import test from 'node:test';
import assert from 'node:assert/strict';
import {Framer, decodeRaw, interpret} from '../public/js/serial.js';

test('framing by start byte + length, and by end byte', () => {
  const f = new Framer({start: 0x02, length: 5});
  assert.deepEqual(f.push([9, 9, 2, 1, 2]), []);
  assert.deepEqual(f.push([3, 4, 2, 5]), [[2, 1, 2, 3, 4]]);
  const e = new Framer({end: 0x0d});
  assert.deepEqual(e.push([65, 66, 13, 67, 13]), [[65, 66, 13], [67, 13]]);
});

test('decoding ascii, bcd and binary fields', () => {
  const frame = [0x02, ...Buffer.from('12:00 7'), 0x21, 0x00, 0x15];
  assert.equal(interpret('clock', decodeRaw(frame, {offset: 1, length: 5, encoding: 'ascii'})), 720000);
  assert.equal(interpret('int', decodeRaw(frame, {offset: 7, length: 1, encoding: 'ascii'})), 7);
  assert.equal(interpret('int', decodeRaw(frame, {offset: 8, length: 1, encoding: 'bcd'})), 21);
  assert.equal(interpret('int', decodeRaw(frame, {offset: 9, length: 2, encoding: 'binary'})), 21);
  assert.equal(interpret('clock', ' 9.4'), 9400);
  assert.equal(interpret('clock', '0845'), 525000);
  assert.equal(interpret('period', 2), '2nd');
  assert.equal(interpret('flag', 0), false);
  assert.equal(decodeRaw(frame, {offset: 40, length: 1, encoding: 'ascii'}), null);
});
