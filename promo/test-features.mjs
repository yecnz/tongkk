// Exercises the shipped app-component bundle. All transports must stay local.
// Run after node promo/build-features.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await fs.readFile(new URL('./features.html', import.meta.url), 'utf8');
const bundle = await fs.readFile(new URL('./features.js', import.meta.url), 'utf8');
const features = ['explain', 'cards', 'issues', 'courses', 'resume', 'plan', 'stats', 'integrations', 'menubar'];
const instances = [];
function create(feature) {
  const errors = [], network = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.stack || error.message));
  virtualConsole.on('error', (...args) => errors.push(args.map(value => value?.stack || String(value)).join(' ')));
  const dom = new JSDOM(html, { url: `https://tongkk.example/features.html?feature=${feature}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const win = dom.window, document = win.document;
  win.structuredClone = structuredClone;
  win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder;
  win.matchMedia = query => ({ media: query, matches: false, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  win.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  win.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.scrollTo = function () {};
  win.scrollTo = () => {};
  win.confirm = () => true;
  win.fetch = async (...args) => { network.push(['fetch', ...args]); throw new Error('Feature demo attempted network access'); };
  win.XMLHttpRequest.prototype.open = function (...args) { network.push(['xhr', ...args]); };
  win.XMLHttpRequest.prototype.send = function () { throw new Error('Feature demo attempted XMLHttpRequest'); };
  win.WebSocket = class { constructor(...args) { network.push(['websocket', ...args]); throw new Error('Feature demo attempted WebSocket'); } };
  win.navigator.sendBeacon = (...args) => { network.push(['beacon', ...args]); return false; };
  win.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const healthy = () => {
    assert.equal(errors.length, 0, `${feature}: ${errors.join('\n')}`);
    assert.equal(network.length, 0, `${feature}: unexpected requests ${JSON.stringify(network)}`);
    assert(!document.body.textContent.includes('예시를 불러오지 못했어요'), `${feature}: error boundary was shown`);
  };
  async function until(test, description) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) { healthy(); if (test()) return; await new Promise(resolve => setTimeout(resolve, 12)); }
    assert.fail(`${feature}: ${description}\n${document.body.textContent.slice(0, 2500)}`);
  }
  const button = (name, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === name || node.getAttribute('aria-label') === name);
  async function click(node, description = 'button exists') { assert(node, `${feature}: ${description}`); assert(!node.disabled, `${feature}: target is enabled`); node.click(); await new Promise(resolve => setTimeout(resolve, 25)); healthy(); }
  function fill(node, value) {
    assert(node, `${feature}: input exists`);
    const proto = node.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
  async function select(trigger, label) {
    await click(trigger, 'custom dropdown exists');
    await until(() => document.querySelector('[role="listbox"]'), 'custom options open');
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes(label));
    await click(option, `option ${label} exists`);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'custom dropdown closes after selection');
    assert.equal(document.activeElement, trigger, 'selection restores focus');
  }
  const result = { feature, dom, win, document, healthy, until, button, click, fill, select };
  instances.push(result); win.eval(bundle); return result;
}

try {
  for (const feature of features) {
    const app = create(feature);
    const { document: doc, until, button, click, fill, select } = app;
    const text = () => doc.body.textContent;
    if (feature === 'explain') {
      await until(() => button('직접 설명하기 →'), 'actual explanation workspace starts with the sample concept');
      await click(button('직접 설명하기 →'));
      await until(() => text().includes('퀵 정렬은 평균적으로 빠른데') && doc.querySelector('textarea'), 'actual explanation workspace renders a sample question');
      assert(doc.querySelector('.learning-workspace') || doc.querySelector('main'), 'explanation uses the app workspace');
    } else if (feature === 'cards') {
      await until(() => button('답 확인하기'), 'a due flashcard is visible');
      const initialQuestion = doc.querySelector('.flashcard-face').textContent;
      await click(button('답 확인하기'));
      assert(doc.querySelector('.flashcard-answer').textContent.length > 25, 'card reveals its real Markdown answer');
      const answerCard = doc.querySelector('.flashcard-study-card[data-side="answer"]');
      assert(answerCard && answerCard.querySelector('.flashcard-face').textContent === initialQuestion, 'the question remains above the revealed answer');
      assert(doc.querySelector('.flashcard-review').lastElementChild.matches('.flashcard-source'), 'the source stays below the card and rating controls');
      await click(button('알겠음'));
      await until(() => text().includes('다음 복습:') && button('답 확인하기'), 'card rating schedules review and advances the queue');
      assert.notEqual(doc.querySelector('.flashcard-face').textContent, initialQuestion);
      await click(button('카드 만들기'));
      await click(button('직접 카드 추가'));
      await until(() => doc.querySelector('[aria-label="카드 초안 1"]'), 'manual card editor opens');
      const draft = doc.querySelector('[aria-label="카드 초안 1"]');
      fill(draft.querySelectorAll('textarea')[0], '안정 정렬이란?');
      fill(draft.querySelectorAll('textarea')[1], '같은 키를 가진 원소의 상대적 순서를 보존하는 정렬입니다.');
      await until(() => !button('카드 저장', draft).disabled, 'manual card text updates');
      await click(button('카드 저장', draft));
      await until(() => button('저장됨', draft), 'manual card is saved locally');
    } else if (feature === 'issues') {
      await until(() => button('복습 중으로 표시'), 'the linked quick-sort issue renders');
      await click(button('복습 중으로 표시'));
      await until(() => doc.querySelector('.workflow-badge[data-state="in_progress"]'), 'issue enters remediation');
      await click(button('다시 확인할 항목으로'));
      await until(() => doc.querySelector('.workflow-badge[data-state="awaiting_reassessment"]'), 'issue is marked for another check');
      await click(button('확인 완료로 표시'));
      await until(() => button('다시 확인하기'), 'issue can be marked personally checked');
      await click(button('다시 확인하기'));
      await until(() => button('복습 중으로 표시'), 'issue can be reopened');
      const recentChanges = [...doc.querySelectorAll('.learning-issue-history > .learning-issue-events > li')];
      assert.equal(recentChanges.length, 2, 'only two recent changes are expanded');
      assert(recentChanges[0].textContent.includes('확인 필요로 변경'), 'the most recent change appears first');
      assert(!doc.querySelector('.learning-issue-older-events').open, 'older changes start collapsed');
    } else if (feature === 'courses') {
      await until(() => text().includes('챕터') && text().includes('정렬'), 'course chapters and progress render');
      assert(doc.querySelector('input'), 'course title can be edited');
    } else if (feature === 'resume') {
      await until(() => doc.querySelectorAll('a[href="/learn/demo-session"]').length > 0, 'unfinished explanation session is visible');
      assert(text().includes('정렬 알고리즘 확인 퀴즈'), 'quiz resume point is visible');
      await click(doc.querySelector('a[href="/learn/demo-session"]'));
      await until(() => button('직접 설명하기 →'), 'resume link opens the actual explanation workspace');
    } else if (feature === 'plan') {
      await until(() => button('AI가 짜기') && doc.querySelector('input[type="checkbox"]'), 'today tasks and planner controls render');
      await new Promise(resolve => app.win.requestAnimationFrame(() => app.win.requestAnimationFrame(resolve)));
      const task = doc.querySelector('input[type="checkbox"]'), oldState = task.checked;
      await click(task); assert.equal(task.checked, !oldState, 'task completion changes');
      await click(button('AI가 짜기'));
      await until(() => button('이대로 짜기'), 'actual planning options open');
      await click(button('30분'));
      await click(button('이대로 짜기'));
      await until(() => text().includes('하루 30분 예시 계획'), 'selected study time affects the sample plan');
      await click(button('되돌리기'));
      await until(() => !text().includes('하루 30분 예시 계획'), 'generated plan can be undone');
      await click(button('학습 캘린더 · 페이스 플랜'));
      await until(() => text().includes('알고리즘 스터디') && text().includes('페이스'), 'actual calendar and local external events render');
      assert(doc.querySelector('button[aria-label="메뉴 열기"]'), 'actual calendar page shell is used');
    } else if (feature === 'stats') {
      await until(() => text().includes('6회 풀이') && text().includes('평균 70%'), 'quiz statistics render with the sample scores');
      assert(!text().includes('학습과 기억 유지'), 'the promo omits the learning-and-retention panel');
      assert(!text().includes('AI 사용량'), 'the promo omits the AI usage panel');
      assert(text().includes('점수 추이') && text().includes('과목별 성과') && text().includes('최근 풀이'), 'the actual score charts and results remain visible');
      assert(button('개념별 학습 기록') && button('개념 지도'), 'concept tabs remain available');
      await click(button('개념별 학습 기록'));
      await until(() => text().includes('학습한 개념 3개'), 'concept history renders');
      await click(button('변화와 근거 보기 →'));
      await until(() => text().includes('최근 수행 기록'), 'concept evidence detail opens');
      await click(button('개념 지도'));
      await until(() => doc.querySelector('[aria-label="개념 관계 지도"]'), 'actual concept graph renders');
      const selects = doc.querySelectorAll('.workflow-form-grid [role="combobox"]');
      await select(selects[0], '시간 복잡도');
      await select(selects[2], '병합 정렬과 안정성');
      await until(() => !button('연결 저장').disabled, 'graph relation selection updates');
      await click(button('연결 저장'));
      await until(() => [...doc.querySelectorAll('button')].filter(node => node.textContent === '연결 해제').length === 2, 'new graph link is stored');
    } else if (feature === 'integrations') {
      await until(() => [...doc.querySelectorAll('h2')].some(node => node.textContent === 'Notion 자료 연결') && button('자료 찾기'), 'connected data sources render');
      const source = [...doc.querySelectorAll('h2')].find(node => node.textContent === 'Notion 자료 연결').closest('.workflow-panel');
      fill(source.querySelector('input'), '정렬');
      await click(button('자료 찾기', source));
      await until(() => button('최신 본문 가져와 비교', source), 'local source search returns a document');
      await click(button('최신 본문 가져와 비교', source));
      await until(() => button('새 자료 버전으로 저장', source), 'import creates a draft for comparison');
      await click(button('새 자료 버전으로 저장', source));
      await until(() => source.textContent.includes('과목에 새 자료 버전으로 저장했습니다.'), 'source draft can be applied locally');
      const interval = doc.querySelector('[role="combobox"][aria-label="가져오기 간격"]');
      await select(interval, '1시간');
      await until(() => !interval.disabled && interval.textContent.includes('1시간'), 'numeric calendar interval is saved');
      const course = doc.querySelector('[role="combobox"][aria-label="연결 과목"]');
      await select(course, '연결하지 않음');
      await until(() => !course.disabled && course.textContent.includes('연결하지 않음'), 'empty course value removes the event association');
    } else if (feature === 'menubar') {
      await until(() => text().includes('오늘 할 일') && doc.querySelector('.mini-task-check'), 'actual menu bar tasks render');
      const checkbox = doc.querySelector('.mini-task-check'), before = checkbox.getAttribute('aria-pressed');
      await click(checkbox); assert.notEqual(checkbox.getAttribute('aria-pressed'), before, 'menu bar task completion updates');
    }
    app.healthy();
    assert.equal(doc.querySelectorAll('select').length, 0, `${feature}: all dropdowns use custom UI`);
    console.log(`PASS ${feature}`);
    // Close each app after its interaction checks so timers cannot mask errors elsewhere.
    app.dom.window.close();
  }
  console.log('PASS 9 actual feature screens: interactions complete, no network requests or runtime errors.');
} finally {
  for (const { dom } of instances) dom.window.close();
}
