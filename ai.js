// Claude API 호출 계층. 모든 프롬프트는 한국어로, 응답도 한국어로 유도한다.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수를 자동으로 읽음
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium"; // low | medium | high | xhigh | max

// 공통 텍스트 호출
async function ask({ system, messages, maxTokens = 4000 }) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: EFFORT },
    system,
    messages,
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// 구조화(JSON 스키마) 출력 호출. 파싱 실패 시 null.
async function askJson({ system, content, schema, maxTokens = 3000 }) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema },
    },
    system,
    messages: [{ role: "user", content }],
  });
  const jsonText = res.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

// ── 1. 매일 글쓰기 피드백 (구조화 출력) ────────────────────────────
const DAILY_SYSTEM = `당신은 객관적이고 정확한 글쓰기 코치입니다. 사용자가 그날의 느낌과 생각을 자유롭게 적은 글을 읽고 글쓰기 관점에서 분석합니다.
항상 한국어로, 존중하되 듣기 좋은 말만 하지 말고 근거를 들어 솔직하게 씁니다. 사용자의 실제 표현을 인용해 구체적으로 짚으세요.

- strengths(장점): 글에서 잘된 점 1~3가지. 표현·구성·묘사·솔직함·흐름 등 무엇이 왜 좋은지.
- weaknesses(단점): 아쉬운 점 1~3가지. 모호한 표현, 반복, 논리 비약, 흐름 끊김, 상투적 표현 등. 어떻게 고치면 좋을지 방향을 한 줄로 함께.
- questions(새로운 질문): 오늘 쓴 내용을 한 걸음 더 생각해보게 하는 짧은 질문 1~3개. 각 질문은 한 문장, 설명 없이 질문만.
- wordSuggestions(단어 바꾸기 추천): 글 속에서 더 정확하거나 생생한 단어로 바꿔보면 좋을 단어 1~4개.
  - original: 글에 실제로 쓰인 단어(활용형 그대로)
  - context: 그 단어가 쓰인 짧은 구절(글에서 그대로 발췌, 20자 내외)
  - alternatives: 바꿔 쓸 만한 단어 2~3개
  - reason: 왜 바꾸면 좋은지 한 문장
  바꿀 만한 단어가 정말 없다면 빈 배열로 둡니다.

각 항목은 간결하게, 한 항목당 1~2문장.`;

const DAILY_SCHEMA = {
  type: "object",
  properties: {
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    wordSuggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          context: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["original", "context", "alternatives", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["strengths", "weaknesses", "questions", "wordSuggestions"],
  additionalProperties: false,
};

export async function dailyFeedback(text, { dayCount, streak, prompt } = {}) {
  const context =
    `오늘은 사용자의 글쓰기 여정 ${dayCount ?? "?"}일째이고, 현재 연속 기록은 ${streak ?? "?"}일입니다.` +
    (prompt
      ? `\n사용자는 오늘의 질문 "${prompt}"을(를) 보고 글을 썼을 수 있습니다. 질문은 참고용일 뿐이니, 질문과 관련이 없어도 단점으로 지적하지 마세요.`
      : "");
  const fb = await askJson({
    system: DAILY_SYSTEM,
    schema: DAILY_SCHEMA,
    content: `${context}\n\n오늘의 글:\n"""\n${text}\n"""`,
  });
  return (
    fb || { strengths: [], weaknesses: [], questions: [], wordSuggestions: [] }
  );
}

// ── 오늘의 단어: 단어 제시 → 단어에 관한 질문 주고받기 ──────────────
const WORD_PICK_SYSTEM = `당신은 한국어 어휘력을 길러주는 글쓰기 선생님입니다. 글을 쓸 때 써먹을 수 있는, 아름답거나 정확한 한국어 단어를 하루에 하나 고릅니다.
순우리말, 감정·감각을 섬세하게 표현하는 말, 일상에서 덜 쓰지만 알아두면 좋은 말 등에서 고르세요. 너무 어려운 고어나 전문용어는 피합니다.

- word: 단어(기본형)
- meaning: 사전식 뜻풀이 한두 문장
- example: 이 단어를 자연스럽게 쓴 예문 한 문장
- question: 사용자가 이 단어로 생각하고 표현해보게 하는 첫 질문 한 문장 (예: 이 단어가 어울리는 나의 경험, 이 단어를 넣은 문장 만들기, 비슷한 말과의 차이 등)`;

const WORD_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string" },
    meaning: { type: "string" },
    example: { type: "string" },
    question: { type: "string" },
  },
  required: ["word", "meaning", "example", "question"],
  additionalProperties: false,
};

