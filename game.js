(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const wrap = document.getElementById('wrap');
  const muteBtn = document.getElementById('mute');
  const jumpBtn = document.getElementById('btn-jump');
  const duckBtn = document.getElementById('btn-duck');

  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- World (logical units; the canvas is scaled to fit) ----------
  const H = 260;
  const GROUND_Y = 214;
  const STEP = 1 / 120;

  // ---------- Feel ----------
  const GRAVITY = 2500;
  const JUMP_V = 780;      // full jump when the button is held
  const JUMP_CUT = 250;    // upward speed kept when released early
  const MIN_JUMP_T = 0.1;  // a quick tap still gets this much lift
  const FAST_FALL = 4200;  // extra gravity while holding duck in the air
  const JUMP_BUFFER = 0.12;
  const START_SPEED = 330;
  const MAX_SPEED = 800;
  const ACCEL = 5.5;
  const SCORE_RATE = 0.025;
  const CYCLE = 1200;      // points per full day/night cycle
  const BUG_SCORE = 300;   // flying bugs show up after this

  const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  let W = 640;
  let viewScale = 1;
  let dpr = 1;

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const span = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
    },
  };

  // ---------- Sky palette (day → dusk → night → dawn) ----------
  const DAY   = { top: '#7cc6ee', bot: '#fdf0d4', far: '#a7cfa0', near: '#82b47a', ground: '#ecd095', groundDark: '#cdab70', ink: '#3a3226', stars: 0,    glow: 0 };
  const DUSK  = { top: '#ee8a6e', bot: '#ffd49a', far: '#c98e7e', near: '#a5705f', ground: '#e2b37e', groundDark: '#bc8a58', ink: '#3a2a22', stars: 0.15, glow: 0.35 };
  const NIGHT = { top: '#131a42', bot: '#463b72', far: '#2c365e', near: '#212a4b', ground: '#565079', groundDark: '#423c61', ink: '#efeaff', stars: 1,    glow: 1 };
  const DAWN  = { top: '#d88db1', bot: '#fcd9be', far: '#b49aa8', near: '#8f778b', ground: '#dfbf95', groundDark: '#b99a72', ink: '#3a3226', stars: 0.2,  glow: 0.35 };
  const COLOR_KEYS = ['top', 'bot', 'far', 'near', 'ground', 'groundDark', 'ink'];
  const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const KEYS = [[0, DAY], [0.36, DAY], [0.46, DUSK], [0.56, NIGHT], [0.86, NIGHT], [0.94, DAWN], [1, DAY]].map(([at, p]) => {
    const k = { at, stars: p.stars, glow: p.glow };
    for (const c of COLOR_KEYS) k[c] = toRgb(p[c]);
    return k;
  });

  function paletteAt(c) {
    let i = 0;
    while (i < KEYS.length - 2 && c > KEYS[i + 1].at) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = smooth((c - a.at) / (b.at - a.at));
    const out = { stars: lerp(a.stars, b.stars, t), glow: lerp(a.glow, b.glow, t) };
    for (const k of COLOR_KEYS) {
      out[k] = `rgb(${Math.round(lerp(a[k][0], b[k][0], t))},${Math.round(lerp(a[k][1], b[k][1], t))},${Math.round(lerp(a[k][2], b[k][2], t))})`;
    }
    return out;
  }

  // ---------- Colours ----------
  const DINO = { body: '#56b870', shade: '#3f9a5a', belly: '#e3f5b8', spike: '#ff9a3c', eye: '#1f1f1f', cheek: 'rgba(255,120,120,0.45)' };
  const ROCK = { base: '#a39d92', dark: '#7a746b', light: '#d4cec2' };
  const BUSH = { dark: '#3f7a3a', base: '#58a04c', thorn: '#2c5728', berry: '#e5483f' };
  const CRY = { base: '#a18aff', dark: '#6b54d4', light: '#e1d8ff' };
  const BUG = { shell: '#de4a3c', spot: '#2a1f1f', head: '#2b2727', wing: '#eaf4ff' };

  // ---------- Obstacle types ----------
  const TYPES = {
    pebble:   { w: 28, h: 22, min: 0 },
    boulder:  { w: 42, h: 34, min: 0 },
    crystal:  { w: 22, h: 48, min: 0 },
    bush:     { w: 54, h: 30, min: 60 },
    crystals: { w: 44, h: 46, min: 200 },
    rockpile: { w: 70, h: 32, min: 350 },
  };
  const BUG_LIFTS = [8, 36, 64]; // jump it, duck it, or run under it

  // ---------- State ----------
  let state = 'ready'; // ready | running | paused | over
  let speed = START_SPEED;
  let distance = 0;
  let score = 0;
  let gapLeft = 0;
  let best = Number(store.get('dinojump.best', 0)) || 0;
  let newBest = false;
  let muted = store.get('dinojump.muted', '0') === '1';
  let overT = 0;
  let shakeT = 0;
  let popT = 0;
  let dustT = 0;
  let acc = 0;

  const obstacles = [];
  const particles = [];
  const player = { x: 50, y: GROUND_Y, vy: 0, onGround: true, ducking: false, runT: 0, jumpT: 0, blinkT: 2.5, squashT: 0 };
  const input = { duck: false, jumpHeld: false, jumpBuffer: 0 };

  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 210 + rand(0, 120), y: rand(28, 108), s: rand(0.6, 1.3) }));
  const stars = Array.from({ length: 80 }, () => ({ x: rand(0, 1300), y: rand(0, 160), r: rand(0.5, 1.6), p: rand(0, 6.28) }));

  // ---------- Sizing ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = stage.clientWidth;
    const other = wrap.getBoundingClientRect().height - stage.getBoundingClientRect().height;
    const availH = Math.max(140, window.innerHeight - other - 8);
    W = clamp(cssW * 0.75, 560, 900);
    let cssH = cssW * H / W;
    if (cssH > availH) {
      W = Math.min(1200, cssW * H / availH);
      cssH = cssW * H / W;
    }
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    viewScale = cssW / W;
  }

  // ---------- Sound ----------
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type, vol, slideTo, delay = 0) {
    if (muted || !actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sfx = {
    jump: () => tone(380, 0.13, 'square', 0.045, 760),
    point: () => { tone(880, 0.09, 'triangle', 0.09); tone(1320, 0.14, 'triangle', 0.09, null, 0.08); },
    hit: () => { tone(220, 0.32, 'sawtooth', 0.07, 55); tone(90, 0.25, 'square', 0.05, 40); },
  };

  // ---------- Game flow ----------
  function reset() {
    obstacles.length = 0;
    particles.length = 0;
    speed = START_SPEED;
    distance = 0;
    score = 0;
    gapLeft = W * 0.55;
    newBest = false;
    acc = 0;
    Object.assign(player, { y: GROUND_Y, vy: 0, onGround: true, ducking: false, runT: 0, jumpT: 0, squashT: 0 });
    input.jumpBuffer = 0;
  }

  function startRun() {
    reset();
    state = 'running';
  }

  function pause() {
    if (state === 'running') state = 'paused';
  }

  function resume() {
    if (state === 'paused') { state = 'running'; acc = 0; }
  }

  function die() {
    state = 'over';
    overT = 0;
    shakeT = reduceMotion ? 0 : 0.28;
    input.jumpBuffer = 0;
    const s = Math.floor(score);
    newBest = s > best;
    if (newBest) { best = s; store.set('dinojump.best', best); }
    sfx.hit();
    const cx = player.x + 26;
    const cy = player.y - (player.ducking ? 12 : 26);
    for (let i = 0; i < 16; i++) {
      particles.push({
        x: cx, y: cy, vx: rand(-170, 170), vy: rand(-280, -60), g: 900,
        life: rand(0.5, 0.9), max: 0.9, r: rand(1.5, 3.5),
        c: pick([DINO.body, DINO.spike, DINO.belly]),
      });
    }
  }

  // ---------- Input ----------
  function pressJump() {
    ensureAudio();
    input.jumpHeld = true;
    if (state === 'ready') { startRun(); input.jumpBuffer = JUMP_BUFFER; return; }
    if (state === 'paused') { resume(); return; }
    if (state === 'over') { if (overT > 0.45) startRun(); return; }
    input.jumpBuffer = JUMP_BUFFER;
  }

  function releaseJump() {
    input.jumpHeld = false;
  }

  function setDuck(on) {
    if (on) ensureAudio();
    input.duck = on;
  }

  function togglePause() {
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  }

  function syncMute() {
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
  }

  function toggleMute() {
    muted = !muted;
    store.set('dinojump.muted', muted ? '1' : '0');
    syncMute();
  }

  const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  const DUCK_KEYS = new Set(['ArrowDown', 'KeyS']);

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (JUMP_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) pressJump();
    } else if (DUCK_KEYS.has(e.code)) {
      e.preventDefault();
      setDuck(true);
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      togglePause();
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.has(e.code)) releaseJump();
    else if (DUCK_KEYS.has(e.code)) setDuck(false);
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pressJump();
  });
  stage.addEventListener('pointerup', releaseJump);
  stage.addEventListener('pointercancel', releaseJump);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  function holdButton(btn, down, up) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      btn.classList.add('active');
      down();
    });
    const end = () => { btn.classList.remove('active'); up(); };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  holdButton(jumpBtn, pressJump, releaseJump);
  holdButton(duckBtn, () => setDuck(true), () => setDuck(false));

  muteBtn.addEventListener('click', () => { toggleMute(); muteBtn.blur(); });

  function releaseAll() {
    input.duck = false;
    input.jumpHeld = false;
    jumpBtn.classList.remove('active');
    duckBtn.classList.remove('active');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); pause(); }
  });
  window.addEventListener('blur', () => { releaseAll(); pause(); });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ---------- Simulation ----------
  function spawn() {
    let o;
    if (score > BUG_SCORE && Math.random() < 0.25) {
      const lift = pick(BUG_LIFTS);
      const vx = rand(40, 80);
      // Bugs fly a little faster than the ground scrolls; start them further
      // out so they arrive about when a ground obstacle would have.
      const lead = vx * (W - player.x) / speed;
      o = { kind: 'bug', w: 40, h: 26, x: W + 20 + lead, y: GROUND_Y - lift - 26, vx, t: rand(0, 10) };
    } else {
      const kinds = Object.keys(TYPES).filter((k) => score >= TYPES[k].min);
      const kind = pick(kinds);
      const t = TYPES[kind];
      o = { kind, w: t.w, h: t.h, x: W + 20, y: GROUND_Y - t.h, vx: 0, t: 0 };
    }
    obstacles.push(o);
    gapLeft = o.w + (speed * 0.72 + 110) * (1 + Math.random() * 0.85);
  }

  function playerBoxes() {
    const { x, y } = player;
    if (player.ducking) return [{ x: x + 6, y: y - 22, w: 50, h: 21 }];
    return [
      { x: x + 10, y: y - 34, w: 24, h: 33 }, // body + legs
      { x: x + 27, y: y - 46, w: 20, h: 14 }, // head
    ];
  }

  function obstacleBoxes(o) {
    const { x, y, w, h } = o;
    switch (o.kind) {
      case 'crystal': return [{ x: x + 4, y: y + 8, w: w - 8, h: h - 8 }];
      case 'crystals': return [{ x: x + 3, y: y + 8, w: 14, h: h - 8 }, { x: x + 27, y: y + 22, w: 12, h: h - 22 }];
      case 'rockpile': return [{ x: x + 3, y: y + 14, w: w - 6, h: h - 14 }, { x: x + 21, y: y + 3, w: 26, h: h - 3 }];
      case 'bug': return [{ x: x + 3, y: y + 8, w: 33, h: 16 }];
      default: return [{ x: x + 4, y: y + 4, w: w - 8, h: h - 4 }];
    }
  }

  function puff() {
    particles.push({
      x: player.x + 12, y: GROUND_Y - 2, vx: -speed * 0.2 - rand(0, 30), vy: rand(-40, -15), g: 0,
      life: 0.35, max: 0.35, r: rand(1.5, 3.2), c: null,
    });
  }

  function landDust() {
    for (let i = 0; i < 7; i++) {
      particles.push({
        x: player.x + rand(10, 36), y: GROUND_Y - 1, vx: rand(-90, 60) - speed * 0.15, vy: rand(-55, -15), g: 120,
        life: 0.4, max: 0.4, r: rand(1.5, 3), c: null,
      });
    }
  }

  function update(dt) {
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    distance += speed * dt;
    const prev = score;
    score = distance * SCORE_RATE;
    if (Math.floor(score / 100) > Math.floor(prev / 100)) { popT = 0.5; sfx.point(); }

    const p = player;
    if (input.jumpBuffer > 0) input.jumpBuffer -= dt;
    if (p.onGround && input.jumpBuffer > 0) {
      p.vy = -JUMP_V;
      p.onGround = false;
      p.jumpT = 0;
      input.jumpBuffer = 0;
      sfx.jump();
    }

    if (!p.onGround) {
      p.jumpT += dt;
      if (!input.jumpHeld && p.jumpT >= MIN_JUMP_T && p.vy < -JUMP_CUT) p.vy = -JUMP_CUT;
      p.vy += (GRAVITY + (input.duck ? FAST_FALL : 0)) * dt;
      p.y += p.vy * dt;
      if (p.y >= GROUND_Y) {
        p.y = GROUND_Y;
        p.vy = 0;
        p.onGround = true;
        p.squashT = 0.12;
        landDust();
      }
    }
    p.ducking = input.duck && p.onGround;

    if (p.onGround) {
      p.runT += dt * (4 + speed / 110);
      dustT -= dt;
      if (dustT <= 0) { dustT = 0.08; puff(); }
    }

    for (const o of obstacles) {
      o.x -= (speed + o.vx) * dt;
      o.t += dt;
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      if (obstacles[i].x + obstacles[i].w < -30) obstacles.splice(i, 1);
    }

    gapLeft -= speed * dt;
    if (gapLeft <= 0) spawn();

    const pb = playerBoxes();
    for (const o of obstacles) {
      if (o.x > p.x + 70 || o.x + o.w < p.x - 10) continue;
      for (const ob of obstacleBoxes(o)) {
        for (const b of pb) {
          if (overlap(ob, b)) { die(); return; }
        }
      }
    }
  }

  function ambient(dt) {
    const p = player;
    p.blinkT -= dt;
    if (p.blinkT < 0) p.blinkT = rand(2.5, 5);
    if (state === 'paused') return;

    if (p.squashT > 0) p.squashT -= dt;
    overT += dt;
    popT = Math.max(0, popT - dt);
    shakeT = Math.max(0, shakeT - dt);

    const scroll = state === 'running' ? speed * 0.06 : 0;
    for (const c of clouds) {
      c.x -= (scroll + 8 * c.s) * dt;
      if (c.x < -70) {
        c.x = W + rand(40, 220);
        c.y = rand(28, 108);
        c.s = rand(0.6, 1.3);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0) particles.splice(i, 1);
    }
  }

  // ---------- Drawing primitives ----------
  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const circle = (x, y, r, color) => ellipse(x, y, r, r, color);

  function rrect(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function poly(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function line(x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // ---------- Scenery ----------
  function drawSky(pal, c, clock) {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bot);
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, W + 20, GROUND_Y + 20);

    if (pal.stars > 0.01) {
      for (const s of stars) {
        if (s.x > W) continue;
        ctx.globalAlpha = pal.stars * (0.55 + 0.45 * Math.sin(clock * 2 + s.p));
        circle(s.x, s.y, s.r, '#ffffff');
      }
      ctx.globalAlpha = 1;
    }

    // Sun sets around dusk and rises again at dawn
    const sunY = c < 0.6 ? 52 + smooth(span(c, 0.28, 0.5)) * 190 : 242 - smooth(span(c, 0.9, 1)) * 190;
    if (sunY < GROUND_Y + 20) {
      const sx = W * 0.78;
      ctx.globalAlpha = 0.25;
      circle(sx, sunY, 30, '#fff3c4');
      ctx.globalAlpha = 1;
      circle(sx, sunY, 18, '#fff1b8');
    }

    const moonY = c < 0.75 ? 242 - smooth(span(c, 0.48, 0.62)) * 180 : 62 + smooth(span(c, 0.84, 0.96)) * 180;
    if (moonY < GROUND_Y + 20) {
      const mx = W * 0.24;
      ctx.globalAlpha = 0.18;
      circle(mx, moonY, 24, '#e9e4ff');
      ctx.globalAlpha = 1;
      circle(mx, moonY, 13, '#f3efe2');
      circle(mx - 4, moonY - 3, 2.6, '#ddd6c2');
      circle(mx + 4, moonY + 4, 1.8, '#ddd6c2');
      circle(mx + 3, moonY - 5, 1.3, '#ddd6c2');
    }

    ctx.globalAlpha = 0.9 - pal.stars * 0.62;
    for (const cl of clouds) {
      const { x, y, s } = cl;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, y, 24 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 9 * s, y - 4 * s, 10 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 6 * s, y - 7 * s, 12 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHills(color, base, a1, f1, a2, f2, off, phase) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, GROUND_Y + 1);
    for (let x = -10; x <= W + 18; x += 8) {
      const wx = x + off;
      ctx.lineTo(x, base - Math.sin(wx * f1 + phase) * a1 - Math.sin(wx * f2 + phase * 2.1) * a2);
    }
    ctx.lineTo(W + 18, GROUND_Y + 1);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround(pal) {
    ctx.fillStyle = pal.ground;
    ctx.fillRect(-10, GROUND_Y, W + 20, H - GROUND_Y + 10);
    ctx.fillStyle = pal.groundDark;
    ctx.fillRect(-10, GROUND_Y, W + 20, 2);

    const tile = 34;
    const first = Math.floor(distance / tile);
    for (let i = first; i * tile - distance < W + tile; i++) {
      const sx = i * tile - distance;
      const r = hash(i);
      if (r < 0.45) {
        ellipse(sx + hash(i + 0.3) * tile, GROUND_Y + 9 + hash(i + 0.5) * 32, 1.5 + hash(i + 0.7) * 2.5, 1 + hash(i + 0.9) * 1.3, pal.groundDark);
      } else if (r < 0.62) {
        ctx.fillStyle = pal.groundDark;
        ctx.fillRect(sx, GROUND_Y + 7 + hash(i + 0.2) * 30, 6 + hash(i + 0.4) * 10, 1.5);
      }
      if (hash(i + 0.33) < 0.22) {
        const tx = sx + hash(i + 0.66) * tile;
        ctx.strokeStyle = pal.near;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, GROUND_Y + 1); ctx.lineTo(tx - 3, GROUND_Y - 4);
        ctx.moveTo(tx + 2, GROUND_Y + 1); ctx.lineTo(tx + 2, GROUND_Y - 6);
        ctx.moveTo(tx + 4, GROUND_Y + 1); ctx.lineTo(tx + 7, GROUND_Y - 4);
        ctx.stroke();
      }
    }
  }

  // ---------- Obstacles ----------
  function drawRock(cx, top, rx, h) {
    const ry = h / 1.75;
    const cy = top + ry;
    ellipse(cx, cy, rx, ry, ROCK.dark);
    ellipse(cx - rx * 0.1, cy - ry * 0.06, rx * 0.88, ry * 0.92, ROCK.base);
    ellipse(cx - rx * 0.38, cy - ry * 0.45, rx * 0.28, ry * 0.16, ROCK.light);
  }

  function drawCrystal(x, top, w, h, glow) {
    const cx = x + w / 2;
    const sh = Math.min(12, h * 0.28);
    const bottom = GROUND_Y + 2;
    if (glow > 0.02) {
      const g = ctx.createRadialGradient(cx, top + h * 0.5, 2, cx, top + h * 0.5, h * 0.9);
      g.addColorStop(0, `rgba(170,140,255,${0.45 * glow})`);
      g.addColorStop(1, 'rgba(170,140,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - h, top - h * 0.4, h * 2, h * 1.8);
    }
    poly([[cx, top], [x + w, top + sh], [x + w - 1, bottom], [x + 1, bottom], [x, top + sh]], CRY.dark);
    poly([[cx, top], [cx + 1, bottom], [x + 1, bottom], [x, top + sh]], CRY.base);
    poly([[cx - 1, top + 4], [cx - w * 0.24, top + sh + 1], [cx - w * 0.2, top + h * 0.7], [cx - 1, top + h * 0.58]], CRY.light);
  }

  function drawBush(x, y) {
    const blobs = [[x + 14, y + 20, 12, [125, 165]], [x + 27, y + 13, 13, [60, 95, 130]], [x + 40, y + 19, 13, [15, 50]]];
    for (const [cx, cy, r, angles] of blobs) {
      for (const deg of angles) {
        const a = deg * Math.PI / 180;
        line(cx + Math.cos(a) * (r - 1), cy - Math.sin(a) * (r - 1), cx + Math.cos(a) * (r + 4), cy - Math.sin(a) * (r + 4), BUSH.thorn, 2);
      }
    }
    for (const [cx, cy, r] of blobs) circle(cx, cy, r, BUSH.dark);
    for (const [cx, cy, r] of blobs) circle(cx - 1.5, cy - 2, r - 3, BUSH.base);
    circle(x + 20, y + 17, 2.4, BUSH.berry);
    circle(x + 33, y + 11, 2.2, BUSH.berry);
    circle(x + 43, y + 21, 2.4, BUSH.berry);
  }

  function drawBug(o) {
    const { x, y } = o;
    const f = Math.sin(o.t * 38);
    // wings
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = BUG.wing;
    ctx.beginPath();
    ctx.ellipse(x + 25, y + 6, 12, 3 + Math.abs(f) * 4, -0.35 + f * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // legs
    const k = Math.sin(o.t * 20) * 1.5;
    line(x + 15, y + 23, x + 13 + k, y + 28, BUG.head, 1.6);
    line(x + 22, y + 24, x + 21 - k, y + 29, BUG.head, 1.6);
    line(x + 29, y + 23, x + 29 + k, y + 28, BUG.head, 1.6);
    // shell
    ellipse(x + 22, y + 16, 15, 9.5, BUG.shell);
    ellipse(x + 19, y + 11, 7, 2.5, 'rgba(255,255,255,0.35)');
    circle(x + 18, y + 14, 2.2, BUG.spot);
    circle(x + 27, y + 12, 2, BUG.spot);
    circle(x + 24, y + 20, 2.2, BUG.spot);
    circle(x + 32, y + 18, 1.8, BUG.spot);
    // head
    circle(x + 8, y + 17, 6.5, BUG.head);
    circle(x + 5.5, y + 15.5, 1.9, '#ffffff');
    ctx.strokeStyle = BUG.head;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 11); ctx.quadraticCurveTo(x + 3, y + 5, x - 1, y + 5);
    ctx.moveTo(x + 9, y + 11); ctx.quadraticCurveTo(x + 8, y + 4, x + 4, y + 2);
    ctx.stroke();
  }

  function drawObstacles(pal) {
    // soft shadows on the ground
    for (const o of obstacles) {
      ctx.globalAlpha = o.kind === 'bug' ? 0.08 : 0.16;
      ellipse(o.x + o.w / 2, GROUND_Y + 2, o.w * (o.kind === 'bug' ? 0.35 : 0.55), 3, '#000000');
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, W + 20, GROUND_Y + 11.5);
    ctx.clip();
    for (const o of obstacles) {
      const { x, y, w, h } = o;
      switch (o.kind) {
        case 'pebble': drawRock(x + w / 2, y, w / 2, h); break;
        case 'boulder': drawRock(x + w / 2, y, w / 2, h); break;
        case 'rockpile':
          drawRock(x + 34, y, 16, h);
          drawRock(x + 16, y + 12, 16, h - 12);
          drawRock(x + 52, y + 8, 18, h - 8);
          break;
        case 'crystal': drawCrystal(x, y, w, h, pal.glow); break;
        case 'crystals':
          drawCrystal(x + 24, y + 16, 18, h - 16, pal.glow);
          drawCrystal(x, y, 20, h, pal.glow);
          break;
        case 'bush': drawBush(x, y); break;
        case 'bug': drawBug(o); break;
      }
    }
    ctx.restore();
  }

  // ---------- Dino ----------
  function spikes(cx, cy, rx, ry, angles, size) {
    ctx.fillStyle = DINO.spike;
    for (const deg of angles) {
      const a = deg * Math.PI / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const px = cx + rx * c;
      const py = cy - ry * s;
      ctx.beginPath();
      ctx.moveTo(px + s * size * 0.6, py + c * size * 0.6);
      ctx.lineTo(px + c * size, py - s * size);
      ctx.lineTo(px - s * size * 0.6, py - c * size * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  function leg(x, top, lift, color) {
    rrect(x, top, 7, -top - lift, 3, color);
    rrect(x, -lift - 4, 10, 4, 2, color);
  }

  function face(f, dead, blink) {
    const [ex, ey, r] = f.eye;
    ellipse(f.cheek[0], f.cheek[1], 3, 2, DINO.cheek);
    if (dead) {
      ctx.strokeStyle = DINO.eye;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 2.8, ey - 2.8); ctx.lineTo(ex + 2.8, ey + 2.8);
      ctx.moveTo(ex + 2.8, ey - 2.8); ctx.lineTo(ex - 2.8, ey + 2.8);
      ctx.stroke();
    } else if (blink) {
      ctx.strokeStyle = DINO.eye;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 3.4, ey);
      ctx.quadraticCurveTo(ex, ey + 2.2, ex + 3.4, ey);
      ctx.stroke();
    } else {
      circle(ex, ey, r, '#ffffff');
      circle(ex + r * 0.3, ey, r * 0.55, DINO.eye);
      circle(ex + r * 0.45, ey - r * 0.32, r * 0.2, '#ffffff');
    }
    circle(f.nose[0], f.nose[1], 1.1, DINO.shade);
    const [mx1, my1, mx2, my2] = f.mouth;
    if (dead) {
      ellipse((mx1 + mx2) / 2 + 1, my1, 2.6, 2.2, DINO.shade);
    } else {
      ctx.strokeStyle = DINO.shade;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mx1, my1);
      ctx.quadraticCurveTo((mx1 + mx2) / 2, my1 + 2.5, mx2, my2);
      ctx.stroke();
    }
  }

  function drawStanding(a, b, dead, blink) {
    leg(13, -14, b, DINO.shade);
    ctx.fillStyle = DINO.body;
    ctx.beginPath();
    ctx.moveTo(14, -32);
    ctx.quadraticCurveTo(2, -31, -3, -21);
    ctx.quadraticCurveTo(5, -18, 14, -13);
    ctx.closePath();
    ctx.fill();
    spikes(22, -23, 14, 13, [160, 132, 105], 5);
    spikes(31, -31, 7, 9, [128], 4.5);
    spikes(37, -38, 13, 10, [112], 4);
    ellipse(22, -23, 14, 13, DINO.body);
    ellipse(31, -31, 7, 9, DINO.body);
    ellipse(37, -38, 13, 10, DINO.body);
    ellipse(25, -19, 8, 9, DINO.belly);
    leg(24, -12, a, DINO.body);
    line(30, -23, 34, -19, DINO.shade, 3.5);
    face({ eye: [40, -41, 4.2], nose: [47.5, -40], mouth: [41, -33, 48, -34], cheek: [35, -34] }, dead, blink);
  }

  function drawDucking(a, b, dead, blink) {
    leg(14, -7, b, DINO.shade);
    ctx.fillStyle = DINO.body;
    ctx.beginPath();
    ctx.moveTo(10, -18);
    ctx.quadraticCurveTo(0, -17, -5, -11);
    ctx.quadraticCurveTo(2, -8, 10, -7);
    ctx.closePath();
    ctx.fill();
    spikes(25, -13, 19, 10, [155, 125, 98], 4.5);
    ellipse(25, -13, 19, 10, DINO.body);
    ellipse(37, -14, 6, 7, DINO.body);
    ellipse(47, -15, 12, 9, DINO.body);
    ellipse(28, -9, 10, 5.5, DINO.belly);
    leg(28, -7, a, DINO.body);
    line(37, -7, 40, -4, DINO.shade, 3);
    face({ eye: [50, -18, 3.8], nose: [57, -17], mouth: [51, -11, 57.5, -12], cheek: [46, -12] }, dead, blink);
  }

  function drawDino() {
    const p = player;
    const air = !p.onGround;
    const dead = state === 'over';

    // shadow shrinks as the dino rises
    const k = Math.max(0.35, 1 - (GROUND_Y - p.y) / 160);
    ctx.globalAlpha = 0.18 * k;
    ellipse(p.x + (p.ducking ? 28 : 22), GROUND_Y + 1.5, (p.ducking ? 27 : 19) * k, 3.5 * k, '#000000');
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(p.x, p.y);
    let sx = 1;
    let sy = 1;
    if (p.squashT > 0 && !dead) {
      const q = p.squashT / 0.12;
      sx = 1 + 0.1 * q;
      sy = 1 - 0.1 * q;
    } else if (air && !dead) {
      const q = clamp(-p.vy / JUMP_V, 0, 1) * 0.08;
      sx = 1 - q;
      sy = 1 + q;
    }
    if (sx !== 1) {
      ctx.translate(25, 0);
      ctx.scale(sx, sy);
      ctx.translate(-25, 0);
    }

    let a = 0;
    let b = 0;
    if (state === 'running' && !air) {
      const s = Math.sin(p.runT * Math.PI * 2);
      a = Math.max(0, s) * 5;
      b = Math.max(0, -s) * 5;
    } else if (air) {
      a = 4;
      b = 1.5;
    }
    const blink = p.blinkT < 0.12;
    if (p.ducking) drawDucking(a * 0.6, b * 0.6, dead, blink);
    else drawStanding(a, b, dead, blink);
    ctx.restore();
  }

  function drawParticles(pal) {
    for (const q of particles) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      circle(q.x, q.y, q.r, q.c || pal.groundDark);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD & overlays ----------
  const pad5 = (n) => String(Math.floor(n)).padStart(5, '0');

  function drawHUD(pal) {
    ctx.fillStyle = pal.ink;
    ctx.font = `700 17px ${FONT}`;
    ctx.textBaseline = 'middle';
    const slot = ctx.measureText('00000').width;
    const k = popT > 0 ? 1 + 0.25 * Math.sin((1 - popT / 0.5) * Math.PI) : 1;
    ctx.save();
    ctx.translate(W - 18 - slot / 2, 24);
    ctx.scale(k, k);
    ctx.textAlign = 'center';
    ctx.fillText(pad5(score), 0, 0);
    ctx.restore();
    if (best > 0) {
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'right';
      ctx.fillText(`BEST ${pad5(best)}`, W - 18 - slot - 18, 24);
      ctx.globalAlpha = 1;
    }
  }

  function drawPanel(lines, pal) {
    const night = pal.stars > 0.5;
    const fg = night ? '#f3f0ff' : '#3a3226';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let maxW = 0;
    let totalH = 0;
    for (const l of lines) {
      ctx.font = `${l.weight || 700} ${l.size}px ${FONT}`;
      maxW = Math.max(maxW, ctx.measureText(l.text).width);
      totalH += l.size * 1.55;
    }
    const pw = maxW + 48;
    const ph = totalH + 22;
    const px = W / 2 - pw / 2;
    const py = 98 - ph / 2;
    rrect(px, py, pw, ph, 14, night ? 'rgba(14,16,40,0.66)' : 'rgba(255,253,247,0.84)');
    let y = py + 11;
    for (const l of lines) {
      const lh = l.size * 1.55;
      ctx.font = `${l.weight || 700} ${l.size}px ${FONT}`;
      ctx.globalAlpha = l.alpha ?? 1;
      ctx.fillStyle = l.color || fg;
      ctx.fillText(l.text, W / 2, y + lh / 2);
      y += lh;
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(pal) {
    if (state === 'ready') {
      drawPanel([
        { text: isTouch ? 'Tap to run' : 'Press Space to run', size: 21 },
        { text: 'Jump rocks and crystals · duck the bugs', size: 13, weight: 500, alpha: 0.75 },
      ], pal);
    } else if (state === 'paused') {
      drawPanel([
        { text: 'Paused', size: 21 },
        { text: isTouch ? 'Tap to keep going' : 'Press P or Space to keep going', size: 13, weight: 500, alpha: 0.75 },
      ], pal);
    } else if (state === 'over') {
      const lines = [
        { text: 'Bonk!', size: 24 },
        { text: `Score ${Math.floor(score)}   ·   Best ${best}`, size: 14, weight: 600 },
      ];
      if (newBest) lines.push({ text: 'New best!', size: 14, color: '#3f9a5a' });
      lines.push({ text: isTouch ? 'Tap to play again' : 'Press Space to play again', size: 13, weight: 500, alpha: 0.75 * span(overT, 0.35, 0.6) });
      drawPanel(lines, pal);
    }
  }

  // ---------- Render ----------
  function render(clock) {
    const c = (score / CYCLE) % 1;
    const pal = paletteAt(c);
    ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0);

    ctx.save();
    if (shakeT > 0) {
      const m = (shakeT / 0.28) * 4;
      ctx.translate(rand(-m, m), rand(-m, m));
    }
    drawSky(pal, c, clock);
    drawHills(pal.far, 152, 18, 0.0065, 8, 0.019, distance * 0.1, 0.4);
    drawHills(pal.near, 186, 12, 0.011, 6, 0.027, distance * 0.28, 2);
    drawGround(pal);
    drawObstacles(pal);
    drawDino();
    drawParticles(pal);
    ctx.restore();

    drawHUD(pal);
    drawOverlay(pal);
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'running') {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
        if (state !== 'running') { acc = 0; break; }
      }
    }
    ambient(dt);
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  syncMute();
  resize();
  reset();
  requestAnimationFrame(frame);
})();
