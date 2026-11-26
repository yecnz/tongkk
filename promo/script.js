(() => {
  'use strict';

  const product = document.getElementById('preview');
  const tablist = product.querySelector('.lp-product-tabs');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
  const header = document.querySelector('.lp-header');
  const demoWindow = product.querySelector('.lp-product-window');
  const reopen = product.querySelector('.lp-demo-reopen');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeStep = 0;

  function selectStep(index, moveFocus = false) {
    if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
    const focusedInPanel = index !== activeStep && panels[activeStep].contains(document.activeElement);
    activeStep = index;
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
    reopen.hidden = true;
    selectStep(index, true);
    product.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  }

  product.querySelectorAll('[data-demo-close]').forEach((button) => {
    button.addEventListener('click', () => {
      demoWindow.hidden = true;
      reopen.hidden = false;
      reopen.querySelector('button').focus({ preventScroll: true });
    });
  });
  product.querySelector('[data-demo-open]').addEventListener('click', () => openDemo(activeStep));
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
    });
  });
  window.addEventListener('promo:step', (event) => {
    const index = event.detail?.index;
    if (Number.isInteger(index) && index >= 0 && index < tabs.length) openDemo(index);
  });

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
