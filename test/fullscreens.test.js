import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultFullDrafts, keysFull, leaders, leadersFull, lineupFull, matchupFull, statsFull} from '../public/js/fullscreens.js';
import {coverAt, fullUp, newTransition, wipeMs, wipeOver} from '../public/js/transitions.js';
import {defaultLive} from '../lib/defaults.js';
import {validLive} from '../lib/validate.js';

const hoops = {
  sport: 'basketball',
  teams: [
    {players: [{id: 'a', num: '3', name: 'Jalen Ward', pos: 'G', cls: 'Sr'}, {id: 'b', num: '21', name: 'Cam Ross', pos: 'F', cls: '11'}]},
    {players: [{id: 'c', num: '10', name: 'Ben Hale', pos: 'C', cls: 'Jr'}]},
  ],
  events: [
    {id: 1, type: 'fg', team: 0, player: 'a', three: true, made: true, ast: 'b', period: '1st'},
    {id: 2, type: 'fg', team: 1, player: 'c', made: true, period: '1st'},
    {id: 3, type: 'reb', team: 0, player: 'b', off: false, period: '2nd'},
    {id: 4, type: 'fg', team: 0, player: 'b', made: true, period: '2nd'},
  ],
};

function hoopsLive(score = [5, 2], period = 'HALF') {
  const live = defaultLive();
  live.sport = 'basketball';
  live.games.basketball.score = score;
  live.games.basketball.period = period;
  return live;
}
const stamp = full => ({...full, id: 'x1', showAt: 1000, hideAt: 0});

test('score & stats screen locks the bug score, team stats and a matching line score', () => {
  const live = hoopsLive();
  const full = statsFull(defaultFullDrafts().stats, {live, stats: hoops});
  assert.equal(full.kicker, 'Halftime');
  assert.deepEqual(full.score, [5, 2]);
  assert.deepEqual(full.line.columns, ['1st', '2nd', '3rd', '4th']);
  assert.deepEqual(full.line.rows, [[3, 2, 0, 0], [2, 0, 0, 0]]);
  assert.equal(full.rows[0].label, 'Field Goals');
  assert.equal(full.rows.find(r => r.label === 'Assists').left, '1');
  const doc = {...live, full: stamp(full)};
  assert.ok(validLive(doc));

  // The bug disagrees with the stat keeper: no line score, so two scores never show.
  const off = statsFull(defaultFullDrafts().stats, {live: hoopsLive([9, 2]), stats: hoops});
  assert.equal(off.line, undefined);
  // No plays yet: still a valid screen with just the score.
  const empty = statsFull({...defaultFullDrafts().stats, kicker: 'Pregame'}, {live, stats: {...hoops, events: []}});
  assert.equal(empty.kicker, 'Pregame');
  assert.deepEqual(empty.rows, []);
  assert.ok(validLive({...live, full: stamp(empty)}));
});

test('leaders pick the top player per team and skip categories nobody has', () => {
  const rows = leaders('basketball', hoops);
  const points = rows.find(r => r.label === 'Points');
  assert.equal(points.sides[0].name, 'Jalen Ward');
  assert.equal(points.sides[0].stat, '3');
  assert.equal(points.sides[0].detail, '1-1 FG · 1 3PT');
  assert.equal(points.sides[1].name, 'Ben Hale');
  const rebounds = rows.find(r => r.label === 'Rebounds');
  assert.equal(rebounds.sides[0].name, 'Cam Ross');
  const full = leadersFull(defaultFullDrafts().leaders, {live: hoopsLive(), stats: hoops});
  assert.equal(full.leaders.length, 4);
  assert.ok(validLive({...hoopsLive(), full: stamp(full)}));

  const fb = {sport: 'football', teams: [{players: [{id: 'q', num: '7', name: 'Marcus Hill'}]}, {players: []}],
    events: [{id: 1, type: 'pass', team: 0, player: 'q', result: 'complete', yards: 30, td: true, period: '1st'}, {id: 2, type: 'pass', team: 0, player: 'q', result: 'incomplete', period: '1st'}]};
  const passing = leaders('football', fb).find(r => r.label === 'Passing');
  assert.deepEqual(passing.sides[0], {num: '7', name: 'Marcus Hill', stat: '30', detail: '1/2 · 1 TD'});
  assert.equal(passing.sides[1], null);
  assert.equal(leaders('football', fb).find(r => r.label === 'Rushing').sides[0], null);
});

