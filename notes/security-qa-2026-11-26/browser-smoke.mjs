/* global process, console, URL, document */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Build separately with synthetic VITE_SUPABASE_URL=https://qa.invalid,
// VITE_SUPABASE_ANON_KEY=qa-public-test-key, and VITE_API_URL=/api.
const output = dirname(fileURLToPath(import.meta.url));
const buildRoot = resolve(process.env.QA_BUILD_DIR || join(tmpdir(), 'tongkk-security-browser-20261126-frontend'));
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const candidates = [process.env.QA_CHROME_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try { await access(candidate); executablePath = candidate; break; } catch { /* Try the next installed browser. */ }
}
assert(executablePath, 'No installed Chromium browser; do not install a browser for this smoke test.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(buildRoot, `.${pathname}`);
    if (file !== buildRoot && !file.startsWith(buildRoot + sep)) { response.writeHead(403).end(); return; }
    if (!extname(file)) file = join(buildRoot, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { date: '2026-11-26', build: 'isolated temporary build with synthetic Supabase credentials',
  browser: executablePath, networkPolicy: 'All external requests aborted; all /api requests fulfilled locally as 401. No real login, API, or user data.',
  routes: [], blockedOrigins: [], localAssetErrors: [], consoleErrors: [] };
const blockedOrigins = new Set();
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-first-run', '--disable-sync'] });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile', serviceWorkers: 'block' });
    let apiRequests = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { blockedOrigins.add(url.origin); await route.abort('blockedbyclient'); return; }
      if (url.pathname.startsWith('/api')) {
        apiRequests++;
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'QA guest session' }) });
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT') && !message.text().includes('401')) {
        report.consoleErrors.push({ viewport: viewport.name, message: message.text() });
      }
    });
    page.on('response', response => {
      if (response.url().startsWith(origin) && !response.url().includes('/api') && response.status() >= 400) {
        report.localAssetErrors.push({ viewport: viewport.name, url: response.url().replace(origin, ''), status: response.status() });
      }
    });
    for (const route of ['/', '/auth', '/teachers', '/flashcards', '/study-paths', '/mini']) {
      console.log(`Smoke ${viewport.name} ${route}`);
      const errorsBefore = runtimeErrors.length;
      await page.goto(origin + route, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => (document.querySelector('#root')?.textContent?.trim().length || 0) > 30);
      const tutorialClose = page.getByRole('button', { name: '튜토리얼 닫기', exact: true });
      if (await tutorialClose.isVisible()) await tutorialClose.click();
      const item = { viewport: viewport.name, route, title: await page.title(),
        rootTextLength: (await page.locator('#root').innerText()).trim().length,
        runtimeErrors: runtimeErrors.slice(errorsBefore), apiRequests };
      if (route === '/auth') {
        const previousRequests = apiRequests;
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        await page.locator('input[type=email]').fill('invalid-email');
        await page.locator('input[type=password]').fill('synthetic-password');
        await page.locator('button[type=submit]').click();
        await page.getByRole('alert').filter({ hasText: '이메일 또는 비밀번호' }).waitFor();
        assert.equal(apiRequests, previousRequests, 'Invalid login input must not send a request.');
        item.invalidLoginBlockedLocally = true;
        if (viewport.name === 'desktop') await page.screenshot({ path: join(output, 'browser-auth-desktop.png'), fullPage: true });
      }
      if (route === '/teachers' && viewport.name === 'mobile') await page.screenshot({ path: join(output, 'browser-teachers-mobile.png'), fullPage: true });
      report.routes.push(item);
      assert.equal(item.runtimeErrors.length, 0, `${viewport.name} ${route} runtime errors`);
    }
    await context.close();
  }
  assert.equal(report.localAssetErrors.length, 0, 'Local build assets must load.');
  assert.equal(report.consoleErrors.length, 0, 'No unexpected browser console errors.');
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack || String(error); process.exitCode = 1;
} finally {
  report.blockedOrigins = [...blockedOrigins];
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(output, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
