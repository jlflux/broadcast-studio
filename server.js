// Local mode: runs the whole studio on one laptop with no internet or database.
//   SCOREBUG_ADMIN_PASSWORD=... npm run local
// Data is saved in ./data. Set HOST=0.0.0.0 to let tablets on the same network
// reach the control panel and stat keeper (anyone on that network who knows
// the password can then change the game).
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handler} from './lib/api.js';
import {fileStore, sqlStore} from './lib/store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

let store;
if (process.env.LOCAL_PG_URL) {
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString: process.env.LOCAL_PG_URL});
  store = sqlStore((text, params) => pool.query(text, params).then(result => result.rows));
} else {
  store = fileStore(path.join(root, 'data'));
}

const env = {...process.env};
if (!env.SCOREBUG_ADMIN_PASSWORD) {
  console.error('Set SCOREBUG_ADMIN_PASSWORD (20+ characters) before starting, e.g.\n  SCOREBUG_ADMIN_PASSWORD=my-long-password-here npm run local');
  process.exit(1);
}
const routes = Object.fromEntries(['doc', 'overlay', 'session'].map(route => [route, handler(route, env, () => store)]));
const rewrites = {'/': '/control.html', '/control': '/control.html', '/overlay': '/overlay.html', '/stats': '/stats.html', '/login': '/login.html'};
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain'};

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const api = url.pathname.match(/^\/api\/(doc|overlay|session)$/);
    if (api) {
      const result = await routes[api[1]].fetch(new Request(url, {
        method: request.method, headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await body(request),
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    const file = path.normalize(path.join(publicDir, rewrites[url.pathname] || url.pathname));
    if (!file.startsWith(publicDir)) throw Object.assign(new Error(), {code: 'ENOENT'});
    const data = await readFile(file);
    response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    response.end(data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500);
    response.end();
  }
}).listen(port, host, () => {
  console.log(`Studio running:\n  Control panel  http://localhost:${port}/control\n  Stat keeper    http://localhost:${port}/stats`);
});
