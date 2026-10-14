/* ============================================================================
   GET /api/pump?view=new|active|grad|live|top&limit=50
   Proxy for pump.fun's public frontend API (the browser cannot call it
   directly). Also exports build(): the coin universe the shared ape trades
   on the server, with SOL priced from its deepest DEX Screener pool.
============================================================================ */
const BASE = 'https://frontend-api-v3.pump.fun';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const GW = 'https://pump.mypinata.cloud/ipfs/';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ApeTerminal/1.0)', 'Accept': 'application/json' };

function listUrl(view, limit, offset) {
  const q = `offset=${offset}&limit=${limit}&includeNsfw=false`;
  switch (view) {
    case 'top': return `${BASE}/coins?${q}&sort=market_cap&order=DESC`;
    case 'live': return `${BASE}/coins/currently-live?${q}`;
    case 'active': return `${BASE}/coins?${q}&sort=last_trade_timestamp&order=DESC&complete=false`;
    case 'grad': return `${BASE}/coins?${q}&sort=last_trade_timestamp&order=DESC&complete=true`;
    case 'new':
    default: return `${BASE}/coins?${q}&sort=created_timestamp&order=DESC`;
  }
}
function ipfs(u) {
  if (!u) return '';
  if (u.startsWith('ipfs://')) return GW + u.slice(7);
  const m = u.match(/^https?:\/\/(?:ipfs\.io|cf-ipfs\.com|dweb\.link|gateway\.pinata\.cloud|[a-z0-9.-]+\.quicknode-ipfs\.com)\/ipfs\/(.+)$/i);
  return m ? GW + m[1] : u;
}
function normalize(c) {
  return {
    mint: c.mint, name: c.name || '', symbol: c.symbol || '', image: ipfs(c.image_uri || ''), uri: c.metadata_uri || '',
    desc: String(c.description || '').slice(0, 300),
    mcapSol: Number(c.market_cap) || 0, mcapUsd: Number(c.usd_market_cap) || 0, athSol: Number(c.ath_market_cap) || 0,
    created: Number(c.created_timestamp) || 0, lastTrade: Number(c.last_trade_timestamp) || 0,
    complete: !!c.complete, vSol: Number(c.virtual_sol_reserves) / 1e9 || 0, vTok: Number(c.virtual_token_reserves) / 1e6 || 0,
    replies: Number(c.reply_count) || 0, creator: c.creator || '', twitter: c.twitter || '', telegram: c.telegram || '', website: c.website || '',
    live: !!c.is_currently_live, nsfw: !!c.nsfw
  };
}
async function getJSON(url, ms) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(ms || 10000) });
  if (!r.ok) throw new Error(url.slice(0, 60) + ' → ' + r.status);
  return r.json();
}
const soft = (url, ms) => getJSON(url, ms).catch(() => null);
async function fetchList(view, limit, offset) {
  const data = await getJSON(listUrl(view, limit, offset || 0));
  const list = Array.isArray(data) ? data : (data.coins || data.items || []);
  return list.map(normalize);
}

/* SOL in dollars from its deepest pool (no key, no rate-limit drama) */
let solCache = { at: 0, v: 0 };
async function solUsd() {
  if (Date.now() - solCache.at < 60000 && solCache.v) return solCache.v;
  const pairs = await soft('https://api.dexscreener.com/tokens/v1/solana/' + SOL_MINT, 8000);
  let v = 0;
  if (Array.isArray(pairs)) { const deep = pairs.filter(p => p.baseToken && p.baseToken.address === SOL_MINT && p.priceUsd).sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0]; if (deep) v = parseFloat(deep.priceUsd) || 0; }
  if (!v) { const cg = await soft('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', 6000); v = cg && cg.solana ? cg.solana.usd : 0; }
  if (v) solCache = { at: Date.now(), v };
  return v || solCache.v || 150;
}

/* the universe for one server tick: fresh launches, coins climbing the curve,
   fresh graduates, plus a price for any held mint that fell off the lists */
let uniCache = { at: 0, body: null };
async function build(heldMints) {
  if (uniCache.body && Date.now() - uniCache.at < 12000 && !(heldMints || []).some(m => !uniCache.body.byMint[m])) return uniCache.body;
  const [nw, active, grad, sol] = await Promise.all([
    fetchList('new', 50).catch(() => []), fetchList('active', 50).catch(() => []), fetchList('grad', 40).catch(() => []), solUsd()
  ]);
  const byMint = {};
  [].concat(grad, active, nw).forEach(c => { if (!c.mint || c.nsfw) return; const prev = byMint[c.mint]; if (!prev || (c.lastTrade || 0) >= (prev.lastTrade || 0)) byMint[c.mint] = c; });
  // graduated coins trade on PumpSwap: price the held ones through DEX Screener
  const missing = (heldMints || []).filter(m => !byMint[m]).slice(0, 30);
  if (missing.length) {
    const extra = await soft('https://api.dexscreener.com/tokens/v1/solana/' + missing.join(','), 8000);
    if (Array.isArray(extra)) extra.forEach(p => { if (!p || !p.baseToken || !p.priceUsd) return; const a = p.baseToken.address; const mcUsd = p.marketCap || p.fdv || 0; if (!mcUsd) return; const prev = byMint[a]; if (prev && !prev._dex) return; byMint[a] = { mint: a, name: p.baseToken.name || '', symbol: p.baseToken.symbol || '', image: (p.info && p.info.imageUrl) || '', mcapSol: mcUsd / sol, mcapUsd: mcUsd, complete: true, created: p.pairCreatedAt || 0, lastTrade: Date.now(), vSol: 0, vTok: 0, replies: 0, live: false, _dex: true }; });
  }
  const body = { solUsd: sol, updatedAt: Date.now(), byMint, coins: Object.values(byMint), counts: { new: nw.length, active: active.length, grad: grad.length } };
  uniCache = { at: Date.now(), body };
  return body;
}

module.exports = async (req, res) => {
  const view = String(req.query.view || 'new');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const coins = await fetchList(view, limit, offset);
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
    res.status(200).send(JSON.stringify({ view, coins }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send(JSON.stringify({ view, coins: [], error: String(e.message || e) }));
  }
};
module.exports.build = build;
module.exports.solUsd = solUsd;
module.exports.fetchList = fetchList;
