import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {handler} from '../lib/api.js';
import {fileStore, sqlStore} from '../lib/store.js';
import {defaultLive} from '../lib/defaults.js';
import {overlayKey} from '../lib/auth.js';

const password = 'test-password-long-enough-123';
const env = {SCOREBUG_ADMIN_PASSWORD: password};
const origin = 'http://studio.test';

async function stores() {
  const list = [['file', fileStore(await mkdtemp(path.join(tmpdir(), 'studio-')))]];
  if (process.env.LOCAL_PG_URL) {
    const {default: pg} = await import('pg');
    const pool = new pg.Pool({connectionString: process.env.LOCAL_PG_URL});
    await pool.query('DROP TABLE IF EXISTS studio_docs');
    list.push(['postgres', sqlStore((text, params) => pool.query(text, params).then(r => r.rows))]);
  }
  return list;
}

for (const [name, store] of await stores()) {
  test(`${name}: sign in, read default, write, conflict, overlay`, async () => {
    const api = route => handler(route, env, () => store);
    const login = await api('session').fetch(new Request(origin + '/api/session', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify({password}),
    }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];

    const first = await (await api('doc').fetch(new Request(origin + '/api/doc?key=live', {headers: {cookie}}))).json();
    assert.equal(first.revision, 0);
    assert.equal(first.doc.sport, 'football');

    const doc = defaultLive();
    doc.games.football.score = [7, 3];
    const post = (revision, body = doc) => api('doc').fetch(new Request(origin + '/api/doc', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, cookie},
      body: JSON.stringify({key: 'live', session: first.session, revision, doc: body}),
    }));
    const saved = await post(0);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    const stale = await post(0);
    assert.equal(stale.status, 409);
    assert.deepEqual((await stale.json()).doc.games.football.score, [7, 3]);
    const bad = await post(1, {...doc, sport: 'curling'});
    assert.equal(bad.status, 400);

    const unchanged = await api('doc').fetch(new Request(origin + '/api/doc?key=live', {headers: {cookie, 'X-Doc-Version': 'studio-v1/1'}}));
    assert.equal(unchanged.status, 204);

    const denied = await api('overlay').fetch(new Request(origin + '/api/overlay'));
    assert.equal(denied.status, 401);
    const overlay = await api('overlay').fetch(new Request(origin + '/api/overlay', {headers: {Authorization: 'Bearer ' + overlayKey(password)}}));
    const view = await overlay.json();
    assert.equal(view.revision, '1.0');
    assert.deepEqual(view.live.games.football.score, [7, 3]);
    assert.equal(view.ticker.visible, false);

    const anonymous = await api('doc').fetch(new Request(origin + '/api/doc?key=live'));
    assert.equal(anonymous.status, 401);
  });
}
