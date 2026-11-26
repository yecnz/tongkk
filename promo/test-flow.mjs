// Full-page regression checks for the four-stage standalone learning flow.
// Run after rebuilding demo.js: node promo/test-flow.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const errors = [];
const networkRequests = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const html = await fs.readFile(new URL('./index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  // No resources option: script/link elements cannot load anything from the network.
  url: new URL('./index.html', import.meta.url).href,
});
const win = dom.window;
const document = win.document;
win.matchMedia = query => ({
  media: query, matches: query.includes('prefers-reduced-motion'), onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent() { return true; },
});
win.HTMLElement.prototype.scrollIntoView = function () {};
win.fetch = async (...args) => {
  networkRequests.push(['fetch', ...args]);
  throw new Error('The standalone learning demo must not make a network request');
};
win.XMLHttpRequest.prototype.open = function (...args) { networkRequests.push(['xhr', ...args]); };
win.XMLHttpRequest.prototype.send = function () { throw new Error('Unexpected XMLHttpRequest'); };
win.WebSocket = class { constructor(...args) { networkRequests.push(['websocket', ...args]); throw new Error('Unexpected WebSocket'); } };
win.navigator.sendBeacon = (...args) => { networkRequests.push(['beacon', ...args]); return false; };
win.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

function runtimeHealthy() {
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(networkRequests.length, 0, `Unexpected network calls: ${JSON.stringify(networkRequests)}`);
}

