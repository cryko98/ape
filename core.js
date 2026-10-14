/* ============================================================================
   $APE — the trading core
   The ape's whole rulebook as pure functions over a plain "book" object.
   The same file runs in the browser (window.ApeCore, solo mode) and inside
   the Vercel functions (require, shared mode) — one brain, two homes.

   Nothing here touches the DOM, storage, fetch or a clock: the caller passes
   ctx { byMint, solUsd, now, rand } plus the coin universe and reads the
   results back off the book.

   Coin shape (pump.fun):
     { mint, name, symbol, image, mcapSol, vSol, vTok, complete, created,
       replies, lastTrade, live }
   price per token in SOL = mcapSol / 1e9 (every pump.fun coin has 1B supply)
============================================================================ */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.ApeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var SUPPLY = 1e9;
var CURVE_INIT_VTOK = 1073000191;
var CURVE_TOTAL = 793100000;

/* --------------------------------------------------------------- rulebook */
var RULES = {
  START_SOL:      10,
  MAX_POS:        4,
  MIN_SIZE_PCT:   8,
  MAX_SIZE_PCT:   14,
  MIN_SIZE_SOL:   0.25,
  MAX_IMPACT_PCT: 3,        // bonding curves are thin: size to the pool, not the wallet
  MIN_MCAP_USD:   6000,     // under this it is not on the board at all
  MAX_MCAP_USD:   500000,   // above this it is not a lowcap any more
  MAX_AGE_H:      24,
  MAX_MOVE_3M:    150,      // +150% in 3 minutes is somebody else's exit
  DEAD_AFTER_MS:  5 * 60000,// no trade for 5 min = nobody home

  TARGET_PCT:     35,
  SCALE_AT:       0.5,      // scale out at half the target...
  SCALE_PORTION:  0.4,      // ...selling this much
  BANK_PORTION:   0.6,      // at the target, bank this much of the rest
  RUNNER_CAP:     2.2,      // the runner is cut at target × this
  TRAIL_PCT:      20,       // trail under the high once banked
  STOP_PCT:      -22,
  TIME_STOP_MIN:  18,
  TIME_STOP_GAIN: 5,        // a position under this gain at the time stop is dead money
  RUG_DROP:       0.55,     // one tick down this much = rug, out

  REBUY_COOL_MIN: 8,
  LOSS_STREAK:    4,
  PAUSE_MIN:      5,
  AUTO_GAP_MS:    15000,
  SCORE_BUY:      58,
  SWAP_FEE:       0.01,
  STALE_MARK_MS:  10 * 60000,
  LLM_INTERVAL_MS: 40000
};

var BOOK_GEN = 1;
var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/* ----------------------------------------------------------------- helpers */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fmtAmt(n) { if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toFixed(2); }
function fmtUsd(v) { if (!isFinite(v)) return '—'; if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'; return '$' + v.toFixed(v < 1 ? 4 : 2); }
function fmtSol(v) { return v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(4); }
function sgn(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 1 : d) + '%'; }
function b58(rand, n) { var s = ''; for (var i = 0; i < n; i++) s += B58[(rand() * 58) | 0]; return s; }
function todayOf(now) { return new Date(now).toISOString().slice(0, 10); }
function priceSol(c) { return (c && c.mcapSol || 0) / SUPPLY; }
function curvePct(c) { return c.complete ? 100 : clamp(((CURVE_INIT_VTOK - (c.vTok || CURVE_INIT_VTOK)) / CURVE_TOTAL) * 100, 0, 100); }
function ageMin(c, now) { return c.created ? (now - c.created) / 60000 : null; }
function ascii(s) { return /^[\x20-\x7e]+$/.test(s || ''); }