test('lineup, keys and matchup screens', () => {
  const players = [{num: '3', name: 'Jalen Ward', pos: 'G', cls: 'Sr', photo: 'data:image/png;base64,AAAA', photoPos: 'center top'}];
  const lineup = lineupFull({...defaultFullDrafts().lineup, side: 1}, players, 'basketball');
  assert.equal(lineup.side, 1);
  assert.equal(lineup.players[0].cls, 'Senior');
  assert.equal(lineup.players[0].photo, 'data:image/png;base64,AAAA');
  // More than five: a text list, no photos.
  const eleven = Array.from({length: 14}, (_, i) => ({...players[0], num: String(i)}));
  const list = lineupFull(defaultFullDrafts().lineup, eleven, 'football');
  assert.equal(list.players.length, 12);
  assert.equal(list.players[0].photo, '');
  const keys = keysFull({...defaultFullDrafts().keys, points: ['Win the turnover battle', '', 'Rebound']});
  assert.deepEqual(keys.points, ['Win the turnover battle', 'Rebound']);
  const live = defaultLive();
  for (const full of [lineup, list, keys, matchupFull({kicker: 'Tonight', title: 'Region 5', subtitle: 'Waldrop Stadium'})]) {
    assert.ok(validLive({...live, full: stamp(full)}), full.kind);
  }
  assert.equal(validLive({...live, full: {...stamp(keys), points: Array(6).fill('x')}}), false);
});

test('wipes run on the server clock and full-screens switch at the cover point', () => {
  const t = newTransition({wipe: 'iris', wipeSpeed: 'fast'}, 10_000, 1, 'w1');
  assert.deepEqual(t, {id: 'w1', style: 'iris', speed: 'fast', side: 1, at: 11_000});
  assert.equal(wipeMs('fast'), 1000);
  assert.equal(coverAt(t), 11_500);
  assert.equal(wipeOver(t, 11_900), false);
  assert.equal(wipeOver(t, 12_300), true);
  assert.equal(newTransition({}, 0, 5, 'w').style, 'slash');
  assert.equal(newTransition({}, 0, 5, 'w').side, -1);
  const live = defaultLive();
  assert.ok(validLive({...live, transition: t}));
  assert.equal(validLive({...live, transition: {...t, style: 'spin'}}), false);
  assert.equal(validLive({...live, style: {...live.style, wipe: 'spin'}}), false);
  const full = {showAt: 100, hideAt: 500};
  assert.equal(fullUp(full, 99), false);
  assert.equal(fullUp(full, 100), true);
  assert.equal(fullUp(full, 500), false);
  assert.equal(fullUp({showAt: 100, hideAt: 0}, 1e12), true);
  assert.equal(fullUp(null, 1), false);
});

test('matchup clock: countdown to a start time, or the scorebug clock', async () => {
  const {startAtFor} = await import('../public/js/fullscreens.js');
  const now = new Date(2026, 10, 24, 18, 30).getTime();
  assert.equal(startAtFor('19:00', now), new Date(2026, 10, 24, 19, 0).getTime());
  assert.equal(startAtFor('18:00', now), new Date(2026, 10, 24, 18, 0).getTime()); // just passed: today
  assert.equal(startAtFor('06:00', now), new Date(2026, 10, 25, 6, 0).getTime()); // long gone: tomorrow
  assert.equal(startAtFor('', now), 0);
  const draft = {...defaultFullDrafts().matchup, clock: 'start', startTime: '19:00'};
  const full = matchupFull(draft, 'football', now);
  assert.equal(full.clock, 'start');
  assert.equal(full.clockLabel, 'Kickoff in');
  assert.equal(full.startAt, new Date(2026, 10, 24, 19, 0).getTime());
  assert.equal(matchupFull({...draft, startTime: ''}, 'football', now).clock, undefined);
  const game = matchupFull({...draft, clock: 'game', clockLabel: 'Tip-off'}, 'basketball', now);
  assert.deepEqual([game.clock, game.clockLabel, game.startAt], ['game', 'Tip-off', undefined]);
  const live = defaultLive();
  assert.ok(validLive({...live, full: stamp(full)}));
  assert.ok(validLive({...live, full: stamp(game)}));
  assert.equal(validLive({...live, full: {...stamp(full), clock: 'moon'}}), false);
});
