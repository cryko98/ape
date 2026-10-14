/* ============================================================================
   $APE — hero 3D
   Three ways to show the ape, best available wins:
     1. /assets/ape.glb      a real 3D model (textured, animated)
     2. /assets/ape-turn.mp4 the rendered 3D turnaround with the background
                             removed (colour on top, alpha matte below, one
                             MP4 that plays everywhere) — dragging scrubs the
                             turn, letting go spins it on its own
     3. a holographic standee built from the character art
   All three sit on the same neon platform with rising sparks.
============================================================================ */
import * as THREE from 'three';
import { GLTFLoader } from '/js/vendor/loaders/GLTFLoader.js';

(() => {
  'use strict';
  const wrap = document.getElementById('heroCharWrap'); if (!wrap) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MODEL_URL = '/assets/ape.glb';
  const VIDEO_URL = innerWidth < 700 ? '/assets/ape-turn-sm.mp4' : '/assets/ape-turn.mp4';
  const VIDEO_ASPECT = 880 / 1280;
  const POSES = [
    { src: '/assets/ape-1-arms-crossed.webp', w: 595, h: 1400 },
    { src: '/assets/ape-4-point.webp', w: 662, h: 1400 },
    { src: '/assets/ape-5-walk.webp', w: 548, h: 1400 },
    { src: '/assets/ape-2-jump.webp', w: 908, h: 1400 },
  ];
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement; canvas.className = 'hero__gl'; canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas); wrap.classList.add('is-3d');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50); camera.position.set(0, 0.15, 7.2);
  const rig = new THREE.Group(); scene.add(rig);
  const subject = new THREE.Group(); rig.add(subject);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 4, 4); scene.add(key);
  const rimL = new THREE.PointLight(0x8dff1f, 18, 12); rimL.position.set(-3, 1.5, -2.5); scene.add(rimL);
  const rimR = new THREE.PointLight(0xb25cff, 10, 12); rimR.position.set(3, 0.5, -2); scene.add(rimR);

  // ---- platform ---------------------------------------------------------------
  const plat = new THREE.Group(); plat.position.y = -2.05; rig.add(plat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.03, 12, 96), new THREE.MeshBasicMaterial({ color: 0x8dff1f })); ring.rotation.x = Math.PI / 2; plat.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x8dff1f, transparent: true, opacity: 0.4 })); ring2.rotation.x = Math.PI / 2; plat.add(ring2);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64), new THREE.MeshBasicMaterial({ color: 0x8dff1f, transparent: true, opacity: 0.08, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; plat.add(disc);
  const grid = new THREE.GridHelper(3.2, 12, 0x8dff1f, 0x2f6500); grid.material.transparent = true; grid.material.opacity = 0.35; plat.add(grid);
  const N = 90, pos = new Float32Array(N * 3), spd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 3.4; pos[i * 3 + 1] = Math.random() * 4.2 - 2; pos[i * 3 + 2] = (Math.random() - .5) * 3.4; spd[i] = 0.2 + Math.random() * 0.5; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rig.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8dff1f, size: 0.045, transparent: true, opacity: 0.8 })));

  // ---- standee (first thing on screen, and the fallback) ----------------------
  const LAYERS = 14, DEPTH = 0.26; const loader = new THREE.TextureLoader(); const textures = new Map();
  function tex(p) { if (!textures.has(p.src)) { const t = loader.load(p.src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; textures.set(p.src, t); } return textures.get(p.src); }
  let pose = 0, mode = 'standee';
  function clearSubject() { while (subject.children.length) { const o = subject.children[0]; subject.remove(o); o.traverse && o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) [].concat(n.material).forEach(m => m.dispose && m.dispose()); }); } }
  function buildStandee(p) {
    clearSubject(); mode = 'standee';
    const H = 3.7, W = H * p.w / p.h; const t = tex(p);
    for (let i = 0; i < LAYERS; i++) {
      const k = i / (LAYERS - 1); const outer = i === 0 || i === LAYERS - 1;
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: outer ? 0xffffff : new THREE.Color().setHSL(0.26, 0.7, 0.05 + Math.abs(k - .5) * 0.12) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); m.position.z = (k - .5) * DEPTH; if (i === 0) m.scale.x = -1; subject.add(m);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.06, H * 1.04), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, color: 0x8dff1f, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = -DEPTH / 2 - 0.02; subject.add(glow);
    subject.position.set(0, -0.15, 0); subject.scale.setScalar(1);
  }

  // ---- the rendered turnaround video --------------------------------------------
  let video = null, videoMesh = null, videoDur = 0;
  function buildVideo() {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.src = VIDEO_URL;
      const fail = () => reject(new Error('no video'));
      v.addEventListener('error', fail, { once: true });
      v.addEventListener('loadedmetadata', () => { videoDur = v.duration || 0; });
      v.addEventListener('canplay', () => {
        if (mode === 'model') { resolve(); return; }
        const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
        const H = 3.95, W = H * VIDEO_ASPECT;
        const mat = new THREE.ShaderMaterial({
          uniforms: { map: { value: t } }, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: `uniform sampler2D map; varying vec2 vUv;
            void main(){
              vec3 c = texture2D(map, vec2(vUv.x, 0.5 + vUv.y * 0.5)).rgb;   // colour, top half
              float a = texture2D(map, vec2(vUv.x, vUv.y * 0.5)).r;          // matte, bottom half
              if (a < 0.02) discard;
              gl_FragColor = vec4(c, a);
              #include <colorspace_fragment>
            }`
        });
        clearSubject(); mode = 'video'; video = v;
        videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); videoMesh.position.y = plat.position.y + H / 2 + 0.02; subject.add(videoMesh);
        subject.position.set(0, 0, 0); subject.scale.setScalar(1);
        wrap.classList.add('has-video');
        if (!reduced) v.play().catch(() => {});
        resolve();
      }, { once: true });
      v.load();
    });
  }

  // ---- a real model, if there is one ----------------------------------------------
  let mixer = null;
  function fitModel(obj) {
    const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
    obj.scale.setScalar(3.9 / Math.max(size.y, 0.001)); box.setFromObject(obj); box.getCenter(center);
    obj.position.x -= center.x; obj.position.z -= center.z; obj.position.y -= box.min.y; obj.position.y += plat.position.y + 0.02;
  }
  function loadModel() {
    return fetch(MODEL_URL, { method: 'HEAD' }).then(r => { if (!r.ok) throw 0; return new Promise((res, rej) => new GLTFLoader().load(MODEL_URL, res, undefined, rej)); })
      .then(gltf => {
        clearSubject(); mode = 'model'; if (video) { video.pause(); video = null; }
        const model = gltf.scene; model.traverse(n => { if (n.isMesh) n.frustumCulled = false; });
        fitModel(model); subject.add(model); subject.position.set(0, 0, 0); subject.scale.setScalar(1);
        if (gltf.animations && gltf.animations.length && !reduced) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); }
        wrap.classList.add('has-model');
      }).catch(() => {});
  }
  buildStandee(POSES[0]);
  buildVideo().catch(() => {}); loadModel();

  // ---- interaction: drag spins (scrubs the turnaround), let go and it keeps turning
  const SEC_PER_PX = 0.012;          // how much of the turn one pixel of drag is
  let autoSpeed = reduced ? 0 : 0.55, vel = 0, dragging = false, lastX = 0, lastT = 0, idleT = 0, tiltX = 0, tiltTarget = 0, moved = 0;
  let scrubT = 0, scrubVel = 0, lastSeek = 0;
  function seekTo(t) { if (!video || !videoDur) return; const d = videoDur; t = ((t % d) + d) % d; const now = performance.now(); if (now - lastSeek < 40) { scrubT = t; return; } lastSeek = now; scrubT = t; try { video.currentTime = t; } catch (e) {} }
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); dragging = true; moved = 0; lastX = e.clientX; lastT = performance.now(); vel = 0; scrubVel = 0; wrap.classList.add('is-grabbing'); if (video) { video.pause(); scrubT = video.currentTime; } });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return; const dx = e.clientX - lastX; const now = performance.now(); const dt = Math.max(now - lastT, 8); moved += Math.abs(dx); lastX = e.clientX; lastT = now; idleT = 0;
    if (mode === 'video') { scrubVel = dx / dt * 1000 * SEC_PER_PX; seekTo(scrubT + dx * SEC_PER_PX); }
    else { vel = dx / dt * 14; rig.rotation.y += dx * 0.012; }
  });
  const up = () => { if (!dragging) return; dragging = false; wrap.classList.remove('is-grabbing'); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  wrap.addEventListener('click', () => { if (moved > 6 || mode !== 'standee') return; pose = (pose + 1) % POSES.length; buildStandee(POSES[pose]); });
  const hero = document.getElementById('hero');
  if (hero && matchMedia('(hover: hover)').matches) hero.addEventListener('mousemove', e => { const r = hero.getBoundingClientRect(); tiltTarget = ((e.clientY - r.top) / r.height - .5) * -0.35; });

  // ---- loop ---------------------------------------------------------------------
  function resize() { const w = wrap.clientWidth || 300, h = wrap.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); const fit = Math.max(1, 5.2 / (w / h * 4.2)); camera.position.z = 6.1 * Math.min(fit, 1.35); }
  new ResizeObserver(resize).observe(wrap); resize();
  let visible = true; new IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); if (video && !dragging && !reduced) { if (visible && !document.hidden) video.play().catch(() => {}); else video.pause(); } }).observe(wrap);
  document.addEventListener('visibilitychange', () => { if (video && !dragging && !reduced) { if (!document.hidden && visible) video.play().catch(() => {}); else video.pause(); } });
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (mode === 'video') {
      if (!dragging && video) {
        if (Math.abs(scrubVel) > 0.05) { seekTo(scrubT + scrubVel * dt); scrubVel *= 0.93; }
        else if (video.paused && !reduced) { scrubVel = 0; video.play().catch(() => {}); }
      }
      rig.rotation.y = 0;                                   // the turn lives in the video; the rig only tilts
    } else if (!dragging) {
      if (Math.abs(vel) > 0.01) { rig.rotation.y += vel * dt; vel *= 0.94; idleT = 0; }
      else { idleT += dt; rig.rotation.y += autoSpeed * dt * Math.min(idleT / 1.2, 1); }
    }
    tiltX += (tiltTarget - tiltX) * 0.06; rig.rotation.x = tiltX * 0.5;
    if (mode === 'standee') subject.position.y = -0.15 + Math.sin(now / 900) * 0.06;
    if (mixer) mixer.update(dt);
    ring.rotation.z += dt * 0.6; ring2.rotation.z -= dt * 0.3;
    const a = pg.attributes.position.array; for (let i = 0; i < N; i++) { a[i * 3 + 1] += spd[i] * dt; if (a[i * 3 + 1] > 2.3) a[i * 3 + 1] = -2; } pg.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
})();