/* ---------------------------------------------------------------- the book */
function newBook(now, rand) {
  return {
    gen: BOOK_GEN, day: todayOf(now), startedAt: now,
    wallet: 'Ape' + b58(rand || Math.random, 41),
    cash: RULES.START_SOL, positions: [], closed: [], txs: [], logs: [], watch: [], equity: [], archive: [],
    hist: {}, marks: {},
    peak: RULES.START_SOL, maxDD: 0, fees: 0, nClosed: 0, nWins: 0, nTx: 0, realized: 0, scans: 0,
    llmCalls: 0, model: null, thesis: '', brainState: 'hunting', brainSource: 'heuristic', logN: 0,
    cooldowns: {}, lossStreak: 0, pausedUntil: 0, lastAutoBuy: 0, lastLlm: 0, lastTick: 0, lastEquityAt: 0
  };
}
function log(book, now, kind, text, symbol) {
  book.logN = (book.logN || 0) + 1;
  book.logs.push({ id: book.logN, t: now, kind: kind, text: text, symbol: symbol || null });
  if (book.logs.length > 140) book.logs.splice(0, book.logs.length - 140);
}
function bootLogs(book, now) {
  log(book, now, 'boot', 'BOOT  ape terminal online · wallet ' + book.wallet.slice(0, 6) + '… · ' + RULES.START_SOL + ' SOL on the desk');
  log(book, now, 'boot', 'RULE  max ' + RULES.MAX_POS + ' open · ' + RULES.MIN_SIZE_PCT + '-' + RULES.MAX_SIZE_PCT + '% a clip · target +' + RULES.TARGET_PCT + '% · stop ' + RULES.STOP_PCT + '% · time stop ' + RULES.TIME_STOP_MIN + 'm');
  log(book, now, 'boot', 'SCAN  listening to pump.fun · new launches, climbing curves, fresh graduates');
}

/* ------------------------------------------------------------ price memory */
/* a few minutes of market cap per coin, sampled every tick, so momentum can
   be read without any volume data at all */
function sample(book, ctx, coins) {
  var h = book.hist;
  var keep = {};
  coins.forEach(function (c) {
    if (!c.mint || !c.mcapSol) return;
    var arr = h[c.mint] || (h[c.mint] = []);
    var last = arr[arr.length - 1];
    if (!last || ctx.now - last[0] >= 5000) arr.push([ctx.now, c.mcapSol]);
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    keep[c.mint] = true;
  });
  book.positions.forEach(function (p) { keep[p.mint] = true; });
  Object.keys(h).forEach(function (m) { if (!keep[m] && (!h[m].length || ctx.now - h[m][h[m].length - 1][0] > 15 * 60000)) delete h[m]; });
}
function changeOver(book, mint, now, ms) {
  var arr = book.hist[mint]; if (!arr || arr.length < 2) return null;
  var last = arr[arr.length - 1], ref = null;
  for (var i = arr.length - 1; i >= 0; i--) { if (now - arr[i][0] >= ms) { ref = arr[i]; break; } }
  if (!ref) ref = arr[0];
  if (now - ref[0] < 20000) return null;             // not enough history yet
  return ref[1] > 0 ? (last[1] / ref[1] - 1) * 100 : null;
}

