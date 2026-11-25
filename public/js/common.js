// Shared browser helpers: DOM shortcuts, clocks, colors, images, and Doc — a
// synced JSON document that polls the API and commits changes with
// optimistic concurrency (retrying on conflict against the newest copy).

export const byId = id => document.getElementById(id);
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const copy = value => structuredClone(value);
export const ordinals = ['1st', '2nd', '3rd', '4th'];
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function setText(target, value) {
  const element = typeof target === 'string' ? byId(target) : target;
  const text = String(value ?? '');
  if (element && element.textContent !== text) element.textContent = text;
}

export function remaining(clock, now) {
  // `floor`: a running clock fed by a scoreboard never shows less than the
  // scoreboard's last reading, even if readings stop arriving.
  return Math.max(0, clock.end ? Math.max(clock.end - now, clock.floor || 0) : clock.ms);
}
export const running = (clock, now) => clock.end > now;

export function clockText(ms, tenths = false) {
  if (tenths && ms < 60000) return (Math.ceil(ms / 100) / 10).toFixed(1);
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// "12:00", "12", "0:09.4", "9.4" → milliseconds
export function parseClock(text) {
  const value = String(text).trim();
  let match = value.match(/^(\d{1,2}):(\d{1,2}(?:\.\d)?)$/);
  if (match) return Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
  match = value.match(/^\d{1,2}(?:\.\d)?$/);
  if (match) return Math.round(Number(value) * (value.includes('.') ? 1000 : 60000));
  return NaN;
}

export function hexColor(value) {
  const digits = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(digits) ? '#' + digits.toLowerCase() : '';
}

export function shade(color, factor) {
  const base = hexColor(color) || '#323a46';
  return '#' + base.slice(1).match(/.{2}/g).map(channel =>
    clamp(Math.round(parseInt(channel, 16) * factor), 0, 255).toString(16).padStart(2, '0')).join('');
}

// Blend color a toward b by t (0..1).
export function mix(a, b, t) {
  const left = (hexColor(a) || '#000000').slice(1).match(/.{2}/g).map(c => parseInt(c, 16));
  const right = (hexColor(b) || '#000000').slice(1).match(/.{2}/g).map(c => parseInt(c, 16));
  return '#' + left.map((value, i) => Math.round(value + (right[i] - value) * t).toString(16).padStart(2, '0')).join('');
}

export function luminance(color) {
  const [r, g, b] = (hexColor(color) || '#000000').slice(1).match(/.{2}/g).map(c => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// White or near-black text, whichever reads better on the color.
export const readable = color => luminance(color) > 0.45 ? '#0b0f16' : '#ffffff';

export function setTeamColors(element, team) {
  const base = hexColor(team?.color) || '#323a46';
  element.style.setProperty('--team', base);
  element.style.setProperty('--team-dark', shade(base, 0.72));
  element.style.setProperty('--team-ink', readable(base));
  element.style.setProperty('--accent', hexColor(team?.accent) || '#323a46');
}

export function validImage(value) {
  return typeof value === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(value) ||
    /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value));
}

// Player photos always show in a square. The photo itself is never cropped;
// photoPos says which part of it shows: "<left|center|right> <top|center|bottom>".
export const PHOTO_X = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
export const PHOTO_Y = [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']];
export function photoPosition(value) {
  const [x, y] = String(value || '').split(' ');
  return `${PHOTO_X.some(([v]) => v === x) ? x : 'center'} ${PHOTO_Y.some(([v]) => v === y) ? y : 'top'}`;
}

// Read an image file and shrink it so it stays small enough to sync quickly.
export function readImage(file, {maxWidth = 320, maxHeight = 320, type = 'image/png', quality = 0.86} = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
      reject(new Error('Choose a PNG, JPEG, WebP, GIF, or SVG image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That image could not be read.'));
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(type, quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function download(name, text, type = 'text/plain') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], {type}));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

// Shared server-clock offset so every page agrees on running clocks.
let offset = 0;
export const serverNow = () => Date.now() + offset;
function learnOffset(serverTime, start) {
  if (Number.isFinite(serverTime)) offset = serverTime - (start + Date.now()) / 2;
}

const listeners = new Set();
export function onConnection(listener) { listeners.add(listener); }
let lastOnline = null;
function reportConnection(online) {
  if (online === lastOnline) return;
  lastOnline = online;
  listeners.forEach(listener => listener(online));
}

export class Doc {
  constructor(key, {onChange = () => {}, interval = 1000, onUnauthorized = toLogin} = {}) {
    this.key = key;
    this.onChange = onChange;
    this.interval = interval;
    this.onUnauthorized = onUnauthorized;
    this.packet = null;
    this.busy = false;
    this.failures = 0;
    this.work = Promise.resolve();
    this.timer = 0;
  }
  get doc() { return this.packet?.doc; }
  get ready() { return Boolean(this.packet); }

  start() {
    const loop = async () => {
      await this.poll();
      this.timer = setTimeout(loop, this.interval);
    };
    return this.poll(true).then(() => { this.timer = setTimeout(loop, this.interval); });
  }

  async poll(force = false) {
    if (this.busy) return;
    this.busy = true;
    const start = Date.now();
    try {
      const headers = !force && this.packet ? {'X-Doc-Version': `${this.packet.session}/${this.packet.revision}`} : {};
      const response = await fetch('/api/doc?key=' + encodeURIComponent(this.key), {headers, cache: 'no-store', signal: AbortSignal.timeout(5000)});
      if (response.status === 401) { this.onUnauthorized(); return; }
      if (!response.ok) throw new Error('Disconnected');
      if (response.status !== 204) this.accept(await response.json(), start);
      this.failures = 0;
      reportConnection(true);
    } catch {
      this.failures += 1;
      if (this.failures > 1) reportConnection(false);
    } finally {
      this.busy = false;
    }
  }

  accept(packet, start) {
    learnOffset(packet.now, start);
    const changed = !this.packet || this.packet.revision !== packet.revision || this.packet.session !== packet.session;
    this.packet = packet;
    if (changed) this.onChange(packet.doc);
  }

  // change(draft) mutates a copy of the newest doc; return false to cancel.
  // Resolves true when saved.
  commit(change) {
    return this.work = this.work.then(async () => {
      if (!this.packet) throw new Error('Still connecting. Try again in a moment.');
      while (this.busy) await new Promise(resolve => setTimeout(resolve, 25));
      this.busy = true;
      try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const draft = copy(this.packet.doc);
          if (change(draft) === false) return false;
          const start = Date.now();
          const response = await fetch('/api/doc', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({key: this.key, session: this.packet.session, revision: this.packet.revision, doc: draft}),
            signal: AbortSignal.timeout(8000),
          });
          if (response.status === 401) { this.onUnauthorized(); return false; }
          const next = await response.json();
          if (!response.ok && response.status !== 409) throw new Error(next.error || 'Update failed.');
          this.accept(next, start);
          reportConnection(true);
          if (response.ok) return true;
        }
        throw new Error('Someone else is editing the same thing. Try again.');
      } catch (error) {
        if (error.name === 'TimeoutError' || error instanceof TypeError) {
          reportConnection(false);
          throw new Error('Could not reach the studio. Check the connection and try again.');
        }
        throw error;
      } finally {
        this.busy = false;
      }
    });
  }
}

export function toLogin() {
  const path = location.pathname;
  location.replace(path.startsWith('/stats') ? '/login?next=stats' : path.startsWith('/gamecast') ? '/login?next=gamecast' : path.startsWith('/spotting') ? '/login?next=spotting' : '/login');
}

export async function getSession() {
  const response = await fetch('/api/session', {cache: 'no-store'});
  if (response.status === 401) { toLogin(); return null; }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The studio is unavailable.');
  return response.json();
}

export async function signOut() {
  await fetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({signOut: true})});
  location.replace('/login');
}

export function overlayUrl(key, layers) {
  const url = new URL('/overlay', location.origin);
  if (layers) url.searchParams.set('layers', layers);
  url.hash = 'key=' + key;
  return url.href;
}

export function toast(message, kind = 'info') {
  let host = byId('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  const item = document.createElement('div');
  item.className = 'toast ' + kind;
  item.textContent = message;
  host.append(item);
  setTimeout(() => item.classList.add('out'), kind === 'error' ? 6000 : 2600);
  setTimeout(() => item.remove(), kind === 'error' ? 6500 : 3100);
}
