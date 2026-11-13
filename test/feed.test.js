import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyFeed, readings, roleOf} from '../lib/feed.js';
import {defaultLive} from '../lib/defaults.js';
import {handler} from '../lib/api.js';
import {fileStore} from '../lib/store.js';
import {feedKey} from '../lib/auth.js';
import {remaining} from '../public/js/common.js';

test('reads ScoreSight JSON (Full), JSON (Simple) and GET', () => {
  assert.deepEqual(readings([{name: 'Home Score', text: '14', state: 'Success'}, {name: 'Time', text: '7:57', state: 'SameNoChange'},
    {name: 'Away Score', text: '', state: 'FailedFilter'}]), {'Home Score': '14', Time: '7:57'});
  assert.deepEqual(readings({'Home Score': '3', 'Shot Clock': '21'}), {'Home Score': '3', 'Shot Clock': '21'});
  assert.deepEqual(readings(null, new URLSearchParams('key=x&Period=2')), {Period: '2'});
  assert.equal(roleOf('Score Guest'), 'awayScore');
  assert.equal(roleOf('To Go'), 'distance');
});

test('applies readings: home side, changes only, clock running and stopping', () => {
  const live = defaultLive();
  live.sport = 'basketball';
  live.feed = {enabled: true, homeSide: 1};
  let t = 1_000_000;
  applyFeed(live, {'Home Score': '14', 'Away Score': '9', Time: '8:00', Period: '2', 'Home Fouls': '4'}, t);
  const g = live.games.basketball;
  assert.deepEqual(g.score, [9, 14]);
  assert.equal(g.period, '2nd');
  assert.deepEqual(g.fouls, [0, 4]);
  assert.deepEqual(g.game, {ms: 480000, end: 0});
  // Operator correction sticks while the scoreboard doesn't change.
  g.score[1] = 16;
  t += 1000;
  applyFeed(live, {'Home Score': '14', 'Away Score': '9', Time: '7:59'}, t);
  assert.equal(g.score[1], 16);
  assert.equal(g.game.end, t + 479000, 'counting down → running');
  assert.equal(remaining(g.game, t + 5000), 478001, 'floor holds the display at the last reading');
  t += 2000;
  applyFeed(live, {Time: '7:59'}, t);
  assert.deepEqual(g.game, {ms: 479000, end: 0}, 'held still → stopped');
  t += 500;
  applyFeed(live, {'Home Score': '18'}, t);
  assert.equal(g.score[1], 18);
});

test('ignores readings while disabled and flips home to the left', () => {
  const live = defaultLive();
  live.feed = {enabled: false};
  assert.equal(applyFeed(live, {'Home Score': '7'}, 1), true);
  assert.deepEqual(live.games.football.score, [0, 0]);
  assert.deepEqual(live.feed.raw, {'Home Score': '7'});
  live.feed.enabled = true;
  live.feed.homeSide = 0;
  applyFeed(live, {'Home Score': '7', Down: '3', 'To Go': '8', 'Away Possession': '1'}, 2);
  assert.deepEqual(live.games.football.score, [7, 0]);
  assert.equal(live.games.football.down, 3);
  assert.equal(live.games.football.distance, '8');
  assert.equal(live.games.football.possession, 1);
});

test('feed endpoint needs the feed key and updates the live doc', async () => {
  const password = 'test-password-long-enough-123';
  const store = fileStore(await mkdtemp(path.join(tmpdir(), 'studio-')));
  const live = defaultLive();
  live.feed = {enabled: true, homeSide: 1};
  await store.write('live', 0, live);
  const api = handler('feed', {SCOREBUG_ADMIN_PASSWORD: password}, () => store);
  const post = key => api.fetch(new Request('https://studio.test/api/feed?key=' + key, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({'Home Score': '21', 'Away Score': '7'}),
  }));
  assert.equal((await post('wrong')).status, 401);
  const ok = await post(feedKey(password));
  assert.equal(ok.status, 200);
  assert.deepEqual((await store.read(['live'])).live.doc.games.football.score, [7, 21]);
  const bad = await api.fetch(new Request('https://studio.test/api/feed?key=' + feedKey(password), {method: 'POST', body: 'Name,Text\nTime,1:00'}));
  assert.equal(bad.status, 415);
});
