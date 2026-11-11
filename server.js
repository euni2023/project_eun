import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, update, newId } from "./store.js";
import * as ai from "./ai.js";
import { translateCached } from "./translations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5174;

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n⚠️  ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 파일에 키를 넣어주세요.\n",
  );
}

// AI 호출을 감싸 에러를 사용자 친화적으로 반환
function aiRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      const msg =
        err?.status === 401
          ? "API 키가 유효하지 않습니다. .env 의 ANTHROPIC_API_KEY 를 확인하세요."
          : err?.status === 429
            ? "요청이 많아 잠시 후 다시 시도해주세요."
            : (err?.message || "AI 응답 중 오류가 발생했습니다.");
      res.status(500).json({ error: msg });
    }
  };
}

// ── 날짜/통계 헬퍼 ────────────────────────────────────────────────
const MILESTONES = [15, 30, 50, 100, 200, 365];

function ymd(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function computeStats(entries) {
  const dates = new Set(entries.map((e) => e.date));
  const totalDays = dates.size;

  // 연속 기록: 오늘(또는 어제까지 유예)부터 거슬러 올라가며 계산
  let streak = 0;
  const cursor = new Date();
  if (!dates.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1); // 오늘 아직 안 썼으면 어제부터
  while (dates.has(ymd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const achieved = MILESTONES.filter((m) => totalDays >= m);
  const nextMilestone = MILESTONES.find((m) => totalDays < m) || null;
  return {
    totalDays,
    streak,
    achieved,
    nextMilestone,
    milestones: MILESTONES,
    remainingToNext: nextMilestone ? nextMilestone - totalDays : 0,
  };
}

// ── 매일 글쓰기 ───────────────────────────────────────────────────
// prompts: { [날짜]: 오늘의 질문 }, words: { [날짜]: 오늘의 단어 + 대화 }
const DAILY_DEFAULT = { entries: [], prompts: {}, words: {} };
const WORKS_DEFAULT = { works: [] };

async function loadDaily() {
  const d = await load("daily", DAILY_DEFAULT);
  d.prompts = d.prompts || {};
  d.words = d.words || {};
  return d;
}
function updateDaily(mutator) {
  return update("daily", DAILY_DEFAULT, (d) => {
    d.prompts = d.prompts || {};
    d.words = d.words || {};
    return mutator(d);
  });
}

// 등록된 작품의 질문 중 하나를 무작위로 고른다. 최근에 나온 질문은 가능하면 피한다.
function pickPrompt(works, prompts, exclude) {
  const pool = works.flatMap((w) =>
    (w.questions || []).map((question) => ({
      workId: w.id,
      title: w.title,
      author: w.author || "",
      question,
    })),
  );
  if (!pool.length) return null;
  const recent = new Set(
    Object.keys(prompts)
      .sort()
      .slice(-30)
      .map((k) => prompts[k]?.question),
  );
  if (exclude) recent.add(exclude);
  const fresh = pool.filter((p) => !recent.has(p.question));
  const from = fresh.length ? fresh : pool.filter((p) => p.question !== exclude);
  const list = from.length ? from : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// 오늘의 질문 조회(없으면 고르고 저장). shuffle 이면 다른 질문으로 교체.
async function todayPrompt({ shuffle = false } = {}) {
  const { works } = await load("works", WORKS_DEFAULT);
  const today = ymd(new Date());
  return updateDaily((d) => {
    const cur = d.prompts[today];
    const valid = cur && works.some((w) => w.id === cur.workId);
    if (valid && !shuffle) return cur;
    const p = pickPrompt(works, d.prompts, cur?.question);
    if (p) d.prompts[today] = p;
    else delete d.prompts[today];
    return p;
  });
}

app.get("/api/daily/prompt", async (_req, res) => {
  res.json({ prompt: await todayPrompt() });
});
app.post("/api/daily/prompt/shuffle", async (_req, res) => {
  res.json({ prompt: await todayPrompt({ shuffle: true }) });
});

// 오늘의 단어 — 하루에 한 번만 만든다(동시 요청 시 중복 생성 방지).
let wordPending = null;
app.get(
  "/api/daily/word",
  aiRoute(async (_req, res) => {
    const today = ymd(new Date());
    const d = await loadDaily();
    if (d.words[today]) return res.json({ word: d.words[today] });
    if (!wordPending) {
      const used = Object.values(d.words).map((w) => w.word);
      wordPending = ai
        .pickWord(used)
        .then((w) =>
          updateDaily((dd) => {
            if (!dd.words[today])
              dd.words[today] = { ...w, messages: [], createdAt: new Date().toISOString() };
            return dd.words[today];
          }),
        )
        .finally(() => (wordPending = null));
    }
    res.json({ word: await wordPending });
  }),
);

app.post(
  "/api/daily/word/message",
  aiRoute(async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "내용을 입력하세요." });
    const today = ymd(new Date());
    const d = await loadDaily();
    const word = d.words[today];
    if (!word) return res.status(404).json({ error: "오늘의 단어가 아직 없어요." });

    const reply = await ai.wordChat(word, text);
    await updateDaily((dd) => {
      const w = dd.words[today];
      w.messages = w.messages || [];
      w.messages.push({ role: "user", text }, { role: "assistant", text: reply });
    });
    res.json({ reply });
  }),
);

app.get("/api/daily", async (_req, res) => {
  const data = await loadDaily();
  const entries = [...data.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  res.json({ entries, stats: computeStats(data.entries) });
});

app.post(
  "/api/daily",
  aiRoute(async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "글 내용을 입력하세요." });

    const before = await loadDaily();
    const statsBefore = computeStats(before.entries);
    const dayCount = statsBefore.totalDays + (before.entries.some(e => e.date === ymd(new Date())) ? 0 : 1);
    const prompt = before.prompts[ymd(new Date())] || null; // 글을 쓸 때 본 오늘의 질문

    const feedback = await ai.dailyFeedback(text, {
      dayCount,
      streak: statsBefore.streak,
      prompt: prompt?.question,
    });

    const entry = {
      id: newId(),
      date: ymd(new Date()),
      text,
      prompt,
      feedback,
      createdAt: new Date().toISOString(),
    };
    await updateDaily((d) => {
      d.entries.push(entry);
    });
    const after = await loadDaily();
    res.json({ entry, stats: computeStats(after.entries) });
  }),
);

