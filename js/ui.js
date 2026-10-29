// 界面：渲染、动画、人类玩家交互
(function () {
  const SGS = globalThis.SGS;
  const W = 1600,
    H = 900;
  const KN = SGS.KINGDOM_NAME;
  const SEAT_POS = {
    1: [[800, 140]],
    2: [[1150, 145], [450, 145]],
    3: [[1470, 400], [800, 140], [130, 400]],
    4: [[1470, 420], [1050, 140], [550, 140], [130, 420]],
    5: [[1470, 430], [1230, 140], [800, 140], [370, 140], [130, 430]],
    6: [[1470, 470], [1470, 215], [1000, 132], [600, 132], [130, 215], [130, 470]],
    7: [[1470, 470], [1470, 215], [1130, 132], [800, 132], [470, 132], [130, 215], [130, 470]],
  };
  const P_TABLE = { x: 800, y: 395 };
  const P_DECK = { x: 545, y: 300 };
  const P_HAND = { x: 735, y: 795 };
  const P_MYEQ = { x: 130, y: 790 };
  const SPEEDS = { 慢: 1.5, 中: 1, 快: 0.6, 极速: 0.3 };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  // 内容不变就不碰 DOM：避免重设 innerHTML 让入场动画（阵亡印章、判定印章、按钮光效）反复重播
  const setHTML = (e, html) => {
    if (e.__html !== html) {
      e.__html = html;
      e.innerHTML = html;
    }
  };
  // 受伤/回复/翻面等一次性特效 class 由 flashSeat 加上、定时移除，重绘时保留，免得动画被截断
  const TRANSIENT = ['hurt', 'healed', 'flip', 'die-anim', 'dying-pulse'];
  const setClass = (e, cls) => {
    const next = [cls, ...TRANSIENT.filter((c) => e.classList.contains(c))].join(' ').trim();
    if (e.className !== next) e.className = next;
  };
  const TYPE_ORDER = { basic: 0, trick: 1, delay: 2, equip: 3 };
  const GLYPH = { 火杀: '火', 雷杀: '雷', 无懈可击: '懈', 无中生有: '无', 过河拆桥: '拆', 顺手牵羊: '顺', 借刀杀人: '借', 南蛮入侵: '蛮', 万箭齐发: '箭', 桃园结义: '桃', 五谷丰登: '谷', 铁索连环: '索', 乐不思蜀: '乐', 兵粮寸断: '兵' };
  const EQ_ICON = { weapon: '⚔', armor: '⛨', minus: '−1', plus: '+1' };

  class UI {
    constructor(root) {
      this.root = root;
      this.speed = 1;
      this.speedName = '中';
      this.sound = new SGS.Sound();
      this.game = null;
      this.me = null;
      this.hidden = new Set();
      this.table = [];
      this.handPos = {};
      this.pending = null;
      this.sel = { cards: [], targets: [], skill: null };
      this.autoPlay = false;
      this.logOpen = false;
      this.build();
      setInterval(() => this.game && this.renderTable(), 400);
    }

    // ================= 构建 =================
    build() {
      const r = this.root;
      r.innerHTML = '';
      const stage = (this.stage = el('div', 'stage'));
      stage.innerHTML = `
        <div class="bg"><div class="bg-ink"></div><div class="bg-felt"></div><div class="bg-vignette"></div></div>
        <div id="topbar">
          <div class="tb-left"><span id="tb-round"></span><span id="tb-phase"></span></div>
          <div class="tb-right">
            <button data-act="auto" class="tb-btn">托管</button>
            <button data-act="log" class="tb-btn">战报</button>
            <button data-act="sound" class="tb-btn">音效</button>
            <button data-act="voice" class="tb-btn">配音</button>
            <button data-act="music" class="tb-btn">音乐</button>
            <button data-act="speed" class="tb-btn">速度</button>
            <button data-act="menu" class="tb-btn">菜单</button>
          </div>
        </div>
        <div id="seats"></div>
        <div id="deck"><div class="card back sm"><div class="cb-emblem">杀</div></div><div class="deck-count"></div><div class="deck-label">牌堆</div></div>
        <div id="discard-count"></div>
        <div id="table"></div>
        <div id="feed"></div>
        <div id="me">
          <div id="me-judges"></div>
          <div id="me-equips"></div>
          <div id="hand"></div>
          <div id="skill-bar"></div>
          <div id="me-seat"></div>
        </div>
        <div id="controls"><div id="prompt"></div><div id="buttons"></div></div>
        <canvas id="fx"></canvas>
        <div id="anim"></div>
        <div id="wugu" class="hidden"></div>
        <div id="dialog" class="hidden"></div>
        <div id="log-drawer"><div class="log-title">战 报</div><div id="log"></div></div>
      `;
      r.appendChild(stage);
      this.tip = el('div', 'tip hidden');
      document.body.appendChild(this.tip);
      this.$ = (s) => stage.querySelector(s);
      this.fxe = new SGS.FX(this.$('#fx'), W, H);
      this.fit();
      window.addEventListener('resize', () => this.fit());
      stage.addEventListener('click', (e) => this.onClick(e));
      stage.addEventListener('dblclick', (e) => this.onDblClick(e));
      stage.addEventListener('mousemove', (e) => this.onHover(e));
      stage.addEventListener('mouseleave', () => this.tip.classList.add('hidden'));
      stage.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.pending) this.cancelSelection();
      });
    }
    fit() {
      const s = Math.min(window.innerWidth / W, window.innerHeight / H);
      this.scale = s;
      this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
    attach(game, onMenu) {
      this.game = game;
      this.onMenu = onMenu;
      this.me = null;
      this.table = [];
      this.hidden.clear();
      this.pending = null;
      this.autoPlay = !!game.opts.spectate;
      this.$('#log').innerHTML = '';
      this.$('#feed').innerHTML = '';
      this.closeDialog();
      this.$('#wugu').classList.add('hidden');
    }
    setMe(p) {
      this.me = p;
      const n = this.game.players.length;
      const others = [];
      for (let i = 1; i < n; i++) others.push(this.game.players[(p.seat + i) % n]);
      this.seatPos = {};
      const pos = SEAT_POS[others.length];
      others.forEach((q, i) => (this.seatPos[q.seat] = { x: pos[i][0], y: pos[i][1] }));
      this.seatPos[p.seat] = { x: 1455, y: 760 };
    }

    // ================= 工具 =================
    wait(ms) {
      return SGS.sleep(ms * this.speed);
    }
    pp(p) {
      if (!p) return { x: W / 2, y: 120 };
      const s = this.seatPos && this.seatPos[p.seat];
      return s ? { x: s.x, y: s.y - 10 } : { x: W / 2, y: H / 2 };
    }
    zonePoint(zone, owner, card) {
      if (owner && (zone === 'h' || zone === 'e' || zone === 'j')) {
        if (owner === this.me) {
          if (zone === 'h') return card && this.handPos[card.id] ? this.handPos[card.id] : P_HAND;
          if (zone === 'e') return P_MYEQ;
          return { x: 130, y: 660 };
        }
        const p = this.pp(owner);
        if (zone === 'e') return { x: p.x, y: p.y + 50 };
        if (zone === 'j') return { x: p.x - 50, y: p.y - 40 };
        return p;
      }
      if (zone === 'deck' || zone == null || zone === 'deckTop' || zone === 'deckBottom') return P_DECK;
      return P_TABLE;
    }
    nameOf(p) {
      return p === this.me ? '你' : p.name;
    }
    skillObj(id) {
      return SGS.Skills[id] || SGS.EquipSkills[id];
    }

    // ================= 卡牌外观 =================
    cardHTML(c, opts = {}) {
      if (!c) return `<div class="card back ${opts.cls || ''}"><div class="cb-emblem">杀</div></div>`;
      const def = c.def;
      const red = SGS.isRedSuit(c.suit);
      const color = c.suit === 'none' ? (c.color === 'red' ? 'red' : 'black') : red ? 'red' : 'black';
      const name = c.displayName;
      const glyph = GLYPH[name] || name[0];
      const range = def.type === 'equip' && def.subtype === 'weapon' ? `<span class="c-range">${def.range}</span>` : '';
      const vt = c.virtual && c.skill ? `<div class="c-vtag">${(this.skillObj(c.skill) || {}).name || ''}</div>` : '';
      const corner = c.suit && c.suit !== 'none' ? `<div class="c-corner"><b>${SGS.numStr(c.number)}</b><i>${SGS.SUIT_SYMBOL[c.suit]}</i></div>` : '';
      return `<div class="card ${color} t-${def.type} ${def.subtype ? 's-' + def.subtype : ''} ${c.nature ? 'n-' + c.nature : ''} ${opts.cls || ''}" data-cid="${c.id}" ${opts.attrs || ''}>
        <div class="c-frame"></div><div class="c-ink">${glyph}</div>${corner}
        <div class="c-name len${name.length}">${name}</div>
        <div class="c-type">${def.typeName}${range}</div>${vt}
      </div>`;
    }
    portraitHTML(gen, opts = {}) {
      if (!gen) return `<div class="pt pt-unknown"><div class="pt-art"></div><div class="pt-name">未选将</div></div>`;
      return `<div class="pt k-${gen.kingdom} ${opts.cls || ''}">
        <div class="pt-art"></div><div class="pt-ink">${gen.name[0]}</div>
        <div class="pt-seal">${KN[gen.kingdom]}</div>
        <div class="pt-name ${gen.name.length > 3 ? 'long' : ''}">${gen.name}</div>
        <div class="pt-title">${gen.title}</div>
      </div>`;
    }
    hpHTML(p) {
      const hp = Math.max(p.hp, 0),
        max = p.maxHp;
      const ratio = hp / Math.max(1, max);
      const col = ratio > 0.66 ? 'g' : ratio > 0.34 ? 'y' : 'r';
      if (max > 5) return `<div class="hp"><i class="mg ${hp > 0 ? col : 'e'}"></i><span class="hp-num">${hp}/${max}</span></div>`;
      let s = '';
      for (let i = 0; i < max; i++) s += `<i class="mg ${i < hp ? col : 'e'}"></i>`;
      return `<div class="hp">${s}</div>`;
    }
    identityHTML(p) {
      const known = p.revealed || p === this.me || p.identity === 'lord' || (this.game && this.game.over);
      if (!known) return `<div class="idb unknown">?</div>`;
      const ch = { lord: '主', loyal: '忠', rebel: '反', spy: '内' }[p.identity];
      return `<div class="idb r-${p.identity}">${ch}</div>`;
    }
    judgesHTML(p) {
      return p.judges.map((c) => `<span class="jt ${c.name === '闪电' ? 'jt-sd' : ''}" data-tipcard="${c.id}">${GLYPH[c.name] || c.name[0]}</span>`).join('');
    }

    // ================= 渲染 =================
    refresh() {
      this.render();
    }
    render() {
      const g = this.game;
      if (!g || !this.me) return;
      this.renderTop();
      this.renderSeats();
      this.renderMe();
      this.renderControls();
      this.renderTable();
    }
    renderTop() {
      const g = this.game;
      const cur = g.current;
      this.$('#tb-round').textContent = `第 ${Math.max(1, g.round || 1)} 轮`;
      setHTML(this.$('#tb-phase'), cur ? `<b class="k-${cur.kingdom}">${esc(this.nameOf(cur))}</b> · ${g.phase ? SGS.PHASE_NAME[g.phase] : '回合开始'}` : '选将中');
      this.$('#deck .deck-count').textContent = g.deck.length;
      this.$('#discard-count').textContent = `弃牌 ${g.discardPile.length}`;
      this.stage.querySelector('[data-act=auto]').classList.toggle('on', this.autoPlay);
      this.stage.querySelector('[data-act=sound]').classList.toggle('off', !this.sound.on);
      this.stage.querySelector('[data-act=voice]').classList.toggle('off', !this.sound.voiceOn);
      this.stage.querySelector('[data-act=music]').classList.toggle('off', !this.sound.musicOn);
      this.stage.querySelector('[data-act=speed]').textContent = '速度·' + this.speedName;
    }
    seatClasses(p) {
      const g = this.game;
      const c = ['seat'];
      if (g.current === p) c.push('current');
      if (!p.alive) c.push('dead');
      if (p.dying) c.push('dying');
      if (p.chained) c.push('chained');
      if (p.turnedOver) c.push('turned');
      if (p.wine) c.push('wined');
      if (this.pending) {
        const st = this.targetState(p);
        if (st === 'sel') c.push('selected');
        else if (st === 'ok') c.push('targetable');
        else if (st === 'no' && p !== this.me) c.push('dim');
      }
      return c.join(' ');
    }
    seatInner(p, big) {
      const g = this.game;
      const eqs = p
        .equipList()
        .map((c) => `<div class="eq-row ${SGS.isRedSuit(c.suit) ? 'red' : 'black'}" data-tipcard="${c.id}"><span class="eq-ic">${EQ_ICON[c.subtype]}</span>${c.name}<span class="eq-s">${SGS.SUIT_SYMBOL[c.suit]}${SGS.numStr(c.number)}</span></div>`)
        .join('');
      const dist = !big && this.me && this.me.alive && p.alive ? `<div class="dist">距${g.distance(this.me, p)}</div>` : '';
      const phase = g.current === p && g.phase ? `<div class="phase-tag">${SGS.PHASE_NAME[g.phase].slice(0, 2)}</div>` : '';
      const marks = (p.marks.niepanUsed ? '<span class="mk">涅槃已用</span>' : '') + (p.marks.luanwuUsed ? '<span class="mk">乱武已用</span>' : '');
      const order = this.sel.targets.indexOf(p);
      return `
        ${this.portraitHTML(p.general)}
        ${this.identityHTML(p)}
        <div class="judges">${this.judgesHTML(p)}</div>
        ${big ? '' : `<div class="eqs">${eqs}</div>`}
        <div class="chain-ov"></div><div class="turn-ov">翻面</div><div class="dead-ov"><span>阵亡</span></div>
        ${phase}${dist}
        ${order >= 0 ? `<div class="tg-order">${order + 1}</div>` : ''}
        <div class="seat-foot">
          ${this.hpHTML(p)}
          ${big ? '' : `<div class="hc"><span>${p.hand.length}</span></div>`}
        </div>
        <div class="mks">${marks}</div>
        <div class="seat-num">${p.seat + 1}</div>`;
    }
    renderSeats() {
      const box = this.$('#seats');
      const g = this.game;
      for (const p of g.players) {
        if (p === this.me) continue;
        let e = box.querySelector(`[data-seat="${p.seat}"]`);
        if (!e) {
          e = el('div');
          e.dataset.seat = p.seat;
          box.appendChild(e);
        }
        const pos = this.seatPos[p.seat];
        e.style.left = pos.x - 75 + 'px';
        e.style.top = pos.y - 105 + 'px';
        setClass(e, this.seatClasses(p));
        setHTML(e, this.seatInner(p, false));
      }
    }
    renderMe() {
      const p = this.me,
        g = this.game;
      const seat = this.$('#me-seat');
      seat.dataset.seat = p.seat;
      setClass(seat, this.seatClasses(p) + ' big');
      setHTML(seat, this.seatInner(p, true));
      // 装备
      const eq = this.$('#me-equips');
      setHTML(eq, ['weapon', 'armor', 'minus', 'plus']
        .map((k) => {
          const c = p.equips[k];
          if (!c) return `<div class="eq-slot empty"><span class="eq-ic">${EQ_ICON[k]}</span>${{ weapon: '武器', armor: '防具', minus: '进攻马', plus: '防御马' }[k]}</div>`;
          const st = this.cardState(c);
          return `<div class="eq-slot ${SGS.isRedSuit(c.suit) ? 'red' : 'black'} ${st}" data-cid="${c.id}" data-tipcard="${c.id}"><span class="eq-ic">${EQ_ICON[k]}</span><b>${c.name}</b>${c.def.range ? `<em>${c.def.range}</em>` : ''}<span class="eq-s">${SGS.SUIT_SYMBOL[c.suit]}${SGS.numStr(c.number)}</span></div>`;
        })
        .join(''));
      setHTML(this.$('#me-judges'), this.judgesHTML(p));
      // 手牌：按牌 id 复用元素，只改位置和状态，避免整手重建造成闪烁
      const hand = this.$('#hand');
      const cards = p.hand.filter((c) => !this.hidden.has(c.id)).sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name) || a.number - b.number);
      const HW = 930,
        CW = 116;
      const n = cards.length;
      const step = n > 1 ? Math.min(CW + 6, (HW - CW) / (n - 1)) : 0;
      const total = n ? CW + step * (n - 1) : 0;
      const x0 = (HW - total) / 2;
      const old = new Map([...hand.children].map((x) => [x.dataset.cid, x]));
      cards.forEach((c, i) => {
        let e = old.get(String(c.id));
        old.delete(String(c.id));
        if (!e) {
          e = el('div', null, this.cardHTML(c, { cls: 'hand-card' })).firstElementChild;
          e.__base = e.className;
          e.classList.add('fresh');
          setTimeout(() => e.classList.remove('fresh'), 450);
          hand.appendChild(e);
        }
        const cls = `${e.__base} ${this.cardState(c)}${e.classList.contains('fresh') ? ' fresh' : ''}`.trim();
        if (e.className !== cls) e.className = cls;
        const left = x0 + i * step + 'px';
        if (e.style.left !== left) e.style.left = left;
        if (e.style.zIndex !== String(i + 1)) e.style.zIndex = i + 1;
        this.handPos[c.id] = { x: 265 + x0 + i * step + CW / 2, y: 795 };
      });
      for (const e of old.values()) e.remove();
      // 技能栏
      const btns = this.skillButtons();
      setHTML(
        this.$('#skill-bar'),
        btns
          .map((b) => `<button class="sk ${b.on ? 'on' : ''} ${b.usable ? '' : 'passive'} ${b.lord ? 'lord' : ''}" data-skill="${b.id}" data-tipskill="${b.id}" ${b.usable ? '' : 'disabled'}>${b.name}</button>`)
          .join('')
      );
    }
    renderControls() {
      const pr = this.$('#prompt'),
        bt = this.$('#buttons');
      if (!this.pending || this.dialogMode) {
        const cur = this.game.current;
        setHTML(pr, this.waitText || (cur && cur !== this.me ? `等待 <b>${esc(cur.name)}</b> 行动…` : ''));
        setClass(pr, 'waiting');
        setHTML(bt, '');
        return;
      }
      const req = this.pending.req;
      setClass(pr, '');
      setHTML(pr, this.promptText(req));
      const b = [];
      const ok = this.canConfirm();
      if (req.type === 'play') {
        const eff = this.effCard();
        if (eff && !eff.virtual && eff.def.recast && this.sel.targets.length === 0 && !this.sel.skill) b.push(['recast', '重铸', true]);
        b.push(['ok', '确 定', ok]);
        if (this.sel.cards.length || this.sel.skill || this.sel.targets.length) b.push(['cancel', '取 消', true]);
        b.push(['end', '结束出牌', true]);
      } else if (req.type === 'respond') {
        b.push(['ok', '确 定', ok], ['cancel', '取 消', true]);
      } else if (req.type === 'cards' || req.type === 'targets') {
        b.push(['ok', '确 定', ok]);
        if (req.min === 0) b.push(['cancel', '取 消', true]);
      } else if (req.type === 'confirm') {
        b.push(['ok', '确 定', true], ['cancel', '取 消', true]);
      }
      setHTML(bt, b.map(([k, t, en]) => `<button class="btn btn-${k}" data-btn="${k}" ${en ? '' : 'disabled'}>${t}</button>`).join(''));
    }
    promptText(req) {
      const g = this.game;
      if (req.type === 'play') {
        const eff = this.effCard();
        if (this.sel.skill) {
          const s = this.skillObj(this.sel.skill);
          return `【${s.name}】${s.enable ? '请选择' + (s.enable.cards && s.enable.cards.max ? '牌' : '') + (s.enable.targets && s.enable.targets.max ? '及目标' : '') + '后点确定' : `请选择${s.viewAs.count || 1}张牌`}`;
        }
        if (eff) {
          const d = eff.def;
          if (d.targets && !d.targets.self && !d.targets.all && d.type !== 'equip') {
            if (d.split) return this.sel.targets.length ? `请选择 ${esc(this.sel.targets[0].name)} 使用【杀】的目标` : `请选择装备有武器的角色`;
            const mx = g.maxTargets(this.me, eff);
            return `使用 ${SGS.cardText(eff)}：请选择${mx > 1 ? `至多 ${mx} 名` : ''}目标`;
          }
          return `使用 ${SGS.cardText(eff)}？`;
        }
        return `<b>出牌阶段</b>：请选择一张牌或技能（双击可快速使用）`;
      }
      return req.prompt || ({ cards: '请选择牌', targets: '请选择目标', respond: '请响应', confirm: '是否确定？' }[req.type] || '');
    }
    tableEntryAdd(card, opts = {}) {
      const e = { key: Math.random().toString(36).slice(2), card, t: performance.now(), label: opts.label || '', stamp: opts.stamp || null, ghost: !!opts.ghost, judge: !!opts.judge };
      this.table.push(e);
      if (this.table.length > 12) this.table.shift();
      this.renderTable();
      return e;
    }
    tableFind(card) {
      for (let i = this.table.length - 1; i >= 0; i--) if (this.table[i].card === card) return this.table[i];
      return null;
    }
    renderTable() {
      const box = this.$('#table');
      if (!box) return;
      const now = performance.now();
      const life = 3600 * Math.max(0.6, this.speed);
      this.table = this.table.filter((e) => (!e.ghost && e.card.zone === 'processing') || now - e.t < life);
      const list = this.table.slice(-8);
      const CW = 100,
        maxW = 520;
      const n = list.length;
      const step = n > 1 ? Math.min(CW + 8, (maxW - CW) / (n - 1)) : 0;
      const total = n ? CW + step * (n - 1) : 0;
      // 按条目复用元素：卡面只建一次，标签/印章变化时才改，渐隐只切换 class
      const old = new Map([...box.children].map((x) => [x.dataset.key, x]));
      list.forEach((e, i) => {
        let d = old.get(e.key);
        old.delete(e.key);
        if (!d) {
          d = el('div', 'tcard enter', this.cardHTML(e.card, { cls: 'sm', attrs: `data-tipcard="${e.card.id}"` }));
          d.dataset.key = e.key;
          d.__extra = el('div', 't-extra');
          d.appendChild(d.__extra);
          setTimeout(() => d.classList.remove('enter'), 400);
          box.appendChild(d);
        }
        const left = (maxW - total) / 2 + i * step + 'px';
        if (d.style.left !== left) d.style.left = left;
        const fade = !(e.card.zone === 'processing' && !e.ghost) && now - e.t > life - 700;
        d.classList.toggle('fading', fade);
        setHTML(
          d.__extra,
          (e.label ? `<div class="t-label">${e.label}</div>` : '') + (e.stamp ? `<div class="t-stamp ${e.stamp.cls}">${e.stamp.text}</div>` : '')
        );
      });
      for (const d of old.values()) d.remove();
    }
    feed(html) {
      const f = this.$('#feed');
      const d = el('div', 'feed-line', html);
      f.appendChild(d);
      while (f.children.length > 3) f.removeChild(f.firstChild);
      setTimeout(() => d.classList.add('out'), 4500);
      setTimeout(() => d.remove(), 5200);
    }
    log(html) {
      const box = this.$('#log');
      if (!box) return;
      const d = el('div', 'log-line', html);
      box.appendChild(d);
      while (box.children.length > 500) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
      if (!/turn-sep/.test(html) && !/摸了 \d+ 张牌/.test(html)) this.feed(html);
    }

    // ================= 选择逻辑 =================
    get mode() {
      return this.pending ? this.pending.req.type : null;
    }
    effCard() {
      const g = this.game,
        p = this.me,
        req = this.pending && this.pending.req;
      if (!req) return null;
      const { cards, skill } = this.sel;
      if (skill) {
        const s = this.skillObj(skill);
        if (s && s.viewAs) {
          const n = s.viewAs.count || 1;
          return cards.length === n ? g.makeVirtual(s, cards) : null;
        }
        return null;
      }
      if (cards.length !== 1) return null;
      const c = cards[0];
      if (req.type === 'play') {
        if (c.zone === 'h' && g.isUsable(p, c)) return c;
        for (const s of g.viewAsSkills(p, 'play'))
          if ((s.viewAs.count || 1) === 1 && s.viewAs.filter(g, p, c, []) && (s.viewAs.areas || 'h').includes(c.zone)) {
            const v = g.makeVirtual(s, [c]);
            if (v && g.isUsable(p, v)) return v;
          }
        if (c.zone === 'h' && c.def.recast) return c;
        return null;
      }
      if (req.type === 'respond') {
        if (c.zone === 'h' && req.names.includes(c.name)) return c;
        for (const s of g.viewAsSkills(p, 'respond'))
          if ((s.viewAs.count || 1) === 1 && s.viewAs.filter(g, p, c, []) && (s.viewAs.areas || 'h').includes(c.zone)) {
            const v = g.makeVirtual(s, [c]);
            if (v && req.names.includes(v.name)) return v;
          }
      }
      return null;
    }
    cardState(c) {
      if (!this.pending || this.dialogMode) return '';
      const sel = this.sel.cards.includes(c);
      if (sel) return 'selected';
      return this.cardSelectable(c) ? 'selectable' : 'dim';
    }
    cardSelectable(c) {
      const g = this.game,
        p = this.me,
        req = this.pending.req;
      const { skill, cards } = this.sel;
      if (req.type === 'cards') return req.cands.includes(c) && cards.length < req.max;
      if (req.type === 'play' || req.type === 'respond') {
        const mode = req.type === 'play' ? 'play' : 'respond';
        if (skill) {
          const s = this.skillObj(skill);
          if (s.viewAs) return cards.length < (s.viewAs.count || 1) && g.viewAsCands(p, s, cards).includes(c);
          if (s.enable) {
            const spec = s.enable.cards;
            if (!spec || !spec.max) return false;
            if (cards.length >= spec.max) return false;
            return (spec.areas || 'h').includes(c.zone) && spec.filter(g, p, c, cards);
          }
          return false;
        }
        if (c.zone === 'h') {
          if (mode === 'play' ? g.isUsable(p, c) || c.def.recast : req.names.includes(c.name)) return true;
        }
        for (const s of g.viewAsSkills(p, mode)) {
          if ((s.viewAs.count || 1) !== 1 || !(s.viewAs.areas || 'h').includes(c.zone) || !s.viewAs.filter(g, p, c, [])) continue;
          const v = g.makeVirtual(s, [c]);
          if (!v) continue;
          if (mode === 'play' ? g.isUsable(p, v) : req.names.includes(v.name)) return true;
        }
      }
      return false;
    }
    targetSpec() {
      const g = this.game,
        p = this.me,
        req = this.pending && this.pending.req;
      if (!req) return null;
      if (req.type === 'targets') return { min: req.min, max: req.max, ok: (t) => req.cands.includes(t) };
      if (req.type !== 'play') return null;
      if (this.sel.skill) {
        const s = this.skillObj(this.sel.skill);
        if (s.enable) {
          const ts = s.enable.targets;
          if (!ts || !ts.max) return null;
          return { min: ts.min, max: ts.max, ok: (t, sel) => !!ts.filter(g, p, t, sel, this.sel.cards) };
        }
      }
      const eff = this.effCard();
      if (!eff) return null;
      const d = eff.def;
      if (!d.targets || d.targets.self || d.targets.all || d.type === 'equip') return null;
      return { min: d.targets.min, max: g.maxTargets(p, eff), ok: (t, sel) => g.targetOk(p, t, eff, sel) };
    }
    targetState(t) {
      const spec = this.targetSpec();
      if (!spec) return '';
      if (this.sel.targets.includes(t)) return 'sel';
      if (!t.alive) return '';
      return this.sel.targets.length < spec.max && spec.ok(t, this.sel.targets) ? 'ok' : 'no';
    }
    canConfirm() {
      const req = this.pending && this.pending.req;
      if (!req) return false;
      const g = this.game,
        p = this.me;
      const { cards, targets, skill } = this.sel;
      switch (req.type) {
        case 'cards':
          return cards.length >= Math.max(1, req.min) && cards.length <= req.max;
        case 'targets':
          return targets.length >= Math.max(1, req.min) && targets.length <= req.max;
        case 'confirm':
          return true;
        case 'respond':
          return !!this.effCard();
        case 'play': {
          if (skill) {
            const s = this.skillObj(skill);
            if (s.enable) {
              const cs = s.enable.cards || { min: 0, max: 0 },
                ts = s.enable.targets || { min: 0, max: 0 };
              return cards.length >= (cs.min || 0) && cards.length <= (cs.max || 0) && targets.length >= (ts.min || 0) && targets.length <= (ts.max || 0);
            }
          }
          const eff = this.effCard();
          if (!eff || !g.isUsable(p, eff)) return false;
          const spec = this.targetSpec();
          if (!spec) return true;
          return targets.length >= spec.min && targets.length <= spec.max;
        }
      }
      return false;
    }
    skillButtons() {
      const g = this.game,
        p = this.me;
      const out = [];
      const req = this.pending && !this.dialogMode ? this.pending.req : null;
      for (const id of p.skills) {
        const s = SGS.Skills[id];
        if (!s) continue;
        let usable = false;
        if (req && req.type === 'play') {
          if (s.enable) usable = !s.enable.canUse || s.enable.canUse(g, p);
          if (s.viewAs && (!s.viewAs.when || s.viewAs.when(g, p, 'play'))) usable = g.viewAsCands(p, s).length >= (s.viewAs.count || 1);
        }
        if (req && req.type === 'respond') {
          if (s.viewAs && (s.viewAs.count || 1) > 1 && (!s.viewAs.when || s.viewAs.when(g, p, 'respond')) && req.names.includes(g.viewAsName(s, []))) usable = true;
          if (req.proxy === id) usable = true;
        }
        out.push({ id, name: s.name, usable, on: this.sel.skill === id, lord: s.lord });
      }
      const w = p.equips.weapon;
      if (w && SGS.EquipSkills[w.name] && SGS.EquipSkills[w.name].viewAs) {
        const s = SGS.EquipSkills[w.name];
        let usable = false;
        if (req && (req.type === 'play' || (req.type === 'respond' && req.names.includes('杀')))) usable = g.viewAsCands(p, s).length >= 2 && (req.type === 'respond' || g.isUsable(p, g.dummySlash()));
        out.push({ id: w.name, name: w.name, usable, on: this.sel.skill === w.name });
      }
      return out;
    }

    // ================= 事件 =================
    onClick(e) {
      const t = e.target;
      const act = t.closest('[data-act]');
      if (act) return this.topAction(act.dataset.act);
      if (this.dialogMode) return;
      const btn = t.closest('[data-btn]');
      if (btn && !btn.disabled) return this.button(btn.dataset.btn);
      const sk = t.closest('[data-skill]');
      if (sk && !sk.disabled) return this.clickSkill(sk.dataset.skill);
      const cardEl = t.closest('[data-cid]');
      if (cardEl && (cardEl.closest('#hand') || cardEl.closest('#me-equips'))) {
        // 手牌每次点击都会重绘，浏览器不会触发 dblclick，这里按时间间隔识别双击
        const id = cardEl.dataset.cid;
        const now = performance.now();
        const last = this.lastClick;
        this.lastClick = { id, t: now };
        if (last && last.id === id && now - last.t < 380) {
          this.lastClick = null;
          return this.quickUse(id);
        }
        return this.clickCard(id);
      }
      const seat = t.closest('[data-seat]');
      if (seat) return this.clickSeat(+seat.dataset.seat);
    }
    onDblClick(e) {}
    quickUse(id) {
      if (!this.pending) return;
      const req = this.pending.req;
      const c = this.findCard(id);
      if (!c) return;
      if (req.type === 'play' || req.type === 'respond') {
        if (this.sel.skill || !this.cardSelectable(c)) return this.render();
        this.sel = { cards: [c], targets: [], skill: null };
        if (req.type === 'play') this.autoTarget();
        if (this.canConfirm()) this.button('ok');
        else this.render();
      } else if (req.type === 'cards' && req.max === 1 && req.cands.includes(c)) {
        this.sel.cards = [c];
        this.button('ok');
      }
    }
    findCard(id) {
      const p = this.me;
      return p.cards('he').find((c) => String(c.id) === String(id));
    }
    clickCard(id) {
      if (!this.pending) return;
      const c = this.findCard(id);
      if (!c) return;
      const sel = this.sel;
      const req = this.pending.req;
      this.sound.play('click');
      if (sel.cards.includes(c)) {
        sel.cards = sel.cards.filter((x) => x !== c);
        if (!sel.skill) sel.targets = [];
      } else if (this.cardSelectable(c)) {
        const multi = req.type === 'cards' ? req.max > 1 : !!sel.skill;
        if (multi) sel.cards.push(c);
        else {
          sel.cards = [c];
          sel.targets = [];
        }
      } else if (!sel.skill && (req.type === 'play' || req.type === 'respond')) {
        return;
      }
      if (req.type === 'play' && !sel.skill) this.autoTarget();
      this.render();
    }
    autoTarget() {
      const spec = this.targetSpec();
      if (!spec || this.sel.targets.length) return;
      const cands = this.game.alivePlayers().filter((t) => spec.ok(t, []));
      if (cands.length === 1 && spec.min === 1 && spec.max === 1) this.sel.targets = [cands[0]];
    }
    clickSeat(seat) {
      if (!this.pending) return;
      const p = this.game.players[seat];
      const st = this.targetState(p);
      if (st === 'sel') {
        const i = this.sel.targets.indexOf(p);
        this.sel.targets = this.sel.targets.slice(0, i);
      } else if (st === 'ok') {
        const spec = this.targetSpec();
        if (spec.max === 1) this.sel.targets = [p];
        else this.sel.targets.push(p);
      } else return;
      this.sound.play('click');
      this.render();
    }
    clickSkill(id) {
      if (!this.pending) return;
      const req = this.pending.req;
      if (req.type === 'respond' && req.proxy === id) return this.finish({ proxy: true });
      if (this.sel.skill === id) this.sel = { cards: [], targets: [], skill: null };
      else this.sel = { cards: [], targets: [], skill: id };
      this.sound.play('click');
      this.render();
    }
    cancelSelection() {
      const req = this.pending && this.pending.req;
      if (!req) return;
      if (this.sel.cards.length || this.sel.targets.length || this.sel.skill) {
        this.sel = { cards: [], targets: [], skill: null };
        this.render();
      }
    }
    button(k) {
      const req = this.pending && this.pending.req;
      if (!req) return;
      this.sound.play('click');
      const { cards, targets, skill } = this.sel;
      if (k === 'end') return this.finish({ type: 'end' });
      if (k === 'recast') return this.finish({ type: 'recast', card: cards[0] });
      if (k === 'cancel') {
        if (req.type === 'play') return this.cancelSelection();
        if (req.type === 'respond') return this.finish(null);
        if (req.type === 'cards') return this.finish([]);
        if (req.type === 'targets') return this.finish([]);
        if (req.type === 'confirm') return this.finish(false);
      }
      if (k === 'ok') {
        if (!this.canConfirm()) return;
        if (req.type === 'play') {
          if (skill && this.skillObj(skill).enable) return this.finish({ type: 'skill', skill, cards, targets });
          return this.finish({ type: 'card', card: this.effCard(), targets });
        }
        if (req.type === 'respond') return this.finish(this.effCard());
        if (req.type === 'cards') return this.finish(cards);
        if (req.type === 'targets') return this.finish(targets);
        if (req.type === 'confirm') return this.finish(true);
      }
    }
    topAction(a) {
      this.sound.play('click');
      if (a === 'log') {
        this.logOpen = !this.logOpen;
        this.$('#log-drawer').classList.toggle('open', this.logOpen);
      } else if (a === 'sound' || a === 'voice' || a === 'music') {
        const k = { sound: 'on', voice: 'voiceOn', music: 'musicOn' }[a];
        this.sound[k] = !this.sound[k];
        if (a === 'music') this.sound.musicOn ? this.sound.startMusic() : this.sound.stopMusic();
        if (a === 'voice' && !this.sound.voiceOn && this.sound.curVoice) this.sound.curVoice.pause();
        try {
          localStorage.setItem('sgs-' + a, this.sound[k] ? '1' : '0');
        } catch (e) {}
      } else if (a === 'speed') {
        const names = Object.keys(SPEEDS);
        this.speedName = names[(names.indexOf(this.speedName) + 1) % names.length];
        this.speed = SPEEDS[this.speedName];
        try {
          localStorage.setItem('sgs-speed', this.speedName);
        } catch (e) {}
      } else if (a === 'auto') {
        this.autoPlay = !this.autoPlay;
        if (this.autoPlay && this.pending) {
          const { req } = this.pending;
          this.closeDialog();
          this.me.controller.ai.handle(req).then((r) => this.finish(r));
        }
      } else if (a === 'menu') {
        if (this.onMenu) this.onMenu();
      }
      this.render();
    }
    onHover(e) {
      const t = e.target;
      let html = null;
      const tc = t.closest('[data-tipcard]') || t.closest('#hand [data-cid]');
      const ts = t.closest('[data-tipskill]');
      const tg = t.closest('[data-tipgen]');
      const seat = t.closest('[data-seat]');
      if (tc) {
        const id = tc.dataset.tipcard || tc.dataset.cid;
        const c = this.lookupCard(id);
        if (c) html = this.cardTip(c);
      } else if (ts) {
        const s = this.skillObj(ts.dataset.tipskill);
        if (s) html = `<b>${s.name}</b><p>${s.desc || (SGS.CardDefs[s.id] && SGS.CardDefs[s.id].desc) || ''}</p>`;
      } else if (tg) {
        html = this.genTip(SGS.Generals[tg.dataset.tipgen]);
      } else if (seat && this.game) {
        const p = this.game.players[+seat.dataset.seat];
        if (p && p.general) html = this.genTip(p.general, p);
      }
      if (!html) return this.tip.classList.add('hidden');
      this.tip.innerHTML = html;
      this.tip.classList.remove('hidden');
      const x = e.clientX + 18,
        y = e.clientY + 18;
      const r = this.tip.getBoundingClientRect();
      this.tip.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
      this.tip.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    }
    lookupCard(id) {
      const g = this.game;
      if (!g) return null;
      for (const p of g.players) for (const c of p.cards('hej')) if (String(c.id) === String(id)) return c;
      for (const e of this.table) if (String(e.card.id) === String(id)) return e.card;
      for (const c of (this.wuguCards || []).concat(this.tipCards || [])) if (String(c.id) === String(id)) return c;
      return null;
    }
    cardTip(c) {
      const d = c.def;
      const suit = c.suit && c.suit !== 'none' ? `<span class="${SGS.isRedSuit(c.suit) ? 'lr' : 'lb'}">${SGS.SUIT_SYMBOL[c.suit]}${SGS.numStr(c.number)}</span> ` : '';
      return `<b>${suit}${c.displayName}</b> <small>${d.typeName}${d.range ? ' · 攻击范围' + d.range : ''}</small><p>${d.desc || ''}</p>`;
    }
    genTip(gen, p) {
      const sk = (p ? p.skills : gen.skills)
        .map((id) => SGS.Skills[id])
        .filter(Boolean)
        .map((s) => `<div class="tip-sk"><b>【${s.name}】</b>${s.desc}</div>`)
        .join('');
      let extra = '';
      if (p) {
        const eq = p.equipList().map((c) => c.name).join('、');
        extra = `<div class="tip-st">体力 ${Math.max(p.hp, 0)}/${p.maxHp} · 手牌 ${p.hand.length}${eq ? ' · 装备：' + eq : ''}${p.chained ? ' · 连环' : ''}${p.turnedOver ? ' · 翻面' : ''}</div>`;
      }
      return `<b class="k-${gen.kingdom}">${gen.name}</b> <small>${KN[gen.kingdom]} · ${gen.title} · ${gen.hp}体力 · ${gen.gender === 'female' ? '女' : '男'}</small>${extra}${sk}`;
    }

    // ================= 请求 =================
    request(p, req) {
      return new Promise((resolve) => {
        this.pending = { req, resolve };
        this.sel = { cards: [], targets: [], skill: null };
        this.dialogMode = false;
        if (req.type === 'option') this.dlgOption(req);
        else if (req.type === 'pickCard') this.dlgPick(req);
        else if (req.type === 'guanxing') this.dlgGuanxing(req);
        else if (req.type === 'wugu') this.wuguActivate(req);
        else if (req.type === 'general') this.dlgGeneral(req);
        if (req.type === 'play') this.sound.play('click');
        else if (req.type === 'respond') this.stage.classList.add('alert');
        this.render();
      });
    }
    finish(result) {
      const pd = this.pending;
      if (!pd) return;
      this.pending = null;
      this.dialogMode = false;
      this.sel = { cards: [], targets: [], skill: null };
      this.stage.classList.remove('alert');
      this.closeDialog();
      this.wuguDeactivate();
      this.render();
      pd.resolve(result);
    }
    abort() {
      this.pending = null;
      this.closeDialog();
    }

    // ================= 对话框 =================
    openDialog(title, body, cls) {
      const d = this.$('#dialog');
      d.className = 'dialog ' + (cls || '');
      d.innerHTML = `<div class="dlg-box"><div class="dlg-title">${title}</div><div class="dlg-body"></div></div>`;
      d.querySelector('.dlg-body').appendChild(body);
      this.dialogMode = true;
      return d;
    }
    closeDialog() {
      const d = this.$('#dialog');
      if (d) {
        d.className = 'hidden';
        d.innerHTML = '';
      }
      this.dialogMode = false;
    }
    dlgOption(req) {
      const body = el('div', 'dlg-options');
      req.options.forEach((o, i) => {
        const b = el('button', 'btn btn-opt', esc(o));
        b.onclick = () => this.finish(i);
        body.appendChild(b);
      });
      this.openDialog(req.prompt || '请选择', body);
    }
    dlgPick(req) {
      const t = req.target;
      const body = el('div', 'dlg-pick');
      const areas = req.areas || 'hej';
      const add = (label, cards, hiddenFace) => {
        if (!cards.length) return;
        const row = el('div', 'pick-row');
        row.appendChild(el('div', 'pick-label', label));
        const wrap = el('div', 'pick-cards');
        cards.forEach((c) => {
          const e = el('div', 'pick-item', hiddenFace ? this.cardHTML(null, { cls: 'sm' }) : this.cardHTML(c, { cls: 'sm', attrs: `data-tipcard="${c.id}"` }));
          e.onclick = () => this.finish(hiddenFace ? t.hand[Math.floor(Math.random() * t.hand.length)] : c);
          wrap.appendChild(e);
        });
        row.appendChild(wrap);
        body.appendChild(row);
      };
      if (areas.includes('h')) add('手牌', t.hand.slice(), t !== this.me);
      if (areas.includes('e')) add('装备区', t.equipList());
      if (areas.includes('j')) add('判定区', t.judges.slice());
      this.openDialog(req.prompt || `选择 ${esc(t.name)} 的一张牌`, body);
    }
    dlgGuanxing(req) {
      const top = req.cards.slice(),
        bottom = [];
      const body = el('div', 'dlg-gx');
      const draw = () => {
        body.innerHTML = '';
        for (const [label, arr, other] of [
          ['牌堆顶', top, bottom],
          ['牌堆底', bottom, top],
        ]) {
          const row = el('div', 'pick-row');
          row.appendChild(el('div', 'pick-label', label));
          const wrap = el('div', 'pick-cards gx-drop');
          arr.forEach((c) => {
            const e = el('div', 'pick-item', this.cardHTML(c, { cls: 'sm', attrs: `data-tipcard="${c.id}"` }));
            e.title = '点击移到另一行末尾';
            e.onclick = () => {
              arr.splice(arr.indexOf(c), 1);
              other.push(c);
              draw();
            };
            wrap.appendChild(e);
          });
          row.appendChild(wrap);
          body.appendChild(row);
        }
        const ok = el('button', 'btn btn-ok', '确 定');
        ok.onclick = () => this.finish({ top, bottom });
        const f = el('div', 'dlg-foot');
        f.appendChild(el('span', 'hint', '牌堆顶从左到右依次被摸到；点击牌可在两行之间移动（追加到末尾）'));
        f.appendChild(ok);
        body.appendChild(f);
      };
      this.tipCards = req.cards;
      draw();
      this.openDialog('观星', body, 'wide');
    }
    dlgGeneral(req) {
      const body = el('div', 'dlg-gens' + (req.choices.length > 5 ? ' many' : ''));
      req.choices.forEach((id) => {
        const gen = SGS.Generals[id];
        const e = el('div', 'gen-card');
        e.dataset.tipgen = id;
        const sk = gen.skills
          .map((s) => SGS.Skills[s])
          .filter((s) => s && (!s.lord || this.me.identity === 'lord'))
          .map((s) => `<div class="gc-sk"><b>${s.name}</b>${s.desc}</div>`)
          .join('');
        e.innerHTML = `${this.portraitHTML(gen)}<div class="gc-hp">${'<i class="mg g"></i>'.repeat(Math.min(gen.hp, 8))}</div><div class="gc-skills">${sk}</div>`;
        e.onclick = () => {
          this.sound.play('skill');
          this.finish(id);
        };
        body.appendChild(e);
      });
      const idn = SGS.ROLE_NAME[this.me.identity];
      this.openDialog(`<span class="r-${this.me.identity}">你的身份：${idn}</span> · 选择武将`, body, 'wide gens');
    }
    wuguShow(cards) {
      this.wuguCards = cards.slice();
      this.wuguTaken = new Map();
      this.renderWugu();
      this.$('#wugu').classList.remove('hidden');
    }
    renderWugu(active) {
      const box = this.$('#wugu');
      box.innerHTML = `<div class="wg-title">五谷丰登</div><div class="wg-cards">${this.wuguCards
        .map((c) => {
          const who = this.wuguTaken.get(c);
          return `<div class="wg-item ${who ? 'taken' : active ? 'pickable' : ''}" data-wg="${c.id}">${this.cardHTML(c, { cls: 'sm', attrs: `data-tipcard="${c.id}"` })}${who ? `<div class="wg-who">${esc(who)}</div>` : ''}</div>`;
        })
        .join('')}</div>${active ? '<div class="wg-hint">请选择一张牌</div>' : ''}`;
      if (active)
        box.querySelectorAll('.wg-item.pickable').forEach((e) => {
          e.onclick = () => {
            const c = this.wuguCards.find((x) => String(x.id) === e.dataset.wg);
            this.finish(c);
          };
        });
    }
    wuguActivate(req) {
      if (!this.wuguCards) this.wuguShow(req.cards);
      this.dialogMode = true;
      this.renderWugu(true);
    }
    wuguDeactivate() {
      if (this.wuguCards && !this.$('#wugu').classList.contains('hidden')) this.renderWugu(false);
    }

    // ================= 动画 =================
    async animMove({ moves, to, visible }) {
      if (!this.me || !moves.length) return;
      const toTable = to.zone === 'processing' || to.zone === 'discard';
      // 处理区 → 弃牌堆：无需飞行
      const flying = moves.filter((m) => !(toTable && (m.from.zone === 'processing' || m.from.zone === 'discard')));
      if (!flying.length) return;
      const anim = this.$('#anim');
      const toPt = this.zonePoint(to.zone, to.player);
      const dur = 420 * this.speed;
      const stagger = Math.min(90, 300 / flying.length) * this.speed;
      flying.forEach((m) => this.hidden.add(m.card.id));
      if (to.player === this.me) this.renderMe();
      const els = [];
      flying.forEach((m, i) => {
        const fromPt = this.zonePoint(m.from.zone, m.from.owner, m.card);
        const faceUp =
          visible ||
          toTable ||
          to.zone === 'e' ||
          to.zone === 'j' ||
          ['e', 'j', 'processing', 'discard'].includes(m.from.zone) ||
          (to.player === this.me && to.zone === 'h') ||
          (m.from.owner === this.me && m.from.zone === 'h') ||
          (this.game && this.game.over);
        const e = el('div', 'fly', this.cardHTML(faceUp ? m.card : null, { cls: 'sm' }));
        anim.appendChild(e);
        const off = (i - (flying.length - 1) / 2) * (toTable ? 52 : 18);
        const tx = toPt.x + off,
          ty = toPt.y;
        e.style.left = fromPt.x - 50 + 'px';
        e.style.top = fromPt.y - 70 + 'px';
        const a = e.animate(
          [
            { transform: 'translate(0,0) scale(0.85) rotate(0deg)', opacity: 0.2 },
            { opacity: 1, offset: 0.15 },
            { transform: `translate(${tx - fromPt.x}px,${ty - fromPt.y}px) scale(${toTable ? 1 : 0.7}) rotate(${(Math.random() - 0.5) * 8}deg)`, opacity: 1 },
          ],
          { duration: dur, delay: i * stagger, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' }
        );
        els.push([e, a]);
      });
      this.sound.play(to.zone === 'h' && flying.every((m) => !m.from.zone || m.from.zone === 'deck') ? 'draw' : 'card');
      await SGS.sleep(dur + stagger * (flying.length - 1) + 20);
      for (const [e] of els) e.remove();
      flying.forEach((m) => this.hidden.delete(m.card.id));
      if (toTable) for (const m of flying) this.tableEntryAdd(m.card);
      this.render();
    }
    floatText(p, text, cls) {
      const pt = this.pp(p);
      const e = el('div', 'float-num ' + (cls || ''), text);
      e.style.left = pt.x + 'px';
      e.style.top = pt.y + 'px';
      this.$('#anim').appendChild(e);
      setTimeout(() => e.remove(), 1600);
    }
    banner(text, cls, ms) {
      const e = el('div', 'banner ' + (cls || ''), `<span>${text}</span>`);
      this.$('#anim').appendChild(e);
      setTimeout(() => e.remove(), ms || 1600);
    }
    skillBanner(p, name) {
      const pt = this.pp(p);
      const e = el('div', 'skill-banner', `<span>${esc(name)}</span>`);
      const x = Math.max(150, Math.min(W - 150, pt.x));
      e.style.left = x + 'px';
      e.style.top = Math.max(90, Math.min(pt.y - 20, 640)) + 'px';
      this.$('#anim').appendChild(e);
      setTimeout(() => e.remove(), 1400 * Math.max(0.7, this.speed));
    }
    seatEl(p) {
      return p === this.me ? this.$('#me-seat') : this.$(`#seats [data-seat="${p.seat}"]`);
    }
    flashSeat(p, cls, ms) {
      const e = this.seatEl(p);
      if (!e) return;
      e.classList.remove(cls);
      void e.offsetWidth;
      e.classList.add(cls);
      setTimeout(() => {
        const e2 = this.seatEl(p);
        e2 && e2.classList.remove(cls);
      }, ms || 700);
    }
    shake(power) {
      this.stage.style.setProperty('--shake', power + 'px');
      this.stage.classList.remove('shaking');
      void this.stage.offsetWidth;
      this.stage.classList.add('shaking');
      setTimeout(() => this.stage.classList.remove('shaking'), 450);
    }
    screenFlash(color) {
      const e = el('div', 'screen-flash');
      e.style.background = color;
      this.$('#anim').appendChild(e);
      setTimeout(() => e.remove(), 600);
    }

    // 引擎特效钩子
    async fx(type, d) {
      if (!this.me) return;
      const F = this.fxe,
        S = this.sound;
      const w = (ms) => this.wait(ms);
      const pp = (p) => this.pp(p);
      switch (type) {
        case 'use': {
          const { user, card, targets } = d;
          const reals = SGS.realCards(card);
          const label = `${esc(this.nameOf(user))}${card.virtual && reals.length ? '·' + card.displayName : ''}`;
          for (const c of reals) {
            const e = this.tableFind(c);
            if (e) e.label = label;
          }
          if (!reals.length) this.tableEntryAdd(card, { label, ghost: true });
          this.renderTable();
          const n = card.name;
          // 转化牌已由技能配音代替出牌喊话
          if (!card.skill) S.cardVoice(card, user);
          if (targets && targets.length && !(card.def.targets && card.def.targets.all)) F.aim(pp(user), targets.map(pp), n === '杀' ? '#ff6a4a' : card.def.good ? '#7dff9a' : '#ffc14d');
          if (d.victim) F.aim(pp(targets[0]), [pp(d.victim)], '#ff4040');
          if (n === '杀') {
            S.play(card.nature === 'fire' ? 'fire' : card.nature === 'thunder' ? 'thunder' : 'slash');
            await w(260);
            await Promise.all(targets.map((t) => F.slash(pp(user), pp(t), card.nature)));
            return;
          }
          if (n === '南蛮入侵') {
            S.play('nanman');
            F.shockwave(pp(user));
            this.shake(6);
            return w(700);
          }
          if (n === '万箭齐发') {
            S.play('arrows');
            F.arrowRain(targets.map(pp));
            return w(750);
          }
          if (n === '桃园结义') {
            S.play('heal');
            for (const t of targets) F.sparkle(pp(t), SGS.PALETTE.heal, 20);
            return w(500);
          }
          if (n === '铁索连环') S.play('chain');
          else if (n === '决斗') {
            S.play('slash');
            if (targets[0]) F.slash(pp(user), pp(targets[0]), null);
          } else if (n === '无懈可击') {
            S.play('skill');
            this.banner('无懈可击', 'small gold', 900);
          } else if (n === '火攻') S.play('fire');
          else S.play('card');
          return w(card.def.type === 'equip' ? 150 : 420);
        }
        case 'respond': {
          const { player, card } = d;
          for (const c of SGS.realCards(card)) {
            const e = this.tableFind(c);
            if (e) e.label = `${esc(this.nameOf(player))}打出`;
          }
          if (!SGS.realCards(card).length) this.tableEntryAdd(card, { label: `${esc(this.nameOf(player))}·八卦`, ghost: true });
          if (!card.skill) S.cardVoice(card, player);
          if (card.name === '闪') {
            S.play('dodge');
            F.dodge(pp(player));
          } else S.play('card');
          this.renderTable();
          return w(320);
        }
        case 'damage': {
          const { target, num, nature } = d;
          S.play(nature === 'fire' ? 'fire' : nature === 'thunder' ? 'thunder' : 'hit');
          F.hit(pp(target), nature, num >= 2);
          if (nature === 'fire') F.flames(pp(target));
          if (nature === 'thunder') F.bolt(pp(target).x + 20, pp(target).y - 160, pp(target).x, pp(target).y, '#8a6bff');
          this.flashSeat(target, 'hurt', 700);
          this.floatText(target, '-' + num, 'dmg ' + (nature || ''));
          if (num >= 2 || target === this.me) this.shake(num >= 2 ? 9 : 5);
          if (target === this.me) this.screenFlash('rgba(200,0,0,.25)');
          return w(620);
        }
        case 'recover':
          S.play('heal');
          F.heal(pp(d.player));
          this.flashSeat(d.player, 'healed', 800);
          this.floatText(d.player, '+' + d.num, 'heal');
          return w(520);
        case 'loseHp':
          S.play('hit');
          this.flashSeat(d.player, 'hurt', 600);
          this.floatText(d.player, '-' + d.num, 'lose');
          F.sparkle(pp(d.player), ['#b06cff', '#7a3cff', '#e0c0ff'], 26);
          return w(450);
        case 'skill':
          S.play('skill');
          if (SGS.Skills[d.id]) S.skillVoice(d.id);
          else if (d.id === '八卦阵' || d.id === '仁王盾') S.play('armor');
          this.skillBanner(d.player, d.name);
          F.sparkle(pp(d.player), SGS.PALETTE.gold, 24);
          return w(420);
        case 'awaken':
          S.play('awaken');
          this.banner(`${esc(d.player.name)} · ${esc(d.name)}`, 'awaken', 1800);
          F.shockwave(pp(d.player), '#ffd66b');
          this.screenFlash('rgba(255,210,120,.25)');
          return w(1500);
        case 'rebirth':
          F.flames(pp(d.player));
          F.heal(pp(d.player));
          return w(700);
        case 'dying':
          this.flashSeat(d.player, 'dying-pulse', 900);
          return w(300);
        case 'death':
          S.play('death');
          S.deathVoice(d.player.general);
          F.ash(pp(d.player));
          this.shake(8);
          this.flashSeat(d.player, 'die-anim', 1400);
          if (d.player === this.me) this.screenFlash('rgba(0,0,0,.55)');
          this.banner(`${esc(d.player.name)} 阵亡 · ${SGS.ROLE_NAME[d.player.identity]}`, 'death', 1600);
          return w(1300);
        case 'judgeStart':
          return w(250);
        case 'judge': {
          S.play('judge');
          this.tableEntryAdd(d.card, { label: `${esc(this.nameOf(d.player))}·${esc(d.reason)}`, judge: true });
          return w(650);
        }
        case 'judgeResult': {
          const e = this.tableFind(d.card);
          if (e) e.stamp = d.good ? { text: '生效', cls: 'good' } : { text: '失效', cls: 'bad' };
          if (['乐不思蜀', '兵粮寸断', '闪电'].includes(d.reason) || d.reason === '八卦阵' || d.reason === '八阵') {
            const good = d.good;
            if (e) e.stamp = good ? { text: d.reason === '八卦阵' || d.reason === '八阵' ? '闪' : '无效', cls: 'good' } : { text: d.reason === '八卦阵' || d.reason === '八阵' ? '未闪' : '生效', cls: 'bad' };
          }
          S.play(d.good ? 'good' : 'bad');
          this.renderTable();
          return w(650);
        }
        case 'nullify':
          return w(200);
        case 'equip':
          S.play('equip');
          F.sparkle(d.player === this.me ? P_MYEQ : { x: pp(d.player).x, y: pp(d.player).y + 50 }, SGS.PALETTE.gold, 18);
          return w(120);
        case 'chain':
          S.play('chain');
          F.sparkle(pp(d.player), SGS.PALETTE.chain, 22);
          return w(220);
        case 'chainSpread':
          F.chain(pp(d.from), pp(d.to));
          return w(350);
        case 'turnOver':
          this.flashSeat(d.player, 'flip', 600);
          return w(450);
        case 'lightning': {
          const p = pp(d.player);
          S.play('thunder');
          F.bolt(p.x + (Math.random() - 0.5) * 120, -20, p.x, p.y, '#7a5cff');
          if (!d.small) {
            this.screenFlash('rgba(190,170,255,.45)');
            this.shake(10);
          }
          return w(d.small ? 250 : 700);
        }
        case 'armor':
          F.dodge(pp(d.player));
          this.floatText(d.player, d.name, 'armor');
          S.play('equip');
          return w(400);
        case 'wine':
          F.sparkle(pp(d.player), ['#ff6a6a', '#ff2a2a', '#ffb0a0'], 30);
          this.floatText(d.player, '酒', 'wine');
          return w(320);
        case 'show':
          for (const c of d.cards) this.tableEntryAdd(c, { label: `${esc(this.nameOf(d.player))}展示`, ghost: true });
          S.play('card');
          return w(900);
        case 'pindian': {
          const ea = this.tableFind(d.ca),
            eb = this.tableFind(d.cb);
          if (ea) {
            ea.label = esc(this.nameOf(d.a));
            ea.stamp = d.win ? { text: '赢', cls: 'good' } : { text: '没赢', cls: 'bad' };
          }
          if (eb) {
            eb.label = esc(this.nameOf(d.b));
            eb.stamp = !d.win ? { text: '赢', cls: 'good' } : { text: '没赢', cls: 'bad' };
          }
          this.renderTable();
          S.play(d.win ? 'good' : 'bad');
          return w(1100);
        }
        case 'wuguShow':
          this.wuguShow(d.cards);
          return w(600);
        case 'wuguPick':
          this.wuguTaken.set(d.card, this.nameOf(d.player));
          this.renderWugu(false);
          return w(350);
        case 'wuguEnd':
          await w(400);
          this.$('#wugu').classList.add('hidden');
          this.wuguCards = null;
          return;
        case 'redirect':
          F.aim(pp(d.from), [pp(d.to)], '#ff9ad5');
          return w(400);
        case 'lordReveal':
          S.play('awaken');
          this.banner(`主公 · ${esc(d.player.name)}`, 'lord', 1500);
          return w(1200);
        case 'gameStart':
          this.banner('游 戏 开 始', 'start', 1500);
          S.play('awaken');
          return w(1100);
        case 'turnStart': {
          this.table = this.table.filter((e) => e.card.zone === 'processing');
          if (d.player === this.me && !this.autoPlay) {
            S.play('myturn');
            this.banner('你 的 回 合', 'myturn', 1100);
            return w(700);
          }
          S.play('turn');
          return w(250);
        }
        case 'shuffle':
          S.play('draw');
          return;
      }
    }

    // ================= 结束界面 =================
    showResult(result, onAgain, onMenu) {
      const g = this.game;
      const me = this.me;
      const win = result.winners.includes(me.identity);
      this.sound.play(result.winners.length ? (win ? 'win' : 'lose') : 'lose');
      const rows = g.players
        .map(
          (p) => `<tr class="${result.winners.includes(p.identity) ? 'w' : ''} ${p === me ? 'me' : ''}">
          <td>${p.seat + 1}</td><td class="k-${p.kingdom}">${esc(p.name)}${p === me ? '（你）' : ''}</td>
          <td class="r-${p.identity}">${SGS.ROLE_NAME[p.identity]}</td><td>${p.alive ? '存活' : '阵亡'}</td>
          <td>${result.winners.includes(p.identity) ? '胜' : '负'}</td></tr>`
        )
        .join('');
      const body = el(
        'div',
        'result',
        `<div class="res-title ${result.winners.length ? (win ? 'win' : 'lose') : ''}">${result.winners.length ? (win ? '胜 利' : '失 败') : '平 局'}</div>
         <div class="res-reason">${esc(result.reason || '')}</div>
         <table class="res-table"><tr><th>座次</th><th>武将</th><th>身份</th><th>状态</th><th>结果</th></tr>${rows}</table>
         <div class="dlg-foot"><button class="btn btn-ok" data-r="again">再来一局</button><button class="btn" data-r="menu">返回菜单</button></div>`
      );
      body.querySelector('[data-r=again]').onclick = () => onAgain();
      body.querySelector('[data-r=menu]').onclick = () => onMenu();
      this.openDialog('对局结束', body, 'result-dlg');
      if (win) for (let i = 0; i < 6; i++) setTimeout(() => this.fxe.sparkle({ x: 300 + Math.random() * 1000, y: 150 + Math.random() * 400 }, SGS.PALETTE.gold, 50), i * 250);
    }
  }
  SGS.UI = UI;

  class HumanController {
    constructor(ui, game, p) {
      this.ui = ui;
      this.p = p;
      this.ai = new SGS.AIController(game, p, 'hard');
    }
    async handle(req) {
      if (this.ui.autoPlay) return this.ai.handle(req);
      return this.ui.request(this.p, req);
    }
  }
  SGS.HumanController = HumanController;
})();