export async function pickWord(usedWords = []) {
  const avoid = usedWords.length
    ? `\n이미 다룬 단어(다시 고르지 마세요): ${usedWords.slice(-200).join(", ")}`
    : "";
  const w = await askJson({
    system: WORD_PICK_SYSTEM,
    schema: WORD_SCHEMA,
    maxTokens: 800,
    content: `오늘의 단어를 하나 골라주세요.${avoid}`,
  });
  if (!w || !w.word) throw new Error("오늘의 단어를 만들지 못했어요. 다시 시도해주세요.");
  return w;
}

const WORD_CHAT_SYSTEM = `당신은 '오늘의 단어' 하나를 두고 사용자와 짧게 대화하는 한국어 글쓰기 선생님입니다. 항상 한국어로 답합니다.
- 사용자의 답이나 문장에 대해 단어의 쓰임이 자연스러운지, 뜻에 맞는지 짧고 구체적으로 피드백합니다. 어색하면 고친 예를 보여주세요.
- 사용자가 단어에 대해 물으면(뜻, 유의어·반의어, 어원, 쓰임 차이 등) 정확하게 답합니다.
- 응답 끝에는 대화가 이어지도록 이 단어와 관련된 새 질문을 하나 던집니다.
- 3~6문장 이내로 짧게.`;

// word: {word, meaning, example, question, messages:[{role, text}]}
export async function wordChat(word, userText) {
  const intro = `오늘의 단어: ${word.word}\n뜻: ${word.meaning}\n예문: ${word.example}\n\n이 단어로 대화를 시작해줘.`;
  const messages = [
    { role: "user", content: intro },
    { role: "assistant", content: word.question },
    ...(word.messages || []).map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: userText },
  ];
  return ask({ system: WORD_CHAT_SYSTEM, messages, maxTokens: 1500 });
}

// ── 나의 서재: 좋아하는 작품에서 '오늘의 질문' 만들기 ───────────────
const WORK_Q_SYSTEM = `당신은 사용자가 좋아하는 작품(책)을 바탕으로 매일 글쓰기의 출발점이 될 '오늘의 질문'을 만드는 글쓰기 코치입니다.
- 작품의 주제, 인물, 장면, 문장에서 출발하되, 사용자 자신의 삶·감정·생각을 돌아보며 글을 쓰게 만드는 질문이어야 합니다.
- 줄거리 퀴즈나 감상문 숙제 같은 질문은 피하세요. 작품을 다 기억하지 못해도 쓸 수 있게.
- 각 질문은 한 문장, 40자 내외. 서로 다른 각도로 8개.
- 작품을 잘 모르면 제목과 사용자의 메모에서 알 수 있는 범위로만 만들고, 사실을 지어내지 마세요.

함께 작가 정보도 정리합니다.
- authorName: 작가 이름. 사용자가 적었으면 그대로, 안 적었으면 작품으로 알 수 있는 경우에만 채우고 모르면 빈 문자열.
- authorIntro: 작가 소개 2~3문장 (국적·활동 시기, 작품 세계나 문체의 특징 등).
- notableWorks: 대표 작품 3~6개. 각 항목은 "작품명 (발표 연도)" 형식, 연도가 확실하지 않으면 작품명만.
작가를 확실히 알지 못하면 authorIntro 는 빈 문자열, notableWorks 는 빈 배열로 두세요. 확실하지 않은 사실은 쓰지 마세요.`;