// ── 나의 서재 (좋아하는 작품 → 오늘의 질문 재료) ───────────────────
app.get("/api/works", async (_req, res) => {
  const { works } = await load("works", WORKS_DEFAULT);
  res.json({
    works: [...works].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
});

app.post(
  "/api/works",
  aiRoute(async (req, res) => {
    const title = (req.body?.title || "").trim();
    const author = (req.body?.author || "").trim();
    const note = (req.body?.note || "").trim();
    if (!title) return res.status(400).json({ error: "작품 제목을 입력하세요." });

    const { questions, authorInfo } = await ai.workQuestions({ title, author, note });
    const work = {
      id: newId(),
      title,
      author: author || authorInfo.name, // 저자를 비워두면 AI가 알아낸 이름으로
      note,
      questions,
      authorInfo,
      createdAt: new Date().toISOString(),
    };
    await update("works", WORKS_DEFAULT, (d) => d.works.push(work));
    res.json({ work });
  }),
);

// 질문 · 작가 정보 다시 만들기
app.post(
  "/api/works/:id/questions",
  aiRoute(async (req, res) => {
    const { works } = await load("works", WORKS_DEFAULT);
    const w = works.find((x) => x.id === req.params.id);
    if (!w) return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    const { questions, authorInfo } = await ai.workQuestions(w);
    let saved;
    await update("works", WORKS_DEFAULT, (d) => {
      const x = d.works.find((x) => x.id === req.params.id);
      if (!x) return;
      x.questions = questions;
      x.authorInfo = authorInfo;
      if (!x.author) x.author = authorInfo.name;
      saved = x;
    });
    res.json({ work: saved });
  }),
);

app.delete("/api/works/:id", async (req, res) => {
  await update("works", WORKS_DEFAULT, (d) => {
    d.works = d.works.filter((w) => w.id !== req.params.id);
  });
  res.json({ ok: true });
});

// ── 번역 (한국어 → 영어) ──────────────────────────────────────────
app.post(
  "/api/translate",
  aiRoute(async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "번역할 내용이 없습니다." });
    // 이미 번역한 문단은 저장해둔 것을 재사용하고, 새 문단만 API를 호출한다.
    const { translation, cached, stats } = await translateCached(text, ai.translate);
    res.json({ translation, cached, stats });
  }),
);