async function until(condition, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    runtimeHealthy();
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out: ${description}`);
}

async function flushRender() {
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  runtimeHealthy();
}

function click(node) {
  assert(node, 'The interaction target exists');
  node.click();
}

function key(node, value, options = {}) {
  const event = new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  node.dispatchEvent(event);
  return event;
}

function buttonNamed(scope, name) {
  return [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === name);
}

const tabs = [...document.querySelectorAll('.lp-product-tabs [role="tab"]')];
function selectedTab(index, checkFocus = false) {
  tabs.forEach((tab, position) => {
    const selected = position === index;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    assert.equal(tab.getAttribute('aria-selected'), String(selected));
    assert.equal(tab.tabIndex, selected ? 0 : -1);
    assert.equal(panel.hidden, !selected);
    assert.equal(panel.inert, !selected);
    assert.equal(panel.getAttribute('aria-hidden'), String(!selected));
  });
  if (checkFocus) assert.equal(document.activeElement, tabs[index]);
}

function tabSet(scope, expectedPanels) {
  const controls = [...scope.querySelectorAll('[role="tab"]')];
  assert.deepEqual(controls.map(tab => tab.getAttribute('aria-controls')), expectedPanels);
  const panels = expectedPanels.map(id => document.getElementById(id));
  function selected(index, checkFocus = false) {
    controls.forEach((tab, position) => {
      const active = index === position;
      const panel = panels[position];
      assert(panel, `The ${expectedPanels[position]} tab has a real content panel`);
      assert.equal(tab.getAttribute('aria-selected'), String(active));
      assert.equal(tab.tabIndex, active ? 0 : -1);
      assert.equal(panel.hidden, !active, `${panel.id} is hidden unless selected`);
      assert.equal(panel.inert, !active, `${panel.id} cannot receive interactions while hidden`);
      assert.equal(panel.getAttribute('aria-hidden'), String(!active));
    });
    if (checkFocus) assert.equal(document.activeElement, controls[index]);
  }
  return { controls, panels, selected };
}

async function checkCompactFeatureTabs(landingScript) {
  const journey = tabSet(document.querySelector('.lp-learning-route'), ['learn-summary', 'learn-quiz', 'learn-tutor', 'learn-retry']);
  const featureNames = ['explain', 'cards', 'issues', 'courses', 'resume', 'plan', 'stats', 'integrations', 'menubar'];
  const features = tabSet(document.querySelector('.lp-feature-picker'), featureNames.map(name => `feature-${name}`));
  journey.selected(0);
  features.selected(0);
  const frames = features.panels.map(panel => panel.querySelector('iframe'));
  assert(frames[0].getAttribute('src'), 'the first visible feature loads immediately');
  frames.slice(1).forEach(frame => {
    assert(frame.dataset.src, 'an unopened feature retains its deferred local source');
    assert.equal(frame.getAttribute('src'), null, 'unopened screens do not load in the background');
  });

  // Switching screens must not recreate a loaded iframe and discard its app state.
  const cardsSource = frames[1].dataset.src;
  click(features.controls[1]);
  features.selected(1);
  assert.equal(frames[1].getAttribute('src'), cardsSource);
  const cardsWindow = frames[1].contentWindow;
  const stateMarker = { rememberedCard: 'demo-progress' };
  cardsWindow.__promoRegressionState = stateMarker;
  const sourceChanges = [];
  const observer = new win.MutationObserver(records => sourceChanges.push(...records));
  observer.observe(frames[1], { attributes: true, attributeFilter: ['src'] });
  click(features.controls[2]);
  features.selected(2);
  assert(frames[2].getAttribute('src'), 'selecting a feature activates its deferred iframe');
  click(features.controls[1]);
  features.selected(1);
  await flushRender();
  assert.equal(features.panels[1].querySelector('iframe'), frames[1]);
  assert.equal(frames[1].contentWindow, cardsWindow);
  assert.equal(frames[1].contentWindow.__promoRegressionState, stateMarker);
  assert.equal(sourceChanges.length, 0, 'returning to a loaded screen never resets its source');
  observer.disconnect();

  // Both pickers support horizontal and vertical arrows, wrapping and endpoints.
  for (const group of [journey, features]) {
    const last = group.controls.length - 1;
    click(group.controls[0]);
    group.controls[0].focus();
    for (const [from, keyName, to] of [
      [0, 'ArrowRight', 1], [1, 'ArrowDown', 2], [2, 'ArrowLeft', 1],
      [1, 'ArrowUp', 0], [0, 'ArrowLeft', last], [last, 'ArrowRight', 0],
      [0, 'End', last], [last, 'Home', 0], [0, 'ArrowUp', last], [last, 'ArrowDown', 0],
    ]) {
      assert(key(group.controls[from], keyName).defaultPrevented, `${keyName} is handled by the picker`);
      group.selected(to, true);
    }
  }
  journey.selected(0);
  features.selected(0);
  selectedTab(0); // The original/summary/quiz/tutor product demo is independent.

  async function followHash(hash, group, index) {
    win.location.hash = hash;
    await until(() => group.controls[index].getAttribute('aria-selected') === 'true', `${hash} reveals its panel`);
    group.selected(index);
  }
  await followHash('#feature-stats', features, 6);
  await followHash('#learn-quiz', journey, 1);
  features.selected(6);
  await followHash('#features-understand', features, 0);
  await followHash('#features-organize', features, 3);
  await followHash('#features-connect', features, 6);
  await followHash('#learn-retry', journey, 3);
  win.location.hash = '#not-a-demo-panel';
  await flushRender();
  journey.selected(3);
  features.selected(6);
  selectedTab(0);

  // A directly opened URL must reveal the requested feature before any click.
  const direct = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
    url: `${new URL('./index.html', import.meta.url).href}#feature-courses` });
  try {
    direct.window.matchMedia = win.matchMedia;
    direct.window.HTMLElement.prototype.scrollIntoView = function () {};
    direct.window.eval(landingScript);
    const target = direct.window.document.getElementById('feature-courses');
    assert.equal(target.hidden, false, 'initial deep links select the matching feature');
    assert.equal(target.inert, false);
    assert(target.querySelector('iframe').getAttribute('src'));
    assert.equal(direct.window.document.querySelectorAll('.lp-feature-picker [aria-selected="true"]').length, 1);
    assert.equal(direct.window.document.querySelector('.lp-feature-picker [aria-selected="true"]').getAttribute('aria-controls'), 'feature-courses');
  } finally { direct.window.close(); }
  runtimeHealthy();
}

