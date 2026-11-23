import {DEFAULT_DOCS} from './defaults.js';
import {equal, feedKey, operatorSession, overlayKey, sessionCookie} from './auth.js';
import {applyFeed, readings} from './feed.js';
import {neonStore} from './store.js';
import {LIMITS, docKind, validDoc, validLive} from './validate.js';

const SESSION = 'studio-v1';
const HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
const OVERLAY_KEYS = ['live', 'ticker'];

function json(value, status = 200, additional = {}) {
  return Response.json(value, {status, headers: {...HEADERS, ...additional}});
}

async function readJson(request, limit) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json') || !request.body) {
    throw new SyntaxError('Expected JSON.');
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) return JSON.parse(text + decoder.decode());
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new RangeError('That is too much data to save. Use smaller images.');
    }
    text += decoder.decode(value, {stream: true});
  }
}

async function readText(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new RangeError('Too much data.'); }
    text += decoder.decode(value, {stream: true});
  }
}

const fallback = key => DEFAULT_DOCS[key]?.() ?? null;
const packet = (key, entry) => ({session: SESSION, key, revision: entry?.revision ?? 0, now: Date.now(), doc: entry?.doc ?? fallback(key)});

async function defaultStore(env) {
  const url = env.DATABASE_URL || env.POSTGRES_URL;
  if (!url) return null;
  return neonStore(url);
}

export function handler(route, env = process.env, makeStore = defaultStore) {
  return {async fetch(request) {
    try {
      const password = env.SCOREBUG_ADMIN_PASSWORD;
      if (!password || password.length < 20) return json({error: 'Set a SCOREBUG_ADMIN_PASSWORD of at least 20 characters.'}, 503);
      const method = request.method;
      const url = new URL(request.url);
      if (route !== 'feed' && method === 'POST' && request.headers.get('Origin') !== url.origin) {
        return json({error: 'Open the operator panel directly.'}, 403);
      }
      const isOperator = operatorSession(request, password);

      if (route === 'session') {
        if (method === 'GET') return isOperator
          ? json({overlayKey: overlayKey(password), feedKey: feedKey(password)}) : json({error: 'Sign in to run the studio.'}, 401);
        if (method !== 'POST') return json({error: 'Method not allowed.'}, 405);
        const action = await readJson(request, 4096);
        if (action?.signOut === true && isOperator) return json({}, 200, {'Set-Cookie': sessionCookie(request, password, true)});
        if (typeof action?.password !== 'string' || !equal(action.password, password)) {
          return json({error: 'Incorrect password.'}, 401);
        }
        return json({}, 200, {'Set-Cookie': sessionCookie(request, password)});
      }

      const store = await makeStore(env);
      if (!store) return json({error: 'Connect a Neon database or set DATABASE_URL.'}, 503);

      if (route === 'feed') {
        // Scoreboard camera feed (ScoreSight "Send out API requests"). The key in
        // the URL or an Authorization header is the credential; no cookie.
        const key = request.headers.get('Authorization') || 'Bearer ' + (url.searchParams.get('key') || '');
        if (!equal(key, 'Bearer ' + feedKey(password))) return json({error: 'Use the feed URL from the control panel.'}, 401);
        let body = null;
        if (method === 'POST' || method === 'PUT') {
          const text = await (await readText(request, 64_000));
          try { body = text ? JSON.parse(text) : null; }
          catch { return json({error: 'Send JSON: in ScoreSight set the encoding to "JSON (Full)" or "JSON (Simple key-value)".'}, 415); }
        } else if (method !== 'GET') return json({error: 'Method not allowed.'}, 405);
        const values = readings(body, method === 'GET' ? url.searchParams : null);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const current = (await store.read(['live'])).live;
          const doc = structuredClone(current?.doc ?? fallback('live'));
          const changed = applyFeed(doc, values, Date.now());
          if (!changed) return json({ok: true, applied: false});
          if (!validLive(doc)) return json({error: 'Those readings could not be applied.'}, 400);
          if (await store.write('live', current?.revision ?? 0, doc)) return json({ok: true, applied: doc.feed.enabled});
        }
        return json({error: 'The scorebug is busy. The next reading will catch up.'}, 409);
      }

      if (route === 'overlay') {
        if (method !== 'GET') return json({error: 'Method not allowed.'}, 405);
        const key = request.headers.get('Authorization') || 'Bearer ' + (url.searchParams.get('key') || '');
        if (!equal(key, 'Bearer ' + overlayKey(password))) return json({error: 'An OBS overlay link is required.'}, 401);
        if (url.searchParams.get('doc') === 'gamecast') {
          // The gamecast OBS page (/gamecast?output=1) reads its own doc with the same overlay key.
          const revisions = await store.revisions(['gamecast']);
          const version = `${SESSION}/g${revisions.gamecast ?? 0}`;
          if (request.headers.get('X-Doc-Version') === version) return new Response(null, {status: 204, headers: HEADERS});
          const docs = await store.read(['gamecast']);
          return json({session: SESSION, revision: `g${docs.gamecast?.revision ?? 0}`, now: Date.now(), gamecast: docs.gamecast?.doc ?? fallback('gamecast')});
        }
        const revisions = await store.revisions(OVERLAY_KEYS);
        const version = `${SESSION}/${revisions.live ?? 0}.${revisions.ticker ?? 0}`;
        if (request.headers.get('X-Doc-Version') === version) return new Response(null, {status: 204, headers: HEADERS});
        const docs = await store.read(OVERLAY_KEYS);
        return json({session: SESSION, revision: `${docs.live?.revision ?? 0}.${docs.ticker?.revision ?? 0}`, now: Date.now(),
          live: docs.live?.doc ?? fallback('live'), ticker: docs.ticker?.doc ?? fallback('ticker')});
      }

      // route === 'doc'
      if (!isOperator) return json({error: 'Sign in to run the studio.'}, 401);
      if (method === 'GET') {
        const key = url.searchParams.get('key') || '';
        const kind = docKind(key);
        if (!kind) return json({error: 'Unknown document.'}, 404);
        const revisions = await store.revisions([key]);
        if (request.headers.get('X-Doc-Version') === `${SESSION}/${revisions[key] ?? 0}`) {
          return new Response(null, {status: 204, headers: HEADERS});
        }
        const docs = await store.read([key]);
        if (kind === 'photo' && !docs[key]) return json({error: 'Photo not found.'}, 404);
        return json(packet(key, docs[key]));
      }
      if (method !== 'POST') return json({error: 'Method not allowed.'}, 405);
      const body = await readJson(request, Math.max(...Object.values(LIMITS)) + 4096);
      const key = body?.key;
      const kind = docKind(key);
      if (!kind) return json({error: 'Unknown document.'}, 404);
      if (JSON.stringify(body.doc).length > LIMITS[kind]) return json({error: 'That is too much data to save. Use smaller images.'}, 413);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !validDoc(kind, body.doc)) {
        return json({error: 'That change could not be saved. Reload the page and try again.'}, 400);
      }
      const saved = body.session === SESSION && await store.write(key, body.revision, body.doc);
      if (saved) return json(packet(key, {revision: saved, doc: body.doc}));
      const current = await store.read([key]);
      return json(packet(key, current[key]), 409);
    } catch (error) {
      if (error instanceof RangeError) return json({error: error.message}, 413);
      if (error instanceof SyntaxError) return json({error: 'That change could not be read.'}, 400);
      console.error('Studio request failed', error?.code ?? error?.name, error?.message);
      return json({error: 'The studio database is temporarily unavailable.'}, 503);
    }
  }};
}