const WORK_Q_SCHEMA = {
  type: "object",
  properties: {
    questions: { type: "array", items: { type: "string" } },
    authorName: { type: "string" },
    authorIntro: { type: "string" },
    notableWorks: { type: "array", items: { type: "string" } },
  },
  required: ["questions", "authorName", "authorIntro", "notableWorks"],
  additionalProperties: false,
};

// 작품 → { questions, authorInfo: { name, intro, works } }
export async function workQuestions({ title, author, note }) {
  const r = await askJson({
    system: WORK_Q_SYSTEM,
    schema: WORK_Q_SCHEMA,
    maxTokens: 2500,
    content: `작품: ${title}${author ? ` (${author})` : ""}${note ? `\n내가 이 작품을 좋아하는 이유/메모: ${note}` : ""}\n\n이 작품에서 오늘의 질문 8개를 만들고, 작가 정보도 정리해줘.`,
  });
  const qs = (r?.questions || []).map((q) => q.trim()).filter(Boolean);
  if (!qs.length) throw new Error("질문을 만들지 못했어요. 다시 시도해주세요.");
  return {
    questions: qs,
    authorInfo: {
      name: (r.authorName || "").trim(),
      intro: (r.authorIntro || "").trim(),
      works: (r.notableWorks || []).map((w) => w.trim()).filter(Boolean),
    },
  };
}

// ── 2. 스토리 쓰기 피드백 & 질의응답 ──────────────────────────────
function storySystem(mode) {
  const base = `당신은 하나의 스토리를 완성해 나가는 작가를 돕는 전문 글쓰기 멘토입니다. 항상 한국어로 응답합니다.`;
  const critic = `기본 모드: 전문 작가로서 작성된 글을 평가하고 피드백합니다.
- 먼저 이 글의 강점(구성, 문장, 캐릭터, 분위기, 몰입감 등)을 구체적으로 짚어줍니다.
- 다음으로 개선할 점을 명확하고 실행 가능한 방식으로 2~4가지 제안합니다. 어떻게 고치면 좋을지 예시나 방향을 함께 제시하세요.
- 마지막으로 다음 전개를 위한 아이디어나 이어질 장면의 실마리를 던져 창작 의욕을 북돋습니다.
- 냉정하되 격려하는 균형을 유지하세요. 작가의 목소리를 존중하고 대신 써주지 마세요.`;
  return `${base}\n\n${critic}`;
}

function storyContext(project, outline) {
  const theme = outline ? `이 스토리가 속한 주제의 개요:\n"""\n${outline}\n"""\n\n` : "";
  const premise = project.premise ? `이 스토리의 설정: ${project.premise}\n\n` : "";
  return theme + premise;
}

export async function storyFeedback(project, segmentText, outline) {
  const prior =
    project.segments && project.segments.length
      ? `지금까지 쓴 이전 내용(맥락):\n${project.segments
          .map((s, i) => `[${i + 1}] ${s.text}`)
          .join("\n\n")}\n\n`
      : "";
  const system = storySystem(project.mode);
  return ask({
    system,
    maxTokens: 4000,
    messages: [
      {
        role: "user",
        content: `${storyContext(project, outline)}${prior}방금 새로 쓴 부분입니다. 전문 작가로서 평가와 피드백을 해주세요. 주제 개요와의 연결도 함께 봐주세요:\n"""\n${segmentText}\n"""`,
      },
    ],
  });
}

export async function storyAsk(project, question, outline) {
  const story = (project.segments || [])
    .map((s, i) => `[${i + 1}] ${s.text}`)
    .join("\n\n");
  const system = `${storySystem(project.mode)}\n\n지금은 작가가 창작 과정에서 궁금한 점을 질문합니다. 작법, 전개 방향, 캐릭터, 표현 등 무엇이든 구체적이고 실용적으로 답하세요. 스스로 판단할 수 있도록 선택지와 근거를 함께 제시하되, 작가의 결정을 존중하세요.`;
  return ask({
    system,
    maxTokens: 3000,
    messages: [
      {
        role: "user",
        content: `${storyContext(project, outline)}지금까지의 스토리:\n"""\n${story || "(아직 작성된 내용이 없습니다)"}\n"""\n\n질문: ${question}`,
      },
    ],
  });
}

