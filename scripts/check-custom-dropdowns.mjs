// Check every app and preview source, including controls only rendered in dialogs.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const nativeTags = new Set(['select', 'option', 'datalist']);
const generated = new Set(['promo/features.js', 'promo/demo.js']);
const failures = [];
let files = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'assets'].includes(entry.name)) await checkDirectory(filename);
      continue;
    }
    if (!/\.(?:[cm]?[jt]sx?|html)$/.test(filename) || generated.has(filename)) continue;
    files++;
    const text = await readFile(path.join(root, filename), 'utf8');
    const report = position => failures.push(`${filename}:${text.slice(0, position).split('\n').length} - 기본 선택창 대신 CustomSelect를 사용하세요.`);
    if (filename.endsWith('.html')) {
      for (const match of text.matchAll(/<(?:select|option|datalist)\b/gi)) report(match.index);
      continue;
    }
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && nativeTags.has(node.tagName.getText(source))) report(node.getStart(source));
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && nativeTags.has(node.arguments[0].text)
        && /^(?:.*\.)?(?:createElement|h|jsx|jsxs)$/.test(node.expression.getText(source))) report(node.getStart(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const directory of ['src', 'scripts/learning-guide-preview', 'promo']) await checkDirectory(directory);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`✓ check-custom-dropdowns: ${files}개 소스 파일 검사, 기본 선택창 없음`);