/* ------------------------------------------------------------------- score */
function score(book, ctx, c) {
  var now = ctx.now, s = 0, why = [];
  var usd = c.mcapSol * ctx.solUsd;
  var m3 = changeOver(book, c.mint, now, 180000), m1 = changeOver(book, c.mint, now, 60000);
  if (m3 !== null) { var mo = clamp(m3, 0, 60) / 60 * 24; if (m3 > 0) why.push(sgn(m3, 0) + ' 3m'); s += mo; }
  if (m1 !== null && m1 > 3) { s += clamp(m1, 0, 25) / 25 * 8; }
  var since = c.lastTrade ? now - c.lastTrade : Infinity;
  if (since < 30000) { s += 16; why.push('trading now'); } else if (since < 120000) s += 8;
  var cp = curvePct(c);
  if (!c.complete) { if (cp >= 8 && cp <= 70) { s += 18 - Math.abs(cp - 40) / 40 * 8; why.push(cp.toFixed(0) + '% curve'); } else if (cp > 70) { s += 8; why.push('near graduation'); } }
  else { var am = ageMin(c, now); if (am !== null && am < 90) { s += 14; why.push('fresh graduate'); } else s += 4; }
  var age = ageMin(c, now);
  if (age !== null) { if (age < 20) s += 14; else if (age < 60) s += 10; else if (age < 180) s += 6; else if (age < 720) s += 2; if (age < 60) why.push(Math.round(age) + 'm old'); }
  if (c.replies) s += clamp(c.replies, 0, 30) / 30 * 8;
  if (c.live) { s += 4; why.push('live'); }
  if (c.image) s += 2;
  if (ascii(c.name) && (c.name || '').length >= 3 && (c.name || '').length <= 24) s += 6;
  if (usd >= 15000 && usd <= 120000) s += 4;
  return { s: clamp(Math.round(s), 0, 100), why: why.slice(0, 3).join(' · '), m3: m3, m1: m1 };
}
function veto(book, ctx, c) {
  var usd = c.mcapSol * ctx.solUsd;
  if (!c.mcapSol) return 'no price';
  if (usd < RULES.MIN_MCAP_USD) return 'dead (' + fmtUsd(usd) + ')';
  if (usd > RULES.MAX_MCAP_USD) return 'too big';
  var age = ageMin(c, ctx.now); if (age !== null && age > RULES.MAX_AGE_H * 60) return 'old';
  if (c.lastTrade && ctx.now - c.lastTrade > RULES.DEAD_AFTER_MS) return 'nobody home';
  var m3 = changeOver(book, c.mint, ctx.now, 180000); if (m3 !== null && m3 > RULES.MAX_MOVE_3M) return 'already ran ' + sgn(m3, 0);
  if (m3 !== null && m3 < -40) return 'dumping';
  if (!ascii(c.name)) return 'name';
  return null;
}
function rank(book, ctx, coins) {
  return coins.map(function (c) { return { c: c, sc: score(book, ctx, c), veto: veto(book, ctx, c) }; })
    .sort(function (a, b) { return b.sc.s - a.sc.s; });
}

