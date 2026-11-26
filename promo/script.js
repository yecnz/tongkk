(() => {
  'use strict';

  const product = document.getElementById('preview');
  const tablist = product.querySelector('.lp-product-tabs');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
  const header = document.querySelector('.lp-header');
  const demoWindow = product.querySelector('.lp-product-window');
  const reopen = product.querySelector('.lp-demo-reopen');
  const guidance = product.querySelector('.lp-demo-guidance');
  const nextButton = guidance.querySelector('[data-demo-next]');
  const nextSteps = [
    { text: '원본에서 다룬 개념을 요약으로 연결해 보세요.', label: '요약으로 연결하기', index: 1 },
    { text: '요약에서 읽은 개념을 떠올리며 퀴즈에 답해 보세요.', label: '퀴즈로 확인하기', index: 2 },
    { text: '답을 고른 이유가 헷갈리면, 튜터에게 물어보세요.', label: '튜터에게 질문하기', index: 3 },
    { text: '이유를 이해했다면 퀴즈로 돌아가 확인해 보세요.', label: '퀴즈로 돌아가기', index: 2 },
  ];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeStep = 0;

  function selectStep(index, moveFocus = false) {
    if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
    const focusedInPanel = index !== activeStep && panels[activeStep].contains(document.activeElement);
    activeStep = index;
    guidance.querySelector('[data-demo-guidance]').textContent = nextSteps[index].text;
    nextButton.firstChild.textContent = nextSteps[index].label;
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].hidden = !selected;
      panels[tabIndex].inert = !selected;
      panels[tabIndex].setAttribute('aria-hidden', String(!selected));
    });
    if (moveFocus) tabs[index].focus({ preventScroll: true });
    else if (focusedInPanel) panels[index].focus({ preventScroll: true });
  }

  function openDemo(index) {
    demoWindow.hidden = false;
    guidance.hidden = false;
    reopen.hidden = true;
    selectStep(index, true);
    product.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  }

  product.querySelectorAll('[data-demo-close]').forEach((button) => {
    button.addEventListener('click', () => {
      demoWindow.hidden = true;
      guidance.hidden = true;
      reopen.hidden = false;
      reopen.querySelector('button').focus({ preventScroll: true });
    });
  });
  product.querySelector('[data-demo-open]').addEventListener('click', () => openDemo(activeStep));
  nextButton.addEventListener('click', () => openDemo(nextSteps[activeStep].index));
  selectStep(0);

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStep(index));
    tab.addEventListener('keydown', (event) => {
      let next;
      const vertical = tablist.getAttribute('aria-orientation') === 'vertical';
      if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = (index + 1) % tabs.length;
      else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectStep(next, true);
    });
  });

  document.querySelectorAll('[data-flow-start], [data-demo-step]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openDemo(Number(link.dataset.demoStep || 0));
      if (link.dataset.quizQuestion !== undefined) {
        window.dispatchEvent(new CustomEvent('promo:quiz-open', { detail: { index: Number(link.dataset.quizQuestion) } }));
      }
      if (link.hasAttribute('data-quiz-retry')) window.dispatchEvent(new CustomEvent('promo:quiz-retry'));
      if (link.dataset.tutorQuestion) {
        window.dispatchEvent(new CustomEvent('promo:tutor-question', { detail: { question: link.dataset.tutorQuestion } }));
      }
    });
  });
  window.addEventListener('promo:step', (event) => {
    const index = event.detail?.index;
    if (Number.isInteger(index) && index >= 0 && index < tabs.length) openDemo(index);
  });

  // Keep each example mounted when switching: sample edits survive tab changes.
  function setupShowcase(tabSelector, scrollContainer) {
    const choices = [...document.querySelectorAll(tabSelector)];
    const views = choices.map(choice => document.getElementById(choice.getAttribute('aria-controls')));
    let current = 0;
    function select(index, moveFocus = false, alignView = false) {
      if (index < 0 || index >= choices.length) return;
      const focusedInOldView = views[current].contains(document.activeElement);
      current = index;
      choices.forEach((choice, i) => {
        const selected = i === index;
        choice.setAttribute('aria-selected', String(selected));
        choice.tabIndex = selected ? 0 : -1;
        views[i].hidden = !selected;
        views[i].inert = !selected;
        views[i].setAttribute('aria-hidden', String(!selected));
      });
      const frame = views[index].querySelector('iframe[data-src]');
      if (frame && !frame.hasAttribute('src')) frame.src = frame.dataset.src;
      if (moveFocus || focusedInOldView) choices[index].focus({ preventScroll: true });
      const container = scrollContainer && document.querySelector(scrollContainer);
      if (alignView && container && container.getBoundingClientRect().top < header.offsetHeight) {
        container.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
      }
      window.dispatchEvent(new Event('promo:layout'));
    }
    choices.forEach((choice, index) => {
      choice.addEventListener('click', () => select(index, false, true));
      choice.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % choices.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + choices.length - 1) % choices.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = choices.length - 1;
        else return;
        event.preventDefault();
        select(next, true, true);
      });
    });
    select(0);
    return { select, views };
  }
  const journey = setupShowcase('.lp-learning-route [role="tab"]');
  const featureGallery = setupShowcase('.lp-feature-picker [role="tab"]', '.lp-feature-gallery');
  const featureAliases = { 'features-understand': 'feature-explain', 'features-organize': 'feature-courses', 'features-connect': 'feature-stats' };
  function selectHashPanel() {
    const hash = location.hash.slice(1);
    const id = featureAliases[hash] || hash;
    for (const showcase of [journey, featureGallery]) {
      const index = showcase.views.findIndex(panel => panel.id === id);
      if (index !== -1) showcase.select(index);
    }
  }
  window.addEventListener('hashchange', selectHashPanel);
  selectHashPanel();

  // The iframe isolates app styles; content height keeps document scrolling.
  const examples = [...document.querySelectorAll('[data-feature-example]')];
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const example = examples.find(item => item.querySelector('iframe').contentWindow === event.source);
    if (!example || event.data?.type !== 'tongkk-feature' || event.data.feature !== example.dataset.featureExample) return;
    if (event.data.action === 'resize' && Number.isFinite(event.data.height)) {
      if (example.closest('[role="tabpanel"]').hidden || event.data.height < 20) return;
      const frame = example.querySelector('iframe');
      const height = Math.max(180, Math.min(18000, Math.ceil(event.data.height)));
      if (Math.abs(Number(frame.height) - height) > 2) frame.height = String(height);
      window.dispatchEvent(new Event('promo:layout'));
    }
    if (event.data.action === 'learning-step' && Number.isInteger(event.data.step)) openDemo(event.data.step);
    if (event.data.action === 'notice') example.querySelector('.lp-inline-hint').textContent = event.data.text;
  });
  examples.forEach(example => example.querySelector('[data-feature-reset]').addEventListener('click', () => {
    const frame = example.querySelector('iframe');
    frame.src = frame.getAttribute('src');
  }));

  const menuButton = document.querySelector('.lp-menu-toggle');
  const navigation = document.getElementById('landing-navigation');
  const menuIcon = menuButton.querySelector('use');
  function closeMenu(restoreFocus = false) {
    navigation.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', '메뉴 열기');
    menuIcon.setAttribute('href', '#icon-menu');
    if (restoreFocus) menuButton.focus({ preventScroll: true });
  }
  menuButton.addEventListener('click', () => {
    if (menuButton.getAttribute('aria-expanded') === 'true') return closeMenu();
    navigation.classList.add('is-open');
    menuButton.setAttribute('aria-expanded', 'true');
    menuButton.setAttribute('aria-label', '메뉴 닫기');
    menuIcon.setAttribute('href', '#icon-close');
    navigation.querySelector('a').focus();
  });
  navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    const target = document.querySelector(link.getAttribute('href'));
    closeMenu();
    // Move focus out of the mobile menu before it disappears.
    if (!link.hasAttribute('data-flow-start')) {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }));
  document.querySelector('.lp-brand').addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') closeMenu(true);
  });
  window.matchMedia('(min-width: 601px)').addEventListener('change', (event) => {
    if (event.matches) closeMenu();
  });

  // Follow normal document scrolling without intercepting wheel or touch.
  const sectionLinks = [...navigation.querySelectorAll('a')];
  const sections = sectionLinks.map((link) => document.querySelector(link.getAttribute('href')));
  let scrollFrame;
  function updateSection() {
    scrollFrame = undefined;
    const line = header.offsetHeight + window.innerHeight * 0.25;
    let current = -1;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= line) current = index;
    });
    sectionLinks.forEach((link, index) => {
      link.classList.toggle('is-active', index === current);
      if (index === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function scheduleSection() {
    if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(updateSection);
  }
  window.addEventListener('scroll', scheduleSection, { passive: true });
  window.addEventListener('resize', scheduleSection);
  window.addEventListener('pageshow', scheduleSection);
  window.addEventListener('promo:layout', scheduleSection);
  updateSection();

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.lp-section-reveal').forEach((section) => {
      section.classList.add('will-reveal');
      observer.observe(section);
    });
    reducedMotion.addEventListener('change', (event) => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.will-reveal').forEach((section) => section.classList.add('is-visible'));
    });
  }
  document.querySelector('[data-year]').textContent = new Date().getFullYear();
})();
