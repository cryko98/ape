// Fetches a token metadata JSON (IPFS / https) server-side and returns only the safe fields.
// GET /api/meta?u=<https url>
const ALLOWED = /^https:\/\/[a-z0-9.-]+\//i;

module.exports = async (req, res) => {
  const u = String(req.query.u || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!ALLOWED.test(u) || u.length > 600) { res.status(400).send('{"error":"bad url"}'); return; }
  try {
    const r = await fetch(u, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; ApeTerminal/1.0)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const text = await r.text(); if (text.length > 200000) throw new Error('too big');
    const j = JSON.parse(text);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(JSON.stringify({ name: j.name || '', symbol: j.symbol || '', description: String(j.description || '').slice(0, 500), image: j.image || '', twitter: j.twitter || '', website: j.website || '', telegram: j.telegram || '' }));
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=600');
    res.status(502).send(JSON.stringify({ error: String(e.message || e) }));
  }
};
