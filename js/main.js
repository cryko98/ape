/* ============================================================
   $APE — main.js
   ============================================================ */
(() => {
  'use strict';

  // ---------- CONFIG (edit these when ready) ----------
  const CONFIG = {
    X_URL: '',           // e.g. 'https://x.com/yourhandle' — empty = "coming soon" toast
    CA: '',              // contract address — empty = "COMING SOON"
    BUY_URL: '',         // e.g. 'https://pump.fun/coin/<CA>' — empty = toast
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- Failsafe: never leave the user stuck on the loader ----------
  const killLoader = () => { const l = $('#loader'); if (l) l.remove(); document.body.classList.remove('is-loading'); };
  setTimeout(killLoader, 6000);
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    document.documentElement.classList.add('no-gsap');
    document.addEventListener('DOMContentLoaded', () => { killLoader(); try { setupLinksStatic(); } catch (e) {} });
    console.warn('GSAP missing: running static fallback');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  function setupLinksStatic() { setupLinks(); }
  // ---------- Links / CA ----------
  const toast = $('#toast');
  let toastT;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('is-on'), 2600);
  }

  function setupLinks() {
    const xLinks = ['#xLinkNav', '#xLinkHero', '#xLinkCta', '#xLinkFooter'].map(s => $(s)).filter(Boolean);
    xLinks.forEach(a => {
      if (CONFIG.X_URL) { a.href = CONFIG.X_URL; }
      else a.addEventListener('click', e => { e.preventDefault(); showToast('X link drops soon. Stay apish. 🦍'); });
    });

    const caValue = $('#caValue');
    const caBox = $('#caBox');
    if (CONFIG.CA) {
      caValue.textContent = CONFIG.CA;
      caBox.dataset.cursor = 'COPY';
      $$('.card__val--ca').forEach(el => { el.textContent = CONFIG.CA; el.style.fontSize = '16px'; el.style.wordBreak = 'break-all'; });
      caBox.addEventListener('click', () => {
        navigator.clipboard?.writeText(CONFIG.CA).then(() => showToast('CA copied. Now say ape.'));
      });
    } else {
      caBox.addEventListener('click', () => showToast('CA: coming soon. Follow X to catch the drop.'));
    }

    ['#buyBtn', '#buyBtn2'].forEach(s => {
      const b = $(s); if (!b) return;
      b.addEventListener('click', () => {
        if (CONFIG.BUY_URL) window.open(CONFIG.BUY_URL, '_blank', 'noopener');
        else { flash(.5); showToast('Not live yet. CA drops on X first. 🦍'); }
      });
    });
  }

  // ---------- Flash ----------
  const flashEl = $('#flash');
  function flash(strength = .8) {
    if (reduced) return;
    gsap.fromTo(flashEl, { opacity: strength }, { opacity: 0, duration: .5, ease: 'power2.out' });
  }

  // ---------- Glitch ----------
  function glitch(el) {
    el.classList.remove('is-glitching');
    void el.offsetWidth;
    el.classList.add('is-glitching');
    setTimeout(() => el.classList.remove('is-glitching'), 520);
  }
  function setupGlitch() {
    const els = $$('.glitch');
    els.forEach(el => el.addEventListener('mouseenter', () => glitch(el)));
    if (reduced) return;
    setInterval(() => {
      const visible = els.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      if (visible.length) glitch(visible[Math.floor(Math.random() * visible.length)]);
    }, 2200);
  }

  // ---------- Cursor ----------
  function setupCursor() {
    const cur = $('#cursor'); if (!cur || !fine) return;
    const label = $('#cursorLabel');
    const dot = cur.querySelector('.cursor__dot');
    const ring = cur.querySelector('.cursor__ring');
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
    addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    addEventListener('mousedown', () => cur.classList.add('is-down'));
    addEventListener('mouseup', () => cur.classList.remove('is-down'));
    gsap.ticker.add(() => {
      rx += (mx - rx) * .18; ry += (my - ry) * .18;
      dot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      label.style.transform = `translate(${rx}px,${ry}px)`;
    });
    document.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-cursor], a, button');
      if (t) { cur.classList.add('is-hover'); label.textContent = t.dataset.cursor || 'GO'; }
      else cur.classList.remove('is-hover');
    });
  }

  // ---------- Nav ----------
  function setupNav() {
    const nav = $('#nav');
    const burger = $('#burger');
    const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 30);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    burger.addEventListener('click', () => nav.classList.toggle('is-open'));
    $$('.nav__links a').forEach(a => a.addEventListener('click', () => nav.classList.remove('is-open')));
  }

  // ---------- Candles canvas ----------
  function setupCandles() {
    const c = $('#candles'); if (!c) return;
    const ctx = c.getContext('2d');
    let W, H, dpr, candles = [], t = 0;
    const CW = 14, GAP = 8;
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = c.clientWidth; H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.ceil(W / (CW + GAP)) + 4;
      candles = []; let p = H * .7;
      for (let i = 0; i < n; i++) candles.push(gen(p)), p = candles[i].c;
    }
    function gen(prev) {
      const up = Math.random() < .68;
      const body = 6 + Math.random() * 46;
      const o = prev, cl = up ? o - body : o + body;
      const hi = Math.min(o, cl) - Math.random() * 18, lo = Math.max(o, cl) + Math.random() * 18;
      // drift back toward the centre so it never leaves the screen
      let adj = 0; if (cl < H * .25) adj = (H * .25 - cl) * .5; if (cl > H * .85) adj = -(cl - H * .85) * .5;
      return { o: o + adj, c: cl + adj, h: hi + adj, l: lo + adj, up };
    }
    let offset = 0;
    function draw() {
      t++;
      ctx.clearRect(0, 0, W, H);
      offset += .6;
      if (offset >= CW + GAP) { offset -= CW + GAP; candles.shift(); candles.push(gen(candles[candles.length - 1].c)); }
      // line under candles
      ctx.lineWidth = 1;
      for (let i = 0; i < candles.length; i++) {
        const k = candles[i]; const x = i * (CW + GAP) - offset;
        const col = k.up ? '#8dff1f' : '#ff3fa4';
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.globalAlpha = k.up ? .55 : .35;
        ctx.beginPath(); ctx.moveTo(x + CW / 2, k.h); ctx.lineTo(x + CW / 2, k.l); ctx.stroke();
        const top = Math.min(k.o, k.c), hgt = Math.max(2, Math.abs(k.o - k.c));
        ctx.fillRect(x, top, CW, hgt);
        if (k.up) { ctx.globalAlpha = .18; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillRect(x, top, CW, hgt); ctx.shadowBlur = 0; }
      }
      ctx.globalAlpha = 1;
      // price line
      const last = candles[candles.length - 3];
      if (last) {
        ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(141,255,31,.35)';
        ctx.beginPath(); ctx.moveTo(0, last.c); ctx.lineTo(W, last.c); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '11px "Share Tech Mono", monospace'; ctx.fillStyle = '#8dff1f';
        ctx.fillText('$APE  ▲ ' + (420.69 + Math.sin(t / 40) * 69).toFixed(2) + '%', W - 150, last.c - 6);
      }
      if (!reduced) requestAnimationFrame(draw);
    }
    addEventListener('resize', resize); resize(); draw();
  }

  // ---------- Particles canvas ----------
  function setupParticles() {
    const c = $('#particles'); if (!c) return;
    const ctx = c.getContext('2d');
    const GLYPHS = ['$', '▲', 'ア', 'ペ', '猿', '↑', 'APE', '◆', '100x', 'ゴ'];
    let W, H, dpr, ps = [];
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = c.clientWidth; H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ps = Array.from({ length: Math.min(70, Math.floor(W / 18)) }, mk);
    }
    function mk() {
      return { x: Math.random() * W, y: H + Math.random() * H, s: 10 + Math.random() * 16, v: .3 + Math.random() * .9,
        g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], a: .15 + Math.random() * .5, w: Math.random() * Math.PI * 2,
        col: Math.random() < .8 ? '#8dff1f' : (Math.random() < .5 ? '#b25cff' : '#38f2ff') };
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.y -= p.v; p.w += .02; p.x += Math.sin(p.w) * .3;
        if (p.y < -40) Object.assign(p, mk(), { y: H + 40 });
        ctx.globalAlpha = p.a; ctx.fillStyle = p.col; ctx.font = `${p.s}px "Share Tech Mono", monospace`;
        ctx.shadowColor = p.col; ctx.shadowBlur = 8;
        ctx.fillText(p.g, p.x, p.y);
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (!reduced) requestAnimationFrame(draw);
    }
    addEventListener('resize', resize); resize(); draw();
  }

  // ---------- Hero character ----------
  function setupHeroChar() {
    const wrap = $('#heroCharWrap'); const char = $('#heroChar');
    if (!wrap) return;
    const imgs = $$('.hero__img', wrap);
    let idx = 0;
    // mouse tilt
    if (fine && !reduced) {
      const hero = $('#hero');
      hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        gsap.to(wrap, { rotateY: x * 22, rotateX: -y * 14, x: x * 30, duration: .8, ease: 'power3.out' });
        gsap.to('.hero__orb--1', { x: x * -80, y: y * -60, duration: 1.2 });
        gsap.to('.hero__orb--2', { x: x * 60, y: y * 40, duration: 1.2 });
        gsap.to('.hero__tag', { x: x * -18, y: y * -12, duration: 1 });
      });
      hero.addEventListener('mouseleave', () => gsap.to(wrap, { rotateY: 0, rotateX: 0, x: 0, duration: 1 }));
    }
    // click to cycle
    wrap.addEventListener('click', () => {
      imgs[idx].classList.remove('is-active');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.add('is-active');
      flash(.35);
      $$('.hero__title .glitch').forEach(glitch);
      gsap.fromTo(wrap, { scale: .94, filter: 'hue-rotate(60deg) drop-shadow(0 0 30px rgba(141,255,31,.35))' },
        { scale: 1, filter: 'hue-rotate(0deg) drop-shadow(0 0 30px rgba(141,255,31,.35))', duration: .6, ease: 'elastic.out(1,.5)' });
    });
    // scroll parallax
    gsap.to(char, { y: 120, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__copy', { y: 60, opacity: .2, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
  }

  // ---------- Counters ----------
  function fmt(n, mode) {
    if (mode === 'short') { if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 ? 1 : 0) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M'; }
    return Math.round(n).toLocaleString('en-US');
  }
  function setupCounters() {
    $$('[data-count]').forEach(el => {
      const target = +el.dataset.count, mode = el.dataset.format;
      const o = { v: 0 };
      ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => {
        gsap.to(o, { v: target, duration: 1.8, ease: 'power3.out', onUpdate: () => el.textContent = fmt(o.v, mode) });
      }});
    });
  }

  // ---------- Reveals ----------
  function setupReveals() {
    $$('.reveal').forEach((el, i) => {
      gsap.to(el, { opacity: 1, y: 0, duration: .9, ease: 'power3.out', delay: (i % 3) * .08,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    });
    $$('.section__title').forEach(el => {
      gsap.from(el, { x: -40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
    });
    // lore
    gsap.to('.lore__bubble', { opacity: 1, scale: 1, duration: .5, ease: 'back.out(2)', scrollTrigger: { trigger: '#lore', start: 'top 60%', once: true } });
    gsap.from('#loreChar img', { x: -80, opacity: 0, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '#lore', start: 'top 75%', once: true } });
    // stats bars
    ScrollTrigger.create({ trigger: '.stats', start: 'top 85%', once: true, onEnter: () => $('.stats').classList.add('is-on') });
    // cta char parallax
    gsap.fromTo('#ctaChar', { y: 160 }, { y: -40, ease: 'none', scrollTrigger: { trigger: '#community', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.cta__inner', { scale: .9, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '#community', start: 'top 70%', once: true } });
  }

  // ---------- Terminal typewriter ----------
  function setupTerminal() {
    const body = $('#termBody'); if (!body) return;
    const lines = [
      { t: '> connecting to pump.fun ...', c: 'dim' },
      { t: '> status: LIVE', c: '' },
      { t: '> fetching first post ...', c: 'dim' },
      { t: '' },
      { t: '"ape into lowcaps"', c: 'hot' },
      { t: '' },
      { t: '> one ape read this.', c: '' },
      { t: '> he has not slept since.', c: '' },
      { t: '> $APE initialized_', c: 'hot' },
    ];
    let started = false;
    ScrollTrigger.create({ trigger: '#terminal', start: 'top 80%', once: true, onEnter: () => { if (!started) { started = true; type(); } } });
    async function type() {
      const cur = document.createElement('span'); cur.className = 'cur';
      for (const ln of lines) {
        const span = document.createElement('span'); if (ln.c) span.className = ln.c;
        body.appendChild(span); body.appendChild(cur);
        for (const ch of ln.t) { span.textContent += ch; await wait(reduced ? 0 : 18 + Math.random() * 30); }
        body.insertBefore(document.createTextNode('\n'), cur);
        await wait(reduced ? 0 : 160);
      }
    }
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------- Pose switcher ----------
  function setupPoses() {
    const btns = $$('.pose'); const imgs = $$('.char__img'); const scan = $('.char__scan'); const viewer = $('#charViewer');
    btns.forEach(b => b.addEventListener('click', () => {
      if (b.classList.contains('is-active')) return;
      btns.forEach(x => x.classList.remove('is-active')); b.classList.add('is-active');
      imgs.forEach(i => i.classList.toggle('is-active', i.dataset.pose === b.dataset.pose));
      scan.classList.remove('is-on'); void scan.offsetWidth; scan.classList.add('is-on');
      flash(.25);
      gsap.fromTo(viewer, { x: -6 }, { x: 0, duration: .4, ease: 'elastic.out(1,.3)' });
    }));
    // auto-cycle when idle in view
    let auto; let last = Date.now();
    btns.forEach(b => b.addEventListener('click', () => last = Date.now()));
    ScrollTrigger.create({ trigger: '#character', start: 'top 60%', end: 'bottom 40%',
      onEnter: start, onEnterBack: start, onLeave: stop, onLeaveBack: stop });
    function start() { stop(); auto = setInterval(() => { if (Date.now() - last > 6000) { const i = btns.findIndex(b => b.classList.contains('is-active')); btns[(i + 1) % btns.length].click(); last = Date.now(); } }, 3000); }
    function stop() { clearInterval(auto); }
    // viewer tilt
    if (fine && !reduced) {
      viewer.addEventListener('mousemove', e => {
        const r = viewer.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        gsap.to('.char__img.is-active', { rotateY: x * 18, rotateX: -y * 10, duration: .6 });
      });
      viewer.addEventListener('mouseleave', () => gsap.to('.char__img', { rotateY: 0, rotateX: 0, duration: .8 }));
    }
  }

  // ---------- Card tilt ----------
  function setupTilt() {
    if (!fine || reduced) return;
    $$('[data-tilt]').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        gsap.to(card, { rotateY: x * 14, rotateX: -y * 14, scale: 1.02, duration: .4, transformPerspective: 700 });
      });
      card.addEventListener('mouseleave', () => gsap.to(card, { rotateY: 0, rotateX: 0, scale: 1, duration: .6 }));
    });
  }

  // ---------- Marquee ----------
  function setupMarquee() {
    const track = $('#marquee'); if (!track || reduced) return;
    gsap.to(track, { xPercent: -50, duration: 22, ease: 'none', repeat: -1 });
  }

  // ---------- Loader + intro ----------
  function setupLoader() {
    if (new URLSearchParams(location.search).has('og')) {
      // OG screenshot mode: no loader, instant intro, clean frame
      document.body.classList.add('is-og');
      $('#loader').remove();
      gsap.globalTimeline.timeScale(40);
      intro();
      setTimeout(() => gsap.globalTimeline.timeScale(1), 1500);
      return;
    }
    document.body.classList.add('is-loading');
    const bar = $('#loaderBar'), pct = $('#loaderPct'), loader = $('#loader');
    const o = { v: 0 };
    const heroImg = $('.hero__img.is-active');
    const ready = new Promise(res => { if (heroImg.complete) res(); else { heroImg.onload = res; heroImg.onerror = res; } setTimeout(res, 3500); });
    gsap.to(o, { v: 86, duration: 1.4, ease: 'power2.out', onUpdate: upd });
    function upd() { bar.style.width = o.v + '%'; pct.textContent = Math.round(o.v); }
    ready.then(() => {
      gsap.to(o, { v: 100, duration: .4, ease: 'power2.in', onUpdate: upd, onComplete: () => {
        const tl = gsap.timeline({ onComplete: () => { loader.remove(); document.body.classList.remove('is-loading'); ScrollTrigger.refresh(); } });
        tl.to('.loader__inner', { scale: 1.2, opacity: 0, duration: .4, ease: 'power3.in' })
          .to(loader, { clipPath: 'inset(0 0 100% 0)', duration: .7, ease: 'power4.inOut' }, '-=.1')
          .add(intro, '-=.35');
      }});
    });
  }
  function intro() {
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
    tl.to('.hero__line > span', { y: 0, duration: 1.1, stagger: .12 })
      .from('.hero__eyebrow, .hero__sub, .ca, .hero__actions, .hero__stats', { y: 30, opacity: 0, duration: .8, stagger: .08 }, '-=.7')
      .from('#heroCharWrap', { scale: .7, opacity: 0, y: 80, duration: 1.2, ease: 'elastic.out(1,.6)' }, '-=1.1')
      .to('.hero__tag', { opacity: 1, duration: .5, stagger: .12 }, '-=.6')
      .to('.hero__hint', { opacity: 1, duration: .5 }, '-=.2')
      .add(() => { flash(.6); $$('.hero__title .glitch').forEach(glitch); }, '-=.9');
  }

  // ---------- Pose registry (swap/add images here) ----------
  const POSES = {
    boss:  { src: '/assets/ape-1-arms-crossed.webp', w: 595, h: 1400 },
    jump:  { src: '/assets/ape-2-jump.webp',         w: 908, h: 1400 },
    chair: { src: '/assets/ape-3-chair.webp',        w: 869, h: 1400 },
    point: { src: '/assets/ape-4-point.webp',        w: 662, h: 1400 },
    walk:  { src: '/assets/ape-5-walk.webp',         w: 548, h: 1400 },
  };

  // ---------- The Cycle (pinned horizontal scroll) ----------
  const CYCLE = [
    { n: '00', tag: 'PHASE 1', title: 'SEES A LOWCAP', desc: 'market cap: 12k. chart: vertical. brain: off.', pose: 'walk' },
    { n: '01', tag: 'PHASE 2', title: 'SAYS "APE"', desc: 'no research. no roadmap. just vibes and a seed phrase.', pose: 'boss' },
    { n: '02', tag: 'PHASE 3', title: 'IT PUMPS', desc: 'screams. tells the group chat. calls himself a genius.', pose: 'jump' },
    { n: '03', tag: 'PHASE 4', title: '4AM CHART WATCH', desc: 'refreshes every 3 seconds. sleep is for paper hands.', pose: 'chair' },
    { n: '04', tag: 'PHASE 5', title: 'IT DUMPS', desc: 'blames the dev. blames the jeets. buys more.', pose: 'point', mod: 'dump' },
  ];
  function setupCycle() {
    const track = $('#cycleTrack'); const pin = $('#cyclePin'); if (!track) return;
    track.innerHTML = CYCLE.map(p => `
      <article class="panel ${p.mod ? 'panel--' + p.mod : ''}" data-n="${p.n}">
        <div class="panel__tag"><span>${p.tag}</span><span>${p.n} / 05</span></div>
        <div class="panel__img"><img src="${POSES[p.pose].src}" width="${POSES[p.pose].w}" height="${POSES[p.pose].h}" alt="${p.title}" loading="lazy" /></div>
        <div class="panel__text"><h3 class="panel__title">${p.title}</h3><p class="panel__desc">${p.desc}</p></div>
      </article>`).join('') + `
      <article class="panel panel--repeat" data-n="05">
        <div><img src="/assets/logo.webp" alt="" width="120" height="120" /><h3 class="panel__title">REPEAT<small>FOREVER // $APE</small></h3></div>
      </article>`;
    const panels = $$('.panel', track);
    const getDist = () => track.scrollWidth - innerWidth;
    const tween = gsap.to(track, { x: () => -getDist(), ease: 'none',
      scrollTrigger: { trigger: '#cycle', pin: pin, scrub: .6, start: 'top top', end: () => '+=' + (getDist() + innerHeight * .4), invalidateOnRefresh: true,
        onUpdate: self => { $('#cycleBar').style.width = (self.progress * 100) + '%'; } } });
    panels.forEach(p => ScrollTrigger.create({ trigger: p, containerAnimation: tween, start: 'left 80%', end: 'right 20%', toggleClass: 'is-in' }));
  }

  // ---------- Click burst (anywhere) ----------
  const BURST_GLYPHS = ['$', '▲', '◆', 'APE', '🦍', '+'];
  function spawnBurst(x, y, txt) {
    if (reduced) return;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.className = 'burst';
      s.textContent = txt || BURST_GLYPHS[Math.floor(Math.random() * BURST_GLYPHS.length)];
      s.style.left = x + 'px'; s.style.top = y + 'px';
      if (Math.random() < .25) s.style.color = Math.random() < .5 ? '#b25cff' : '#38f2ff';
      document.body.appendChild(s);
      const a = (i / n) * Math.PI * 2 + Math.random() * .5, d = 60 + Math.random() * 90;
      gsap.fromTo(s, { x: 0, y: 0, scale: .4, opacity: 1 }, { x: Math.cos(a) * d, y: Math.sin(a) * d - 40, scale: 1.2, opacity: 0, rotate: (Math.random() - .5) * 90, duration: .7 + Math.random() * .4, ease: 'power3.out', onComplete: () => s.remove() });
    }
  }
  function setupBurst() {
    document.addEventListener('click', e => {
      if (e.target.closest('.pose, .nav, a, button')) return;
      spawnBurst(e.clientX, e.clientY);
    });
  }

  // ---------- Text scramble on section titles ----------
  function setupScramble() {
    const CH = '!<>-_\\/[]{}—=+*^?#▲$アペ猿';
    $$('.section__title .glitch, .cta__title .glitch').forEach(el => {
      const final = el.dataset.text || el.textContent;
      ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => {
        if (reduced) return;
        let frame = 0; const total = 22;
        const tick = () => {
          frame++;
          el.textContent = final.split('').map((c, i) => c === ' ' ? ' ' : (frame / total > i / final.length + .15 ? c : CH[Math.floor(Math.random() * CH.length)])).join('');
          if (frame < total) requestAnimationFrame(tick); else el.textContent = final;
        }; tick();
      }});
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    [setupLinks, setupCursor, setupNav, setupGlitch, setupCandles, setupParticles, setupHeroChar,
     setupCounters, setupReveals, setupTerminal, setupPoses, setupTilt, setupMarquee,
     setupCycle, setupBurst, setupScramble].forEach(fn => { try { fn(); } catch (e) { console.error(fn.name, e); } });
    try { setupLoader(); } catch (e) { console.error('loader', e); killLoader(); }
  });
})();