// ── 스토리 쓰기 (주제 카테고리 → 개요 → 하위 스토리) ──────────────
const STORY_DEFAULT = { categories: [] };

// 예전 { projects:[...] } 형식을 { categories:[...] } 로 이전 + 필드 보정
function normalizeStory(d) {
  if (!d.categories) {
    const projects = d.projects || [];
    // 고정 id/날짜로 이전 — 저장 전에도 재조회 시 동일 id 유지(404 방지)
    d.categories = projects.length
      ? [
          {
            id: "cat-legacy",
            title: "기본 주제",
            outline: "",
            stories: projects,
            createdAt: projects[0].createdAt || "2026-01-01T00:00:00.000Z",
          },
        ]
      : [];
  }
  delete d.projects;
  for (const c of d.categories) {
    c.stories = c.stories || [];
    if (c.outline == null) c.outline = "";
    for (const s of c.stories) {
      s.segments = s.segments || [];
      s.qa = s.qa || [];
    }
  }
  return d;
}
async function loadStory() {
  return normalizeStory(await load("story", STORY_DEFAULT));
}
function updateStory(mutator) {
  return update("story", STORY_DEFAULT, async (d) => {
    normalizeStory(d);
    return mutator(d);
  });
}
const findCat = (d, cid) => d.categories.find((c) => c.id === cid);
const findStory = (c, sid) => (c ? (c.stories || []).find((s) => s.id === sid) : null);

// 주제(카테고리) 목록/생성/조회/수정/삭제
app.get("/api/story/categories", async (_req, res) => {
  const data = await loadStory();
  const categories = [...data.categories]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      id: c.id,
      title: c.title,
      outline: c.outline,
      storyCount: c.stories.length,
      createdAt: c.createdAt,
    }));
  res.json({ categories });
});

app.post("/api/story/categories", async (req, res) => {
  const title = (req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "주제를 입력하세요." });
  const category = {
    id: newId(),
    title,
    outline: typeof req.body?.outline === "string" ? req.body.outline : "",
    stories: [],
    createdAt: new Date().toISOString(),
  };
  await updateStory((d) => d.categories.push(category));
  res.json({ category });
});

app.get("/api/story/categories/:cid", async (req, res) => {
  const data = await loadStory();
  const c = findCat(data, req.params.cid);
  if (!c) return res.status(404).json({ error: "주제를 찾을 수 없습니다." });
  res.json({
    category: {
      id: c.id,
      title: c.title,
      outline: c.outline,
      createdAt: c.createdAt,
      stories: [...c.stories]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((s) => ({
          id: s.id,
          title: s.title,
          segmentCount: s.segments.length,
          createdAt: s.createdAt,
        })),
    },
  });
});

app.patch("/api/story/categories/:cid", async (req, res) => {
  let updated = null;
  await updateStory((d) => {
    const c = findCat(d, req.params.cid);
    if (!c) return;
    if (typeof req.body?.title === "string" && req.body.title.trim())
      c.title = req.body.title.trim();
    if (typeof req.body?.outline === "string") c.outline = req.body.outline;
    updated = c;
  });
  if (!updated) return res.status(404).json({ error: "주제를 찾을 수 없습니다." });
  res.json({ ok: true, title: updated.title, outline: updated.outline });
});

app.delete("/api/story/categories/:cid", async (req, res) => {
  await updateStory((d) => {
    d.categories = d.categories.filter((c) => c.id !== req.params.cid);
  });
  res.json({ ok: true });
});

// AI: 주제 추천 / 개요 초안
app.post(
  "/api/story/suggest-theme",
  aiRoute(async (req, res) => {
    const theme = await ai.suggestTheme((req.body?.hint || "").trim());
    res.json({ theme });
  }),
);

// 제목만으로 개요 초안 (아직 저장 안 된 새 주제용)
app.post(
  "/api/story/outline-draft",
  aiRoute(async (req, res) => {
    const title = (req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "주제를 입력하세요." });
    const outline = await ai.outlineDraft(title, (req.body?.current || "").trim());
    res.json({ outline });
  }),
);

app.post(
  "/api/story/categories/:cid/outline-draft",
  aiRoute(async (req, res) => {
    const data = await loadStory();
    const c = findCat(data, req.params.cid);
    if (!c) return res.status(404).json({ error: "주제를 찾을 수 없습니다." });
    const outline = await ai.outlineDraft(c.title, c.outline);
    res.json({ outline });
  }),
);

