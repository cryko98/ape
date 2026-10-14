/* ============================================================================
   $APE TERMINAL — the ape trades, you watch.
   Live feed: PumpPortal websocket (launches + trades) and /api/pump lists.
   The book: /api/state when a store is attached (one ape for everybody),
   otherwise core.js runs right here in the browser, per visitor.
============================================================================ */
(() => {
  'use strict';
  const root = document.getElementById('term'); if (!root || typeof ApeCore === 'undefined') return;
  const C = ApeCore, RULES = C.RULES;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const WS_URL = 'wss://pumpportal.fun/api/data';
  const LS_KEY = 'ape_book_v' + C.BOOK_GEN;
  const MAX_FEED = 160, MAX_SUBS = 60;
  const MIN_SHOW_USD = 6000;            // the board only shows coins above this market cap
  const GW = 'https://pump.mypinata.cloud/ipfs/';

  const S = {
    ws: null, wsOk: false, wsTimer: null, subs: new Set(),
    solUsd: 0, coins: new Map(), feeds: { new: [], active: [], grad: [], live: [] },
    feed: 'new', deskTab: 'positions', selected: null, tf: 60,
    chart: null, series: null, candles: [], trades: new Map(), history: new Map(),
    book: null, shared: null, search: '', started: false, feedDirty: 0, manualAt: 0, following: false,
  };

  /* ------------------------------------------------------------- format -- */
  const fmtSol = C.fmtSol, fmtUsd = C.fmtUsd, fmtTok = C.fmtAmt, sgn = C.sgn;
  function fmtPrice(usd) {
    if (!isFinite(usd) || usd <= 0) return '—'; if (usd >= 0.01) return '$' + usd.toFixed(4);
    const m = usd.toFixed(12).match(/^0\.(0*)(\d+)/); if (!m) return '$' + usd;
    const z = m[1].length, sub = String(z).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
    return z > 2 ? `$0.0${sub}${m[2].slice(0, 4)}` : '$' + usd.toFixed(z + 4);
  }
  const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const hhmmss = t => new Date(t).toTimeString().slice(0, 8);
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const priceSol = C.priceSol, curvePct = C.curvePct;
  const mcapUsd = c => (c && c.mcapSol || 0) * (S.solUsd || 150);
  const ipfs = u => { if (!u) return ''; if (u.startsWith('ipfs://')) return GW + u.slice(7); const m = u.match(/^https?:\/\/(?:ipfs\.io|cf-ipfs\.com|dweb\.link|gateway\.pinata\.cloud|[a-z0-9.-]+\.quicknode-ipfs\.com)\/ipfs\/(.+)$/i); return m ? GW + m[1] : u; };
  const imgHtml = (c, cls) => c && c.image ? `<div class="${cls}"><img src="${esc(c.image)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${esc(((c && c.symbol) || '?').slice(0, 3))}'" /></div>` : `<div class="${cls}">${esc(((c && c.symbol) || '?').slice(0, 3))}</div>`;

  /* ----------------------------------------------------------- metadata -- */
  const metaQueue = []; let metaBusy = 0;
  function needMeta(c) { if (c.image || !c.uri || c._metaReq) return; c._metaReq = true; metaQueue.push(c); pumpMeta(); }
  async function pumpMeta() {
    while (metaBusy < 3 && metaQueue.length) {
      const c = metaQueue.shift(); metaBusy++;
      try {
        let j; try { const r = await fetch(ipfs(c.uri), { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw 0; j = await r.json(); }
        catch (e1) { const r2 = await fetch('/api/meta?u=' + encodeURIComponent(c.uri), { signal: AbortSignal.timeout(10000) }); j = await r2.json(); if (j.error) throw 0; }
        c.image = ipfs(j.image || ''); c.desc = c.desc || j.description || ''; rerenderCoin(c.mint);
      } catch (e) {} finally { metaBusy--; }
    }
  }

  /* -------------------------------------------------------------- coins -- */
  function upsert(raw) {
    let c = S.coins.get(raw.mint);
    if (!c) { c = { mint: raw.mint, trades: 0, vol: 0, seen: Date.now() }; S.coins.set(raw.mint, c); }
    if (raw.image) raw.image = ipfs(raw.image);
    for (const k of ['name', 'symbol', 'uri', 'image', 'desc', 'creator', 'twitter', 'telegram', 'website']) if (raw[k] && !c[k]) c[k] = raw[k];
    if (raw.created) c.created = raw.created;
    if (raw.mcapSol != null && raw.mcapSol > 0) c.mcapSol = raw.mcapSol;
    if (raw.vSol) c.vSol = raw.vSol; if (raw.vTok) c.vTok = raw.vTok;
    if (raw.complete != null) c.complete = raw.complete;
    if (raw.athSol) c.athSol = Math.max(c.athSol || 0, raw.athSol);
    if (raw.replies != null) c.replies = raw.replies;
    if (raw.live != null) c.live = raw.live;
    if (raw.lastTrade && raw.lastTrade > (c.lastTrade || 0)) c.lastTrade = raw.lastTrade;
    c.athSol = Math.max(c.athSol || 0, c.mcapSol || 0);
    if (!c.image) needMeta(c);
    return c;
  }
  function pushHistory(mint, p) { let h = S.history.get(mint); if (!h) { h = []; S.history.set(mint, h); } h.push({ t: Date.now(), p }); if (h.length > 600) h.shift(); }
  const showable = c => c && (mcapUsd(c) >= MIN_SHOW_USD || held().includes(c.mint) || c.mint === S.selected);

  /* ---------------------------------------------------------- websocket -- */
  function connect() {
    if (S.ws) return;
    const ws = new WebSocket(WS_URL); S.ws = ws;
    ws.onopen = () => { S.wsOk = true; status(); ws.send(JSON.stringify({ method: 'subscribeNewToken' })); if (S.subs.size) ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [...S.subs] })); };
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error('onMsg', err); } };
    ws.onclose = () => { S.ws = null; S.wsOk = false; status(); clearTimeout(S.wsTimer); S.wsTimer = setTimeout(connect, 4000); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  function status() { const el = $('#termStatus'); el.classList.toggle('is-on', S.wsOk); el.querySelector('span').textContent = (S.wsOk ? 'LIVE' : 'RECONNECTING') + (S.shared ? ' · ONE APE' : ''); }
  function onMsg(d) {
    if (d.txType === 'create') {
      const c = upsert({ mint: d.mint, name: d.name, symbol: d.symbol, uri: d.uri, creator: d.traderPublicKey, created: Date.now(), mcapSol: d.marketCapSol, vSol: d.vSolInBondingCurve, vTok: d.vTokensInBondingCurve, complete: false, lastTrade: Date.now() });
      c.isNew = true; S.feeds.new.unshift(c.mint); if (S.feeds.new.length > MAX_FEED) S.feeds.new.pop();
      pushHistory(c.mint, priceSol(c));
      if (S.feed === 'new' && !S.search && showable(c)) renderFeed();
      syncSubs();
    } else if (d.txType === 'buy' || d.txType === 'sell') {
      const c = S.coins.get(d.mint); if (!c) return;
      const prev = c.mcapSol || 0; const wasShown = showable(c);
      c.mcapSol = d.marketCapSol; c.vSol = d.vSolInBondingCurve; c.vTok = d.vTokensInBondingCurve; c.athSol = Math.max(c.athSol || 0, c.mcapSol);
      if (d.pool && d.pool !== 'pump') c.complete = true;
      c.trades++; c.vol += d.solAmount || 0; c.lastTrade = Date.now();
      pushHistory(c.mint, priceSol(c));
      const t = { t: Date.now(), type: d.txType, sol: d.solAmount, tok: d.tokenAmount, mcap: d.marketCapSol, who: d.traderPublicKey, sig: d.signature };
      let arr = S.trades.get(c.mint); if (!arr) { arr = []; S.trades.set(c.mint, arr); } arr.unshift(t); if (arr.length > 80) arr.pop();
      if (wasShown !== showable(c)) scheduleFeed(); else flashCoin(c.mint, c.mcapSol >= prev);
      if (S.selected === c.mint) { addTradeRow(t); feedChart(c.mcapSol * S.solUsd); renderHead(); }
    }
  }
  function scheduleFeed() { if (S.feedDirty) return; S.feedDirty = setTimeout(() => { S.feedDirty = 0; renderFeed(); }, 1200); }
  function held() { return S.book ? S.book.positions.map(p => p.mint) : []; }
  function syncSubs() {
    const want = new Set();
    if (S.selected) want.add(S.selected);
    held().forEach(m => want.add(m));
    (S.book ? S.book.watch : []).forEach(w => want.add(w.mint));
    S.feeds.new.slice(0, 40).forEach(m => want.add(m));          // fresh launches: watch them cross the 6K line
    currentFeed().slice(0, 30).forEach(m => want.add(m));
    const arr = [...want].filter(m => S.coins.has(m)).slice(0, MAX_SUBS);
    const add = arr.filter(m => !S.subs.has(m)), rem = [...S.subs].filter(m => !arr.includes(m));
    rem.forEach(m => S.subs.delete(m)); add.forEach(m => S.subs.add(m));
    if (S.ws && S.wsOk) { if (rem.length) S.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: rem })); if (add.length) S.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: add })); }
  }

  /* --------------------------------------------------------------- lists -- */
  async function loadList(view) {
    try {
      const r = await fetch(`/api/pump?view=${view}&limit=50`, { signal: AbortSignal.timeout(12000) }); const j = await r.json();
      if (!j.coins || !j.coins.length) throw new Error('empty');
      const mints = j.coins.filter(c => !c.nsfw).map(raw => { const c = upsert(raw); if (!S.history.has(c.mint)) pushHistory(c.mint, priceSol(c)); return c.mint; });
      if (view === 'new') { const set = new Set(S.feeds.new); mints.forEach(m => { if (!set.has(m)) S.feeds.new.push(m); }); S.feeds.new.sort((a, b) => (S.coins.get(b).created || 0) - (S.coins.get(a).created || 0)); S.feeds.new = S.feeds.new.slice(0, MAX_FEED); }
      else S.feeds[view] = mints;
      if (S.feed === view) renderFeed(); syncSubs(); return true;
    } catch (e) { console.error('loadList', view, e); if (S.feed === view) renderFeed(); return false; }
  }
  async function loadSol() {
    try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(8000) }); const j = await r.json(); S.solUsd = j.solana.usd; }
    catch (e) { if (!S.solUsd) S.solUsd = 150; }
    $('#termSol').textContent = '$' + S.solUsd.toFixed(2); renderDesk(); renderHead();
  }

  /* ---------------------------------------------------------------- feed -- */
  function currentFeed() {
    let list;
    if (S.feed === 'watch') list = (S.book ? S.book.watch : []).map(w => w.mint);
    else { list = S.feeds[S.feed] || []; if (S.search) { const q = S.search.toLowerCase(); list = [...S.coins.keys()].filter(m => { const c = S.coins.get(m); return m.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q); }); } }
    return list.filter(m => showable(S.coins.get(m)));
  }
  function coinHtml(c) {
    const isHeld = held().includes(c.mint); const watched = S.book && S.book.watch.some(w => w.mint === c.mint);
    return `<div class="coin ${c.mint === S.selected ? 'is-active' : ''} ${c.isNew ? 'is-new' : ''}" data-mint="${c.mint}">
      ${imgHtml(c, 'coin__img')}
      <div class="coin__main">
        <div class="coin__name"><b>${esc(c.name || short(c.mint))}</b><span>${esc(c.symbol || '')}</span></div>
        <div class="coin__sub"><span>${c.created ? ago(c.created) : '—'} ago</span>${c.live ? '<span class="live">● LIVE</span>' : ''}${isHeld ? '<span class="apeTag">🦍 APED</span>' : watched ? '<span class="apeTag apeTag--w">👀 WATCHING</span>' : ''}${c.trades ? `<span>${c.trades} tx</span>` : ''}${c.replies ? `<span>${c.replies} replies</span>` : ''}</div>
        <div class="coin__prog"><i style="--p:${curvePct(c).toFixed(1)}%"></i></div>
      </div>
      <div class="coin__right"><div class="coin__mcap" data-mcap="${c.mint}">${fmtUsd(mcapUsd(c))}</div><div class="coin__cp">${c.complete ? 'GRAD' : curvePct(c).toFixed(0) + '%'}</div></div>
    </div>`;
  }
  function renderFeed() {
    const el = $('#feed'); const list = currentFeed();
    if (!list.length) { el.innerHTML = `<div class="feed__empty">${S.feed === 'watch' ? 'the ape is not watching anything yet<br/>give him a minute' : S.search ? 'nothing matches above $6K<br/>paste a full mint to load it' : S.wsOk ? 'waiting for coins above $6K…<br/>pump.fun never sleeps' : 'connecting to the chain…'}</div>`; return; }
    el.innerHTML = list.map(m => S.coins.get(m)).filter(Boolean).map(coinHtml).join('');
    list.forEach(m => { const c = S.coins.get(m); if (c) c.isNew = false; });
  }
  function rerenderCoin(mint) {
    const row = $(`.coin[data-mint="${mint}"]`); const c = S.coins.get(mint);
    if (row && c) { const tmp = document.createElement('div'); tmp.innerHTML = coinHtml(c); row.replaceWith(tmp.firstElementChild); }
    if (S.selected === mint) renderHead();
  }
  function flashCoin(mint, up) {
    const el = $(`.coin__mcap[data-mcap="${mint}"]`); const c = S.coins.get(mint); if (!el || !c) return;
    el.textContent = fmtUsd(mcapUsd(c)); el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(up ? 'flash-up' : 'flash-down');
    const row = el.closest('.coin'); const prog = row && row.querySelector('.coin__prog i'); if (prog) prog.style.setProperty('--p', curvePct(c).toFixed(1) + '%');
    const cp = row && row.querySelector('.coin__cp'); if (cp) cp.textContent = c.complete ? 'GRAD' : curvePct(c).toFixed(0) + '%';
  }

  /* ------------------------------------------------------ chart & header -- */
  function select(mint, manual) {
    const c = S.coins.get(mint); if (!c) return;
    if (manual) { S.manualAt = Date.now(); S.following = false; } else S.following = true;
    S.selected = mint; $$('.coin').forEach(r => r.classList.toggle('is-active', r.dataset.mint === mint));
    renderHead(); buildChart(); renderTrades(); syncSubs();
    if (innerWidth <= 820) mobileCol('center');
  }
  function renderHead() {
    const c = S.selected && S.coins.get(S.selected); if (!c) return;
    $('#cheadImg').outerHTML = imgHtml(c, 'chead__img').replace('class="chead__img"', 'class="chead__img" id="cheadImg"');
    $('#cheadName').textContent = c.name || short(c.mint); $('#cheadSym').textContent = c.symbol || '';
    const pos = S.book && S.book.positions.find(p => p.mint === c.mint);
    $('#cheadMint').innerHTML = `<span>${short(c.mint)}</span><button data-copy="${c.mint}">copy</button><a href="https://pump.fun/coin/${c.mint}" target="_blank" rel="noopener">pump.fun ↗</a>${c.creator ? `<span>· dev ${short(c.creator)}</span>` : ''}${c.created ? `<span>· ${ago(c.created)} ago</span>` : ''}${pos ? `<span class="apeTag">🦍 the ape holds ${fmtSol(pos.cost)} SOL of this</span>` : ''}${S.following ? '<span class="apeTag apeTag--w">· following the ape</span>' : ''}`;
    $('#cheadMcap').textContent = fmtUsd(mcapUsd(c)); $('#cheadPrice').textContent = fmtPrice(priceSol(c) * S.solUsd); $('#cheadAth').textContent = fmtUsd((c.athSol || 0) * S.solUsd);
    const p = curvePct(c); $('#cprogBar').style.setProperty('--p', p.toFixed(1) + '%'); $('#cprogPct').textContent = c.complete ? 'GRADUATED' : p.toFixed(1) + '%';
  }
  const TF_LABEL = { 15: '15s', 60: '1m', 300: '5m' };
  let chartReq = 0;
  async function buildChart() {
    const box = $('#chart'); const empty = $('#chartEmpty'); const mint = S.selected;
    if (typeof LightweightCharts === 'undefined') { empty.textContent = 'chart library unavailable'; return; }
    if (!S.chart) {
      S.chart = LightweightCharts.createChart(box, { layout: { background: { color: '#0d0f0e' }, textColor: '#8b948f', fontFamily: 'Share Tech Mono, monospace', fontSize: 11 }, grid: { vertLines: { color: '#171b19' }, horzLines: { color: '#171b19' } }, rightPriceScale: { borderColor: '#262b29', scaleMargins: { top: .12, bottom: .08 } }, timeScale: { borderColor: '#262b29', timeVisible: true, secondsVisible: true, rightOffset: 3 }, crosshair: { mode: 0 }, autoSize: true, localization: { priceFormatter: v => fmtUsd(v) } });
      S.series = S.chart.addCandlestickSeries({ upColor: '#4ade80', downColor: '#f87171', borderUpColor: '#4ade80', borderDownColor: '#f87171', wickUpColor: '#4ade80', wickDownColor: '#f87171', priceFormat: { type: 'custom', minMove: 0.01, formatter: v => fmtUsd(v) } });
    }
    const req = ++chartReq;
    S.candles = []; S.series.setData([]); S.series.setMarkers([]);
    empty.style.display = ''; empty.innerHTML = 'LOADING MARKET CAP HISTORY…';
    let hist = [];
    try { const r = await fetch(`/api/candles?mint=${mint}&interval=${TF_LABEL[S.tf] || '1m'}&limit=500`, { signal: AbortSignal.timeout(12000) }); const jj = await r.json(); hist = jj.candles || []; } catch (e) {}
    if (req !== chartReq) return;
    const bucket = t => Math.floor(t / 1000 / S.tf) * S.tf;
    hist.forEach(k => S.candles.push({ time: bucket(k.t), open: k.o * 1e9, high: k.h * 1e9, low: k.l * 1e9, close: k.c * 1e9 }));
    // dedupe + sort (the API is already ordered, but never trust a feed)
    const seen = new Map(); S.candles.forEach(c => seen.set(c.time, c)); S.candles = [...seen.values()].sort((x, y) => x.time - y.time);
    // live points newer than the last real candle (seen on this desk)
    const lastT = S.candles.length ? S.candles[S.candles.length - 1].time : 0;
    (S.history.get(mint) || []).filter(pt => bucket(pt.t) > lastT).forEach(pt => feedChart(pt.p * S.solUsd * 1e9, pt.t, true));
    S.series.setData(S.candles.slice()); S.series.setMarkers(markersFor(mint)); S.chart.timeScale().fitContent();
    if (S.candles.length > 80) S.chart.timeScale().setVisibleLogicalRange({ from: S.candles.length - 80, to: S.candles.length + 3 });
    empty.style.display = S.candles.length ? 'none' : ''; empty.innerHTML = 'NO HISTORY YET<br/>chart builds live from the first trade';
  }
  // value = market cap in USD; one candle per S.tf seconds
  function feedChart(mcapUsdVal, ts, silent) {
    if (!S.series || !isFinite(mcapUsdVal) || mcapUsdVal <= 0) return;
    const t = Math.floor((ts || Date.now()) / 1000 / S.tf) * S.tf;
    let c = S.candles[S.candles.length - 1];
    if (c && t < c.time) return;
    if (!c || c.time !== t) { c = { time: t, open: mcapUsdVal, high: mcapUsdVal, low: mcapUsdVal, close: mcapUsdVal }; S.candles.push(c); if (S.candles.length > 1200) S.candles.shift(); }
    else { c.high = Math.max(c.high, mcapUsdVal); c.low = Math.min(c.low, mcapUsdVal); c.close = mcapUsdVal; }
    if (!silent) { S.series.update({ ...c }); $('#chartEmpty').style.display = 'none'; }
  }
  function markersFor(mint) {
    if (!S.book) return [];
    return S.book.txs.filter(t => t.mint === mint).map(t => ({ time: Math.floor(t.t / 1000 / S.tf) * S.tf, position: t.type === 'buy' ? 'belowBar' : 'aboveBar', color: t.type === 'buy' ? '#8dff1f' : '#ff3fa4', shape: t.type === 'buy' ? 'arrowUp' : 'arrowDown', text: (t.type === 'buy' ? 'APE ' : 'SOLD ') + fmtSol(t.sol) })).sort((a, b) => a.time - b.time);
  }
  function renderTrades() { const body = $('#tradesBody'); const arr = S.trades.get(S.selected) || []; body.innerHTML = arr.map(tradeRow).join('') || '<div class="feed__empty">no trades seen yet on this desk</div>'; }
  const tradeRow = t => `<div class="trow"><span>${hhmmss(t.t)}</span><span class="${t.type}">${t.type.toUpperCase()}</span><span>${fmtSol(t.sol || 0)}</span><span>${fmtTok(t.tok || 0)}</span><span>${fmtUsd((t.mcap || 0) * S.solUsd)}</span><span>${t.sig ? `<a href="https://solscan.io/tx/${t.sig}" target="_blank" rel="noopener">${short(t.who)}</a>` : short(t.who)}</span></div>`;
  function addTradeRow(t) { const body = $('#tradesBody'); if (body.firstElementChild && body.firstElementChild.classList.contains('feed__empty')) body.innerHTML = ''; body.insertAdjacentHTML('afterbegin', tradeRow(t)); while (body.children.length > 80) body.lastElementChild.remove(); }

  /* ------------------------------------------------------------ the book -- */
  function ctx() {
    const byMint = {}; for (const [m, c] of S.coins) if (c.mcapSol) byMint[m] = c;
    return { byMint, solUsd: S.solUsd || 150, now: Date.now(), rand: Math.random };
  }
  function universe() {
    const out = []; const now = Date.now();
    for (const c of S.coins.values()) if (c.mcapSol && (c.lastTrade || c.created) && now - Math.max(c.lastTrade || 0, c.created || 0) < 3 * 3600000) out.push(c);
    return out;
  }
  function save() { if (S.shared) return; try { localStorage.setItem(LS_KEY, JSON.stringify(S.book)); } catch (e) {} }
  function restore() { try { const b = JSON.parse(localStorage.getItem(LS_KEY)); if (b && b.gen === C.BOOK_GEN) return b; } catch (e) {} return null; }
  let lastLogId = 0;
  function soloTick() { if (S.shared || !S.book) return; C.tick(S.book, ctx(), universe()); save(); afterTick(); }
  function afterTick() {
    for (const [m, mk] of Object.entries(S.book.marks || {})) if (!S.coins.has(m) && mk.mcapSol) upsert({ mint: m, name: mk.name, symbol: mk.symbol, image: mk.image, mcapSol: mk.mcapSol, vSol: mk.vSol, vTok: mk.vTok, complete: mk.complete });
    renderDesk(); syncSubs();
    const fresh = S.book.logs.filter(l => l.id > lastLogId);
    if (lastLogId && fresh.length) fresh.forEach(l => { if (l.kind === 'buy' || l.kind === 'sell' || l.kind === 'risk') toast(l); });
    lastLogId = S.book.logN || 0;
    followApe(fresh);
    if (S.selected && S.series) S.series.setMarkers(markersFor(S.selected));
    if ($('.coin').length) { if (S.feed === 'watch') renderFeed(); else held().concat((S.book.watch || []).map(w => w.mint)).forEach(rerenderCoin); }
  }
  function followApe(fresh) {
    if (Date.now() - S.manualAt < 120000) return;           // the visitor clicked something: leave it for 2 minutes
    const buys = (fresh || []).filter(l => l.kind === 'buy');
    let target = null;
    if (buys.length) { const tx = (S.book.txs || []).find(t => t.type === 'buy'); target = tx && tx.mint; }
    else if (!S.selected && S.book.positions.length) target = S.book.positions.slice().sort((a, b) => b.opened - a.opened)[0].mint;
    else if (!S.selected && S.book.txs && S.book.txs.length) target = S.book.txs[0].mint;
    if (target && target !== S.selected && S.coins.get(target)) select(target, false);
  }
  async function pollShared() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(20000) }); const st = await r.json();
      if (!st || !st.shared) { if (S.shared === null) { S.shared = false; soloBoot(); } return; }
      S.shared = true; S.book = st.book; if (st.solUsd) { S.solUsd = st.solUsd; $('#termSol').textContent = '$' + S.solUsd.toFixed(2); }
      status(); afterTick();
    } catch (e) { if (S.shared === null) { S.shared = false; soloBoot(); } }
  }
  function soloBoot() {
    S.book = restore();
    if (!S.book) { S.book = C.newBook(Date.now(), Math.random); C.bootLogs(S.book, Date.now()); }
    else C.log(S.book, Date.now(), 'boot', 'BOOT  session restored · ' + S.book.positions.length + ' open · ' + S.book.nTx + ' fills on the tape');
    lastLogId = S.book.logN || 0; renderDesk(); setInterval(soloTick, 15000); setTimeout(soloTick, 4000);
  }

  /* --------------------------------------------------------------- desk -- */
  let lastMood = '', toastT;
  function mood(st) {
    const n = S.book.positions.length; const pct = st.pnlPct;
    const m = n === 0 && Math.abs(pct) < 3 ? 'watch' : pct > 25 ? 'moon' : pct >= 0 ? 'up' : pct > -15 ? 'watch' : 'rekt';
    if (m === lastMood) return; lastMood = m;
    $$('#pfApe img').forEach(i => i.classList.toggle('is-active', i.dataset.mood === m));
  }
  function thesisText(st) {
    if (S.book.thesis) return S.book.thesis;
    const b = S.book.brainState;
    return b === 'cooling off' ? 'four Ls in a row. touching grass for a minute.' : b === 'fully aped' ? 'four positions open. fully aped. no more hands.' : b === 'in position' ? (st.pnlPct >= 0 ? 'in position. green. not selling. (the rules will sell.)' : 'in position. red. it\'s fine. it\'s fine.') : 'scanning new pairs. looking for a face and a vibe.';
  }
  function renderDesk() {
    if (!S.book) return;
    const cx = ctx(); const st = C.stats(S.book, cx);
    $('#termBal').textContent = fmtSol(S.book.cash) + ' SOL'; $('#termEq').textContent = fmtSol(st.equity) + ' SOL';
    const pe = $('#dkPnl'); pe.textContent = (st.pnlSol >= 0 ? '+' : '') + fmtSol(st.pnlSol) + ' SOL'; pe.className = 'mono ' + (st.pnlSol >= 0 ? 'up' : 'down');
    $('#dkPnlPct').textContent = sgn(st.pnlPct); $('#dkPnlPct').className = 'mono ' + (st.pnlPct >= 0 ? 'up' : 'down');
    $('#dkEq').textContent = fmtSol(st.equity); $('#dkWin').textContent = st.nClosed ? st.winRate.toFixed(0) + '%' : '—'; $('#dkOpen').textContent = st.open + '/' + RULES.MAX_POS; $('#dkTx').textContent = st.nTx;
    $('#dkState').textContent = (S.book.brainState || 'hunting').toUpperCase() + (S.book.brainSource === 'model' ? ' · MODEL' : ' · DEGEN BRAIN');
    $('#pfSay').textContent = thesisText(st);
    mood(st); drawEquity();
    const list = $('#dkList');
    if (S.deskTab === 'positions') {
      const items = S.book.positions.map(p => { const c = C.coinOf(S.book, cx, p.mint); const mark = c ? priceSol(c) : p.entryMark; const val = c ? C.quoteSell(c, p.tokens).out : p.cost; const pct = (mark / p.entryMark - 1) * 100; return { p, c, val, pct }; }).sort((a, b) => b.val - a.val);
      list.innerHTML = items.map(({ p, c, val, pct }) => `<div class="hold" data-mint="${p.mint}">${imgHtml({ image: p.image || (c && c.image), symbol: p.symbol }, 'hold__img')}<div class="hold__main"><b>${esc(p.name || short(p.mint))} <span>${esc(p.symbol || '')}</span>${p.banked ? ' <span class="apeTag">BANKED</span>' : p.scaled ? ' <span class="apeTag">SCALED</span>' : ''}</b><span>${fmtSol(p.cost)} SOL in · ${ago(p.opened)} · target +${RULES.TARGET_PCT}%</span></div><div class="hold__right"><b>${fmtSol(val)} SOL</b><span class="${pct >= 0 ? 'up' : 'down'}">${sgn(pct)}</span></div></div>`).join('') || `<div class="pf__empty">no open positions<br/>the ape is ${esc(S.book.brainState || 'hunting')}</div>`;
    } else if (S.deskTab === 'watch') {
      list.innerHTML = (S.book.watch || []).map(w => { const c = S.coins.get(w.mint); return `<div class="hold" data-mint="${w.mint}">${imgHtml({ image: w.image || (c && c.image), symbol: w.symbol }, 'hold__img')}<div class="hold__main"><b>${esc(w.name || w.symbol || short(w.mint))} <span>${esc(w.symbol || '')}</span></b><span>${esc(w.reason || '')}</span></div><div class="hold__right"><b>${c ? fmtUsd(mcapUsd(c)) : '—'}</b><span>score ${w.score || '—'}</span></div></div>`; }).join('') || '<div class="pf__empty">nothing on the watchlist yet<br/>the ape needs a few minutes of tape</div>';
    } else if (S.deskTab === 'tape') {
      list.innerHTML = (S.book.txs || []).slice(0, 60).map(t => `<div class="hist" data-mint="${t.mint}"><span class="${t.type}">${t.type === 'buy' ? '🦍 APE' : 'SOLD'}</span><div><b>${esc(t.symbol || t.name || short(t.mint))}</b><small>${hhmmss(t.t)} · ${esc(t.reason || '')}</small></div><div class="hist__right">${fmtSol(t.sol)} SOL${t.pnl != null ? `<small class="${t.pnl >= 0 ? 'up' : 'down'}">${t.pnl >= 0 ? '+' : ''}${fmtSol(t.pnl)}</small>` : ''}</div></div>`).join('') || '<div class="pf__empty">no fills yet</div>';
    } else {
      const logs = (S.book.logs || []).slice().reverse();
      list.innerHTML = `<div class="stream">${logs.map(l => `<div class="stream__row stream__row--${l.kind}"><span>${hhmmss(l.t)}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
    }
    const closed = S.book.closed || []; const best = closed.length ? closed.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
    $('#dkFoot').textContent = `${S.shared ? 'one ape for everyone' : 'your view of the ape'} · session ${S.book.day} · ${closed.length} closed${best ? ' · best ' + (best.symbol || '') + ' +' + fmtSol(best.pnl) : ''} · ${S.book.archive && S.book.archive.length ? S.book.archive.length + ' days archived' : 'day 1'}`;
  }
  function drawEquity() {
    const c = $('#dkEquity'); if (!c) return; const g = c.getContext('2d'); const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    const pts = (S.book.equity || []).slice(-200); if (pts.length < 2) { g.fillStyle = '#8b948f'; g.font = '10px Share Tech Mono'; g.fillText('equity curve builds as he trades', 8, H / 2 + 4); return; }
    const vs = pts.map(p => p[1]); const mn = Math.min(...vs, RULES.START_SOL), mx = Math.max(...vs, RULES.START_SOL); const rng = Math.max(mx - mn, 0.05);
    const y = v => H - 4 - ((v - mn) / rng) * (H - 8); const x = i => (i / (pts.length - 1)) * W;
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, y(RULES.START_SOL)); g.lineTo(W, y(RULES.START_SOL)); g.stroke(); g.setLineDash([]);
    const up = vs[vs.length - 1] >= RULES.START_SOL; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(x(i), y(p[1])) : g.moveTo(x(i), y(p[1])));
    g.strokeStyle = up ? '#8dff1f' : '#ff3fa4'; g.lineWidth = 1.5; g.shadowColor = g.strokeStyle; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = up ? 'rgba(141,255,31,.12)' : 'rgba(255,63,164,.12)'; g.fill();
  }
  function toast(l) {
    const el = $('#termToast'); $('#termToastTxt').textContent = l.text; el.classList.toggle('is-red', l.kind === 'risk');
    el.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('is-on'), 3600);
    const say = $('#pfSay'); if (l.kind === 'buy') say.textContent = pick(['saw it. aped it. no regrets.', 'lowcap detected. sending.', 'this one has a face. in.', 'ticker goes hard. buying.']); else if (l.kind === 'sell') say.textContent = pick(['took profit. responsible degen.', 'green. next.', 'sold the top. definitely the top.']); else say.textContent = pick(['rugged. classic.', 'cut it. onto the next lowcap.', 'that one was a scam. moving on.']);
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function mobileCol(col) { $$('#termMtabs button').forEach(b => b.classList.toggle('is-active', b.dataset.col === col)); $$('.term__col').forEach(c => c.classList.toggle('is-mobile-active', c.dataset.col === col)); }

  /* -------------------------------------------------------------- events -- */
  function bind() {
    $('#feedTabs').addEventListener('click', e => { const b = e.target.closest('.ttab'); if (!b) return; $$('#feedTabs .ttab').forEach(x => x.classList.toggle('is-active', x === b)); S.feed = b.dataset.feed; renderFeed(); if (S.feed !== 'watch' && !(S.feeds[S.feed] || []).length) loadList(S.feed); syncSubs(); });
    $('#feed').addEventListener('click', e => { const row = e.target.closest('.coin'); if (row) select(row.dataset.mint, true); });
    $('#dkTabs').addEventListener('click', e => { const b = e.target.closest('.ttab'); if (!b) return; $$('#dkTabs .ttab').forEach(x => x.classList.toggle('is-active', x === b)); S.deskTab = b.dataset.dk; renderDesk(); });
    $('#dkList').addEventListener('click', e => { const r = e.target.closest('[data-mint]'); if (r && S.coins.get(r.dataset.mint)) select(r.dataset.mint, true); });
    $('#chead').addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b && navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy', 1200); }); });
    $('#chartTf').addEventListener('click', e => { const b = e.target.closest('[data-tf]'); if (!b) return; $$('#chartTf button').forEach(x => x.classList.toggle('is-active', x === b)); S.tf = +b.dataset.tf; if (S.selected) buildChart(); });
    $('#termMtabs').addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (b) mobileCol(b.dataset.col); });
    let st; $('#termSearch').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { S.search = e.target.value.trim(); const q = S.search; if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !S.coins.get(q)) { upsert({ mint: q, name: short(q), symbol: '' }); S.feeds.new.unshift(q); S.selected = q; syncSubs(); } renderFeed(); }, 200); });
    root.addEventListener('wheel', e => { if (e.target.closest('.feed, .pf__list, .trades__body')) e.stopPropagation(); }, { passive: true });
  }

  /* ---------------------------------------------------------------- boot -- */
  function start() {
    if (S.started) return; S.started = true;
    connect(); loadList('new'); loadList('active'); loadList('grad');
    pollShared(); setInterval(pollShared, 15000);
    setInterval(() => { loadList('new'); loadList('active'); if (S.feed === 'grad') loadList('grad'); }, 45000);
    setInterval(() => { if ($$('.coin').length) renderFeed(); renderDesk(); }, 30000);
  }
  function boot() {
    bind(); loadSol(); setInterval(loadSol, 60000);
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { start(); io.disconnect(); } }, { rootMargin: '800px' }); io.observe(root); } else start();
    setTimeout(start, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