/* --------------------------------------------------------------- execution */
function quoteBuy(c, sol) {
  var net = sol * (1 - RULES.SWAP_FEE);
  if (!c.complete && c.vSol && c.vTok) { var out = c.vTok - (c.vSol * c.vTok) / (c.vSol + net); var spot = net * c.vTok / c.vSol; return { out: out, impact: Math.max(0, 1 - out / spot) }; }
  var p = priceSol(c); if (!p) return { out: 0, impact: 0 };
  var impact = Math.min(0.3, net / Math.max(c.mcapSol * 0.25, 1e-9)); return { out: (net / p) * (1 - impact), impact: impact };
}
function quoteSell(c, tok) {
  if (!c.complete && c.vSol && c.vTok) { var gross = c.vSol - (c.vSol * c.vTok) / (c.vTok + tok); var spot = tok * c.vSol / c.vTok; return { out: gross * (1 - RULES.SWAP_FEE), impact: Math.max(0, 1 - gross / spot) }; }
  var p = priceSol(c); var g = tok * p; var im = Math.min(0.3, g / Math.max(c.mcapSol * 0.25, 1e-9)); return { out: g * (1 - im) * (1 - RULES.SWAP_FEE), impact: im };
}
function sizeForImpact(c, maxImpact) {
  if (!c.complete && c.vSol) return c.vSol * maxImpact / (1 - maxImpact);
  return c.mcapSol * 0.25 * maxImpact;
}
function coinOf(book, ctx, mint) {
  var c = ctx.byMint[mint]; if (c && c.mcapSol) return c;
  var m = book.marks[mint]; return m ? m : null;
}
function markOf(book, ctx, pos) {
  var c = coinOf(book, ctx, pos.mint);
  if (c && c.mcapSol) { book.marks[pos.mint] = { mint: pos.mint, name: pos.name, symbol: pos.symbol, image: pos.image, mcapSol: c.mcapSol, vSol: c.vSol, vTok: c.vTok, complete: c.complete, t: ctx.now }; return c; }
  return null;
}
function equityNow(book, ctx) {
  var v = book.cash;
  book.positions.forEach(function (p) { var c = coinOf(book, ctx, p.mint); v += c ? quoteSell(c, p.tokens).out : p.cost; });
  return v;
}
function recordTx(book, ctx, o) {
  book.nTx++;
  book.txs.unshift({ t: ctx.now, type: o.type, mint: o.mint, symbol: o.symbol, name: o.name, image: o.image, sol: o.sol, tok: o.tok, pnl: o.pnl === undefined ? null : o.pnl, reason: o.reason, sig: b58(ctx.rand, 88), mcap: o.mcap });
  if (book.txs.length > 60) book.txs.length = 60;
}
function buy(book, ctx, c, sol, reason, conviction) {
  if (sol <= 0 || sol > book.cash) return false;
  var q = quoteBuy(c, sol); if (q.out <= 0) return false;
  book.cash -= sol; book.fees += sol * RULES.SWAP_FEE;
  var p = priceSol(c);
  var pos = { mint: c.mint, name: c.name, symbol: c.symbol, image: c.image || null, tokens: q.out, cost: sol, entryMark: p, peakMark: p, opened: ctx.now, scaled: false, banked: false, conviction: conviction || 0, reason: reason };
  book.positions.push(pos); book.lastAutoBuy = ctx.now;
  book.marks[c.mint] = { mint: c.mint, name: c.name, symbol: c.symbol, image: c.image, mcapSol: c.mcapSol, vSol: c.vSol, vTok: c.vTok, complete: c.complete, t: ctx.now };
  recordTx(book, ctx, { type: 'buy', mint: c.mint, symbol: c.symbol, name: c.name, image: c.image, sol: sol, tok: q.out, reason: reason, mcap: c.mcapSol });
  log(book, ctx.now, 'buy', 'APE   ' + (c.symbol || c.name) + ' · ' + fmtSol(sol) + ' SOL at ' + fmtUsd(c.mcapSol * ctx.solUsd) + ' mcap · impact ' + (q.impact * 100).toFixed(1) + '% · ' + reason, c.symbol);
  return true;
}
function sell(book, ctx, pos, portion, reason) {
  var c = coinOf(book, ctx, pos.mint); if (!c) return false;
  var tok = pos.tokens * clamp(portion, 0, 1); if (tok <= 0) return false;
  var q = quoteSell(c, tok); var costPart = pos.cost * (tok / pos.tokens); var pnl = q.out - costPart;
  book.cash += q.out; book.fees += q.out * RULES.SWAP_FEE / (1 - RULES.SWAP_FEE);
  pos.tokens -= tok; pos.cost -= costPart; book.realized += pnl;
  recordTx(book, ctx, { type: 'sell', mint: pos.mint, symbol: pos.symbol, name: pos.name, image: pos.image, sol: q.out, tok: tok, pnl: pnl, reason: reason, mcap: c.mcapSol });
  var full = pos.tokens < 1 || portion >= 0.999;
  if (full) {
    book.positions = book.positions.filter(function (p) { return p !== pos; });
    var totalPnl = (pos.realizedPart || 0) + pnl;
    book.nClosed++; if (totalPnl >= 0) { book.nWins++; book.lossStreak = 0; } else { book.lossStreak++; }
    book.closed.push({ t: ctx.now, mint: pos.mint, symbol: pos.symbol, name: pos.name, image: pos.image, pnl: totalPnl, pct: pos.costTotal ? totalPnl / pos.costTotal * 100 : 0, held: ctx.now - pos.opened, reason: reason });
    if (book.closed.length > 80) book.closed.splice(0, book.closed.length - 80);
    book.cooldowns[pos.mint] = ctx.now + (totalPnl < 0 ? RULES.REBUY_COOL_MIN * 2 : RULES.REBUY_COOL_MIN) * 60000;
    if (book.lossStreak >= RULES.LOSS_STREAK) { book.pausedUntil = ctx.now + RULES.PAUSE_MIN * 60000; book.lossStreak = 0; log(book, ctx.now, 'risk', 'PAUSE ' + RULES.LOSS_STREAK + ' losses in a row · the ape touches grass for ' + RULES.PAUSE_MIN + ' minutes'); }
    delete book.marks[pos.mint];
  } else { pos.realizedPart = (pos.realizedPart || 0) + pnl; }
  log(book, ctx.now, pnl >= 0 ? 'sell' : 'risk', (full ? 'CLOSE ' : 'TRIM  ') + (pos.symbol || pos.name) + ' · ' + Math.round(portion * 100) + '% · ' + (pnl >= 0 ? '+' : '') + fmtSol(pnl) + ' SOL · ' + reason, pos.symbol);
  return true;
}