// 하위 스토리 생성/조회/수정/삭제
app.post("/api/story/categories/:cid/stories", async (req, res) => {
  const title = (req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "스토리 제목을 입력하세요." });
  let story = null;
  await updateStory((d) => {
    const c = findCat(d, req.params.cid);
    if (!c) return;
    story = {
      id: newId(),
      title,
      premise: "",
      mode: "critic",
      segments: [],
      qa: [],
      createdAt: new Date().toISOString(),
    };
    c.stories.push(story);
  });
  if (!story) return res.status(404).json({ error: "주제를 찾을 수 없습니다." });
  res.json({ story });
});

app.get("/api/story/categories/:cid/stories/:sid", async (req, res) => {
  const data = await loadStory();
  const c = findCat(data, req.params.cid);
  const s = findStory(c, req.params.sid);
  if (!s) return res.status(404).json({ error: "스토리를 찾을 수 없습니다." });
  res.json({ story: s, outline: c.outline });
});

app.patch("/api/story/categories/:cid/stories/:sid", async (req, res) => {
  let updated = null;
  await updateStory((d) => {
    const s = findStory(findCat(d, req.params.cid), req.params.sid);
    if (!s) return;
    if (typeof req.body?.title === "string" && req.body.title.trim())
      s.title = req.body.title.trim();
    updated = s;
  });
  if (!updated) return res.status(404).json({ error: "스토리를 찾을 수 없습니다." });
  res.json({ ok: true, title: updated.title });
});

app.delete("/api/story/categories/:cid/stories/:sid", async (req, res) => {
  await updateStory((d) => {
    const c = findCat(d, req.params.cid);
    if (c) c.stories = c.stories.filter((s) => s.id !== req.params.sid);
  });
  res.json({ ok: true });
});

// 스토리 이어쓰기(피드백) / 단락 수정 / 질의응답
app.post(
  "/api/story/categories/:cid/stories/:sid/segment",
  aiRoute(async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "쓴 내용을 입력하세요." });
    const data = await loadStory();
    const c = findCat(data, req.params.cid);
    const s = findStory(c, req.params.sid);
    if (!s) return res.status(404).json({ error: "스토리를 찾을 수 없습니다." });

    const feedback = await ai.storyFeedback(s, text, c.outline);
    const segment = {
      id: newId(),
      text,
      feedback,
      createdAt: new Date().toISOString(),
    };
    await updateStory((d) => {
      const ss = findStory(findCat(d, req.params.cid), req.params.sid);
      ss.segments.push(segment);
    });
    res.json({ segment });
  }),
);

app.patch(
  "/api/story/categories/:cid/stories/:sid/segment/:segid",
  async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "내용을 입력하세요." });
    let seg = null;
    await updateStory((d) => {
      const s = findStory(findCat(d, req.params.cid), req.params.sid);
      if (!s) return;
      const g = (s.segments || []).find((x) => x.id === req.params.segid);
      if (g) {
        g.text = text;
        seg = g;
      }
    });
    if (!seg) return res.status(404).json({ error: "단락을 찾을 수 없습니다." });
    res.json({ ok: true, segment: seg });
  },
);

app.post(
  "/api/story/categories/:cid/stories/:sid/ask",
  aiRoute(async (req, res) => {
    const question = (req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "질문을 입력하세요." });
    const data = await loadStory();
    const c = findCat(data, req.params.cid);
    const s = findStory(c, req.params.sid);
    if (!s) return res.status(404).json({ error: "스토리를 찾을 수 없습니다." });

    const answer = await ai.storyAsk(s, question, c.outline);
    const qa = {
      id: newId(),
      question,
      answer,
      createdAt: new Date().toISOString(),
    };
    await updateStory((d) => {
      const ss = findStory(findCat(d, req.params.cid), req.params.sid);
      ss.qa.push(qa);
    });
    res.json({ qa });
  }),
);

// ── 독서토론 ──────────────────────────────────────────────────────
const BOOK_DEFAULT = { sessions: [] };

// 대화를 클라이언트 표시용으로 변환 (이미지 원본 데이터는 제외)
function displayMessages(messages) {
  return messages.map((m) => {
    let text = "";
    let hasImage = false;
    if (typeof m.content === "string") text = m.content;
    else
      for (const block of m.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "image") hasImage = true;
      }
    return { role: m.role, text, hasImage };
  });
}

