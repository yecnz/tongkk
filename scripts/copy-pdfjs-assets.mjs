#!/usr/bin/env node
// pdfjs 렌더링에 필요한 cMap·표준폰트 데이터를 public/pdfjs 아래로 복사한다.
// PDF에 폰트가 임베드되지 않으면(특히 한글 CID/Identity-H 폰트) 이 데이터 없이는 글자가 렌더되지 않는다.
// predev/prebuild에서 실행되어 dev·build 모두 같은 경로(/pdfjs/...)로 서빙된다. (생성물은 .gitignore)
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const dir of ["cmaps", "standard_fonts"]) {
  const src = `${root}node_modules/pdfjs-dist/${dir}`;
  const dest = `${root}public/pdfjs/${dir}`;
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`✓ pdfjs ${dir} 복사 완료`);
  } else {
    console.warn(`⚠ pdfjs ${dir} 원본을 찾지 못했습니다: ${src}`);
  }
}
