// ── 유틸 ──────────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 3200);
}
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.error ||
        (res.status === 404
          ? "서버에 없는 기능이에요(404). 서버를 재시작한 뒤 새로고침해 주세요."
          : `요청 실패 (${res.status})`),
    );
  return data;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function preview(text, n = 22) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t || "(내용 없음)";
}
function withLoading(btn, label, fn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  return Promise.resolve()
    .then(fn)
    .catch((e) => toast(e.message))
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = orig;
    });
}
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 탭 전환 ───────────────────────────────────────────────────────
$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const id = tab.dataset.tab;
    $(`#${id}`).classList.add("active");
    if (id === "daily") loadDaily();
    if (id === "story") loadStories();
    if (id === "book") loadBooks();
    if (id === "works") loadWorks();
    if (id === "copy") loadCopy();
  }),
);

// ══════════════════════════════════════════════════════════════════
// 1. 매일 글쓰기
// ══════════════════════════════════════════════════════════════════
// 등록된 작품이 없을 때 쓰는 기본 질문
const PROMPTS = [
  "오늘 가장 마음에 남은 순간은?",
  "지금 이 감정에 이름을 붙인다면?",
  "오늘 나를 스쳐 간 작은 발견 하나.",
  "누군가에게 하고 싶었던 말.",
  "오늘의 나에게 건네는 한 문장.",
  "창밖, 혹은 주변에서 본 장면 하나.",
  "요즘 자꾸 떠오르는 생각.",
  "오늘 고마웠던 사람이나 순간.",
  "만약 오늘을 한 단어로 남긴다면?",
  "지금 이 순간의 온도, 소리, 냄새.",
];

let dailyEntries = [];
let currentDailyEntry = null;

async function loadDaily() {
  const data = await api("/api/daily");
  dailyEntries = data.entries;
  renderMilestones(data.stats);
  renderTodayNote(data.stats);
  renderDailyList();
  showDailyWrite();
  const todayEntry = dailyEntries.find((e) => e.date === todayYmd());
  currentDailyEntry = todayEntry || null;
  loadTodayPrompt().catch((e) => toast(e.message));
  loadWord();
}

function renderTodayNote(s) {
  const now = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
  $("#todayNote").innerHTML = `
    <div class="today-date">📅 ${dateStr}</div>
    ${s.streak > 0 ? `<div>연속 <b>${s.streak}일째</b> 이어가고 있어요. 🔥</div>` : `<div>오늘 첫 문장을 남겨보세요.</div>`}`;
}

// ── 오늘의 질문 (나의 서재에 등록한 작품에서 매일 하나) ──
function fallbackPrompt() {
  const now = new Date();
  const idx =
    (now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate()) %
    PROMPTS.length;
  return PROMPTS[idx];
}
function promptSource(p) {
  return `${escapeHtml(p.title)}${p.author ? ` · ${escapeHtml(p.author)}` : ""}`;
}
function renderTodayPrompt(p) {
  const html = p
    ? `<div class="tp-label">💡 오늘의 질문 <span class="tp-src">— 《${promptSource(p)}》에서</span>
         <button class="mini-link tp-shuffle" title="다른 질문 보기">🎲 다른 질문</button></div>
       <div class="tp-q">“${escapeHtml(p.question)}”</div>`
    : `<div class="tp-label">💡 오늘의 질문</div>
       <div class="tp-q">“${fallbackPrompt()}”</div>
       <div class="tp-empty">📚 <b>나의 서재</b>에 좋아하는 작품을 등록하면 그 작품에서 매일 질문을 드려요.</div>`;
  for (const el of [$("#todayPrompt"), $("#worksTodayPrompt")]) {
    el.innerHTML = html;
    const btn = el.querySelector(".tp-shuffle");
    if (btn) btn.addEventListener("click", shufflePrompt);
  }
}
async function loadTodayPrompt() {
  const { prompt } = await api("/api/daily/prompt");
  renderTodayPrompt(prompt);
}
function shufflePrompt() {
  api("/api/daily/prompt/shuffle", { method: "POST" })
    .then(({ prompt }) => renderTodayPrompt(prompt))
    .catch((e) => toast(e.message));
}

function renderMilestones(s) {
  const nodes = s.milestones
    .map((m) => {
      const done = s.totalDays >= m;
      const next = s.nextMilestone === m;
      return `<div class="ms-vnode ${done ? "done" : ""} ${next ? "next" : ""}">
        <span class="ms-vdot">${done ? "✓" : ""}</span>
        <span class="ms-vlabel">${m}일 마라톤</span>
      </div>`;
    })
    .join("");
  let msg = "";
  if (s.nextMilestone)
    msg = `🏃 다음 목표 <b>${s.nextMilestone}일</b>까지 <b>${s.remainingToNext}일</b> 남았어요!`;
  else if (s.totalDays > 0) msg = "🎉 모든 마일스톤을 달성했어요. 대단합니다!";
  else msg = "첫 글을 써서 여정을 시작해보세요.";

  $("#milestoneBar").innerHTML = `
    <div class="side-stats">
      <div class="ms-stat"><span class="num">${s.totalDays}</span><span class="lbl">총 글쓴 날</span></div>
      <div class="ms-stat"><span class="num">${s.streak}🔥</span><span class="lbl">연속 기록</span></div>
    </div>
    <div class="ms-vtrack">${nodes}</div>
    <div class="ms-msg">${msg}</div>`;
}

