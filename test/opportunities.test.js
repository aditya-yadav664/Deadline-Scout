import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { hash } from '../server/security.js';

const executablePath = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium'
].find(path => path && existsSync(path));

async function fixture(t) {
  const store = new Store(':memory:');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const url = 'http://127.0.0.1:' + port;
  const app = createApp({
    store,
    env: { HOST: '127.0.0.1', APP_URL: url },
    vault: { seal: JSON.stringify, open: JSON.parse }
  });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  t.after(() => app.close());
  const source = url + '/demo/registration';
  const faq = url + '/demo/faq';
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  const { data: { token } } = await request('/api/local-session', 'POST', {});
  const { data: page } = await request('/api/inspect', 'POST', { url: source }, token);
  const { status, data: track } = await request('/api/tracks', 'POST', {
    title: 'Orbit Hack',
    url: source,
    sources: [source, faq],
    milestones: page.milestones.filter(milestone => milestone.kind === 'registration_closes')
  }, token);
  assert.equal(status, 201);
  return { store, url, source, faq, track, token, request };
}

test('opportunity details project legacy tracks, isolate owners and retain bounded source evidence', async t => {
  const f = await fixture(t);
  const path = '/api/opportunities/' + f.track.id;
  assert.equal((await f.request(path)).status, 401);
  f.store.put('_system', 'session', hash('other-account'), { owner: 'another', expires: Date.now() + 10000 });
  assert.equal((await f.request(path, 'GET', undefined, 'other-account')).status, 404);
  const get = async () => (await f.request(path, 'GET', undefined, f.token)).data;
  const send = (path, method, body) => f.request(path, method, body, f.token);
  const check = () => send('/api/tracks/' + f.track.id + '/check', 'POST', {});
  const legacy = await get();
  assert.equal(legacy.milestones[0].id, f.track.milestones[0].id);
  assert.deepEqual(legacy.sources.map(source => source.history), [[], []]);
  await check();
  await check();
  assert.equal((await get()).sources[0].history.length, 1);
  await send('/api/demo', 'POST', { mode: 'changed' });
  await check();
  const changed = await get();
  assert.equal(changed.changes[0].category, 'milestone_date');
  assert.equal(changed.changes[0].before.date, '2026-11-28');
  assert.equal(changed.changes[0].after.date, '2026-11-26');
  assert.match(changed.sources.find(source => source.url === f.faq).history[0].evidence[0].quote, /moved/);
  await send('/api/demo', 'POST', { mode: 'failed' });
  await check();
  const failed = await get();
  assert.equal(failed.milestones[0].date, '2026-11-26');
  assert.equal(failed.sources.find(source => source.url === f.faq).history[0].status, 'unavailable');
  await send('/api/tracks/' + f.track.id, 'DELETE');
  assert.equal((await f.request(path, 'GET', undefined, f.token)).status, 404);
  assert.equal(f.store.get('local-demo', 'sourceHistory', f.track.id), null);
});

test('dashboard shell keeps watchlist actions and opportunity links accessible on mobile', { skip: !executablePath }, async t => {
  const f = await fixture(t);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url);
  await page.getByRole('button', { name: /^My Watchlist/ }).click();
  await page.locator('#tracks').getByRole('button', { name: 'Check now' }).click();
  await page.locator('#tracks').getByRole('link', { name: 'Orbit Hack' }).click();
  await page.getByRole('heading', { name: 'Orbit Hack' }).waitFor();
  await page.getByText('Source evidence', { exact: true }).first().click();
  await page.getByText('Milestones found', { exact: false }).first().waitFor();
  assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), true);
  await page.reload();
  await page.getByRole('heading', { name: 'Orbit Hack' }).waitFor();
  await page.getByRole('button', { name: 'Back to watchlist' }).click();
  await page.getByRole('link', { name: 'Backup Signup', exact: true }).click();
  await page.waitForURL('**/backup.html');
  assert.deepEqual(errors, []);
});
