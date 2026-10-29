// 声音：CC0 采样音效 + F5-TTS 武将配音 + 合成层（火焰/雷电/旋律）+ 生成式古筝背景乐
// 采样与配音用 HTMLAudioElement 播放，直接双击 index.html（file://）也能用。
(function () {
  const SGS = globalThis.SGS;
  const SFX_DIR = 'assets/sfx/';
  const VOICE_DIR = 'assets/voice/';
  const range = (p, n, from = 1) => Array.from({ length: n }, (_, i) => p + (i + from));
  const SFX = {
    place: range('place', 4),
    draw: range('slide', 4),
    shuffle: ['shuffle'],
    judge: ['fan1', 'fan2'],
    sword: range('sword', 5),
    clash: range('clash', 4),
    punch: range('punch', 3, 0),
    bell: ['bell0', 'bell1'],
    metal: ['metal0', 'metal1'],
    wood: ['wood0'],
    woodheavy: ['woodheavy'],
    soft: ['soft0'],
    chain: range('chain', 3),
    equip: ['equip1', 'equip2'],
    flip: ['flip'],
    arrow: ['arrow1', 'arrow2'],
  };
  const CARD_KEY = {
    杀: 'sha', 火杀: 'huosha', 雷杀: 'leisha', 闪: 'shan', 桃: 'tao', 酒: 'jiu', 决斗: 'juedou', 过河拆桥: 'guohe',
    顺手牵羊: 'shunshou', 无中生有: 'wuzhong', 借刀杀人: 'jiedao', 南蛮入侵: 'nanman', 万箭齐发: 'wanjian',
    桃园结义: 'taoyuan', 五谷丰登: 'wugu', 无懈可击: 'wuxie', 火攻: 'huogong', 铁索连环: 'tiesuo',
    乐不思蜀: 'lebu', 兵粮寸断: 'bingliang', 闪电: 'shandian',
  };
  const PENTA = [0, 2, 4, 7, 9];

  class Sound {
    constructor() {
      this.on = true; // 音效
      this.voiceOn = true; // 配音
      this.musicOn = true; // 背景乐
      this.sfxVol = 0.75;
      this.voiceVol = 1;
      this.musicVol = 0.32;
      this.pool = new Map();
      this.ctx = null;
      this.curVoice = null;
      this.voiceUntil = 0;
      this.voiceLock = 0;
    }

    // ---------- 采样 ----------
    sample(file, vol) {
      const src = (file.startsWith('assets/') ? '' : SFX_DIR) + file + (file.endsWith('.mp3') ? '' : '.mp3');
      let list = this.pool.get(src);
      if (!list) this.pool.set(src, (list = []));
      let a = list.find((x) => x.paused || x.ended);
      if (!a) {
        if (list.length >= 6) a = list[0];
        else {
          a = new Audio(src);
          a.preload = 'auto';
          list.push(a);
        }
      }
      try {
        a.currentTime = 0;
      } catch (e) {}
      a.volume = Math.max(0, Math.min(1, vol));
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      return a;
    }
    sfx(name, vol = 1, delay = 0) {
      if (!this.on) return;
      const list = SFX[name];
      if (!list) return;
      const f = list[Math.floor(Math.random() * list.length)];
      const go = () => this.sample(f, vol * this.sfxVol);
      if (delay) setTimeout(go, delay);
      else go();
    }
    preload() {
      for (const list of Object.values(SFX)) for (const f of list) this.sample(f, 0).pause();
    }

    // ---------- 配音 ----------
    hasVoice(id) {
      return !!(SGS.VOICE_CLIPS && SGS.VOICE_CLIPS[id]);
    }
    // priority：死亡 3 > 技能 2 > 出牌 1；低优先级不打断正在说的高优先级台词
    voice(id, priority = 1) {
      if (!this.voiceOn || !this.hasVoice(id)) return 0;
      const now = performance.now();
      if (now < this.voiceUntil && priority < this.voiceLock) return 0;
      if (this.curVoice) this.curVoice.pause();
      this.curVoice = this.sample(VOICE_DIR + id + '.mp3', this.voiceVol);
      const dur = SGS.VOICE_CLIPS[id] || 1;
      this.voiceUntil = now + dur * 1000;
      this.voiceLock = priority;
      this.duck(dur);
      return dur;
    }
    cardVoice(card, player) {
      const key = CARD_KEY[card.displayName] || CARD_KEY[card.name];
      if (!key || !player) return;
      this.voice(`card_${player.gender === 'female' ? 'f' : 'm'}_${key}`, 1);
    }
    skillVoice(id) {
      const n = Math.random() < 0.5 ? 1 : 2;
      return this.voice(`skill_${id}_${n}`, 2) || this.voice(`skill_${id}_${3 - n}`, 2);
    }
    deathVoice(general) {
      if (general) this.voice(`death_${general.id}`, 3);
    }

    // ---------- 合成层 ----------
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return this.ctx;
    }
    tone(freq, dur, o = {}) {
      const c = this.ctx,
        t = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((o.vol || 0.3) * this.sfxVol, t + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(o.dest || this.master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    noiseBurst(dur, o = {}) {
      const c = this.ctx,
        t = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.freq || 1200, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = o.q || 1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((o.vol || 0.4) * this.sfxVol, t + (o.attack || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }
    synth(fn) {
      try {
        if (!this.ensure()) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        fn(this);
      } catch (e) {}
    }

    // ---------- 统一入口（界面按事件名调用） ----------
    play(name) {
      if (!this.on) return;
      const S = this;
      switch (name) {
        case 'card':
          return S.sfx('place', 0.8);
        case 'draw':
          return S.sfx('draw', 0.7);
        case 'click':
          return S.sfx('place', 0.35);
        case 'slash':
          return S.sfx('sword', 1);
        case 'fire':
          S.sfx('sword', 0.9);
          return S.synth((s) => {
            s.noiseBurst(0.9, { freq: 500, to: 2600, q: 0.6, vol: 1.2, filter: 'lowpass' });
            s.noiseBurst(0.7, { freq: 3200, q: 2.5, vol: 0.35, delay: 0.12 });
          });
        case 'thunder':
          S.sfx('metal', 0.6);
          return S.synth((s) => {
            s.noiseBurst(0.15, { freq: 5000, q: 0.5, vol: 1, filter: 'highpass' });
            s.noiseBurst(1.4, { freq: 260, to: 55, q: 0.7, vol: 1.6, filter: 'lowpass', delay: 0.05 });
          });
        case 'hit':
          S.sfx('punch', 1);
          return S.synth((s) => s.tone(95, 0.35, { to: 40, vol: 0.9 }));
        case 'heal':
          S.sfx('bell', 0.35);
          return S.synth((s) => [784, 988, 1175, 1568].forEach((f, i) => s.tone(f, 0.6, { vol: 0.28, delay: i * 0.07 })));
        case 'dodge':
          return S.sfx('clash', 0.9);
        case 'armor':
          return S.sfx('metal', 0.9);
        case 'skill':
          return S.sfx('bell', 0.7);
        case 'awaken':
          S.sfx('bell', 1);
          return S.synth((s) => {
            [130.8, 196, 261.6, 392, 523].forEach((f, i) => s.tone(f, 2.2, { type: 'triangle', vol: 0.25, delay: i * 0.09 }));
            s.noiseBurst(1.6, { freq: 120, q: 0.5, vol: 1, filter: 'lowpass' });
          });
        case 'death':
          S.sfx('woodheavy', 1);
          return S.synth((s) => {
            s.tone(65, 1.4, { vol: 1 });
            s.tone(196, 1.3, { to: 70, type: 'triangle', vol: 0.25 });
          });
        case 'turn':
          return S.sfx('wood', 0.6);
        case 'myturn':
          S.sfx('wood', 0.8);
          return S.synth((s) => [523, 659, 784].forEach((f, i) => s.tone(f, 0.45, { type: 'triangle', vol: 0.3, delay: i * 0.08 })));
        case 'judge':
          return S.sfx('judge', 0.9);
        case 'good':
          return S.synth((s) => {
            s.tone(988, 0.35, { vol: 0.35 });
            s.tone(1318, 0.45, { vol: 0.3, delay: 0.08 });
          });
        case 'bad':
          return S.synth((s) => s.tone(330, 0.45, { type: 'sawtooth', vol: 0.15, to: 210 }));
        case 'equip':
          return S.sfx('equip', 0.9);
        case 'chain':
          return S.sfx('chain', 1);
        case 'nanman':
          S.sfx('punch', 0.8);
          S.sfx('punch', 0.8, 260);
          return S.synth((s) => {
            s.tone(70, 1.1, { type: 'sawtooth', vol: 0.3, to: 120 });
            s.noiseBurst(1.1, { freq: 300, q: 0.8, vol: 1, filter: 'lowpass' });
          });
        case 'arrows':
          for (let i = 0; i < 6; i++) S.sfx('arrow', 0.6, i * 80);
          return;
        case 'shuffle':
          return S.sfx('shuffle', 0.8);
        case 'win':
          return S.synth((s) => [523, 659, 784, 1047, 784, 1047, 1318].forEach((f, i) => s.tone(f, 0.5, { type: 'triangle', vol: 0.35, delay: i * 0.13 })));
        case 'lose':
          return S.synth((s) => [440, 392, 330, 262].forEach((f, i) => s.tone(f, 0.7, { type: 'triangle', vol: 0.35, delay: i * 0.2 })));
      }
    }

    // ---------- 生成式背景乐（五声音阶古筝拨弦 + 低音持续 + 回声） ----------
    startMusic() {
      if (!this.musicOn || this.musicTimer) return;
      if (!this.ensure()) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const c = this.ctx;
      if (!this.musicBus) {
        this.musicBus = c.createGain();
        this.musicBus.gain.value = 0;
        const delay = c.createDelay(1);
        delay.delayTime.value = 0.42;
        const fb = c.createGain();
        fb.gain.value = 0.38;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        this.musicBus.connect(c.destination);
        this.musicIn = c.createGain();
        this.musicIn.connect(this.musicBus);
        this.musicIn.connect(delay);
        delay.connect(lp);
        lp.connect(fb);
        fb.connect(delay);
        lp.connect(this.musicBus);
      }
      this.musicBus.gain.setTargetAtTime(this.musicVol, c.currentTime, 1.5);
      this.step = 0;
      this.root = 50; // D3
      this.last = 2;
      const tick = () => this.musicTick();
      tick();
      this.musicTimer = setInterval(tick, 400);
    }
    stopMusic() {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
      if (this.musicBus) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
    duck(sec) {
      if (!this.musicBus || !this.musicTimer) return;
      const t = this.ctx.currentTime;
      const g = this.musicBus.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(this.musicVol * 0.35, t, 0.05);
      g.setTargetAtTime(this.musicVol, t + sec + 0.2, 0.6);
    }
    pluck(midi, t, vol) {
      const c = this.ctx;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const g = c.createGain();
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 7, t);
      lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 1.2);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      for (const [mul, type, amp] of [
        [1, 'triangle', 1],
        [2, 'sine', 0.35],
        [3.01, 'sine', 0.12],
      ]) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f * mul;
        const og = c.createGain();
        og.gain.value = amp;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(t + 2.5);
      }
      // 古筝揉弦：轻微滑音
      lp.connect(g);
      g.connect(this.musicIn);
    }
    musicTick() {
      if (!this.ctx || !this.musicOn) return;
      const c = this.ctx,
        t = c.currentTime + 0.05;
      const s = this.step++;
      const note = (deg) => this.root + 12 * Math.floor(deg / 5) + PENTA[((deg % 5) + 5) % 5];
      // 低音：每 16 拍一个根音/五度
      if (s % 16 === 0) {
        const bass = s % 32 === 0 ? this.root - 12 : this.root - 5;
        this.pluck(bass, t, 0.22);
        this.pluck(bass + 12, t + 0.02, 0.08);
      }
      // 旋律：随机游走，偶尔休止、偶尔双音
      const rest = Math.random() < (s % 8 < 4 ? 0.25 : 0.5);
      if (!rest) {
        this.last = Math.max(3, Math.min(12, this.last + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        const n = note(this.last);
        this.pluck(n, t, 0.16 + Math.random() * 0.06);
        if (Math.random() < 0.18) this.pluck(n + 12, t + 0.12, 0.06);
        if (Math.random() < 0.12) this.pluck(note(this.last - 2), t + 0.2, 0.08);
      }
      // 每 64 拍转调（D → G → A → D）
      if (s % 64 === 63) this.root = [50, 55, 57, 50][Math.floor(s / 64 + 1) % 4];
    }
  }
  SGS.Sound = Sound;
  SGS.CARD_VOICE_KEY = CARD_KEY;
})();