function renderDailyList() {
  if (!dailyEntries.length) {
    $("#dailyList").innerHTML = `<div class="mini-empty">아직 쓴 글이 없어요.</div>`;
    return;
  }
  const sorted = [...dailyEntries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  $("#dailyList").innerHTML = sorted
    .map(
      (e) => `
    <div class="mini-item ${currentDailyEntry && currentDailyEntry.id === e.id ? "active" : ""}" data-id="${e.id}">
      <div class="t">${e.date}</div>
      <div class="m">${escapeHtml(preview(e.text))}</div>
    </div>`,
    )
    .join("");
  $$("#dailyList .mini-item").forEach((it) =>
    it.addEventListener("click", () => openDailyEntry(it.dataset.id)),
  );
}

const listHtml = (items) =>
  `<ul>${(items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;

function wordSuggestHtml(ws) {
  if (!ws || !ws.length)
    return `<p>바꿔볼 만한 단어가 따로 보이지 않아요. 단어 선택이 좋습니다.</p>`;
  return ws
    .map(
      (w) => `<div class="ws-item">
        <div class="ws-head"><span class="ws-orig">${escapeHtml(w.original)}</span> → ${(w.alternatives || [])
          .map((a) => `<span class="ws-alt">${escapeHtml(a)}</span>`)
          .join(" ")}</div>
        ${w.context ? `<div class="ws-ctx">“${escapeHtml(w.context)}”</div>` : ""}
        <div class="ws-reason">${escapeHtml(w.reason)}</div>
      </div>`,
    )
    .join("");
}

function feedbackHtml(fb) {
  fb = fb || {};
  // 예전 형식(코멘트 · 마음 돌봄 · 인사이트)으로 저장된 글
  if (!fb.strengths)
    return `
    <div class="fb-block"><h4>💬 AI 코멘트</h4><p>${escapeHtml(fb.comment)}</p></div>
    ${fb.counseling ? `<div class="fb-block counsel"><h4>🌿 마음 돌봄</h4><p>${escapeHtml(fb.counseling)}</p></div>` : ""}
    <div class="fb-block insight"><h4>💡 새로운 인사이트 제안</h4><p>${escapeHtml(fb.insight)}</p></div>`;
  return `
    <div class="fb-block"><h4>💬 AI 코멘트</h4>
      <div class="fb-sub">👍 장점</div>${listHtml(fb.strengths)}
      <div class="fb-sub">🔧 아쉬운 점</div>${listHtml(fb.weaknesses)}
    </div>
    <div class="fb-block insight"><h4>💡 새로운 질문</h4>${listHtml(fb.questions)}</div>
    <div class="fb-block words"><h4>✏️ 바꿔보면 좋을 단어</h4>${wordSuggestHtml(fb.wordSuggestions)}</div>`;
}

// 인쇄/텍스트용 피드백 (새 형식 · 예전 형식 모두)
function feedbackSections(fb) {
  if (!fb) return [];
  if (!fb.strengths)
    return [
      ["AI 코멘트", fb.comment],
      ["마음 돌봄", fb.counseling],
      ["인사이트 제안", fb.insight],
    ].filter(([, t]) => t);
  const bullets = (a) => (a || []).map((t) => `· ${t}`).join("\n");
  return [
    ["AI 코멘트 — 장점", bullets(fb.strengths)],
    ["AI 코멘트 — 아쉬운 점", bullets(fb.weaknesses)],
    ["새로운 질문", bullets(fb.questions)],
    [
      "바꿔보면 좋을 단어",
      (fb.wordSuggestions || [])
        .map((w) => `· ${w.original} → ${(w.alternatives || []).join(", ")} (${w.reason})`)
        .join("\n"),
    ],
  ].filter(([, t]) => t);
}

function showDailyWrite() {
  $("#dailyWriteView").classList.remove("hidden");
  $("#dailyReadView").classList.add("hidden");
}

function openDailyEntry(id) {
  const e = dailyEntries.find((x) => x.id === id);
  if (!e) return;
  $("#dailyWriteView").classList.add("hidden");
  $("#dailyReadView").classList.remove("hidden");
  $("#readDate").innerHTML =
    `📅 ${e.date}` +
    (e.prompt
      ? `<div class="read-prompt">💡 ${escapeHtml(e.prompt.question)} <span class="tp-src">— 《${promptSource(e.prompt)}》</span></div>`
      : "");
  $("#readText").textContent = e.text;
  $("#readFeedback").innerHTML =
    feedbackHtml(e.feedback) + legacyQaHtml(e.qa);
  resetTranslation("#readTranslation", "#dailyTranslate");
  currentDailyEntry = e;
  renderDailyList();
}

// 예전 'AI에게 더 묻기' 기록이 있는 글
function legacyQaHtml(qa) {
  if (!qa || !qa.length) return "";
  return `<div class="fb-block counsel"><h4>🤔 AI에게 더 묻기 (예전 기록)</h4>${qa
    .map(
      (q) => `<div class="qa-item">
        <div class="qa-q">Q. ${escapeHtml(q.question)}</div>
        <div class="qa-a">${escapeHtml(q.answer)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

$("#dailyBackToday").addEventListener("click", () => {
  showDailyWrite();
  const todayEntry = dailyEntries.find((e) => e.date === todayYmd());
  currentDailyEntry = todayEntry || null;
  renderDailyList();
});

// ── 오늘의 단어 (오른쪽): 단어 제시 → 단어에 관한 질문 주고받기 ──
let todayWord = null;

function renderWord() {
  const w = todayWord;
  const on = !!w;
  $("#wordInput").disabled = !on;
  $("#wordSend").disabled = !on;
  if (!w) return;
  $("#wordCard").innerHTML = `
    <div class="wc-word">${escapeHtml(w.word)}</div>
    <div class="wc-meaning">${escapeHtml(w.meaning)}</div>
    <div class="wc-example">예) ${escapeHtml(w.example)}</div>`;
  const msgs = [{ role: "assistant", text: w.question }, ...(w.messages || [])];
  const box = $("#wordChat");
  box.innerHTML = msgs
    .map((m) => `<div class="msg ${m.role}">${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;
}

function loadWord() {
  if (todayWord && todayWord.date === todayYmd()) return renderWord();
  $("#wordCard").innerHTML = `<div class="thinking"><span class="spinner"></span>오늘의 단어를 고르는 중...</div>`;
  $("#wordChat").innerHTML = "";
  api("/api/daily/word")
    .then(({ word }) => {
      todayWord = { ...word, date: todayYmd() };
      renderWord();
    })
    .catch((e) => {
      $("#wordCard").innerHTML = `<p class="tool-hint">${escapeHtml(e.message)}</p>
        <button class="mini-link" id="wordRetry">다시 시도</button>`;
      $("#wordRetry").addEventListener("click", loadWord);
    });
}

function sendWord() {
  const text = $("#wordInput").value.trim();
  if (!text || !todayWord) return;
  todayWord.messages = todayWord.messages || [];
  todayWord.messages.push({ role: "user", text }, { role: "assistant", text: "생각 중..." });
  renderWord();
  $("#wordInput").value = "";
  $("#wordSend").disabled = true;
  api("/api/daily/word/message", { method: "POST", body: JSON.stringify({ text }) })
    .then(({ reply }) => {
      todayWord.messages[todayWord.messages.length - 1].text = reply;
    })
    .catch((e) => {
      todayWord.messages.splice(-2, 2);
      $("#wordInput").value = text;
      toast(e.message);
    })
    .finally(renderWord);
}
$("#wordSend").addEventListener("click", sendWord);
$("#wordInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendWord();
  }
});

$("#dailySubmit").addEventListener("click", () => {
  const text = $("#dailyText").value.trim();
  if (!text) return toast("글 내용을 입력하세요.");
  const fbArea = $("#dailyFeedback");
  fbArea.innerHTML = `<div class="thinking"><span class="spinner"></span>AI가 글을 읽고 있어요...</div>`;
  withLoading($("#dailySubmit"), "생각 중...", async () => {
    const { entry, stats } = await api("/api/daily", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    fbArea.innerHTML = feedbackHtml(entry.feedback);
    $("#dailyText").value = "";
    dailyEntries.push(entry);
    renderMilestones(stats);
    renderDailyList();
    currentDailyEntry = entry;
  });
});

// ══════════════════════════════════════════════════════════════════
// 나의 서재 — 좋아하는 작품 등록 (오늘의 질문 재료)
// ══════════════════════════════════════════════════════════════════
let works = [];

async function loadWorks() {
  const data = await api("/api/works");
  works = data.works;
  renderWorks();
  loadTodayPrompt().catch(() => {});
}

// 작가 소개 · 대표 작품 (예전에 등록한 작품은 '다시 만들기'로 채울 수 있음)
function authorInfoHtml(w) {
  const a = w.authorInfo;
  if (!a)
    return `<div class="author-box"><span class="hint">작가 정보가 없어요. '🔄 다시 만들기'를 누르면 채워져요.</span></div>`;
  if (!a.intro && !(a.works || []).length) return "";
  return `<div class="author-box">
    <div class="fb-sub">✍️ 작가 소개${a.name ? ` — ${escapeHtml(a.name)}` : ""}</div>
    ${a.intro ? `<p>${escapeHtml(a.intro)}</p>` : ""}
    ${(a.works || []).length ? `<div class="fb-sub">대표 작품</div><div class="author-works">${a.works.map((t) => `<span class="ws-alt">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
  </div>`;
}

function renderWorks() {
  if (!works.length) {
    $("#worksList").innerHTML = `<div class="empty-state">아직 등록한 작품이 없어요.<br />왼쪽에서 좋아하는 책을 등록해보세요.</div>`;
    return;
  }
  $("#worksList").innerHTML = works
    .map(
      (w) => `
    <div class="card work-card" data-id="${w.id}">
      <div class="row-between">
        <h3>📖 ${escapeHtml(w.title)}${w.author ? ` <span class="hint">· ${escapeHtml(w.author)}</span>` : ""}</h3>
        <span class="work-actions">
          <button class="mini-link" data-regen="${w.id}">🔄 다시 만들기</button>
          <button class="mini-link" data-del="${w.id}">✕ 삭제</button>
        </span>
      </div>
      ${w.note ? `<div class="work-note">${escapeHtml(w.note)}</div>` : ""}
      ${authorInfoHtml(w)}
      <div class="fb-sub">이 작품에서 나올 오늘의 질문</div>
      ${listHtml(w.questions)}
    </div>`,
    )
    .join("");
  $$("#worksList [data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 작품을 서재에서 삭제할까요?")) return;
      await api(`/api/works/${b.dataset.del}`, { method: "DELETE" }).catch((e) => toast(e.message));
      loadWorks();
    }),
  );
  $$("#worksList [data-regen]").forEach((b) =>
    b.addEventListener("click", () =>
      withLoading(b, "만드는 중...", async () => {
        const { work } = await api(`/api/works/${b.dataset.regen}/questions`, {
          method: "POST",
        });
        works = works.map((w) => (w.id === work.id ? work : w));
        renderWorks();
      }),
    ),
  );
}

