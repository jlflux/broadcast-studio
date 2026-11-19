import test from 'node:test';
import assert from 'node:assert/strict';
import {currentRun, gameKicker, periodName, playerGraphics, statPeriod, teamGraphics} from '../public/js/stat-graphics.js';

const teams = [
  {name: 'Demo Hawks', short: 'HAW'},
  {name: 'Demo Eagles', short: 'EAG'},
];
const stats = {
  sport: 'basketball',
  teams: [
    {players: [{id: 'comet', num: '1', name: 'A. Comet', pos: 'G', cls: 'Sr'}, {id: 'wolf', num: '33', name: 'D. Wolf', pos: 'F', cls: '11'}]},
    {players: [{id: 'blaze', num: '3', name: 'Z. Blaze', pos: 'PG', cls: 'Jr'}, {id: 'flint', num: '50', name: 'N. Flint', pos: 'C', cls: ''}]},
  ],
  events: [
    {type: 'fg', team: 0, player: 'comet', three: true, made: true, period: '1st'},
    {type: 'ft', team: 0, player: 'wolf', made: true, period: '1st'},
    {type: 'fg', team: 1, player: 'blaze', three: true, made: true, ast: 'flint', period: '1st'},
    {type: 'fg', team: 1, player: 'flint', three: false, made: true, period: '1st'},
    {type: 'ft', team: 1, player: 'flint', made: true, period: '1st'},
    {type: 'fg', team: 0, player: 'comet', three: true, made: false, period: '2nd'},
    {type: 'reb', team: 1, player: 'flint', off: false, period: '2nd'},
    {type: 'fg', team: 1, player: 'flint', three: false, made: true, period: '2nd'},
    {type: 'ft', team: 1, player: 'flint', made: false, period: '2nd'},
    {type: 'fg', team: 0, player: 'comet', three: true, made: true, period: '2nd'},
    {type: 'pf', team: 0, player: 'wolf', period: '2nd'},
  ],
};

test('period helpers', () => {
  assert.equal(statPeriod('HALF', stats.events), '2nd');
  assert.equal(statPeriod('FINAL', stats.events), '2nd');
  assert.equal(statPeriod('3rd', stats.events), '3rd');
  assert.equal(periodName('3rd'), '3rd Quarter');
  assert.equal(periodName('OT'), 'Overtime');
  assert.equal(periodName('2OT'), '2nd Overtime');
  assert.equal(gameKicker('HALF'), 'Halftime');
  assert.equal(gameKicker('4th'), '4th Quarter');
});

test('current run counts points since the other team last scored', () => {
  assert.deepEqual(currentRun(stats.events), {team: 0, points: 3});
  assert.deepEqual(currentRun(stats.events.slice(0, 9)), {team: 1, points: 8});
  assert.equal(currentRun([]), null);
});

test('player graphics fill in the numbers', () => {
  const list = playerGraphics({stats, teams, team: 0, playerId: 'comet', period: '2nd'});
  const by = Object.fromEntries(list.map(item => [item.key, item]));
  assert.equal(by.line.text, '6 PTS · 2-3 FG');
  assert.equal(by.points.text, '6 PTS · 2-3 FG · 2-3 3PT');
  assert.equal(by.threes.text, '2 three-pointers · 2 of 3');
  assert.equal(by.quarter.text, '3 PTS in the 2nd quarter · 1-2 FG');
  assert.equal(by.ft, undefined, 'no free throw graphic without attempts');
  const g = by.threes.graphic;
  assert.equal(g.type, 'player');
  assert.equal(g.side, 0);
  assert.equal(g.title, 'A. Comet');
  assert.equal(g.number, '1');
  assert.equal(g.kicker, 'Guard');
  assert.equal(g.subtitle, 'Demo Hawks · Senior');
  assert.equal(g.stat, '2 three-pointers · 2 of 3');

  const flint = Object.fromEntries(playerGraphics({stats, teams, team: 1, playerId: 'flint', period: '2nd'}).map(i => [i.key, i.text]));
  assert.equal(flint.ft, '1 of 2 at the line');
  assert.equal(flint.reb, '1 rebound · 1 DEF');
  assert.equal(flint.ast, '1 assist');

  const wolf = Object.fromEntries(playerGraphics({stats, teams, team: 0, playerId: 'wolf', period: '2nd'}).map(i => [i.key, i.text]));
  assert.equal(wolf.fouls, '1 foul');
  assert.equal(playerGraphics({stats, teams, team: 0, playerId: 'nobody', period: '2nd'}).length, 0);
});

test('double-double shows once two categories reach 10', () => {
  const events = [
    ...Array.from({length: 5}, () => ({type: 'fg', team: 0, player: 'wolf', three: false, made: true, period: '1st'})),
    ...Array.from({length: 10}, () => ({type: 'reb', team: 0, player: 'wolf', off: false, period: '1st'})),
  ];
  const list = playerGraphics({stats: {...stats, events}, teams, team: 0, playerId: 'wolf', period: '1st'});
  assert.equal(list.find(i => i.key === 'double').text, 'Double-double · 10 PTS · 10 REB');
});

test('team graphics', () => {
  const list = teamGraphics({stats, teams, period: '2nd'});
  const by = Object.fromEntries(list.map(item => [item.key, item]));
  assert.deepEqual(Object.keys(by), ['compare', 'quarter', 'shooting', 'leaders', 'byQuarter', 'scorers0', 'scorers1']);
  assert.equal(by.compare.graphic.kicker, '2nd Quarter');
  assert.deepEqual(by.quarter.graphic.rows[0], {label: 'Points', left: '3', right: '2'});
  assert.equal(by.quarter.graphic.title, '2nd Quarter');
  assert.deepEqual(by.leaders.graphic.rows[0], {label: 'Points', left: '6 Comet', right: '5 Flint'});
  assert.deepEqual(by.leaders.graphic.rows.map(r => r.label), ['Points', 'Rebounds', 'Assists']);
  assert.deepEqual(by.byQuarter.graphic.rows, [
    {label: '1st Quarter', left: '4', right: '6'},
    {label: '2nd Quarter', left: '3', right: '2'},
    {label: 'Total', left: '7', right: '8'},
  ]);
  assert.deepEqual(by.scorers1.graphic.rows, [{label: '#50 N. Flint', left: '5 PTS'}, {label: '#3 Z. Blaze', left: '3 PTS'}]);
  assert.equal(by.scorers1.graphic.side, 1);
  assert.equal(by.run, undefined, 'a 3-0 run is too small to offer');

  const runList = teamGraphics({stats: {...stats, events: stats.events.slice(0, 9)}, teams, period: '2nd'});
  const run = runList.find(i => i.key === 'run');
  assert.equal(run.graphic.title, '8-0 Run');
  assert.equal(run.graphic.side, 1);
  assert.equal(teamGraphics({stats: {...stats, events: []}, teams, period: '1st'}).length, 0);
});