// 주제(카테고리) 이름 추천
export async function suggestTheme(hint) {
  const system = `너는 글쓰기 주제를 제안하는 창작 도우미야. 스토리를 쓰고 싶게 만드는 흥미로운 '주제(카테고리)' 이름을 딱 하나만 한국어로 제안해. 3~15자 내외의 간결한 명사구로, 따옴표나 설명 없이 주제 이름만 한 줄로 출력해.`;
  const t = await ask({
    system,
    maxTokens: 60,
    messages: [
      {
        role: "user",
        content: hint ? `이런 방향으로 하나 제안해줘: ${hint}` : "자유롭게 하나 제안해줘.",
      },
    ],
  });
  return t.replace(/^["'“”]+|["'“”]+$/g, "").split("\n")[0].trim();
}

// 스토리 개요 초안 생성
export async function outlineDraft(themeTitle, current) {
  const system = `너는 스토리 개요를 잡아주는 창작 멘토야. 주어진 주제로 쓸 수 있는 스토리의 개요를 한국어로 간결하게 제안해. 메모 형식으로 배경 · 인물 · 핵심 갈등 · 전개 방향 정도를 짧게 짚어줘. 5~8줄 이내. 사용자가 자유롭게 수정할 초안이니 부담 없이 제안해. 개요 본문만 출력해.`;
  return ask({
    system,
    maxTokens: 800,
    messages: [
      {
        role: "user",
        content: `주제: ${themeTitle}\n${current ? `\n지금까지 적어둔 개요(참고):\n${current}\n` : ""}\n이 주제로 스토리 개요 초안을 잡아줘.`,
      },
    ],
  });
}

// ── 번역 (한국어 → 영어) ──────────────────────────────────────────
const TRANSLATE_SYSTEM = `You are a skilled literary translator. Translate the user's Korean text into natural, fluent English that faithfully preserves the tone, voice, emotion, imagery, and nuance of the original. Keep paragraph breaks. Do not add notes, explanations, or headings — output only the English translation.

Korean frequently omits the subject. Infer it from the surrounding context; for personal, diary-like writing with no other cue, use the first person ("I"). Never invent a subject the text does not support.

The user's message may begin with a "[이전 문맥 — 번역하지 말 것]" block. That block is reference only: use it to keep person, tense, and voice consistent, but translate ONLY the text under "[번역할 문단]" and output nothing else.`;

// context: 바로 앞 문단들의 원문. 번역하지 않고 일관성 유지용으로만 넘긴다.
export async function translate(text, context = []) {
  const content = context.length
    ? `[이전 문맥 — 번역하지 말 것]\n${context.join("\n\n")}\n\n[번역할 문단]\n${text}`
    : text;
  return ask({
    system: TRANSLATE_SYSTEM,
    maxTokens: 3000,
    messages: [{ role: "user", content }],
  });
}

// ── 3. 독서토론 ───────────────────────────────────────────────────
const BOOK_SYSTEM = `당신은 독서토론을 이끄는 노련한 진행자입니다. 목표는 사용자의 비판적 사고, 새로운 사고, 요약·정리 능력, 그리고 자기 표현력을 길러주는 것입니다. 항상 한국어로 대화합니다.

진행 원칙:
- 강의하지 말고 소크라테스식으로 질문을 던져 사용자가 스스로 생각하게 하세요. 한 번에 하나의 핵심 질문에 집중.
- 사용자가 스스로 질문을 만들도록 유도하고, 좋은 질문에는 그 가치를 짚어주세요.
- 사용자가 자기 생각을 표현할 기회를 충분히 주고, 답을 대신 말하지 마세요.
- 사용자가 쓴 문장이나 요약에 대해 표현·논리·근거 측면에서 짧고 구체적인 피드백을 곁들이세요.
- 때때로 다른 관점이나 반론을 제시해 사고를 확장시키되, 강요하지 마세요.
- 따뜻하고 호기심 어린 어조. 응답은 너무 길지 않게, 대화가 이어지도록.`;

// 세션의 자료(제목/텍스트/이미지)로 첫 사용자 턴을 만든다.
export function buildBookOpeningTurn({ sourceType, title, sourceText, image }) {
  const content = [];
  if (sourceType === "image" && image) {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(image);
    if (m) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: m[1], data: m[2] },
      });
    }
    content.push({
      type: "text",
      text: `이건 내가 읽은 책의 한 부분을 찍은 사진이야${title ? ` (책 제목: ${title})` : ""}. 내용을 읽고, 이걸로 독서토론을 시작해줘. 먼저 이 부분이 어떤 내용인지 짧게 확인해주고, 내가 생각해볼 만한 질문 하나를 던져줘.`,
    });
  } else if (sourceType === "text") {
    content.push({
      type: "text",
      text: `내가 읽은 부분이야${title ? ` (책 제목: ${title})` : ""}:\n"""\n${sourceText}\n"""\n\n이걸로 독서토론을 시작해줘. 내가 생각해볼 만한 질문 하나를 던져줘.`,
    });
  } else {
    content.push({
      type: "text",
      text: `"${title}"라는 책으로 독서토론을 하고 싶어. 이 책에 대해 함께 이야기 나누자. 먼저 내가 이 책의 어떤 점에 대해 생각해보면 좋을지, 질문 하나로 대화를 열어줘.`,
    });
  }
  return { role: "user", content };
}