$("#workCreate").addEventListener("click", function () {
  const title = $("#workTitle").value.trim();
  if (!title) return toast("작품 제목을 입력하세요.");
  withLoading(this, "질문 만드는 중...", async () => {
    await api("/api/works", {
      method: "POST",
      body: JSON.stringify({
        title,
        author: $("#workAuthor").value.trim(),
        note: $("#workNote").value.trim(),
      }),
    });
    $("#workTitle").value = "";
    $("#workAuthor").value = "";
    $("#workNote").value = "";
    toast("서재에 등록했어요.");
    await loadWorks();
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. 스토리 쓰기
// ══════════════════════════════════════════════════════════════════
let categories = [];
let currentCategory = null; // {id, title, outline, stories:[요약]}
let currentStory = null; // 열려 있는 하위 스토리(전체)

const storyBase = () =>
  `/api/story/categories/${currentCategory.id}/stories/${currentStory.id}`;

async function loadStories() {
  const { categories: cats } = await api("/api/story/categories");
  categories = cats;
  renderCatList();
  if (currentCategory && cats.some((c) => c.id === currentCategory.id)) {
    await selectCategory(currentCategory.id, currentStory && currentStory.id);
  } else {
    currentCategory = null;
    currentStory = null;
    $("#catSelected").classList.add("hidden");
    $("#outlineRight").classList.add("hidden");
    showStoryEmpty();
  }
}

function renderCatList() {
  if (!categories.length) {
    $("#catList").innerHTML = `<div class="mini-empty">아직 주제가 없어요.</div>`;
    return;
  }
  $("#catList").innerHTML = categories
    .map(
      (c) => `
    <div class="mini-item ${currentCategory && currentCategory.id === c.id ? "active" : ""}" data-id="${c.id}">
      <span class="del" data-del="${c.id}" title="삭제">✕</span>
      <div class="t">📂 ${escapeHtml(c.title)}</div>
      <div class="m">📚 ${c.storyCount}편 · ${fmtDate(c.createdAt)}</div>
    </div>`,
    )
    .join("");
  $$("#catList .mini-item").forEach((it) =>
    it.addEventListener("click", (e) => {
      if (e.target.dataset.del) return;
      selectCategory(it.dataset.id);
    }),
  );
  $$("#catList .del").forEach((d) =>
    d.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("이 주제와 하위 스토리를 모두 삭제할까요?")) return;
      await api(`/api/story/categories/${d.dataset.del}`, { method: "DELETE" });
      if (currentCategory && currentCategory.id === d.dataset.del) {
        currentCategory = null;
        currentStory = null;
      }
      loadStories();
    }),
  );
}

// ── 주제 생성 (팝업 모달: 제목 + 초기 개요) ──
function openCatModal() {
  $("#modalCatTitle").value = "";
  $("#modalOutline").value = "";
  $("#catModal").classList.remove("hidden");
  $("#modalCatTitle").focus();
}
function closeCatModal() {
  $("#catModal").classList.add("hidden");
}
$("#catNewBtn").addEventListener("click", openCatModal);
$("#catModalClose").addEventListener("click", closeCatModal);
$("#catModalCancel").addEventListener("click", closeCatModal);
$("#catModal").addEventListener("click", (e) => {
  if (e.target === $("#catModal")) closeCatModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#catModal").classList.contains("hidden"))
    closeCatModal();
});

$("#modalCatSuggest").addEventListener("click", function () {
  withLoading(this, "…", async () => {
    const { theme } = await api("/api/story/suggest-theme", {
      method: "POST",
      body: JSON.stringify({ hint: $("#modalCatTitle").value.trim() }),
    });
    $("#modalCatTitle").value = theme;
    $("#modalCatTitle").focus();
  });
});

$("#modalOutlineDraft").addEventListener("click", function () {
  withLoading(this, "…", async () => {
    const title = $("#modalCatTitle").value.trim();
    if (!title) return toast("먼저 제목을 입력하세요.");
    const { outline } = await api("/api/story/outline-draft", {
      method: "POST",
      body: JSON.stringify({ title, current: $("#modalOutline").value.trim() }),
    });
    const cur = $("#modalOutline").value.trim();
    $("#modalOutline").value = cur ? cur + "\n\n" + outline : outline;
  });
});

$("#catModalCreate").addEventListener("click", function () {
  withLoading(this, "생성", async () => {
    const title = $("#modalCatTitle").value.trim();
    if (!title) return toast("주제를 입력하세요.");
    const outline = $("#modalOutline").value;
    const { category } = await api("/api/story/categories", {
      method: "POST",
      body: JSON.stringify({ title, outline }),
    });
    closeCatModal();
    const { categories: cats } = await api("/api/story/categories");
    categories = cats;
    await selectCategory(category.id);
    renderCatList();
  });
});

// ── 카테고리 선택 ──
async function selectCategory(cid, keepSid) {
  const { category } = await api(`/api/story/categories/${cid}`);
  currentCategory = category;
  $("#catSelected").classList.remove("hidden");
  $("#outlineRight").classList.remove("hidden");
  setOutline(category.outline || "");
  if (keepSid && category.stories.some((s) => s.id === keepSid)) {
    await selectStory(keepSid);
  } else {
    currentStory = null;
    showStoryEmpty();
  }
  renderSubList();
  renderCatList();
}

// ── 개요 저장 / AI 초안 (오른쪽 개요 메모 한 곳) ──
function setOutline(v) {
  $("#outlineText2").value = v;
}
async function saveOutline(silent) {
  if (!currentCategory) return;
  const outline = $("#outlineText2").value;
  await api(`/api/story/categories/${currentCategory.id}`, {
    method: "PATCH",
    body: JSON.stringify({ outline }),
  });
  currentCategory.outline = outline;
  if (!silent) toast("개요를 저장했어요.");
}
$("#outlineText2").addEventListener("blur", () => {
  if (currentCategory && $("#outlineText2").value !== (currentCategory.outline || ""))
    saveOutline(true).catch(() => {});
});
$("#outlineSave2").addEventListener("click", () =>
  saveOutline(false).catch((e) => toast(e.message)),
);
$("#outlineDraft2").addEventListener("click", function () {
  withLoading(this, "…", async () => {
    if (!currentCategory) return toast("주제를 먼저 선택하세요.");
    const { outline } = await api(
      `/api/story/categories/${currentCategory.id}/outline-draft`,
      { method: "POST" },
    );
    const cur = $("#outlineText2").value.trim();
    setOutline(cur ? cur + "\n\n" + outline : outline);
    toast("AI 초안을 넣었어요. 확인 후 저장하세요.");
  });
});

// ── 하위 스토리 목록/생성 ──
function renderSubList() {
  const stories = (currentCategory && currentCategory.stories) || [];
  if (!stories.length) {
    $("#subList").innerHTML = `<div class="mini-empty">아직 스토리가 없어요.</div>`;
    return;
  }
  $("#subList").innerHTML = stories
    .map(
      (s) => `
    <div class="mini-item ${currentStory && currentStory.id === s.id ? "active" : ""}" data-id="${s.id}">
      <span class="del" data-del="${s.id}" title="삭제">✕</span>
      <div class="t">✍️ ${escapeHtml(s.title)}</div>
      <div class="m">${s.segmentCount}개 단락 · ${fmtDate(s.createdAt)}</div>
    </div>`,
    )
    .join("");
  $$("#subList .mini-item").forEach((it) =>
    it.addEventListener("click", (e) => {
      if (e.target.dataset.del) return;
      selectStory(it.dataset.id);
    }),
  );
  $$("#subList .del").forEach((d) =>
    d.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("이 스토리를 삭제할까요?")) return;
      await api(
        `/api/story/categories/${currentCategory.id}/stories/${d.dataset.del}`,
        { method: "DELETE" },
      );
      if (currentStory && currentStory.id === d.dataset.del) currentStory = null;
      loadStories();
    }),
  );
}