app.get("/api/book", async (_req, res) => {
  const data = await load("book", BOOK_DEFAULT);
  const sessions = [...data.sessions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({
      id: s.id,
      title: s.title,
      sourceType: s.sourceType,
      createdAt: s.createdAt,
      turns: s.messages.length,
    }));
  res.json({ sessions });
});

app.get("/api/book/:id", async (req, res) => {
  const data = await load("book", BOOK_DEFAULT);
  const s = data.sessions.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });
  res.json({
    session: {
      id: s.id,
      title: s.title,
      sourceType: s.sourceType,
      createdAt: s.createdAt,
      messages: displayMessages(s.messages),
    },
  });
});

app.delete("/api/book/:id", async (req, res) => {
  await update("book", BOOK_DEFAULT, (d) => {
    d.sessions = d.sessions.filter((s) => s.id !== req.params.id);
  });
  res.json({ ok: true });
});

app.post(
  "/api/book",
  aiRoute(async (req, res) => {
    const sourceType = req.body?.sourceType; // "title" | "text" | "image"
    const title = (req.body?.title || "").trim();
    const sourceText = (req.body?.sourceText || "").trim();
    const image = req.body?.image; // data URL

    if (sourceType === "title" && !title)
      return res.status(400).json({ error: "책 제목을 입력하세요." });
    if (sourceType === "text" && !sourceText)
      return res.status(400).json({ error: "읽은 내용을 입력하세요." });
    if (sourceType === "image" && !image)
      return res.status(400).json({ error: "사진을 업로드하세요." });

    const opening = ai.buildBookOpeningTurn({
      sourceType,
      title,
      sourceText,
      image,
    });
    const firstReply = await ai.bookReply([opening]);

    const messages = [
      opening,
      { role: "assistant", content: firstReply },
    ];
    const session = {
      id: newId(),
      title: title || (sourceType === "image" ? "사진 자료" : "읽은 부분"),
      sourceType,
      messages,
      createdAt: new Date().toISOString(),
    };
    await update("book", BOOK_DEFAULT, (d) => d.sessions.push(session));
    res.json({
      session: {
        id: session.id,
        title: session.title,
        sourceType: session.sourceType,
        createdAt: session.createdAt,
        messages: displayMessages(messages),
      },
    });
  }),
);

app.post(
  "/api/book/:id/message",
  aiRoute(async (req, res) => {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "메시지를 입력하세요." });
    const data = await load("book", BOOK_DEFAULT);
    const s = data.sessions.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });

    const convo = [...s.messages, { role: "user", content: text }];
    const reply = await ai.bookReply(convo);

    await update("book", BOOK_DEFAULT, (d) => {
      const sess = d.sessions.find((x) => x.id === req.params.id);
      sess.messages.push({ role: "user", content: text });
      sess.messages.push({ role: "assistant", content: reply });
    });
    res.json({ reply });
  }),
);

// ── 필사 (책을 보며 직접 옮겨 쓰기 + 내 생각) ──────────────────────
// books: [{ id, title, author, publisher, createdAt,
//   entries: [{ id, date, page, text, thoughts: [{ id, text, createdAt }], analysis, createdAt }] }]
const COPY_DEFAULT = { books: [] };

function loadCopyData() {
  return load("copy", COPY_DEFAULT).then((d) => ((d.books = d.books || []), d));
}
function updateCopy(mutator) {
  return update("copy", COPY_DEFAULT, (d) => {
    d.books = d.books || [];
    return mutator(d);
  });
}
const allCopyEntries = (books) => books.flatMap((b) => b.entries || []);
const cleanText = (t) => (t || "").replace(/\r\n?/g, "\n").trim();

function copyFind(d, bid, eid) {
  const book = d.books.find((b) => b.id === bid);
  const entry = eid ? book?.entries.find((e) => e.id === eid) : null;
  return { book, entry };
}

async function copyResponse(res, extra = {}) {
  const { books } = await loadCopyData();
  res.json({
    ...extra,
    books: [...books].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    stats: computeStats(allCopyEntries(books)),
  });
}

app.get("/api/copy", async (_req, res) => copyResponse(res));

