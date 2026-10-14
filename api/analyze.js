/* ============================================================================
   POST /api/analyze — the ape's optional brain on fal.ai.
   Environment: FAL_KEY (required for the model; without it the built-in
   scoring drives), FAL_MODEL (default google/gemini-2.5-flash-lite),
   FAL_ENDPOINT (default openrouter/router), LLM_MAX_PER_MIN (default 20).
   The model only proposes; core.js enforces every rule before a fill.
============================================================================ */
const FAL_MODEL = process.env.FAL_MODEL || 'google/gemini-2.5-flash-lite';
const FAL_ENDPOINT = process.env.FAL_ENDPOINT || 'openrouter/router';
const MAX_PER_MIN = parseInt(process.env.LLM_MAX_PER_MIN || '20', 10);
let windowStart = 0, windowCount = 0;

const SYSTEM = [
  'You are APE, a degenerate memecoin trader on Solana who lives on pump.fun. You run a 10 SOL wallet with no supervision.',
  'You ape into lowcaps: brand-new launches, coins climbing the bonding curve, and fresh graduates to PumpSwap.',
  'You are reckless in spirit but the rulebook is not: every proposal is checked by code before it fills.',
  '',
  'Candidates carry: mcapUsd, curvePct (0-100, 100 = graduated), ageMin, replies, lastTradeSec, m1/m3 (% change over 1 and 3 minutes, may be null), score (0-100 from the built-in model) and why.',
  'Hunt 25-60% moves with obvious invalidation. Fresh momentum with trades happening right now beats a big number that already ran.',
  'Rules: at most 4 open positions. A clip is 8-14% of equity. Never buy a coin that is +150% in 3 minutes, a coin with no trades for 5 minutes, or one under $6,000 market cap. Do nothing is often right.',
  'Only propose SELL when the thesis itself has broken; targets, trailing stops, stop loss and time stops run automatically.',
  'Answer with JSON only, no markdown:',
  '{"thesis":"one short sentence in ape voice about the board","actions":[{"type":"BUY"|"SELL","mint":"<mint from candidates or positions>","sizePct":<8-14, BUY only>,"conviction":<0-100>,"reason":"<max 120 chars, concrete numbers>"}],"watch":[{"mint":"<mint>","reason":"<max 80 chars>"}]}',
  'At most 2 actions. Empty actions array when nothing is worth it.'
].join('\n');

const r = (v, d) => { const n = Number(v); if (!isFinite(n)) return 0; const p = Math.pow(10, d); return Math.round(n * p) / p; };
function trim(c, solUsd) {
  return { symbol: c.symbol, name: c.name, mint: c.mint, mcapUsd: Math.round(c.mcapSol * solUsd), curvePct: c.complete ? 100 : r(((1073000191 - (c.vTok || 1073000191)) / 793100000) * 100, 0), ageMin: c.created ? Math.round((Date.now() - c.created) / 60000) : null, replies: c.replies || 0, lastTradeSec: c.lastTrade ? Math.round((Date.now() - c.lastTrade) / 1000) : null, m1: c.m1 == null ? null : r(c.m1, 1), m3: c.m3 == null ? null : r(c.m3, 1), live: !!c.live, score: c.score, why: c.why };
}
function extractJSON(text) {
  if (!text) return null; let s = String(text).trim(); const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) s = f[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}
async function callFal(key, endpoint, payload) {
  const url = 'https://fal.run/' + endpoint;
  const attempt = async scheme => { const res = await fetch(url, { method: 'POST', headers: { Authorization: scheme + ' ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) }); return { status: res.status, text: await res.text() }; };
  let out = await attempt('Key'); if (out.status === 401 || out.status === 403) out = await attempt('Bearer');
  if (out.status < 200 || out.status >= 300) throw new Error('fal ' + out.status + ': ' + out.text.slice(0, 200));
  try { return JSON.parse(out.text); } catch (e) { return { output: out.text }; }
}
async function runModel(body) {
  const key = process.env.FAL_KEY || process.env.FAL_AI_KEY || '';
  if (!key) return { ok: false, reason: 'no-key' };
  const now = Date.now(); if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
  if (windowCount >= MAX_PER_MIN) return { ok: false, reason: 'throttled' };
  windowCount++;
  const solUsd = body.solUsd || 150;
  const user = JSON.stringify({ wallet: { equitySol: r(body.equity, 3), freeSol: r(body.cash, 3), sessionPnlPct: r(body.pnlPct, 1), openPositions: (body.positions || []).length, maxPositions: 4 }, positions: (body.positions || []).map(p => ({ symbol: p.symbol, mint: p.mint, pnlPct: r(p.pnlPct, 1), valueSol: r(p.valueSol, 3), heldMinutes: Math.round(p.heldMinutes), banked: !!p.banked })), candidates: (body.candidates || []).slice(0, 12).map(c => trim(c, solUsd)) });
  try {
    const data = await callFal(key, FAL_ENDPOINT, { model: FAL_MODEL, system_prompt: SYSTEM, prompt: user, temperature: 0.4, max_tokens: 600 });
    const raw = data.output || data.response || (data.data && data.data.output) || '';
    const parsed = extractJSON(raw); if (!parsed) return { ok: false, reason: 'unparseable' };
    return { ok: true, model: FAL_MODEL, thesis: typeof parsed.thesis === 'string' ? parsed.thesis.slice(0, 200) : '', actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [], watch: Array.isArray(parsed.watch) ? parsed.watch.slice(0, 6) : [] };
  } catch (err) { return { ok: false, reason: 'fal-error', error: String(err.message || err).slice(0, 200) }; }
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).send('{"ok":false,"reason":"method"}');
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !Array.isArray(body.candidates)) return res.status(400).send('{"ok":false,"reason":"bad-body"}');
  res.status(200).send(JSON.stringify(await runModel(body)));
};
module.exports.runModel = runModel;
