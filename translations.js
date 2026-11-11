// 번역 메모리(TM) — 한 번 번역한 문단은 data/translations.json 에 저장해두고 재사용한다.
// 같은 글을 다시 열거나, 글 뒤에 이어 썼을 때 이미 번역된 문단은 API를 호출하지 않는다.
import crypto from "node:crypto";
import { load, update } from "./store.js";

const FILE = "translations";
const DEFAULT = { version: 1, entries: {} };
const MAX_ENTRIES = 5000; // 넘으면 오래된 것부터 정리
const CONCURRENCY = 4; // 새 문단 동시 번역 개수
const CONTEXT_PARAGRAPHS = 2; // 번역 시 참고용으로 함께 보내는 앞 문단 수

// 사소한 차이(줄끝 공백, CRLF)로 캐시가 빗나가지 않도록 정규화
export function normalize(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function keyOf(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

// 빈 줄 기준으로 문단 분리 (번역·저장의 최소 단위)
function splitParagraphs(text) {
  return normalize(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/**
 * 캐시를 먼저 확인하고, 없는 문단만 translateFn 으로 번역한다.
 * @param {string} text 원문(한국어)
 * @param {(s: string) => Promise<string>} translateFn 실제 API 호출 함수
 * @returns {{translation: string, cached: boolean, stats: {paragraphs: number, reused: number, translated: number}}}
 */
export async function translateCached(text, translateFn) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) {
    return { translation: "", cached: true, stats: { paragraphs: 0, reused: 0, translated: 0 } };
  }

  const cache = await load(FILE, DEFAULT);
  const keys = paragraphs.map(keyOf);
  const out = new Array(paragraphs.length);
  const misses = [];

  keys.forEach((k, i) => {
    const hit = cache.entries[k];
    if (hit) out[i] = hit.en;
    else misses.push(i);
  });

  // 캐시에 없는 문단만 API 호출.
  // 주어가 생략된 한국어의 인칭·시제가 흔들리지 않도록 앞 문단 2개를 문맥으로 함께 넘긴다.
  // (문맥은 캐시 키에 포함되지 않으므로 저장·재사용에는 영향이 없다)
  await mapLimit(misses, CONCURRENCY, async (i) => {
    const context = paragraphs.slice(Math.max(0, i - CONTEXT_PARAGRAPHS), i);
    out[i] = await translateFn(paragraphs[i], context);
  });

  const now = new Date().toISOString();
  const model = process.env.CLAUDE_MODEL || "claude-opus-5";

  // 새로 번역한 문단 저장 + 재사용한 문단의 사용 시각 갱신(LRU 기준)
  await update(FILE, DEFAULT, (d) => {
    if (!d.entries) d.entries = {};
    keys.forEach((k, i) => {
      const prev = d.entries[k];
      if (prev) {
        prev.usedAt = now;
        prev.hits = (prev.hits || 0) + 1;
      } else {
        d.entries[k] = { ko: paragraphs[i], en: out[i], model, at: now, usedAt: now, hits: 0 };
      }
    });

    const all = Object.keys(d.entries);
    if (all.length > MAX_ENTRIES) {
      all
        .sort((a, b) => (d.entries[a].usedAt || "").localeCompare(d.entries[b].usedAt || ""))
        .slice(0, all.length - MAX_ENTRIES)
        .forEach((k) => delete d.entries[k]);
    }
  });

  return {
    translation: out.join("\n\n"),
    cached: misses.length === 0,
    stats: {
      paragraphs: paragraphs.length,
      reused: paragraphs.length - misses.length,
      translated: misses.length,
    },
  };
}
