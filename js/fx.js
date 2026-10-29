// 粒子特效（Canvas）
(function () {
  const SGS = globalThis.SGS;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  const PALETTE = {
    normal: ['#fff3c4', '#ffd36b', '#ff6b4a', '#ffffff'],
    fire: ['#fff1a8', '#ffb43a', '#ff6a1a', '#e2361b'],
    thunder: ['#ffffff', '#d7c8ff', '#9a7bff', '#6fd8ff'],
    blood: ['#ff4d4d', '#d81e1e', '#8f0f0f', '#ff8a6a'],
    heal: ['#d8ffb0', '#8cf06e', '#3fcf6b', '#fff6a0'],
    dodge: ['#e8fbff', '#9fe8ff', '#53c3ff', '#ffffff'],
    gold: ['#fff4c2', '#ffd66b', '#e8a93a', '#ffffff'],
    ash: ['#c9c2b8', '#8a8178', '#5c554e'],
    ink: ['#2b2b2b', '#444', '#111'],
    chain: ['#e6e6e6', '#a9b3bd', '#6d7782'],
  };

  // 预渲染发光精灵
  const spriteCache = new Map();
  function sprite(color) {
    if (spriteCache.has(color)) return spriteCache.get(color);
    const s = 64;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = c.height = s;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, color);
    g.addColorStop(0.5, color + '55');
    g.addColorStop(1, color + '00');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    spriteCache.set(color, c);
    return c;
  }

  class FX {
    constructor(canvas, w, h) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = w;
      this.h = h;
      canvas.width = w;
      canvas.height = h;
      this.parts = [];
      this.effects = [];
      this.ambient = [];
      for (let i = 0; i < 46; i++) this.ambient.push(this.newEmber(true));
      this.last = performance.now();
      this.ambientOn = true;
      const loop = (t) => {
        this.frame(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    newEmber(init) {
      return {
        x: rand(0, this.w),
        y: init ? rand(0, this.h) : this.h + 10,
        vx: rand(-6, 6),
        vy: rand(-22, -8),
        size: rand(1, 2.6),
        a: rand(0.15, 0.55),
        ph: rand(0, TAU),
        color: Math.random() < 0.8 ? '#ffb45a' : '#ffe2a0',
      };
    }
    frame(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';
      // 环境余烬
      if (this.ambientOn)
        for (const e of this.ambient) {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.ph += dt * 2;
          if (e.y < -10) Object.assign(e, this.newEmber(false));
          const a = e.a * (0.6 + 0.4 * Math.sin(e.ph));
          const sp = sprite(e.color);
          ctx.globalAlpha = a;
          const s = e.size * 6;
          ctx.drawImage(sp, e.x - s / 2, e.y - s / 2, s, s);
        }
      // 自定义特效
      this.effects = this.effects.filter((ef) => {
        ef.t += dt;
        const k = ef.t / ef.life;
        if (k >= 1) {
          ef.done && ef.done();
          return false;
        }
        ef.draw(ctx, k, dt);
        return true;
      });
      // 粒子
      ctx.globalCompositeOperation = 'lighter';
      this.parts = this.parts.filter((p) => {
        p.t += dt;
        if (p.t >= p.life) return false;
        p.vx *= 1 - p.drag * dt;
        p.vy *= 1 - p.drag * dt;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.t / p.life;
        const a = (1 - k) * p.alpha;
        if (p.shape === 'spark') {
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
          ctx.stroke();
        } else if (p.shape === 'smoke') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = a * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k * 2), 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
        } else if (p.shape === 'flame') {
          const cols = PALETTE.fire;
          const col = cols[Math.min(cols.length - 1, Math.floor(k * cols.length))];
          ctx.globalAlpha = a;
          const s = p.size * (1.4 - k) * 5;
          ctx.drawImage(sprite(col), p.x - s / 2, p.y - s / 2, s, s);
        } else if (p.shape === 'arrow') {
          ctx.globalAlpha = Math.min(1, a * 1.5);
          const ang = Math.atan2(p.vy, p.vx);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.strokeStyle = '#f5e2b8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-34, 0);
          ctx.lineTo(0, 0);
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(4, 0);
          ctx.lineTo(-6, -4);
          ctx.lineTo(-6, 4);
          ctx.fill();
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(-36, -3, 7, 6);
          ctx.restore();
        } else {
          ctx.globalAlpha = a;
          const s = p.size * 6;
          ctx.drawImage(sprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
        }
        return true;
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    emit(x, y, o = {}) {
      const n = o.n || 20;
      const cols = o.colors || PALETTE.gold;
      for (let i = 0; i < n; i++) {
        const ang = o.angle != null ? o.angle + rand(-(o.spread || 0.5), o.spread || 0.5) : rand(0, TAU);
        const sp = rand(o.speed ? o.speed * 0.3 : 40, o.speed || 220);
        this.parts.push({
          x: x + rand(-(o.jitter || 0), o.jitter || 0),
          y: y + rand(-(o.jitter || 0), o.jitter || 0),
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp + (o.vy || 0),
          g: o.gravity || 0,
          drag: o.drag != null ? o.drag : 2,
          life: rand((o.life || 0.8) * 0.6, o.life || 0.8),
          t: 0,
          size: rand((o.size || 3) * 0.5, o.size || 3),
          color: cols[Math.floor(Math.random() * cols.length)],
          alpha: o.alpha || 1,
          shape: o.shape || 'dot',
        });
      }
    }
    add(life, draw, done) {
      this.effects.push({ t: 0, life, draw, done });
    }

    // ---------- 组合特效 ----------
    slash(a, b, nature) {
      const cols = PALETTE[nature || 'normal'];
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len,
        ny = dx / len;
      const cx = mx + nx * len * 0.22,
        cy = my + ny * len * 0.22;
      const pt = (t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
      return new Promise((res) => {
        this.add(
          0.42,
          (ctx, k) => {
            const head = Math.min(1, k * 1.6);
            const tail = Math.max(0, head - 0.45);
            ctx.globalCompositeOperation = 'lighter';
            const N = 24;
            for (let i = 0; i < N; i++) {
              const t0 = tail + ((head - tail) * i) / N,
                t1 = tail + ((head - tail) * (i + 1)) / N;
              const p0 = pt(t0),
                p1 = pt(t1);
              const w = (i / N) * 9 * (1 - Math.max(0, k - 0.6) * 2.5);
              ctx.globalAlpha = 0.25 + (i / N) * 0.75;
              ctx.strokeStyle = cols[i > N * 0.8 ? 0 : i > N * 0.4 ? 1 : 2];
              ctx.lineWidth = Math.max(0.5, w);
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(p0.x, p0.y);
              ctx.lineTo(p1.x, p1.y);
              ctx.stroke();
            }
            if (head < 1) {
              const h = pt(head);
              const s = 46;
              ctx.globalAlpha = 0.9;
              ctx.drawImage(sprite(cols[1]), h.x - s / 2, h.y - s / 2, s, s);
              if (nature === 'fire') this.emit(h.x, h.y, { n: 2, shape: 'flame', speed: 40, life: 0.5, size: 3 });
              if (nature === 'thunder' && Math.random() < 0.5) this.emit(h.x, h.y, { n: 2, colors: cols, shape: 'spark', speed: 260, life: 0.25, size: 1.5 });
            }
          }
        );
        // 用定时器结算，避免后台标签页暂停 rAF 时阻塞游戏流程
        setTimeout(res, 430);
        setTimeout(() => {
          this.emit(b.x, b.y, { n: 26, colors: cols, shape: 'spark', speed: 420, life: 0.45, size: 2, drag: 4 });
        }, 260);
      });
    }
    hit(p, nature, big) {
      const n = big ? 60 : 36;
      if (nature === 'fire') {
        this.emit(p.x, p.y, { n, shape: 'flame', speed: 160, life: 0.9, size: 5, vy: -60, jitter: 20 });
        this.emit(p.x, p.y, { n: 14, shape: 'smoke', colors: ['#3a2a20', '#2a2a2a'], speed: 60, life: 1.4, size: 16, vy: -40, drag: 1 });
      } else if (nature === 'thunder') {
        this.emit(p.x, p.y, { n, colors: PALETTE.thunder, shape: 'spark', speed: 520, life: 0.5, size: 2, drag: 5 });
        this.ring(p, { color: '#a88bff', r1: 120, life: 0.5, width: 5 });
      } else {
        this.emit(p.x, p.y, { n, colors: PALETTE.blood, speed: 300, life: 0.75, size: 4, gravity: 420, drag: 2.5 });
        this.emit(p.x, p.y, { n: 18, colors: PALETTE.normal, shape: 'spark', speed: 480, life: 0.35, size: 2, drag: 5 });
      }
      this.ring(p, { color: nature === 'fire' ? '#ff7a2a' : nature === 'thunder' ? '#b49cff' : '#ff4040', r1: 90, life: 0.4, width: 6 });
    }
    heal(p) {
      this.emit(p.x, p.y + 30, { n: 34, colors: PALETTE.heal, speed: 70, life: 1.4, size: 3.5, vy: -90, drag: 0.6, jitter: 40 });
      this.ring(p, { color: '#7dff9a', r1: 100, life: 0.8, width: 4 });
    }
    dodge(p) {
      this.ring(p, { color: '#8fe6ff', r0: 20, r1: 110, life: 0.55, width: 7 });
      this.ring(p, { color: '#ffffff', r0: 10, r1: 70, life: 0.4, width: 3 });
      this.emit(p.x, p.y, { n: 24, colors: PALETTE.dodge, shape: 'spark', speed: 300, life: 0.4, size: 1.6, drag: 4 });
    }
    ring(p, o) {
      const r0 = o.r0 || 10,
        r1 = o.r1 || 100;
      this.add(o.life || 0.6, (ctx, k) => {
        const e = 1 - Math.pow(1 - k, 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = o.color || '#fff';
        ctx.lineWidth = (o.width || 4) * (1 - k * 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r0 + (r1 - r0) * e, 0, TAU);
        ctx.stroke();
      });
    }
    bolt(x1, y1, x2, y2, color) {
      const mk = () => {
        const pts = [{ x: x1, y: y1 }];
        const segs = 14;
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          pts.push({ x: x1 + (x2 - x1) * t + rand(-38, 38), y: y1 + (y2 - y1) * t + rand(-10, 10) });
        }
        pts.push({ x: x2, y: y2 });
        return pts;
      };
      let pts = mk(),
        br = mk().slice(0, 8);
      let acc = 0;
      this.add(0.6, (ctx, k, dt) => {
        acc += dt;
        if (acc > 0.07) {
          acc = 0;
          pts = mk();
          br = mk().slice(0, 7 + Math.floor(Math.random() * 4)).map((q, i) => ({ x: q.x + i * rand(-8, 8), y: q.y }));
        }
        const flick = Math.random() < 0.85 ? 1 : 0.3;
        ctx.globalCompositeOperation = 'lighter';
        for (const [line, w] of [
          [pts, 1],
          [br, 0.5],
        ]) {
          for (const [lw, col, al] of [
            [14 * w, color || '#7a5cff', 0.25],
            [6 * w, '#c9b8ff', 0.6],
            [2 * w, '#ffffff', 1],
          ]) {
            ctx.globalAlpha = al * (1 - k) * flick;
            ctx.strokeStyle = col;
            ctx.lineWidth = lw;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
            ctx.stroke();
          }
        }
      });
      this.emit(x2, y2, { n: 40, colors: PALETTE.thunder, shape: 'spark', speed: 520, life: 0.6, size: 2, drag: 4 });
    }
    aim(a, targets, color) {
      for (const b of targets) {
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = (a.x + b.x) / 2 - (dy / len) * len * 0.15,
          cy = (a.y + b.y) / 2 + (dx / len) * len * 0.15;
        const pt = (t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
        this.add(0.9, (ctx, k) => {
          const head = Math.min(1, k * 2.2);
          const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
          ctx.globalCompositeOperation = 'lighter';
          ctx.setLineDash([]);
          for (const [lw, al] of [
            [10, 0.18],
            [4, 0.5],
            [1.6, 1],
          ]) {
            ctx.globalAlpha = al * fade;
            ctx.strokeStyle = lw < 2 ? '#fff8dc' : color || '#ffb347';
            ctx.lineWidth = lw;
            ctx.beginPath();
            for (let i = 0; i <= 30; i++) {
              const q = pt((head * i) / 30);
              i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
            }
            ctx.stroke();
          }
          const h = pt(head),
            h2 = pt(Math.max(0, head - 0.03));
          const ang = Math.atan2(h.y - h2.y, h.x - h2.x);
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#fff2c0';
          ctx.save();
          ctx.translate(h.x, h.y);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-8, -7);
          ctx.lineTo(-4, 0);
          ctx.lineTo(-8, 7);
          ctx.fill();
          ctx.restore();
        });
      }
    }
    arrowRain(targets) {
      for (const b of targets) {
        for (let i = 0; i < 7; i++) {
          setTimeout(() => {
            const sx = b.x - rand(260, 420),
              sy = b.y - rand(300, 420);
            const T = rand(0.35, 0.5);
            this.parts.push({ x: sx, y: sy, vx: (b.x + rand(-40, 40) - sx) / T, vy: (b.y + rand(-30, 30) - sy) / T, g: 0, drag: 0, life: T, t: 0, size: 2, color: '#fff', alpha: 1, shape: 'arrow' });
          }, i * 55 + rand(0, 60));
        }
        setTimeout(() => this.emit(b.x, b.y, { n: 16, colors: PALETTE.normal, shape: 'spark', speed: 240, life: 0.3, size: 1.5 }), 520);
      }
    }
    shockwave(p, color) {
      for (let i = 0; i < 3; i++) setTimeout(() => this.ring(p, { color: color || '#e0a050', r0: 30, r1: 520, life: 0.9, width: 10 - i * 3 }), i * 140);
      this.emit(p.x, p.y, { n: 50, colors: ['#c99b5b', '#8b6a3e', '#e6c08a'], speed: 420, life: 1, size: 4, drag: 2 });
    }
    flames(p) {
      this.emit(p.x, p.y + 30, { n: 70, shape: 'flame', speed: 120, life: 1.1, size: 6, vy: -140, jitter: 50, drag: 1 });
    }
    sparkle(p, colors, n) {
      this.emit(p.x, p.y, { n: n || 30, colors: colors || PALETTE.gold, speed: 200, life: 0.9, size: 3, drag: 2.5, jitter: 10 });
    }
    ash(p) {
      this.emit(p.x, p.y, { n: 60, shape: 'smoke', colors: ['#3b342d', '#5a5048', '#2a2420'], speed: 70, life: 2, size: 14, vy: -60, drag: 0.8, jitter: 50 });
      this.emit(p.x, p.y, { n: 30, colors: PALETTE.ash, speed: 90, life: 1.8, size: 2.5, vy: -80, drag: 0.6, jitter: 60 });
    }
    chain(a, b) {
      this.add(0.7, (ctx, k) => {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#cfd8e3';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -k * 80;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
  }
  SGS.FX = FX;
  SGS.PALETTE = PALETTE;

})();
