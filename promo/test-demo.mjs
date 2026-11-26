// Interaction regression checks for the generated standalone bundle.
// Run after building: node promo/test-demo.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = new JSDOM('<!doctype html><div class="lp-product-window"><div id="demo-original"></div><div id="demo-summary"></div><div id="demo-quiz"></div></div>', {
  runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  url: new URL('./index.html', import.meta.url).href,
});
const win = dom.window;
const document = win.document;
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await pause(); }
  assert.fail(`Render timed out. ${errors.join('\n')}`);
}
async function click(node) {
  assert(node, 'click target exists');
  node.click();
  await pause();
  assert.equal(errors.length, 0, errors.join('\n'));
}

try {
  win.eval(await fs.readFile(new URL('./demo.js', import.meta.url), 'utf8'));
  await until(() => document.querySelector('.demo-quiz-option'));
  assert.equal(document.querySelector('#demo-original h1').textContent, '시간 복잡도와 정렬 알고리즘');
  assert.equal(document.querySelector('#demo-original h1').style.fontSize, '19px');
  assert.equal(document.querySelectorAll('#demo-original h2').length, 3);
  assert(document.querySelector('#demo-original .katex'), 'actual KaTeX markup');
  assert.match(document.querySelector('#demo-original').textContent, /메모리가 빠듯하면/);
  const tabs = [...document.querySelectorAll('.demo-summary-tab')];
  assert.equal(tabs.length, 4);
  await click(tabs[1]);
  assert.match(document.querySelector('#demo-summary-content').textContent, /참고\/주의 사항/);
  assert(document.querySelector('#demo-summary-content table'), 'full lecture-note table included');
  await click(tabs[2]);
  assert.equal(document.querySelectorAll('.demo-actual-mindmap [title="분류 기준"]').length, 1);
  const mapButton = text => [...document.querySelectorAll('.demo-actual-mindmap button')].find(button => button.textContent === text);
  const mapViewport = document.querySelector('.demo-actual-mindmap [style*="cursor: grab"]');
  const wheel = new win.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200 });
  mapViewport.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false, 'ordinary wheel input remains available for page scrolling');
  await click(mapButton('모두 접기'));
  assert.equal(document.querySelectorAll('.demo-actual-mindmap [title="분류 기준"]').length, 0);
  await click(mapButton('모두 펼치기'));
  assert.equal(document.querySelectorAll('.demo-actual-mindmap [title="분류 기준"]').length, 1);
  await click(tabs[3]);
  assert.equal(document.querySelectorAll('#demo-summary-content tbody tr').length, 6);
  tabs[3].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  await pause();
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, tabs[0]);
  assert.match(document.querySelector('#demo-summary-content').textContent, /알고리즘 선택 기준/);

  const quiz = document.querySelector('#demo-quiz');
  assert(quiz.querySelector('.demo-quiz-next').disabled);
  await click(quiz.querySelectorAll('.demo-quiz-option')[0]);
  assert.equal(quiz.querySelector('.demo-answer-badge').textContent, '오답');
  assert.equal(quiz.querySelectorAll('.demo-quiz-option.is-correct').length, 1);
  await click(quiz.querySelectorAll('.demo-quiz-option')[3]);
  assert.equal(quiz.querySelector('.demo-answer-badge').textContent, '오답', 'submitted answer cannot be replaced');
  await click(quiz.querySelector('.demo-quiz-next'));
  assert.match(quiz.querySelector('#demo-question').textContent, /퀵 정렬/);
  await click(quiz.querySelectorAll('.demo-quiz-option')[1]);
  assert.equal(quiz.querySelector('.demo-answer-badge').textContent, '정답');
  await click(quiz.querySelector('.demo-quiz-next'));
  await click(quiz.querySelectorAll('.demo-quiz-option')[2]);
  await click(quiz.querySelector('.demo-quiz-next'));
  assert.equal(quiz.querySelector('.demo-result-score').textContent, '67%');
  assert.match(quiz.querySelector('.demo-result-card').textContent, /3문제 중 2문제 정답/);
  let requestedStep;
  win.addEventListener('promo:step', event => { requestedStep = event.detail.index; });
  await click([...quiz.querySelectorAll('button')].find(button => button.textContent === '요약 다시 보기'));
  assert.equal(requestedStep, 1);
  await click([...quiz.querySelectorAll('button')].find(button => button.textContent === '풀이 확인'));
  assert.equal(quiz.querySelector('.demo-answer-badge').textContent, '오답');
  await click(quiz.querySelector('.demo-quiz-next'));
  await click([...quiz.querySelectorAll('button')].find(button => button.textContent === '다시 풀기'));
  assert(quiz.querySelector('.demo-quiz-next').disabled);
  assert.equal(quiz.querySelector('.demo-answer-badge'), null);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: actual Markdown/KaTeX, four summaries, keyboard tabs, mindmap controls and wheel scrolling, immediate grading, score, review and retry.');
} finally {
  win.close();
}
