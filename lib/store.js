// Document store. Every piece of studio data is one JSON document under a key
// (live, ticker, library, stats, photo:<id>) with a revision number used for
// optimistic concurrency: a write succeeds only if it names the current revision.
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import path from 'node:path';

const TABLE = 'studio_docs';

// `query(text, params)` must resolve to an array of rows. Works with
// @neondatabase/serverless (`sql.query`) and node-postgres (`pool.query`).
export function sqlStore(query) {
  let initialization;
  async function use(run) {
    try {
      return await run();
    } catch (error) {
      if (error.code !== '42P01') throw error;
      initialization ||= query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
          key TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          doc JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`, []).catch(error => { initialization = undefined; throw error; });
      await initialization;
      return await run();
    }
  }
  return {
    async read(keys) {
      const rows = await use(() => query(`SELECT key, revision, doc FROM ${TABLE} WHERE key = ANY($1)`, [keys]));
      return Object.fromEntries(rows.map(row => [row.key, {revision: row.revision, doc: row.doc}]));
    },
    async revisions(keys) {
      const rows = await use(() => query(`SELECT key, revision FROM ${TABLE} WHERE key = ANY($1)`, [keys]));
      return Object.fromEntries(rows.map(row => [row.key, row.revision]));
    },
    async write(key, revision, doc) {
      const data = JSON.stringify(doc);
      const rows = await use(() => revision === 0
        ? query(`INSERT INTO ${TABLE} (key, revision, doc) VALUES ($1, 1, $2::jsonb)
                 ON CONFLICT (key) DO NOTHING RETURNING revision`, [key, data])
        : query(`UPDATE ${TABLE} SET revision = revision + 1, doc = $2::jsonb, updated_at = now()
                 WHERE key = $1 AND revision = $3 RETURNING revision`, [key, data, revision]));
      return rows[0]?.revision ?? null;
    },
    async remove(key) {
      await use(() => query(`DELETE FROM ${TABLE} WHERE key = $1`, [key]));
    },
  };
}

let neonCache;
export async function neonStore(url) {
  if (neonCache?.url === url) return neonCache.store;
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(url);
  const store = sqlStore((text, params) => sql.query(text, params));
  neonCache = {url, store};
  return store;
}

// Single-process JSON file store for running on a laptop (`npm run local`).
export function fileStore(directory) {
  const file = path.join(directory, 'docs.json');
  let docs;
  let saving = Promise.resolve();
  async function load() {
    if (docs) return docs;
    try {
      docs = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      docs = {};
    }
    return docs;
  }
  function persist() {
    const snapshot = JSON.stringify(docs);
    saving = saving.then(async () => {
      await mkdir(directory, {recursive: true});
      await writeFile(file + '.tmp', snapshot);
      await rename(file + '.tmp', file);
    });
    return saving;
  }
  return {
    async read(keys) {
      const all = await load();
      return Object.fromEntries(keys.filter(key => all[key]).map(key => [key, structuredClone(all[key])]));
    },
    async revisions(keys) {
      const all = await load();
      return Object.fromEntries(keys.filter(key => all[key]).map(key => [key, all[key].revision]));
    },
    async write(key, revision, doc) {
      const all = await load();
      const current = all[key]?.revision ?? 0;
      if (current !== revision) return null;
      all[key] = {revision: current + 1, doc: structuredClone(doc)};
      await persist();
      return current + 1;
    },
    async remove(key) {
      const all = await load();
      delete all[key];
      await persist();
    },
  };
}