$("#subCreate").addEventListener("click", () =>
  withLoading($("#subCreate"), "추가", async () => {
    if (!currentCategory) return toast("주제를 먼저 선택하세요.");
    const title = $("#subTitle").value.trim();
    if (!title) return toast("스토리 제목을 입력하세요.");
    const { story } = await api(
      `/api/story/categories/${currentCategory.id}/stories`,
      { method: "POST", body: JSON.stringify({ title }) },
    );
    $("#subTitle").value = "";
    await selectCategory(currentCategory.id, story.id);
    const { categories: cats } = await api("/api/story/categories");
    categories = cats;
    renderCatList();
  }),
);

async function selectStory(sid) {
  const { story } = await api(
    `/api/story/categories/${currentCategory.id}/stories/${sid}`,
  );
  openStoryWith(story);
  renderSubList();
}

function showStoryEmpty() {
  $("#storyEmpty").classList.remove("hidden");
  $("#storyWork").classList.add("hidden");
  $("#storyQuestion").disabled = true;
  $("#storyAskBtn").disabled = true;
  $("#storyAskHint").textContent = "스토리를 선택하면 질문할 수 있어요.";
  $("#storyQa").innerHTML = "";
}

function openStoryWith(story) {
  currentStory = story;
  currentStory.segments = story.segments || [];
  currentStory.qa = story.qa || [];
  $("#storyEmpty").classList.add("hidden");
  $("#storyWork").classList.remove("hidden");
  $("#storyDetailTitle").textContent = story.title;
  $("#storyCatLabel").textContent = currentCategory
    ? `주제: ${currentCategory.title}`
    : "";
  renderSegments(currentStory.segments);
  $("#storyQuestion").disabled = false;
  $("#storyAskBtn").disabled = false;
  $("#storyAskHint").textContent = "전개 방향, 캐릭터, 표현 등 무엇이든 물어보세요.";
  renderStoryQa(currentStory.qa);
  resetTranslation("#storyTranslation", "#storyTranslate");
  delete currentStory._tr;
  delete currentStory._trInfo;
  $("#segmentText").value = "";
  $("#storyQuestion").value = "";
}

$("#storyRename").addEventListener("click", async () => {
  if (!currentStory) return;
  const nt = prompt("새 스토리 제목", currentStory.title);
  if (nt == null) return;
  const title = nt.trim();
  if (!title) return;
  try {
    await api(storyBase(), { method: "PATCH", body: JSON.stringify({ title }) });
    currentStory.title = title;
    $("#storyDetailTitle").textContent = title;
    const s = currentCategory.stories.find((x) => x.id === currentStory.id);
    if (s) s.title = title;
    renderSubList();
  } catch (e) {
    toast(e.message);
  }
});

function renderSegments(segments) {
  if (!segments.length) {
    $("#storySegments").innerHTML = `<p class="hint" style="padding:0 4px">아직 쓴 부분이 없어요. 위에서 이야기를 시작해보세요.</p>`;
    return;
  }
  $("#storySegments").innerHTML = segments
    .map(
      (s, i) => `
    <div class="segment" data-id="${s.id}">
      <div class="seg-head">
        <span class="seg-no">${i + 1}부</span>
        <button class="mini-link seg-edit" data-id="${s.id}">✏️ 수정</button>
      </div>
      <div class="seg-text">${escapeHtml(s.text)}</div>
      <div class="seg-fb-label">📝 전문 작가 피드백</div>
      <div class="seg-fb">${escapeHtml(s.feedback)}</div>
    </div>`,
    )
    .join("");
  $$("#storySegments .seg-edit").forEach((b) =>
    b.addEventListener("click", () => editSegment(b.dataset.id)),
  );
}