try {
  const landingScript = await fs.readFile(new URL('./script.js', import.meta.url), 'utf8');
  win.eval(landingScript);
  win.eval(await fs.readFile(new URL('./demo.js', import.meta.url), 'utf8'));
  await until(() => document.querySelector('.demo-tutor-composer textarea') && document.querySelector('.demo-quiz-option'), 'all interactive demo roots mount');
  // Let mount effects register the cross-panel question/retry event handlers.
  await flushRender();
  assert.deepEqual(tabs.map(tab => tab.textContent), ['원본', '요약', '퀴즈', '튜터']);
  selectedTab(0);
  assert.match(document.querySelector('#demo-original h1').textContent, /시간 복잡도와 정렬 알고리즘/);
  assert.equal(document.querySelectorAll('.demo-summary-tab').length, 4);

  await checkCompactFeatureTabs(landingScript);

  // Roving focus and selection must include the newly added fourth tab.
  tabs[0].focus();
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
    assert(key(tabs[from], 'ArrowRight').defaultPrevented);
    selectedTab(to, true);
  }
  key(tabs[0], 'ArrowLeft'); selectedTab(3, true);
  key(tabs[3], 'Home'); selectedTab(0, true);
  key(tabs[0], 'End'); selectedTab(3, true);

  const quiz = document.querySelector('#demo-quiz');
  const tutor = document.querySelector('#demo-tutor');
  const messages = () => [...tutor.querySelectorAll('[data-msg-role]')];
  const lastAssistant = () => [...tutor.querySelectorAll('[data-msg-role="assistant"]')].at(-1);

  // A capability link opens the intended question, not merely the quiz tab.
  click(document.querySelector('[data-demo-step="2"][data-quiz-question="1"]'));
  selectedTab(2);
  await until(() => quiz.querySelector('.demo-quiz-status').textContent.includes('2 / 3'), 'the quiz link opens question 2');
  assert.match(quiz.querySelector('#demo-question').textContent, /퀵 정렬/);
  click(quiz.querySelectorAll('.demo-quiz-option')[0]); // O is deliberately wrong.
  await until(() => quiz.querySelector('.demo-answer-badge')?.textContent === '오답', 'the quiz grades the incorrect answer');
  assert.equal(quiz.querySelectorAll('.demo-quiz-option')[0].getAttribute('aria-pressed'), 'true');
  assert.equal(quiz.querySelectorAll('.demo-quiz-option')[1].classList.contains('is-correct'), true);

  click(quiz.querySelector('.demo-tutor-link'));
  selectedTab(3);
  await until(() => messages().length === 2, 'a quiz question is handed off to the tutor');
  assert.match(messages()[0].textContent, /퀵 정렬의 최악 시간 복잡도/);
  assert.match(lastAssistant().textContent, /피벗이 계속 최솟값이나 최댓값/);
  assert(lastAssistant().querySelector('.katex'), 'the tutor uses the real math renderer');
  assert(lastAssistant().querySelector('strong'), 'the tutor uses formatted Markdown');
  assert.match(tutor.querySelector('.demo-tutor-notice').textContent, /준비된 예시 대화/);

  // Looking back at a summary/tutor must not silently discard quiz progress.
  click(tabs[1]); selectedTab(1);
  click(tabs[2]); selectedTab(2);
  assert.equal(quiz.querySelector('.demo-answer-badge').textContent, '오답');
  assert.match(quiz.querySelector('.demo-quiz-status').textContent, /2 \/ 3/);
  click(tabs[3]); selectedTab(3);
  assert.equal(messages().length, 2);

  const followup = buttonNamed(tutor.querySelector('.demo-tutor-followups'), '병합 정렬과 퀵 정렬은 언제 쓰나요?');
  followup.focus();
  click(followup);
  await until(() => messages().length === 4, 'a suggested follow-up appends a conversation turn');
  assert.equal(document.activeElement, tutor.querySelector('textarea'), 'focus stays in the conversation after a follow-up button disappears');
  assert(lastAssistant().querySelector('table'), 'the real tutor renderer formats comparison tables');
  assert.match(lastAssistant().textContent, /재귀 호출 스택/);

  const input = tutor.querySelector('textarea');
  const submit = tutor.querySelector('.demo-tutor-composer button');
  const nativeValue = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
  async function type(value) {
    // Calling the prototype setter mimics input without bypassing React's tracker.
    nativeValue.call(input, value);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    await until(() => submit.disabled === !value.trim(), 'composer state follows native input');
    await flushRender();
  }

  await type('오늘 날씨 알려줘');
  assert(key(input, 'Enter').defaultPrevented);
  await until(() => messages().length === 6, 'Enter submits a typed question');
  assert.match(lastAssistant().textContent, /새 AI 답변은 생성하지 않습니다/);
  assert.equal(input.value, '');
  assert(submit.disabled);

  await type('첫 줄');
  assert.equal(key(input, 'Enter', { shiftKey: true }).defaultPrevented, false, 'Shift+Enter is reserved for a newline');
  await flushRender();
  assert.equal(messages().length, 6, 'Shift+Enter must not submit');
  await type('첫 줄\n두 번째 줄');
  assert.equal(input.value, '첫 줄\n두 번째 줄');

  await type('안정 정렬은 무슨 뜻인가요?');
  assert.equal(key(input, 'Enter', { isComposing: true, keyCode: 229 }).defaultPrevented, false);
  await flushRender();
  assert.equal(messages().length, 6, 'an IME composition Enter must not submit');
  input.dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
  assert.equal(key(input, 'Enter').defaultPrevented, false, 'the composition state also guards Enter');
  await flushRender();
  assert.equal(messages().length, 6);
  input.dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
  assert(key(input, 'Enter').defaultPrevented);
  await until(() => messages().length === 8, 'Enter submits after composition has ended');
  assert.match(lastAssistant().textContent, /값이 같은 원소들의 원래 순서/);

  await type('   ');
  assert(submit.disabled, 'a whitespace-only message cannot be sent');
  key(input, 'Enter');
  await flushRender();
  assert.equal(messages().length, 8);

  click(buttonNamed(tutor, '새 대화 시작'));
  await until(() => messages().length === 0, 'explicitly starting a new conversation clears the sample history');
  assert.equal(input.value, '');
  assert(submit.disabled);
  assert.equal(tutor.querySelectorAll('.demo-tutor-question').length, 3);
  assert.equal(document.activeElement, input);

  // Quiz answers are cleared only when the user explicitly chooses to retry.
  const suggestion = buttonNamed(tutor, '선택 정렬은 왜 O(n²)인가요?');
  suggestion.focus();
  click(suggestion);
  await until(() => messages().length === 2, 'a fresh sample conversation starts');
  assert.equal(document.activeElement, input, 'focus stays in the conversation after the initial suggestion disappears');
  click(tutor.querySelector('[data-tutor-return-quiz]'));
  selectedTab(2);
  await until(() => quiz.querySelector('.demo-quiz-status').textContent.includes('1 / 3') && !quiz.querySelector('.demo-answer-badge'), 'the explicit retry action returns to a fresh question 1');
  assert.equal(quiz.querySelectorAll('.demo-quiz-nav .is-answered').length, 0);
  assert(quiz.querySelector('.demo-quiz-next').disabled);
  assert.equal(messages().length, 2, 'quiz retry preserves the tutor explanation for reference');

  const productWindow = document.querySelector('.lp-product-window');
  const guidance = document.querySelector('.lp-demo-guidance');
  const reopen = document.querySelector('.lp-demo-reopen');
  click(document.querySelector('[data-demo-close]'));
  assert(productWindow.hidden);
  assert(guidance.hidden, 'next-step guidance must not remain visible after closing the demo');
  assert.equal(reopen.hidden, false);
  assert.equal(document.activeElement, reopen.querySelector('button'));
  click(reopen.querySelector('[data-demo-open]'));
  assert.equal(productWindow.hidden, false);
  assert.equal(guidance.hidden, false);
  assert(reopen.hidden);
  selectedTab(2, true);
  assert.match(guidance.textContent, /튜터에게 질문하기/);
  click(guidance.querySelector('[data-demo-next]'));
  selectedTab(3, true);
  assert.equal(messages().length, 2, 'guided navigation preserves existing conversation');
  assert.match(guidance.textContent, /퀴즈로 돌아가기/);

  runtimeHealthy();
  console.log('PASS: compact journey and feature tabs, keyboard navigation, initial/deferred iframe loading and preserved screen state, live/initial/legacy deep links, four product tabs, quiz grading and tutor handoff, actual Markdown/math/table rendering, preserved answers, typed questions and IME, explicit resets, close/reopen guidance, and zero network requests.');
} finally {
  win.close();
}
