/**
 * ismorg-solutions service — zero external dependencies.
 *
 * Public (proxied at https://ismorg.com/solutions/api/):
 *   GET  /api/health        -> { ok: true }
 *   GET  /api/votes         -> { "<slug>": <count>, ... }
 *   POST /api/vote          { slug, action: "vote"|"unvote", token, website } -> { slug, count }
 *   POST /api/submit        { first_name, last_name, email, idea_name,
 *                             problem, what_it_does, who_for, details, website }
 *                           -> { ok: true }
 *
 * Team-only (proxied at https://ismorg.com/solutions/team/api/, which is
 * behind HTTP basic-auth AND has nginx add `X-Ism-Team: yes`):
 *   GET  /api/submissions   -> [ { id, ts, ...fields }, ... ]  (newest first)
 *
 * Storage: two JSON files, written atomically (tmp + rename), debounced.
 * Abuse guards: per-IP rate limits, honeypot fields, strict validation.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 4310);
const DATA_FILE = resolve(process.env.DATA_FILE || './votes.json');
const SUBMISSIONS_FILE = resolve(
  process.env.SUBMISSIONS_FILE || DATA_FILE.replace(/votes\.json$/, 'submissions.json'),
);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WINDOW_MS = 5 * 60 * 1000;
const VOTE_LIMIT = 40;   // vote writes per window per IP
const SUBMIT_LIMIT = 6;  // idea submissions per window per IP

// ---------- tiny atomic JSON store ----------
function loadJSON(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('could not read', file, err.message);
  }
  return fallback;
}
function makeSaver(file, getData) {
  let timer = null;
  let dirty = false;
  const flush = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(getData()), 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      console.error('save failed', file, err.message);
      dirty = true;
    }
  };
  return {
    schedule() { dirty = true; if (!timer) timer = setTimeout(flush, 400); },
    flush,
  };
}

/** @type {Record<string, Record<string, number>>} slug -> token -> ts */
const votes = loadJSON(DATA_FILE, {});
/** @type {Array<object>} */
let submissions = loadJSON(SUBMISSIONS_FILE, []);
if (!Array.isArray(submissions)) submissions = [];

const saveVotes = makeSaver(DATA_FILE, () => votes);
const saveSubs = makeSaver(SUBMISSIONS_FILE, () => submissions);

process.on('SIGTERM', () => { saveVotes.flush(); saveSubs.flush(); process.exit(0); });
process.on('SIGINT', () => { saveVotes.flush(); saveSubs.flush(); process.exit(0); });

// ---------- rate limiting ----------
const buckets = new Map(); // key -> { n, resetAt }
function rateLimited(key, limit) {
  const now = Date.now();
  let rec = buckets.get(key);
  if (!rec || now > rec.resetAt) {
    rec = { n: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, rec);
  }
  rec.n += 1;
  return rec.n > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of buckets) if (now > rec.resetAt) buckets.delete(k);
}, WINDOW_MS).unref();

// ---------- helpers ----------
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
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- server ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';

  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/votes') return send(res, 200, counts());

  // --- team-only: list submissions (nginx adds this header only on the gated path) ---
  if (req.method === 'GET' && url.pathname === '/api/submissions') {
    if (req.headers['x-ism-team'] !== 'yes') return send(res, 403, { error: 'forbidden' });
    return send(res, 200, submissions.slice().reverse());
  }

  if (req.method === 'POST' && url.pathname === '/api/vote') {
    if (rateLimited('v:' + ip, VOTE_LIMIT)) return send(res, 429, { error: 'rate_limited' });
    let data;
    try { data = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad_json' }); }
    const { slug, action, token, website } = data || {};
    if (website) return send(res, 200, { slug, count: votes[slug] ? Object.keys(votes[slug]).length : 0 });
    if (!ID_RE.test(slug || '') || !ID_RE.test(token || '')) return send(res, 400, { error: 'bad_id' });
    if (action !== 'vote' && action !== 'unvote') return send(res, 400, { error: 'bad_action' });
    votes[slug] = votes[slug] || {};
    if (action === 'vote') votes[slug][token] = Date.now();
    else delete votes[slug][token];
    saveVotes.schedule();
    return send(res, 200, { slug, count: Object.keys(votes[slug]).length });
  }

  if (req.method === 'POST' && url.pathname === '/api/submit') {
    if (rateLimited('s:' + ip, SUBMIT_LIMIT)) return send(res, 429, { error: 'rate_limited' });
    let data;
    try { data = JSON.parse(await readBody(req, 20000)); } catch { return send(res, 400, { error: 'bad_json' }); }
    if (data && data.website) return send(res, 200, { ok: true }); // honeypot: pretend success

    const rec = {
      first_name: clean(data?.first_name, 80),
      last_name: clean(data?.last_name, 80),
      email: clean(data?.email, 160),
      idea_name: clean(data?.idea_name, 120),
      problem: clean(data?.problem, 2000),
      what_it_does: clean(data?.what_it_does, 2000),
      who_for: clean(data?.who_for, 1000),
      details: clean(data?.details, 4000),
    };
    const missing = ['first_name', 'last_name', 'email', 'idea_name', 'problem', 'what_it_does', 'who_for']
      .filter((k) => !rec[k]);
    if (missing.length) return send(res, 400, { error: 'missing_fields', fields: missing });
    if (!EMAIL_RE.test(rec.email)) return send(res, 400, { error: 'bad_email' });

    submissions.push({
      id: randomUUID(),
      ts: new Date().toISOString(),
      ip_hash: createHash('sha256').update(ip).digest('hex').slice(0, 12),
      status: 'new',
      ...rec,
    });
    saveSubs.schedule();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ismorg-solutions service on 127.0.0.1:${PORT}`);
  console.log(`  votes:       ${DATA_FILE}`);
  console.log(`  submissions: ${SUBMISSIONS_FILE}`);
});
