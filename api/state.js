/* ============================================================================
   GET /api/state
   The shared session: ONE ape, one book, for every visitor — kept in Redis
   and advanced by a lazy tick. Whoever's poll finds the book more than 12s
   stale runs the next step under a lock. While anyone is watching, the ape
   trades; if nobody watches for an hour, the next visitor wakes him up.

   Storage: Upstash Redis over REST (Vercel → Storage → Upstash). Either naming:
     KV_REST_API_URL + KV_REST_API_TOKEN
     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
   Without it this answers { shared:false } and each browser runs its own ape.
============================================================================ */
const core = require('../core.js');
const pump = require('./pump.js');
const analyze = require('./analyze.js');

const BOOK_KEY = 'ape:book:v' + core.BOOK_GEN;
const LOCK_KEY = 'ape:tick-lock';
const TICK_STALE_MS = 12000;

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url, token } : null;
}
async function redis(env, command) {
  const r = await fetch(env.url, { method: 'POST', headers: { Authorization: 'Bearer ' + env.token, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  if (!r.ok) throw new Error('redis ' + r.status + ': ' + (await r.text()).slice(0, 160));
  const out = await r.json(); if (out && out.error) throw new Error('redis: ' + String(out.error).slice(0, 160));
  return out ? out.result : null;
}
async function loadBook(env) {
  const raw = await redis(env, ['GET', BOOK_KEY]); if (!raw) return null;
  try { const b = JSON.parse(raw); return b && b.gen === core.BOOK_GEN ? b : null; } catch (e) { return null; }
}
async function saveBook(env, book) {
  const lean = Object.assign({}, book, { closed: book.closed.slice(-80), txs: book.txs.slice(0, 60), logs: book.logs.slice(-140), equity: book.equity.slice(-600), archive: book.archive.slice(-14) });
  await redis(env, ['SET', BOOK_KEY, JSON.stringify(lean)]);
}

async function runTick(book, now) {
  const data = await pump.build(book.positions.map(p => p.mint));
  const ctx = { byMint: data.byMint, solUsd: data.solUsd, now, rand: Math.random };
  const ranked = core.tick(book, ctx, data.coins);
  if (now - (book.lastLlm || 0) >= core.RULES.LLM_INTERVAL_MS) {
    book.lastLlm = now;
    const payload = { equity: core.equityNow(book, ctx), cash: book.cash, pnlPct: (core.equityNow(book, ctx) / core.RULES.START_SOL - 1) * 100, positions: core.positionsForModel(book, ctx), candidates: ranked.filter(r => !r.veto).slice(0, 12).map(r => Object.assign({ score: r.sc.s, why: r.sc.why, m3: r.sc.m3, m1: r.sc.m1 }, r.c)), solUsd: data.solUsd };
    try {
      const res = await analyze.runModel(payload);
      if (res && res.ok) {
        book.llmCalls++; book.model = res.model; book.brainSource = 'model';
        if (res.thesis) { book.thesis = res.thesis; core.log(book, now, 'think', 'READ  ' + res.thesis); }
        const acted = core.applyModelActions(book, ctx, res, ranked);
        if (!acted && (!res.actions || !res.actions.length)) core.log(book, now, 'hold', 'HOLD  the ape sees nothing worth aping right now · ' + ranked.length + ' scored');
      } else {
        const why = (res && res.reason) || 'unknown'; book.warned = book.warned || {};
        if (!book.warned[why]) { book.warned[why] = true; if (why !== 'no-key') core.log(book, now, 'boot', 'NOTE  model call failed: ' + why + ' · built-in degen brain is driving'); }
        book.brainSource = 'heuristic';
      }
    } catch (e) { book.brainSource = 'heuristic'; }
  }
  return data;
}

function wireBook(book) {
  return { day: book.day, startedAt: book.startedAt, wallet: book.wallet, cash: book.cash, positions: book.positions, closed: book.closed.slice(-40), txs: book.txs.slice(0, 40), logs: book.logs.slice(-100), watch: book.watch, equity: book.equity.slice(-400), archive: book.archive, peak: book.peak, maxDD: book.maxDD, fees: book.fees, nClosed: book.nClosed, nWins: book.nWins, nTx: book.nTx, realized: book.realized, scans: book.scans, llmCalls: book.llmCalls, model: book.model, thesis: book.thesis, brainState: book.brainState, brainSource: book.brainSource, logN: book.logN, pausedUntil: book.pausedUntil, lastTick: book.lastTick, marks: book.marks };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const env = redisEnv();
  if (!env) return res.status(200).send(JSON.stringify({ shared: false, reason: 'no-store' }));
  const now = Date.now();
  let book;
  try { book = await loadBook(env); } catch (err) { return res.status(200).send(JSON.stringify({ shared: false, reason: 'store-error', error: String(err.message || err).slice(0, 160) })); }
  let solUsd = 0;
  try {
    if (!book) { book = core.newBook(now, Math.random); core.bootLogs(book, now); core.log(book, now, 'boot', 'BOOT  shared session · everyone is watching the same ape'); await saveBook(env, book); }
    if (now - (book.lastTick || 0) >= TICK_STALE_MS) {
      const got = await redis(env, ['SET', LOCK_KEY, String(now), 'NX', 'PX', '20000']);
      if (got) { try { const data = await runTick(book, now); solUsd = data.solUsd; await saveBook(env, book); } finally { try { await redis(env, ['DEL', LOCK_KEY]); } catch (e) {} } }
    }
  } catch (err) {
    if (book) return res.status(200).send(JSON.stringify({ shared: true, degraded: String(err.message || err).slice(0, 160), serverNow: now, solUsd, book: wireBook(book) }));
    return res.status(200).send(JSON.stringify({ shared: false, reason: 'tick-error', error: String(err.message || err).slice(0, 160) }));
  }
  return res.status(200).send(JSON.stringify({ shared: true, serverNow: now, solUsd, book: wireBook(book) }));
};