function editSegment(id) {
  const seg = currentStory.segments.find((s) => s.id === id);
  if (!seg) return;
  const segEl = document.querySelector(`#storySegments .segment[data-id="${id}"]`);
  const textDiv = segEl.querySelector(".seg-text");
  const ta = document.createElement("textarea");
  ta.className = "seg-editor";
  ta.value = seg.text;
  ta.rows = Math.min(20, Math.max(4, seg.text.split("\n").length + 1));
  textDiv.replaceWith(ta);
  const head = segEl.querySelector(".seg-head");
  head.innerHTML = `<span class="seg-no">수정 중</span><span><button class="mini-link seg-save">💾 저장</button> <button class="mini-link seg-cancel">취소</button></span>`;
  head
    .querySelector(".seg-cancel")
    .addEventListener("click", () => renderSegments(currentStory.segments));
  head.querySelector(".seg-save").addEventListener("click", async () => {
    const text = ta.value.trim();
    if (!text) return toast("내용을 입력하세요.");
    try {
      await api(`${storyBase()}/segment/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
      seg.text = text;
      delete currentStory._tr;
      delete currentStory._trInfo;
      resetTranslation("#storyTranslation", "#storyTranslate");
      renderSegments(currentStory.segments);
    } catch (e) {
      toast(e.message);
    }
  });
  ta.focus();
}

function renderStoryQa(qa) {
  $("#storyQa").innerHTML = (qa || [])
    .map(
      (q) => `<div class="qa-item">
        <div class="qa-q">Q. ${escapeHtml(q.question)}</div>
        <div class="qa-a">${escapeHtml(q.answer)}</div>
      </div>`,
    )
    .join("");
}

$("#segmentSubmit").addEventListener("click", () => {
  const text = $("#segmentText").value.trim();
  if (!text || !currentStory) return toast("쓴 내용을 입력하세요.");
  withLoading($("#segmentSubmit"), "작가가 읽는 중...", async () => {
    const { segment } = await api(`${storyBase()}/segment`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    currentStory.segments.push(segment);
    renderSegments(currentStory.segments);
    delete currentStory._tr;
    delete currentStory._trInfo;
    resetTranslation("#storyTranslation", "#storyTranslate");
    $("#segmentText").value = "";
    const s = currentCategory.stories.find((x) => x.id === currentStory.id);
    if (s) s.segmentCount = currentStory.segments.length;
    renderSubList();
  });
});

$("#storyAskBtn").addEventListener("click", () => {
  const question = $("#storyQuestion").value.trim();
  if (!question || !currentStory) return;
  withLoading($("#storyAskBtn"), "…", async () => {
    const { qa } = await api(`${storyBase()}/ask`, {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    currentStory.qa.push(qa);
    renderStoryQa(currentStory.qa);
    $("#storyQuestion").value = "";
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. 독서토론
// ══════════════════════════════════════════════════════════════════
let bookSessions = [];
let currentBook = null;
let bookSource = "title";
let bookImageData = null;

const SOURCE_LABEL = { title: "📗 책 제목", text: "📄 읽은 텍스트", image: "🖼️ 사진 자료" };
const THINK_TOOLS = [
  { label: "📝 한 문장 요약", text: "이 부분을 한 문장으로 요약하면, " },
  { label: "⭐ 인상 깊은 점", text: "가장 인상 깊었던 건 " },
  { label: "❓ 질문 만들기", text: "이 부분을 읽고 이런 질문이 떠올랐어: " },
  { label: "💭 내 생각", text: "내 생각에는 " },
  { label: "🔄 다른 관점", text: "다른 관점에서 보면, " },
  { label: "🙋 나라면", text: "내가 그 상황이었다면 " },
];

$$(".src-tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".src-tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    bookSource = t.dataset.src;
    $("#bookTitle").classList.toggle("hidden", bookSource !== "title");
    $("#bookText").classList.toggle("hidden", bookSource !== "text");
    $("#bookImageWrap").classList.toggle("hidden", bookSource !== "image");
  }),
);

$("#bookImage").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    bookImageData = reader.result;
    const img = $("#bookImagePreview");
    img.src = bookImageData;
    img.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

async function loadBooks() {
  const { sessions } = await api("/api/book");
  bookSessions = sessions;
  renderBookList();
  renderThinkTools();
  if (currentBook && sessions.some((s) => s.id === currentBook.id)) {
    // 유지
  } else {
    currentBook = null;
    showBookEmpty();
  }
}

function renderBookList() {
  if (!bookSessions.length) {
    $("#bookSessions").innerHTML = `<div class="mini-empty">아직 토론이 없어요.</div>`;
    return;
  }
  $("#bookSessions").innerHTML = bookSessions
    .map(
      (s) => `
    <div class="mini-item ${currentBook && currentBook.id === s.id ? "active" : ""}" data-id="${s.id}">
      <span class="del" data-del="${s.id}" title="삭제">✕</span>
      <div class="t">${escapeHtml(s.title)}</div>
      <div class="m">${SOURCE_LABEL[s.sourceType] || ""} · 💬 ${s.turns}턴</div>
    </div>`,
    )
    .join("");
  $$("#bookSessions .mini-item").forEach((it) =>
    it.addEventListener("click", (e) => {
      if (e.target.dataset.del) return;
      openBook(it.dataset.id);
    }),
  );
  $$("#bookSessions .del").forEach((d) =>
    d.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("이 토론을 삭제할까요?")) return;
      await api(`/api/book/${d.dataset.del}`, { method: "DELETE" });
      if (currentBook && currentBook.id === d.dataset.del) currentBook = null;
      loadBooks();
    }),
  );
}

function showBookEmpty() {
  $("#bookEmpty").classList.remove("hidden");
  $("#bookChatWrap").classList.add("hidden");
  $("#bookMeta").textContent = "토론을 선택하면 표시됩니다.";
}

function renderThinkTools() {
  $("#thinkTools").innerHTML = THINK_TOOLS.map(
    (t, i) => `<button class="chip" data-i="${i}">${t.label}</button>`,
  ).join("");
  $$("#thinkTools .chip").forEach((c) =>
    c.addEventListener("click", () => {
      if (!currentBook) return toast("먼저 토론을 시작하거나 선택하세요.");
      const t = THINK_TOOLS[+c.dataset.i].text;
      const box = $("#chatText");
      box.value = (box.value.trim() ? box.value.replace(/\s*$/, "") + " " : "") + t;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }),
  );
}

$("#bookCreate").addEventListener("click", () => {
  const body = { sourceType: bookSource };
  if (bookSource === "title") {
    body.title = $("#bookTitle").value.trim();
    if (!body.title) return toast("책 제목을 입력하세요.");
  } else if (bookSource === "text") {
    body.sourceText = $("#bookText").value.trim();
    if (!body.sourceText) return toast("읽은 내용을 입력하세요.");
  } else {
    if (!bookImageData) return toast("사진을 업로드하세요.");
    body.image = bookImageData;
    body.title = $("#bookTitle").value.trim();
  }
  withLoading($("#bookCreate"), "AI가 자료를 읽는 중...", async () => {
    const { session } = await api("/api/book", {
      method: "POST",
      body: JSON.stringify(body),
    });
    $("#bookTitle").value = "";
    $("#bookText").value = "";
    bookImageData = null;
    $("#bookImagePreview").classList.add("hidden");
    $("#bookImage").value = "";
    currentBook = session;
    const { sessions } = await api("/api/book");
    bookSessions = sessions;
    renderBookList();
    openBookWith(session);
  });
});

async function openBook(id) {
  const { session } = await api(`/api/book/${id}`);
  openBookWith(session);
  renderBookList();
}

function openBookWith(session) {
  currentBook = session;
  $("#bookEmpty").classList.add("hidden");
  $("#bookChatWrap").classList.remove("hidden");
  $("#bookDetailTitle").textContent = session.title;
  $("#bookMeta").innerHTML = `
    <div class="book-meta-title">${escapeHtml(session.title)}</div>
    <div>${SOURCE_LABEL[session.sourceType] || ""}</div>`;
  renderChat(session.messages);
  $("#chatText").value = "";
}

function renderChat(messages) {
  const box = $("#chatMessages");
  box.innerHTML = messages
    .map((m) => {
      const badge = m.hasImage ? `<span class="img-badge">🖼️ 사진 첨부</span>` : "";
      return `<div class="msg ${m.role}">${badge}${escapeHtml(m.text)}</div>`;
    })
    .join("");
  box.scrollTop = box.scrollHeight;
}

function sendChat() {
  const text = $("#chatText").value.trim();
  if (!text || !currentBook) return;
  currentBook.messages.push({ role: "user", text, hasImage: false });
  renderChat(currentBook.messages);
  $("#chatText").value = "";
  currentBook.messages.push({ role: "assistant", text: "생각 중...", hasImage: false });
  renderChat(currentBook.messages);

  api(`/api/book/${currentBook.id}/message`, {
    method: "POST",
    body: JSON.stringify({ text }),
  })
    .then(({ reply }) => {
      currentBook.messages[currentBook.messages.length - 1].text = reply;
      renderChat(currentBook.messages);
    })
    .catch((e) => {
      currentBook.messages.pop();
      renderChat(currentBook.messages);
      toast(e.message);
    });
}

$("#chatSend").addEventListener("click", sendChat);
$("#chatText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// ══════════════════════════════════════════════════════════════════
// 영어 번역 (토글 + 캐시)
// ══════════════════════════════════════════════════════════════════
function resetTranslation(areaSel, btnSel) {
  const area = $(areaSel);
  if (area) {
    area.classList.add("hidden");
    area.innerHTML = "";
  }
  const btn = $(btnSel);
  if (btn) btn.textContent = "🌐 영어로 보기";
}

function trHtml(text, info) {
  let note = "";
  if (info?.cached) {
    note = `<span class="tr-note">저장된 번역 · API 호출 없음</span>`;
  } else if (info?.stats?.reused) {
    note = `<span class="tr-note">문단 ${info.stats.reused}개 재사용 · ${info.stats.translated}개 새로 번역</span>`;
  }
  return `<div class="tr-label">🌐 ENGLISH TRANSLATION${note}</div>${paras(text)}`;
}

// 대상 객체(obj)에 _tr 로 캐시. getText()는 번역할 원문을 반환.
async function toggleTranslate(btn, areaSel, obj, getText) {
  const area = $(areaSel);
  if (!area.classList.contains("hidden")) {
    area.classList.add("hidden");
    btn.textContent = "🌐 영어로 보기";
    return;
  }
  if (!obj._tr) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "번역 중...";
    try {
      const text = getText();
      if (!text.trim()) {
        toast("번역할 내용이 없어요.");
        return;
      }
      const { translation, cached, stats } = await api("/api/translate", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      obj._tr = translation;
      obj._trInfo = { cached, stats };
    } catch (e) {
      toast(e.message);
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }
  area.innerHTML = trHtml(obj._tr, obj._trInfo);
  area.classList.remove("hidden");
  btn.textContent = "🇰🇷 원문만 보기";
}

$("#dailyTranslate").addEventListener("click", function () {
  if (!currentDailyEntry) return;
  toggleTranslate(this, "#readTranslation", currentDailyEntry, () => currentDailyEntry.text);
});
$("#storyTranslate").addEventListener("click", function () {
  if (!currentStory) return toast("스토리를 선택하세요.");
  toggleTranslate(this, "#storyTranslation", currentStory, () =>
    (currentStory.segments || []).map((s) => s.text).join("\n\n"),
  );
});

// ══════════════════════════════════════════════════════════════════
// 출력 (인쇄 / PDF · 텍스트 다운로드) — 책 형태
// ══════════════════════════════════════════════════════════════════
function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, "<br>");
}
function paras(text) {
  return (text || "")
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
function printDoc(html) {
  $("#printRoot").innerHTML = html;
  window.print();
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── 책 HTML 빌더 ──
function dailyBook(e) {
  return `<div class="book"><div class="book-chapter">
    <div class="bc-head">${e.date}</div>
    ${e.prompt ? `<div class="bc-date">💡 ${escapeHtml(e.prompt.question)} — 《${promptSource(e.prompt)}》</div>` : ""}
    <div class="book-body">${paras(e.text)}</div>
    ${
      e.feedback
        ? `<div class="book-note">${feedbackSections(e.feedback)
            .map(([h, t]) => `<h4>${h}</h4><p>${nl2br(t)}</p>`)
            .join("")}</div>`
        : ""
    }
    ${
      e.qa && e.qa.length
        ? `<div class="book-note">${e.qa.map((q) => `<p class="q">Q. ${escapeHtml(q.question)}</p><p>${nl2br(q.answer)}</p>`).join("")}</div>`
        : ""
    }
  </div></div>`;
}
function dailyAllBook() {
  const sorted = [...dailyEntries].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const from = sorted[0]?.date;
  const to = sorted[sorted.length - 1]?.date;
  const chapters = sorted
    .map(
      (e) =>
        `<div class="book-chapter"><div class="bc-head">${e.date}</div><div class="book-body">${paras(e.text)}</div></div>`,
    )
    .join("");
  return `<div class="book">
    <div class="book-cover">
      <div class="bc-title">나의 글</div>
      <div class="bc-sub">매일 글쓰기 모음</div>
      <div class="bc-meta">${from} ~ ${to} · 총 ${sorted.length}편</div>
    </div>${chapters}</div>`;
}
function storyBook(p) {
  const narrative = (p.segments || []).map((s) => paras(s.text)).join("");
  const fb = (p.segments || [])
    .map((s, i) => `<h4>${i + 1}부 피드백</h4><p>${nl2br(s.feedback)}</p>`)
    .join("");
  return `<div class="book">
    <div class="book-cover">
      <div class="bc-title">${escapeHtml(p.title)}</div>
      ${p.premise ? `<div class="bc-sub">${escapeHtml(p.premise)}</div>` : ""}
    </div>
    <div class="book-chapter">
      <div class="book-body">${narrative || "<p>(아직 내용이 없습니다)</p>"}</div>
      ${fb ? `<div class="book-note"><h4>— 작가 피드백 모음 —</h4>${fb}</div>` : ""}
    </div></div>`;
}
function discussionBook(s) {
  const chat = s.messages
    .map(
      (m) =>
        `<p class="${m.role === "user" ? "me" : ""}"><span class="who">${m.role === "user" ? "나" : "AI"}</span> · ${m.hasImage ? "[사진] " : ""}${nl2br(m.text)}</p>`,
    )
    .join("");
  return `<div class="book">
    <div class="book-cover">
      <div class="bc-title">독서토론</div>
      <div class="bc-sub">${escapeHtml(s.title)}</div>
    </div>
    <div class="book-chapter book-chat">${chat}</div></div>`;
}

// ── 텍스트 빌더 ──
function dailyTxt(e) {
  let t = `[${e.date}] 오늘의 글\n`;
  if (e.prompt) t += `오늘의 질문: ${e.prompt.question} — 《${e.prompt.title}》\n`;
  t += `\n${e.text}\n`;
  for (const [h, body] of feedbackSections(e.feedback)) t += `\n— ${h} —\n${body}\n`;
  if (e.qa && e.qa.length)
    t +=
      `\n— 추가 질문 —\n` +
      e.qa.map((q) => `Q. ${q.question}\nA. ${q.answer}`).join("\n\n") +
      "\n";
  return t;
}
function storyTxt(p) {
  let t = `${p.title}\n${p.premise || ""}\n\n`;
  t += (p.segments || []).map((s) => s.text).join("\n\n");
  const fb = (p.segments || [])
    .map((s, i) => `[${i + 1}부 피드백]\n${s.feedback}`)
    .join("\n\n");
  if (fb) t += `\n\n\n=== 작가 피드백 모음 ===\n${fb}`;
  return t + "\n";
}
function discussionTxt(s) {
  return (
    `독서토론 — ${s.title}\n\n` +
    s.messages
      .map((m) => `${m.role === "user" ? "나" : "AI"}: ${m.hasImage ? "[사진] " : ""}${m.text}`)
      .join("\n\n") +
    "\n"
  );
}

// ── 버튼 연결 ──
$("#dailyPrint").addEventListener("click", () => {
  if (currentDailyEntry) printDoc(dailyBook(currentDailyEntry));
});
$("#dailyDownload").addEventListener("click", () => {
  if (currentDailyEntry)
    downloadText(`글_${currentDailyEntry.date}.txt`, dailyTxt(currentDailyEntry));
});
$("#dailyPrintAll").addEventListener("click", () => {
  if (!dailyEntries.length) return toast("출력할 글이 없어요.");
  printDoc(dailyAllBook());
});
$("#storyPrint").addEventListener("click", () => {
  if (!currentStory) return toast("스토리를 선택하세요.");
  printDoc(storyBook(currentStory));
});
$("#storyDownload").addEventListener("click", () => {
  if (currentStory) downloadText(`${currentStory.title}.txt`, storyTxt(currentStory));
});
$("#bookPrint").addEventListener("click", () => {
  if (currentBook) printDoc(discussionBook(currentBook));
});
$("#bookDownload").addEventListener("click", () => {
  if (currentBook)
    downloadText(`독서토론_${currentBook.title}.txt`, discussionTxt(currentBook));
});

// ══════════════════════════════════════════════════════════════════
// 필사 (책을 보며 직접 옮겨 쓰기 + 내 생각)
// ══════════════════════════════════════════════════════════════════
let copyBooks = [];
let currentCopyBook = null;
let copyAnalysisFor = null; // 오른쪽에 해설을 띄운 entry id
let copyEditingEntry = null;

const copyBase = () => `/api/copy/books/${currentCopyBook.id}`;

// 서버가 돌려준 { books, stats } 로 화면 갱신
function applyCopyData(data, selectId) {
  copyBooks = data.books;
  renderCopyStats(data.stats);
  const id = selectId || currentCopyBook?.id;
  currentCopyBook = copyBooks.find((b) => b.id === id) || null;
  renderCopyBookList();
  renderCopyBook();
}

async function loadCopy() {
  applyCopyData(await api("/api/copy"));
}

function renderCopyStats(s) {
  const total = copyBooks.reduce((n, b) => n + b.entries.length, 0);
  $("#copyStats").innerHTML = `
    <div class="ms-stat"><span class="num">${s.totalDays}</span><span class="lbl">필사한 날</span></div>
    <div class="ms-stat"><span class="num">${s.streak}🔥</span><span class="lbl">연속 기록</span></div>
    <div class="ms-stat"><span class="num">${total}</span><span class="lbl">필사한 대목</span></div>`;
}

function bookMeta(b) {
  return [b.author, b.publisher].filter(Boolean).join(" · ");
}

function renderCopyBookList() {
  if (!copyBooks.length) {
    $("#copyBookList").innerHTML = `<div class="mini-empty">아직 등록한 책이 없어요.</div>`;
    return;
  }
  $("#copyBookList").innerHTML = copyBooks
    .map(
      (b) => `<div class="mini-item ${currentCopyBook?.id === b.id ? "active" : ""}" data-id="${b.id}">
        <div class="t">${escapeHtml(b.title)}</div>
        <div class="m">${bookMeta(b) ? escapeHtml(bookMeta(b)) + " · " : ""}${b.entries.length}대목</div>
      </div>`,
    )
    .join("");
  $$("#copyBookList .mini-item").forEach((it) =>
    it.addEventListener("click", () => {
      if (currentCopyBook?.id === it.dataset.id) return;
      currentCopyBook = copyBooks.find((b) => b.id === it.dataset.id);
      copyEditingEntry = null;
      $("#copyText").value = "";
      $("#copyThought").value = "";
      $("#copyPage").value = "";
      showCopyAnalysis(null);
      renderCopyBookList();
      renderCopyBook();
    }),
  );
}

function renderCopyBook() {
  const b = currentCopyBook;
  $("#copyEmpty").classList.toggle("hidden", !!b);
  $("#copyWork").classList.toggle("hidden", !b);
  if (!b) return showCopyAnalysis(null);
  $("#copyBookName").textContent = b.title;
  $("#copyBookMeta").textContent = bookMeta(b);
  $("#copyNoteCount").textContent = b.entries.length ? `${b.entries.length}대목` : "";
  renderCopyEntries();
  if (copyAnalysisFor && !b.entries.some((e) => e.id === copyAnalysisFor)) showCopyAnalysis(null);
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function entryHtml(e) {
  const editing = copyEditingEntry === e.id;
  const head = `<div class="copy-entry-head">
      <span class="copy-entry-meta">${e.page ? `<b>p.${escapeHtml(e.page)}</b> · ` : ""}${e.date}</span>
      <span class="work-actions">
        <button class="mini-link" data-act="analyze">🔍 해설</button>
        <button class="mini-link" data-act="edit">수정</button>
        <button class="mini-link" data-act="del">✕ 삭제</button>
      </span>
    </div>`;
  const body = editing
    ? `<div class="copy-entry-edit">
        <label class="copy-page">쪽 <input data-f="page" value="${escapeHtml(e.page)}" /></label>
        <textarea data-f="text" class="memo" rows="5">${escapeHtml(e.text)}</textarea>
        <div class="row-end">
          <button class="icon-btn" data-act="cancel">취소</button>
          <button class="primary" data-act="save">저장</button>
        </div>
      </div>`
    : `<blockquote class="copy-quote">${nl2br(e.text)}</blockquote>`;
  const thoughts = e.thoughts
    .map(
      (t) => `<div class="copy-thought" data-tid="${t.id}">
        <span class="copy-thought-icon">💭</span>
        <div class="copy-thought-body">
          <div>${nl2br(t.text)}</div>
          <div class="copy-thought-time">${fmtTime(t.createdAt)} <button class="mini-link" data-act="del-thought" data-tid="${t.id}">지우기</button></div>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card copy-entry ${copyAnalysisFor === e.id ? "selected" : ""}" data-eid="${e.id}">
    ${head}${body}
    ${thoughts}
    <div class="copy-add-thought">
      <textarea data-f="thought" rows="1" placeholder="💭 생각 더하기..."></textarea>
      <button class="icon-btn" data-act="add-thought">더하기</button>
    </div>
  </div>`;
}

function renderCopyEntries() {
  const list = [...currentCopyBook.entries].reverse(); // 최근 대목이 위로
  $("#copyEntries").innerHTML = list.length
    ? list.map(entryHtml).join("")
    : `<div class="mini-empty">아직 필사한 대목이 없어요. 위에서 첫 문장을 옮겨 적어보세요.</div>`;
}

// 필사 노트의 버튼들 (이벤트 위임)
$("#copyEntries").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest(".copy-entry");
  const eid = card.dataset.eid;
  const entry = currentCopyBook.entries.find((e) => e.id === eid);
  const url = `${copyBase()}/entries/${eid}`;
  const act = btn.dataset.act;
  const run = (fn) => Promise.resolve().then(fn).catch((e) => toast(e.message));

  if (act === "edit") {
    copyEditingEntry = eid;
    renderCopyEntries();
  } else if (act === "cancel") {
    copyEditingEntry = null;
    renderCopyEntries();
  } else if (act === "save") {
    const text = $('[data-f="text"]', card).value.trim();
    if (!text) return toast("필사한 문장을 입력하세요.");
    withLoading(btn, "저장 중...", async () => {
      const data = await api(url, {
        method: "PATCH",
        body: JSON.stringify({ text, page: $('[data-f="page"]', card).value }),
      });
      copyEditingEntry = null;
      applyCopyData(data);
      if (copyAnalysisFor === eid) showCopyAnalysis(currentCopyBook.entries.find((e) => e.id === eid));
    });
  } else if (act === "del") {
    if (!confirm("이 대목과 덧붙인 생각을 삭제할까요?")) return;
    run(async () => applyCopyData(await api(url, { method: "DELETE" })));
  } else if (act === "add-thought") {
    const ta = $('[data-f="thought"]', card);
    const text = ta.value.trim();
    if (!text) return ta.focus();
    withLoading(btn, "…", async () => {
      applyCopyData(await api(`${url}/thoughts`, { method: "POST", body: JSON.stringify({ text }) }));
    });
  } else if (act === "del-thought") {
    if (!confirm("이 생각을 지울까요?")) return;
    run(async () =>
      applyCopyData(await api(`${url}/thoughts/${btn.dataset.tid}`, { method: "DELETE" })),
    );
  } else if (act === "analyze") {
    if (entry.analysis) return showCopyAnalysis(entry);
    withLoading(btn, "해설 중...", async () => {
      const { analysis } = await api(`${url}/analysis`, { method: "POST" });
      entry.analysis = analysis;
      showCopyAnalysis(entry);
    });
  }
});

// 생각 입력칸: 내용에 맞춰 늘어나고, Ctrl+Enter 로 바로 더하기
$("#copyEntries").addEventListener("input", (ev) => {
  if (ev.target.dataset.f !== "thought") return;
  ev.target.style.height = "auto";
  ev.target.style.height = ev.target.scrollHeight + "px";
});
$("#copyEntries").addEventListener("keydown", (ev) => {
  if (ev.target.dataset.f === "thought" && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    $('[data-act="add-thought"]', ev.target.closest(".copy-entry")).click();
  }
});

function showCopyAnalysis(entry) {
  copyAnalysisFor = entry?.id || null;
  $$("#copyEntries .copy-entry").forEach((c) => c.classList.toggle("selected", c.dataset.eid === copyAnalysisFor));
  const a = entry?.analysis;
  if (!a) {
    $("#copyAnalysis").innerHTML =
      "필사 노트에서 '🔍 해설'을 누르면 그 대목의 문체와 표현을 짚고, 내 생각에도 한마디 건네드려요.";
    return;
  }
  $("#copyAnalysis").innerHTML = `
    <div class="copy-an-src">“${escapeHtml(preview(entry.text, 40))}”${entry.page ? ` · p.${escapeHtml(entry.page)}` : ""}</div>
    ${a.thoughtReply ? `<div class="fb-sub">💭 내 생각에 대한 한마디</div><p class="copy-an-reply">${escapeHtml(a.thoughtReply)}</p>` : ""}
    <div class="fb-sub">🎨 문체 특징</div>${listHtml(a.style)}
    <div class="fb-sub">✨ 눈여겨볼 표현</div>
    ${(a.highlights || [])
      .map((h) => `<div class="ws-item"><div class="ws-ctx">“${escapeHtml(h.quote)}”</div><div class="ws-reason">${escapeHtml(h.why)}</div></div>`)
      .join("")}
    <div class="fb-sub">✏️ 따라 써보기 과제</div>${listHtml(a.practice)}
    <div class="row-end"><button class="mini-link" id="copyReanalyze">🔄 다시 받기</button></div>`;
  $("#copyReanalyze").addEventListener("click", function () {
    const id = entry.id;
    withLoading(this, "해설 중...", async () => {
      const { analysis } = await api(`${copyBase()}/entries/${id}/analysis`, { method: "POST" });
      const e = currentCopyBook?.entries.find((x) => x.id === id);
      if (!e) return;
      e.analysis = analysis;
      showCopyAnalysis(e);
    });
  });
}

// ── 책 등록 / 수정 / 삭제 ──
$("#copyBookCreate").addEventListener("click", function () {
  const title = $("#copyBookTitle").value.trim();
  if (!title) return toast("책 제목을 입력하세요.");
  withLoading(this, "등록 중...", async () => {
    const data = await api("/api/copy/books", {
      method: "POST",
      body: JSON.stringify({
        title,
        author: $("#copyBookAuthor").value.trim(),
        publisher: $("#copyBookPublisher").value.trim(),
      }),
    });
    ["#copyBookTitle", "#copyBookAuthor", "#copyBookPublisher"].forEach((s) => ($(s).value = ""));
    applyCopyData(data, data.bookId);
    toast("책을 등록했어요. 이제 필사를 시작해보세요.");
    $("#copyText").focus();
  });
});

function toggleBookForm(open) {
  $("#copyBookView").classList.toggle("hidden", open);
  $("#copyBookForm").classList.toggle("hidden", !open);
  if (open) {
    $("#copyEditTitle").value = currentCopyBook.title;
    $("#copyEditAuthor").value = currentCopyBook.author;
    $("#copyEditPublisher").value = currentCopyBook.publisher;
  }
}
$("#copyBookEdit").addEventListener("click", () => toggleBookForm(true));
$("#copyBookCancel").addEventListener("click", () => toggleBookForm(false));
$("#copyBookSave").addEventListener("click", function () {
  const title = $("#copyEditTitle").value.trim();
  if (!title) return toast("책 제목을 입력하세요.");
  withLoading(this, "저장 중...", async () => {
    const data = await api(copyBase(), {
      method: "PATCH",
      body: JSON.stringify({
        title,
        author: $("#copyEditAuthor").value.trim(),
        publisher: $("#copyEditPublisher").value.trim(),
      }),
    });
    toggleBookForm(false);
    applyCopyData(data);
  });
});
$("#copyBookDelete").addEventListener("click", async () => {
  if (!confirm(`'${currentCopyBook.title}'과 필사 노트 전체를 삭제할까요?`)) return;
  try {
    const data = await api(copyBase(), { method: "DELETE" });
    toggleBookForm(false);
    currentCopyBook = null;
    applyCopyData(data);
  } catch (e) {
    toast(e.message);
  }
});

// ── 필사 저장 ──
$("#copySave").addEventListener("click", function () {
  const text = $("#copyText").value.trim();
  if (!text) return toast("필사한 문장을 입력하세요.");
  withLoading(this, "저장 중...", async () => {
    const data = await api(`${copyBase()}/entries`, {
      method: "POST",
      body: JSON.stringify({
        page: $("#copyPage").value.trim(),
        text,
        thought: $("#copyThought").value.trim(),
      }),
    });
    $("#copyText").value = "";
    $("#copyThought").value = "";
    $("#copyPage").value = "";
    applyCopyData(data);
    toast(data.stats.streak > 1 ? `필사 저장! 연속 ${data.stats.streak}일째예요. 🔥` : "필사 노트에 저장했어요. ✍️");
  });
});

// ── 텍스트로 내려받기 ──
$("#copyDownload").addEventListener("click", () => {
  const b = currentCopyBook;
  if (!b || !b.entries.length) return toast("내려받을 필사 노트가 없어요.");
  const lines = [`『${b.title}』${bookMeta(b) ? ` — ${bookMeta(b)}` : ""}`, "필사 노트", ""];
  for (const e of b.entries) {
    lines.push(`── ${e.page ? `p.${e.page} · ` : ""}${e.date}`, e.text);
    for (const t of e.thoughts) lines.push(`  💭 ${t.text.replace(/\n/g, "\n     ")}`);
    lines.push("");
  }
  downloadText(`필사_${b.title}.txt`, lines.join("\n"));
});

// ── 초기 로드 ─────────────────────────────────────────────────────
loadDaily();
