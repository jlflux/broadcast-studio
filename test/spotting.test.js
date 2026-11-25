import test from 'node:test';
import assert from 'node:assert/strict';
import {byNumber, footballGroups, gridShape, splitName} from '../public/js/spotting-layout.js';

test('football groups put two-way players on both sides and sort by position', () => {
  const players = [
    {num: '22', name: 'A', pos: 'RB/LB'}, {num: '7', name: 'B', pos: 'QB'}, {num: '70', name: 'C', pos: 'OL'},
    {num: '3', name: 'D', pos: 'WR/DB'}, {num: '90', name: 'E', pos: 'DL'}, {num: '18', name: 'F', pos: 'K'}, {num: '5', name: 'G', pos: 'ATH'}, {num: '9', name: 'H', pos: ''},
  ];
  const g = footballGroups(players);
  assert.deepEqual(g.offense.map(p => p.num), ['7', '22', '3', '70']);
  assert.deepEqual(g.defense.map(p => p.num), ['90', '22', '3']);
  assert.deepEqual(g.special.map(p => p.num), ['18']);
  assert.deepEqual(g.other.map(p => p.num), ['5', '9']);
});

test('boxes fill the page without getting too short', () => {
  const shape = gridShape(56, 10.3, 6.67, {ratio: 2.7, minHeight: 0.5});
  assert.ok(shape.cols * shape.rows >= 56);
  assert.ok(6.67 / shape.rows >= 0.5);
  assert.deepEqual(gridShape(0, 10, 6), {cols: 1, rows: 1, boxW: 10, boxH: 1.2});
  const few = gridShape(12, 10.3, 6.67);
  assert.ok(few.boxH <= 1.2);
});

test('names and number order', () => {
  assert.deepEqual(splitName('Jaylen Carter'), {first: 'Jaylen', last: 'Carter'});
  assert.deepEqual(splitName('Carter, Jaylen'), {first: 'Jaylen', last: 'Carter'});
  assert.deepEqual(splitName('Marcus Hill Jr.'), {first: 'Marcus', last: 'Hill Jr.'});
  assert.deepEqual(splitName('Prince'), {first: '', last: 'Prince'});
  assert.deepEqual(byNumber([{num: '10'}, {num: ''}, {num: '2'}]).map(p => p.num), ['2', '10', '']);
});