// messages: [{role, content}] 형태의 전체 대화. content는 string 또는 블록 배열.
export async function bookReply(messages) {
  return ask({ system: BOOK_SYSTEM, messages, maxTokens: 2000 });
}

// ── 6. 필사 (문장 해설 + 내 생각에 대한 한마디) ─────────────────────
const COPY_ANALYSIS_SYSTEM = `당신은 문장력을 길러주는 글쓰기 코치입니다. 사용자가 책을 보며 직접 필사(베껴 쓰기)한 대목과, 필사하며 덧붙인 자기 생각을 읽고 무엇을 배우면 좋을지 짚어줍니다.
항상 한국어로, 실제 문장을 짧게 인용하며 구체적으로 씁니다.

- style(문체 특징): 이 대목의 문체·리듬·시점·어조의 특징 2~3가지. 각 1~2문장.
- highlights(눈여겨볼 표현): 따라 써볼 가치가 있는 표현 2~4개.
  - quote: 대목에서 그대로 발췌한 짧은 구절(30자 내외)
  - why: 왜 좋은 표현인지, 어떤 기법인지 한 문장
- practice(따라 써보기 과제): 이 대목의 문장 구조나 기법을 빌려 내 이야기로 한두 문장 써보게 하는 과제 1~2개. 각 과제는 한 문장.
- thoughtReply(내 생각에 대한 한마디): 사용자의 생각이 있으면, 그 생각을 존중하며 한 걸음 더 나아가게 하는 응답 2~3문장(공감 + 생각을 넓히는 질문 하나). 생각이 없으면 빈 문자열.`;

const COPY_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    style: { type: "array", items: { type: "string" } },
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: { quote: { type: "string" }, why: { type: "string" } },
        required: ["quote", "why"],
        additionalProperties: false,
      },
    },
    practice: { type: "array", items: { type: "string" } },
    thoughtReply: { type: "string" },
  },
  required: ["style", "highlights", "practice", "thoughtReply"],
  additionalProperties: false,
};

export async function copyAnalysis({ title, author, text, thoughts = [] }) {
  const r = await askJson({
    system: COPY_ANALYSIS_SYSTEM,
    schema: COPY_ANALYSIS_SCHEMA,
    maxTokens: 2500,
    content:
      `책: ${title}${author ? ` (${author})` : ""}\n\n필사한 대목:\n${text}` +
      (thoughts.length ? `\n\n필사하며 덧붙인 내 생각:\n${thoughts.map((t) => `- ${t}`).join("\n")}` : ""),
  });
  if (!r) throw new Error("해설을 만들지 못했어요. 다시 시도해주세요.");
  return r;
}