/* ------------------------------------------------------------------ manage */
function manage(book, ctx) {
  book.positions.slice().forEach(function (pos) {
    if (!pos.costTotal) pos.costTotal = pos.cost;
    var c = markOf(book, ctx, pos);
    if (!c) { var m = book.marks[pos.mint]; if (m && ctx.now - m.t > RULES.STALE_MARK_MS) { sell(book, ctx, pos, 1, 'stale: no price for 10 min'); } return; }
    var p = priceSol(c); var lastMark = pos.lastMark || pos.entryMark; pos.lastMark = p;
    if (lastMark && p / lastMark - 1 <= -RULES.RUG_DROP) { sell(book, ctx, pos, 1, 'rug: ' + sgn((p / lastMark - 1) * 100, 0) + ' in one tick'); return; }
    pos.peakMark = Math.max(pos.peakMark || p, p);
    var pnl = (p / pos.entryMark - 1) * 100, peak = (pos.peakMark / pos.entryMark - 1) * 100;
    var heldMin = (ctx.now - pos.opened) / 60000;
    if (pnl <= RULES.STOP_PCT) return sell(book, ctx, pos, 1, 'stop ' + sgn(pnl, 0));
    var lock = peak >= 70 ? 45 : peak >= 48 ? 28 : peak >= 32 ? 16 : peak >= 20 ? 8 : peak >= 12 ? 0 : null;
    if (lock !== null && pnl <= lock) return sell(book, ctx, pos, 1, 'profit lock at ' + sgn(lock, 0) + ' (peak ' + sgn(peak, 0) + ')');
    if (pnl >= RULES.TARGET_PCT * RULES.RUNNER_CAP) return sell(book, ctx, pos, 1, 'runner capped ' + sgn(pnl, 0));
    if (pos.banked && pnl <= peak - RULES.TRAIL_PCT) return sell(book, ctx, pos, 1, 'trail ' + sgn(pnl, 0) + ' from peak ' + sgn(peak, 0));
    if (!pos.banked && pnl >= RULES.TARGET_PCT) { pos.banked = true; pos.scaled = true; return sell(book, ctx, pos, RULES.BANK_PORTION, 'target ' + sgn(pnl, 0) + ' · banking, runner trails'); }
    if (!pos.scaled && pnl >= RULES.TARGET_PCT * RULES.SCALE_AT) { pos.scaled = true; return sell(book, ctx, pos, RULES.SCALE_PORTION, 'half target ' + sgn(pnl, 0) + ' · scaling out'); }
    if (heldMin >= RULES.TIME_STOP_MIN && pnl < RULES.TIME_STOP_GAIN) return sell(book, ctx, pos, 1, 'time stop · ' + Math.round(heldMin) + 'm · ' + sgn(pnl, 0));
    var m3 = changeOver(book, pos.mint, ctx.now, 180000);
    if (pnl < -8 && m3 !== null && m3 < -15 && c.lastTrade && ctx.now - c.lastTrade < 60000) return sell(book, ctx, pos, 1, 'momentum gone ' + sgn(pnl, 0));
  });
}