function bookFields(body) {
  return {
    title: (body?.title || "").trim(),
    author: (body?.author || "").trim(),
    publisher: (body?.publisher || "").trim(),
  };
}

app.post("/api/copy/books", async (req, res) => {
  const f = bookFields(req.body);
  if (!f.title) return res.status(400).json({ error: "책 제목을 입력하세요." });
  const book = { id: newId(), ...f, entries: [], createdAt: new Date().toISOString() };
  await updateCopy((d) => d.books.push(book));
  copyResponse(res, { bookId: book.id });
});

app.patch("/api/copy/books/:bid", async (req, res) => {
  const f = bookFields(req.body);
  if (!f.title) return res.status(400).json({ error: "책 제목을 입력하세요." });
  await updateCopy((d) => {
    const { book } = copyFind(d, req.params.bid);
    if (book) Object.assign(book, f);
  });
  copyResponse(res);
});

app.delete("/api/copy/books/:bid", async (req, res) => {
  await updateCopy((d) => {
    d.books = d.books.filter((b) => b.id !== req.params.bid);
  });
  copyResponse(res);
});

// 필사 한 대목 저장 (함께 쓴 내 생각이 있으면 첫 생각으로)
app.post("/api/copy/books/:bid/entries", async (req, res) => {
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: "필사한 문장을 입력하세요." });
  const thought = cleanText(req.body?.thought);
  const now = new Date().toISOString();
  const entry = {
    id: newId(),
    date: ymd(new Date()),
    page: (req.body?.page || "").toString().trim(),
    text,
    thoughts: thought ? [{ id: newId(), text: thought, createdAt: now }] : [],
    analysis: null,
    createdAt: now,
  };
  let ok = false;
  await updateCopy((d) => {
    const { book } = copyFind(d, req.params.bid);
    if (!book) return;
    book.entries.push(entry);
    ok = true;
  });
  if (!ok) return res.status(404).json({ error: "책을 찾을 수 없습니다." });
  copyResponse(res, { entryId: entry.id });
});

app.patch("/api/copy/books/:bid/entries/:eid", async (req, res) => {
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: "필사한 문장을 입력하세요." });
  await updateCopy((d) => {
    const { entry } = copyFind(d, req.params.bid, req.params.eid);
    if (!entry) return;
    if (entry.text !== text) entry.analysis = null;
    entry.text = text;
    entry.page = (req.body?.page || "").toString().trim();
  });
  copyResponse(res);
});

app.delete("/api/copy/books/:bid/entries/:eid", async (req, res) => {
  await updateCopy((d) => {
    const { book } = copyFind(d, req.params.bid);
    if (book) book.entries = book.entries.filter((e) => e.id !== req.params.eid);
  });
  copyResponse(res);
});

// 이미 쓴 대목에 생각 더하기 / 지우기
app.post("/api/copy/books/:bid/entries/:eid/thoughts", async (req, res) => {
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: "생각을 입력하세요." });
  await updateCopy((d) => {
    const { entry } = copyFind(d, req.params.bid, req.params.eid);
    if (entry) entry.thoughts.push({ id: newId(), text, createdAt: new Date().toISOString() });
  });
  copyResponse(res);
});

app.delete("/api/copy/books/:bid/entries/:eid/thoughts/:tid", async (req, res) => {
  await updateCopy((d) => {
    const { entry } = copyFind(d, req.params.bid, req.params.eid);
    if (entry) entry.thoughts = entry.thoughts.filter((t) => t.id !== req.params.tid);
  });
  copyResponse(res);
});

app.post(
  "/api/copy/books/:bid/entries/:eid/analysis",
  aiRoute(async (req, res) => {
    const d = await loadCopyData();
    const { book, entry } = copyFind(d, req.params.bid, req.params.eid);
    if (!entry) return res.status(404).json({ error: "필사 기록을 찾을 수 없습니다." });
    const analysis = await ai.copyAnalysis({
      title: book.title,
      author: book.author,
      text: entry.text,
      thoughts: entry.thoughts.map((t) => t.text),
    });
    await updateCopy((dd) => {
      const { entry: e } = copyFind(dd, req.params.bid, req.params.eid);
      if (e) e.analysis = analysis;
    });
    res.json({ analysis });
  }),
);

app.listen(PORT, () => {
  console.log(`\n✅  글벗 서버 실행 중 →  http://localhost:${PORT}\n`);
});
