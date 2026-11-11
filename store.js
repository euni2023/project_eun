// 아주 단순한 로컬 JSON 파일 저장소 (단일 사용자용).
// 파일별로 읽고/쓰고, 쓰기는 순차 큐로 처리해 동시성 문제를 피한다.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const writeQueues = new Map(); // file -> Promise chain

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export async function load(name, fallback) {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(fallback);
    throw err;
  }
}

// 임시파일에 쓴 뒤 rename 으로 교체 — 쓰다 만 손상 파일이 생기지 않도록.
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file); // 원자적 교체(Windows/POSIX 모두 덮어씀)
}

// 읽고 → 수정 함수 실행 → 저장. 같은 파일에 대한 쓰기는 직렬화된다.
export async function update(name, fallback, mutator) {
  const prev = writeQueues.get(name) || Promise.resolve();
  let release;
  const gate = new Promise((res) => (release = res));
  writeQueues.set(name, prev.then(() => gate));

  try {
    await prev;
    const data = await load(name, fallback);
    const result = await mutator(data);
    await ensureDir();
    const file = filePath(name);
    // 덮어쓰기 전, 현재 파일이 유효하면 .bak 으로 백업(직전 상태 보존)
    try {
      const cur = await fs.readFile(file, "utf8");
      if (cur.trim()) {
        JSON.parse(cur); // 유효한 JSON 일 때만
        await fs.writeFile(`${file}.bak`, cur, "utf8");
      }
    } catch {
      /* 파일 없음/파싱 실패면 백업 생략 */
    }
    await writeAtomic(file, JSON.stringify(data, null, 2));
    return result;
  } finally {
    release();
  }
}

export function newId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
