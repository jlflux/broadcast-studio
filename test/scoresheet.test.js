import test from 'node:test';
import assert from 'node:assert/strict';
import {gameLines, matchSeason, parseSeasonTable, runningTotals, seasonFields, seasonRows, sheetPlayers, threeMarks} from '../public/js/scoresheet-data.js';

const saved = [
  {id: 'a', num: '3', name: 'Jalen Ward', season: {ppg: '14.2'}, say: 'juh-LEN'},
  {id: 'b', num: '21', name: 'Cam Ross'},
];
const stats = {
  sport: 'basketball',
  teams: [{players: [{id: 'a', num: '3', name: 'Jalen Ward'}, {id: 'x', num: '21', name: 'Cam Ross'}]}, {players: [{id: 'c', num: '10', name: 'Ben Hale'}]}],
  events: [
    {id: 1, type: 'fg', team: 0, player: 'a', three: true, made: true, period: '1st'},
    {id: 2, type: 'fg', team: 1, player: 'c', made: true, period: '2nd'},
    {id: 3, type: 'ft', team: 0, player: 'x', made: true, period: '3rd'},
    {id: 4, type: 'fg', team: 0, player: 'a', made: true, period: '4th'},
    {id: 5, type: 'pf', team: 1, player: 'c', period: '4th'},
    {id: 6, type: 'fg', team: 0, player: 'a', three: true, made: false, period: 'OT'},
    {id: 7, type: 'fg', team: 0, player: 'a', three: true, made: true, period: 'OT'},
  ],
};

test('sheet players come from the stat keeper with season stats from the saved roster', () => {
  const players = sheetPlayers(0, {stats, rosters: [{players: saved}, null]});
  assert.deepEqual(players.map(p => p.num), ['3', '21']);
  assert.equal(players[0].season.ppg, '14.2');
  assert.equal(players[0].say, 'juh-LEN');
  // Different id, matched by number and name.
  assert.equal(players[1].id, 'x');
  // Stat keeper on football: the saved roster.
  const fromSaved = sheetPlayers(0, {stats: {...stats, sport: 'football'}, rosters: [{players: saved}, null]});
  assert.equal(fromSaved[1].id, 'b');
  assert.deepEqual(sheetPlayers(1, {stats: {...stats, sport: 'football'}, rosters: [null, null]}), []);
  assert.deepEqual(seasonRows(players, 5).map(p => p.num), ['3']);
});

test('running totals by half, with scorers; threes ringed; fouls and points per player', () => {
  const players = [sheetPlayers(0, {stats, rosters: [null, null]}), sheetPlayers(1, {stats, rosters: [null, null]})];
  const halves = runningTotals(stats.events, players);
  assert.deepEqual(halves[0][0], [{score: 3, num: '3', pts: 3, ot: false}]);
  assert.deepEqual(halves[0][1], [{score: 2, num: '10', pts: 2, ot: false}]);
  assert.deepEqual(halves[1][0].map(x => [x.score, x.num, x.ot]), [[4, '21', false], [6, '3', false], [9, '3', true]]);
  assert.deepEqual([...threeMarks(stats.events, 0, 'a')], [3, 8]);
  const lines = gameLines(stats);
  assert.equal(lines[0].get('a').pts, 8);
  assert.equal(lines[1].get('c').pf, 1);
  assert.equal(gameLines({...stats, sport: 'football'})[0].size, 0);
});

test('season stats paste: MaxPreps-style tabs, CSV, totals turned into per-game', () => {
  const rows = parseSeasonTable('#\tAthlete Name\tGP\tPts\tFG%\t3PM\t3P%\n2\tSam Whitfield (Sr)\t20\t312\t44.1\t41\t.352\n\tTeam Totals\t20\t1200\t\t\t');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Sam Whitfield');
  assert.deepEqual(seasonFields(rows[0]), {ppg: '15.6', fgp: '44%', tpm: '41', tpp: '35%'});
  const csv = parseSeasonTable('No,Name,GP,REB,BLK,AST\n44,Ben Okafor,20,190,41,22');
  assert.deepEqual(seasonFields(csv[0]), {reb: '190', rpg: '9.5', blk: '41', bpg: '2.0', apg: '1.1'});
  const roster = [{id: 'w', num: '2', name: 'Sam Whitfield'}, {id: 'o', num: '44', name: 'Ben Okafor'}];
  const {matched, missed} = matchSeason([...rows, ...csv, {name: 'Okafor', ppg: '12'}, {name: 'Nobody', ppg: '1'}], roster);
  assert.deepEqual(matched.map(m => m.player.id), ['w', 'o', 'o']);
  assert.deepEqual(missed, ['Nobody']);
  assert.deepEqual(parseSeasonTable('no header here\n1 2 3'), []);
});
