/* ============================================================================
   GET /api/candles?mint=<mint>&interval=15s|1m|5m&limit=500
   Real OHLC history for a pump.fun coin (bonding curve and PumpSwap alike)
   from pump.fun's swap API, which the browser cannot call directly.
   Output: { mint, interval, candles: [{ t, o, h, l, c, v }] } — prices in
   USD per token; market cap = price × 1e9.
============================================================================ */
const OK = new Set(['1s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '24h']);
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ApeTerminal/1.0)', 'Accept': 'application/json' };

async function candles(mint, interval, limit) {
  const r = await fetch(`https://swap-api.pump.fun/v1/coins/${mint}/candles?interval=${interval}&limit=${limit}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('upstream ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('bad body');
  return j.map(k => ({ t: Number(k.timestamp), o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume || 0 })).filter(k => k.t && k.c > 0).sort((a, b) => a.t - b.t);
}

module.exports = async (req, res) => {
  const mint = String(req.query.mint || ''); const interval = String(req.query.interval || '1m');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 10), 1000);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !OK.has(interval)) { res.status(400).send('{"error":"bad request"}'); return; }
  try {
    const list = await candles(mint, interval, limit);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).send(JSON.stringify({ mint, interval, candles: list }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send(JSON.stringify({ mint, interval, candles: [], error: String(e.message || e) }));
  }
};
module.exports.candles = candles;
