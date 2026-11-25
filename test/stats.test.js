import test from 'node:test';
import assert from 'node:assert/strict';
import {boxScore, compareRows, lineScore, parseRoster, score, statLine, teamFouls, describe} from '../public/js/stats-engine.js';

const fb = {
  teams: [
    {short: 'EAS', players: [{id: 'q', num: '7', name: 'Marcus Hill'}, {id: 'w', num: '1', name: 'Dee Carter'}, {id: 'k', num: '30', name: 'Sam Ruiz'}]},
    {short: 'WES', players: [{id: 'd', num: '22', name: 'Ty Brooks'}]},
  ],
  events: [
    {id: 1, type: 'pass', team: 0, player: 'q', result: 'complete', receiver: 'w', yards: 45, td: true, period: '1st'},
    {id: 2, type: 'pat', team: 0, player: 'k', kind: 'kick', good: true, period: '1st'},
    {id: 3, type: 'pass', team: 0, player: 'q', result: 'int', defender: 'd', period: '2nd'},
    {id: 4, type: 'sack', team: 0, player: 'q', yards: 6, defender: 'd', period: '2nd'},
    {id: 5, type: 'rush', team: 0, player: 'q', yards: 12, period: '3rd'},
    {id: 6, type: 'fg', team: 0, player: 'k', yards: 31, good: true, period: '3rd'},
    {id: 7, type: 'ret', team: 1, player: 'd', kind: 'int', yards: 60, td: true, period: '4th'},
    {id: 8, type: 'pat', team: 1, player: null, kind: 'run', good: true, period: '4th'},
    {id: 9, type: 'safety', team: 1, player: null, period: '4th'},
  ],
};

test('football score, box score, line score and stat lines', () => {
  assert.deepEqual(score('football', fb.events), [10, 10]);
  const box = boxScore('football', fb);
  const qb = box.teams[0].players.find(p => p.player.id === 'q').line;
  assert.deepEqual(qb.pass, {cmp: 1, att: 2, yds: 45, td: 1, int: 1, long: 45});
  assert.equal(qb.rush.car, 2);
  assert.equal(qb.rush.yds, 6);
  const d = box.teams[1].players.find(p => p.player.id === 'd').line;
  assert.equal(d.def.int, 1);
  assert.equal(d.def.sack, 1);
  assert.equal(statLine('football', qb), '1/2 · 45 YDS · 1 TD · 1 INT  |  2 CAR · 6 YDS');
  const rows = compareRows('football', box);
  assert.deepEqual(rows[0], {label: 'Total Yards', left: '51', right: '0'});
  assert.deepEqual(rows[4], {label: 'Turnovers', left: '1', right: '0'});
  assert.deepEqual(lineScore('football', fb.events), {columns: ['1st', '2nd', '3rd', '4th'], rows: [[7, 0, 3, 0], [0, 0, 0, 10]]});
  assert.match(describe('football', fb.events[0], fb), /#7 Marcus Hill pass complete to #1 Dee Carter for 45 yds, TOUCHDOWN/);
});

test('basketball score, fouls, assists and stat line', () => {
  const game = {teams: [{players: [{id: 'a', num: '3', name: 'A'}, {id: 'b', num: '5', name: 'B'}]}, {players: []}], events: [
    {type: 'fg', team: 0, player: 'a', three: true, made: true, ast: 'b', period: '1st'},
    {type: 'fg', team: 0, player: 'a', three: false, made: false, period: '1st'},
    {type: 'ft', team: 0, player: 'a', made: true, period: '2nd'},
    {type: 'reb', team: 0, player: 'b', off: true, period: '2nd'},
    {type: 'pf', team: 1, player: null, period: '2nd'},
    {type: 'pf', team: 1, player: null, period: '2nd'},
    {type: 'pf', team: 0, player: 'a', period: '1st'},
    {type: 'adj', team: 1, points: 2, period: '2nd'},
  ]};
  assert.deepEqual(score('basketball', game.events), [4, 2]);
  assert.deepEqual(teamFouls(game.events, '2nd'), [0, 2]);
  const box = boxScore('basketball', game);
  const a = box.teams[0].players.find(p => p.player.id === 'a').line;
  assert.equal(statLine('basketball', a), '4 PTS · 1-2 FG · 1-1 3PT');
  assert.equal(box.teams[0].players.find(p => p.player.id === 'b').line.ast, 1);
});

test('roster parsing', () => {
  assert.deepEqual(parseRoster('7 Marcus Hill QB Sr\n#22 Ty Brooks, DB, Jr\nDee Carter 1 WR 11'), [
    {num: '7', name: 'Marcus Hill', pos: 'QB', cls: 'Sr'},
    {num: '22', name: 'Ty Brooks', pos: 'DB', cls: 'Jr'},
    {num: '1', name: 'Dee Carter', pos: 'WR', cls: '11'},
  ]);
  assert.deepEqual(parseRoster('No,Name,Pos,Yr\n3,Jalen Ward,G,Sr'), [{num: '3', name: 'Jalen Ward', pos: 'G', cls: 'Sr'}]);
});

test('roster parser keeps height and weight for spotting boards', async () => {
  const {parseRoster} = await import('../public/js/stats-engine.js');
  assert.deepEqual(parseRoster('7 Marcus Hill QB Sr 6-2 195 lbs'), [{num: '7', name: 'Marcus Hill', pos: 'QB', cls: 'Sr', ht: '6-2', wt: '195'}]);
  assert.deepEqual(parseRoster('No,Name,Pos,Ht,Wt\n3,Jalen Ward,G,6-1,180 lbs'), [{num: '3', name: 'Jalen Ward', pos: 'G', cls: '', ht: '6-1', wt: '180'}]);
});
