#!/usr/bin/env node
// 인라인 하드코딩 hex 색상 가드 — 색은 src/index.css의 @theme 토큰(light-dark)으로만 정의한다.
// 하드코딩 색은 다크모드에서 그대로 남아 "배경만 밝고 글자는 안 보이는" 류의 버그를 만든다.
// 의도적 예외(PDF 내보내기 라이트 고정, 양 모드 공통색 등)는 해당 줄에 `hex-ok: 사유` 주석을 단다.
// light-dark(...)가 있는 줄은 라이트/다크 양쪽 값을 함께 정의한 것이므로 허용한다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3,4})\b/;

const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name)) files.push(p);
  }
};
walk(srcDir);

const violations = [];
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!HEX.test(line)) return;
    if (line.includes("light-dark(") || line.includes("hex-ok")) return;
    violations.push(`${relative(root, file)}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
}

if (violations.length > 0) {
  console.error(`✗ 인라인 hex 색상 ${violations.length}곳 발견 — src/index.css의 @theme 토큰(var(--color-…))을 쓰세요.`);
  console.error(`  의도적 하드코딩이면 그 줄에 'hex-ok: 사유' 주석을 추가하면 통과합니다.\n`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`✓ check-inline-hex: ${files.length}개 파일에 하드코딩 hex 없음`);
