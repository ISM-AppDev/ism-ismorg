/**
 * ismorg-solutions vote service — zero external dependencies.
 *
 * Endpoints (proxied by nginx at https://ismorg.com/solutions/api/):
 *   GET  /api/health        -> { ok: true }
 *   GET  /api/votes         -> { "<slug>": <count>, ... }
 *   POST /api/vote          body { slug, action: "vote"|"unvote", token, website }
 *                           -> { slug, count }
 *
 * Storage is a single JSON file, written atomically (tmp + rename) and
 * debounced. At this scale (a few voters, dozens of ideas) that is plenty and
 * avoids a native sqlite build on the box.
 *
 * Abuse guards: per-IP write rate limit, honeypot field, strict id validation.
 * The site also sits behind HTTP basic-auth until it is made public.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 4310);
const DATA_FILE = resolve(process.env.DATA_FILE || './votes.json');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const WRITE_LIMIT = 40;            // writes per window per IP
const WINDOW_MS = 5 * 60 * 1000;

/** @type {Record<string, Record<string, number>>} slug -> token -> ts */
let votes = {};
try {
  if (existsSync(DATA_FILE)) votes = JSON.parse(readFileSync(DATA_FILE, 'utf8')) || {};
} catch (err) {
  console.error('could not read', DATA_FILE, err.message);
}

let saveTimer = null;
let dirty = false;
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 400);
}
function flush() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(votes), 'utf8');
    renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('save failed', err.message);
    dirty = true; // retry next tick
  }
}
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

const hits = new Map(); // ip -> { n, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { n: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }
  rec.n += 1;
  return rec.n > WRITE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();

function counts() {
  const out = {};
  for (const slug of Object.keys(votes)) out[slug] = Object.keys(votes[slug]).length;
  return out;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req, limit = 4096) {
  return new Promise((res, rej) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { rej(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/votes') return send(res, 200, counts());

  if (req.method === 'POST' && url.pathname === '/api/vote') {
    if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' });
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'bad_json' });
    }
    const { slug, action, token, website } = data || {};
    if (website) return send(res, 200, { slug, count: votes[slug] ? Object.keys(votes[slug]).length : 0 }); // honeypot
    if (!ID_RE.test(slug || '') || !ID_RE.test(token || '')) return send(res, 400, { error: 'bad_id' });
    if (action !== 'vote' && action !== 'unvote') return send(res, 400, { error: 'bad_action' });

    votes[slug] = votes[slug] || {};
    if (action === 'vote') votes[slug][token] = Date.now();
    else delete votes[slug][token];
    scheduleSave();
    return send(res, 200, { slug, count: Object.keys(votes[slug]).length });
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ismorg-solutions vote service on 127.0.0.1:${PORT}, data ${DATA_FILE}`);
});
