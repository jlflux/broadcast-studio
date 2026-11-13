// Scoreboard controller import over Web Serial (Chrome/Edge). Controller makers
// rarely publish their byte formats, so the operator maps fields once: frame
// framing (start byte, end byte or fixed length) and, per field, the byte
// offset, length and encoding. The decoded values drive the scorebug.

export const FIELDS = {
  common: [
    ['score0', 'Left team score', 'int'], ['score1', 'Right team score', 'int'],
    ['clock', 'Game clock (text, e.g. 12:00 or 9.4)', 'clock'], ['clockMin', 'Game clock minutes', 'int'],
    ['clockSec', 'Game clock seconds', 'int'], ['clockTenths', 'Game clock tenths', 'int'],
    ['period', 'Period / quarter', 'period'], ['aux', 'Play clock / shot clock (sec)', 'int'],
    ['timeouts0', 'Left timeouts left', 'int'], ['timeouts1', 'Right timeouts left', 'int'],
  ],
  football: [
    ['down', 'Down', 'int'], ['distance', 'Yards to go', 'text'], ['ballOn', 'Ball on', 'text'],
    ['poss0', 'Left possession (non-zero = yes)', 'flag'], ['poss1', 'Right possession (non-zero = yes)', 'flag'],
  ],
  basketball: [
    ['fouls0', 'Left team fouls', 'int'], ['fouls1', 'Right team fouls', 'int'],
    ['arrow0', 'Arrow points left (non-zero = yes)', 'flag'], ['arrow1', 'Arrow points right (non-zero = yes)', 'flag'],
  ],
};
export const ENCODINGS = [['ascii', 'ASCII digits/text'], ['bcd', 'BCD (2 digits per byte)'], ['binary', 'Binary (big-endian)'], ['binaryle', 'Binary (little-endian)']];

export const parseHex = text => {
  const value = String(text || '').trim().replace(/^0x/i, '');
  return /^[0-9a-f]{1,2}$/i.test(value) ? parseInt(value, 16) : null;
};

// Raw bytes for one field → string (ascii) or number.
export function decodeRaw(frame, {offset, length, encoding}) {
  const start = Number(offset), size = Math.max(1, Number(length) || 1);
  if (!Number.isInteger(start) || start < 0 || start + size > frame.length) return null;
  const bytes = frame.slice(start, start + size);
  if (encoding === 'binary') return bytes.reduce((n, b) => n * 256 + b, 0);
  if (encoding === 'binaryle') return bytes.reduceRight((n, b) => n * 256 + b, 0);
  if (encoding === 'bcd') {
    let digits = '';
    for (const b of bytes) digits += ((b >> 4) > 9 ? ' ' : (b >> 4)) + '' + ((b & 15) > 9 ? ' ' : (b & 15));
    return digits;
  }
  return String.fromCharCode(...bytes.map(b => (b >= 32 && b < 127 ? b : 32)));
}

const ORD = ['', '1st', '2nd', '3rd', '4th'];
// Interpret a raw value for the field's kind.
export function interpret(kind, raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (kind === 'flag') return typeof raw === 'number' ? raw !== 0 : (text !== '' && text !== '0');
  if (kind === 'text') return text;
  if (kind === 'clock') {
    let m = text.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
    m = text.match(/^(\d{1,2})\s*\.\s*(\d)$/);
    if (m) return Number(m[1]) * 1000 + Number(m[2]) * 100;
    m = text.replace(/\s+/g, '').match(/^(\d{1,2})(\d{2})$/);
    if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
    m = text.match(/^\d{1,2}$/);
    if (m) return Number(text) * 1000;
    return null;
  }
  if (kind === 'period') {
    const n = typeof raw === 'number' ? raw : parseInt(text, 10);
    if (Number.isFinite(n)) return n >= 1 && n <= 4 ? ORD[n] : n > 4 ? 'OT' : null;
    return text ? text.toUpperCase().slice(0, 8) : null;
  }
  const n = typeof raw === 'number' ? raw : parseInt(text.replace(/\s+/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Split a byte stream into frames.
export class Framer {
  constructor({start = null, end = null, length = 0} = {}) {
    this.start = start; this.end = end; this.length = length; this.buffer = [];
  }
  push(chunk) {
    const frames = [];
    for (const byte of chunk) this.buffer.push(byte);
    if (this.buffer.length > 8192) this.buffer.splice(0, this.buffer.length - 4096);
    for (;;) {
      if (this.start !== null) {
        const at = this.buffer.indexOf(this.start);
        if (at < 0) { this.buffer.length = 0; break; }
        if (at > 0) this.buffer.splice(0, at);
        if (this.length > 0) {
          if (this.buffer.length < this.length) break;
          frames.push(this.buffer.splice(0, this.length));
          continue;
        }
        const next = this.end !== null ? this.buffer.indexOf(this.end, 1) : this.buffer.indexOf(this.start, 1);
        if (next < 0) break;
        frames.push(this.buffer.splice(0, this.end !== null ? next + 1 : next));
        continue;
      }
      if (this.end !== null) {
        const at = this.buffer.indexOf(this.end);
        if (at < 0) break;
        frames.push(this.buffer.splice(0, at + 1));
        continue;
      }
      if (this.length > 0 && this.buffer.length >= this.length) { frames.push(this.buffer.splice(0, this.length)); continue; }
      break;
    }
    return frames;
  }
}

export class SerialReader {
  constructor(onFrame, onState) {
    this.onFrame = onFrame;
    this.onState = onState;
    this.port = null;
    this.reader = null;
    this.keepReading = false;
  }
  static supported() { return 'serial' in navigator; }
  async connect({baud, framing}) {
    this.port = await navigator.serial.requestPort();
    await this.port.open({baudRate: Number(baud) || 9600});
    this.framer = new Framer(framing);
    this.keepReading = true;
    this.onState('connected');
    this.loop();
  }
  setFraming(framing) { if (this.framer) this.framer = new Framer(framing); }
  async loop() {
    while (this.port?.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const {value, done} = await this.reader.read();
          if (done) break;
          for (const frame of this.framer.push(value)) this.onFrame(frame);
        }
      } catch (error) {
        this.onState('error', error.message);
      } finally {
        this.reader.releaseLock();
      }
    }
    this.onState('disconnected');
  }
  async disconnect() {
    this.keepReading = false;
    try { await this.reader?.cancel(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
    this.onState('disconnected');
  }
}