/* ------------------------------------------------------------------ entries */
function entryBlock(book, ctx, c) {
  if (ctx.now < book.pausedUntil) return 'paused';
  if (book.positions.length >= RULES.MAX_POS) return 'book full';
  if (book.positions.some(function (p) { return p.mint === c.mint; })) return 'held';
  if (book.cooldowns[c.mint] && ctx.now < book.cooldowns[c.mint]) return 'cooldown';
  if (ctx.now - book.lastAutoBuy < RULES.AUTO_GAP_MS) return 'too soon';
  return null;
}
function clipSize(book, ctx, c, pct) {
  var eq = equityNow(book, ctx);
  var mult = eq / RULES.START_SOL - 1 > 0.1 ? 1.15 : eq / RULES.START_SOL - 1 < -0.1 ? 0.8 : 1;
  var want = eq * pct / 100 * mult;
  var pool = sizeForImpact(c, RULES.MAX_IMPACT_PCT / 100);
  return Math.min(want, pool, book.cash * 0.6);
}
function takeEntry(book, ctx, r, why, pct) {
  var block = entryBlock(book, ctx, r.c); if (block) return false;
  var sol = clipSize(book, ctx, r.c, pct);
  if (sol < RULES.MIN_SIZE_SOL) { log(book, ctx.now, 'hold', 'SKIP  ' + (r.c.symbol || r.c.name) + ' · pool too thin for ' + fmtSol(RULES.MIN_SIZE_SOL) + ' SOL', r.c.symbol); return false; }
  return buy(book, ctx, r.c, +sol.toFixed(3), why, r.sc.s);
}
function heuristicDecision(book, ctx, ranked) {
  var cands = ranked.filter(function (r) { return !r.veto && r.sc.s >= RULES.SCORE_BUY; });
  for (var i = 0; i < cands.length; i++) {
    var r = cands[i];
    var pct = RULES.MIN_SIZE_PCT + (RULES.MAX_SIZE_PCT - RULES.MIN_SIZE_PCT) * clamp((r.sc.s - RULES.SCORE_BUY) / 30, 0, 1);
    if (takeEntry(book, ctx, r, 'score ' + r.sc.s + (r.sc.why ? ' · ' + r.sc.why : ''), pct)) return true;
    if (entryBlock(book, ctx, r.c) === 'book full' || entryBlock(book, ctx, r.c) === 'paused' || entryBlock(book, ctx, r.c) === 'too soon') return false;
  }
  return false;
}
function applyModelActions(book, ctx, res, ranked) {
  var acted = false;
  var byMint = {}; ranked.forEach(function (r) { byMint[r.c.mint] = r; });
  (res.actions || []).forEach(function (a) {
    if (!a || !a.mint) return;
    if (a.type === 'SELL') { var pos = book.positions.filter(function (p) { return p.mint === a.mint; })[0]; if (pos && sell(book, ctx, pos, 1, 'model: ' + String(a.reason || '').slice(0, 120))) acted = true; return; }
    if (a.type === 'BUY') { var r = byMint[a.mint]; if (!r || r.veto) { log(book, ctx.now, 'hold', 'VETO  model wanted ' + (r ? r.c.symbol : a.mint.slice(0, 6)) + ' · ' + (r ? r.veto : 'not on the board')); return; } var pct = clamp(+a.sizePct || RULES.MIN_SIZE_PCT, RULES.MIN_SIZE_PCT, RULES.MAX_SIZE_PCT); if (takeEntry(book, ctx, r, 'model: ' + String(a.reason || '').slice(0, 120), pct)) acted = true; }
  });
  if (Array.isArray(res.watch) && res.watch.length) {
    book.watch = res.watch.slice(0, 6).map(function (w) { var r = byMint[w.mint]; return r ? { mint: r.c.mint, symbol: r.c.symbol, name: r.c.name, image: r.c.image, reason: String(w.reason || '').slice(0, 90), score: r.sc.s } : null; }).filter(Boolean);
  }
  return acted;
}
function heuristicWatch(book, ranked) {
  var held = {}; book.positions.forEach(function (p) { held[p.mint] = true; });
  book.watch = ranked.filter(function (r) { return !held[r.c.mint] && !r.veto; }).slice(0, 6).map(function (r) { return { mint: r.c.mint, symbol: r.c.symbol, name: r.c.name, image: r.c.image, reason: r.sc.why || 'score ' + r.sc.s, score: r.sc.s }; });
}

/* ---------------------------------------------------------------- the day */
function archiveFrom(book, ctx) {
  var eq = equityNow(book, ctx);
  book.archive.push({ day: book.day, end: eq, pnlPct: (eq / RULES.START_SOL - 1) * 100, nTx: book.nTx, winRate: book.nClosed ? book.nWins / book.nClosed * 100 : 0 });
  if (book.archive.length > 14) book.archive.splice(0, book.archive.length - 14);
}
function rollDayIfNeeded(book, ctx) {
  var today = todayOf(ctx.now); if (book.day === today) return false;
  book.positions.slice().forEach(function (p) { sell(book, ctx, p, 1, 'session close'); });
  archiveFrom(book, ctx);
  var keep = { archive: book.archive, wallet: book.wallet, hist: book.hist, gen: book.gen, logN: book.logN };
  var fresh = newBook(ctx.now, ctx.rand); Object.keys(fresh).forEach(function (k) { book[k] = fresh[k]; }); Object.keys(keep).forEach(function (k) { book[k] = keep[k]; });
  log(book, ctx.now, 'boot', 'DAY   new session · wallet back to ' + RULES.START_SOL + ' SOL · yesterday archived');
  return true;
}

/* -------------------------------------------------------------------- tick */
function tick(book, ctx, coins) {
  rollDayIfNeeded(book, ctx);
  sample(book, ctx, coins);
  manage(book, ctx);
  var ranked = rank(book, ctx, coins.filter(function (c) { return c.mcapSol > 0; }));
  book.scans++;
  if (book.scans % 8 === 1 && ranked.length) log(book, ctx.now, 'scan', 'SCAN  ' + ranked.length + ' coins on the board · leader ' + (ranked[0].c.symbol || ranked[0].c.name) + ' (' + ranked[0].sc.s + ')' + (ranked[0].veto ? ' · vetoed: ' + ranked[0].veto : ''));
  if (book.brainSource !== 'model' || ctx.now - book.lastLlm > RULES.LLM_INTERVAL_MS * 2) {
    if (!heuristicDecision(book, ctx, ranked) && book.scans % 10 === 0) log(book, ctx.now, 'hold', 'HOLD  nothing clears the rulebook · ' + (ranked.filter(function (r) { return !r.veto; }).length) + ' tradeable · bar ' + RULES.SCORE_BUY);
    heuristicWatch(book, ranked);
  }
  var eq = equityNow(book, ctx);
  if (ctx.now - book.lastEquityAt >= 15000) { book.equity.push([ctx.now, +eq.toFixed(4)]); if (book.equity.length > 600) book.equity.splice(0, book.equity.length - 600); book.lastEquityAt = ctx.now; }
  book.peak = Math.max(book.peak, eq); book.maxDD = Math.max(book.maxDD, (1 - eq / book.peak) * 100);
  book.brainState = ctx.now < book.pausedUntil ? 'cooling off' : book.positions.length >= RULES.MAX_POS ? 'fully aped' : book.positions.length ? 'in position' : 'hunting';
  book.lastTick = ctx.now;
  return ranked;
}

function positionsForModel(book, ctx) {
  return book.positions.map(function (p) { var c = coinOf(book, ctx, p.mint); var mark = c ? priceSol(c) : p.entryMark; return { symbol: p.symbol, mint: p.mint, pnlPct: (mark / p.entryMark - 1) * 100, valueSol: c ? quoteSell(c, p.tokens).out : p.cost, heldMinutes: (ctx.now - p.opened) / 60000, banked: p.banked }; });
}
function stats(book, ctx) {
  var eq = equityNow(book, ctx);
  return { equity: eq, pnlSol: eq - RULES.START_SOL, pnlPct: (eq / RULES.START_SOL - 1) * 100, winRate: book.nClosed ? book.nWins / book.nClosed * 100 : 0, nTx: book.nTx, nClosed: book.nClosed, open: book.positions.length, realized: book.realized, maxDD: book.maxDD, fees: book.fees };
}

return {
  RULES: RULES, BOOK_GEN: BOOK_GEN, SUPPLY: SUPPLY,
  newBook: newBook, bootLogs: bootLogs, log: log, tick: tick, rank: rank, score: score, veto: veto,
  equityNow: equityNow, stats: stats, positionsForModel: positionsForModel, applyModelActions: applyModelActions,
  heuristicDecision: heuristicDecision, quoteBuy: quoteBuy, quoteSell: quoteSell, priceSol: priceSol, curvePct: curvePct,
  fmtAmt: fmtAmt, fmtUsd: fmtUsd, fmtSol: fmtSol, sgn: sgn, todayOf: todayOf, rollDayIfNeeded: rollDayIfNeeded, coinOf: coinOf
};
});
