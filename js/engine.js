// 游戏核心引擎：回合流程、卡牌结算、伤害/濒死/判定、技能触发
(function () {
  const SGS = globalThis.SGS;
  const PHASES = ['start', 'judge', 'draw', 'play', 'discard', 'end'];
  const PHASE_NAME = { start: '准备阶段', judge: '判定阶段', draw: '摸牌阶段', play: '出牌阶段', discard: '弃牌阶段', end: '结束阶段' };
  SGS.PHASE_NAME = PHASE_NAME;
  const ROLE_SETS = {
    2: ['lord', 'rebel'],
    3: ['lord', 'rebel', 'spy'],
    4: ['lord', 'loyal', 'rebel', 'spy'],
    5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'],
    6: ['lord', 'loyal', 'rebel', 'rebel', 'rebel', 'spy'],
    7: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'spy'],
    8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
  };
  SGS.ROLE_SETS = ROLE_SETS;

  const NullUI = {
    refresh() {},
    log() {},
    fx() {},
    animMove() {},
    wait() {},
    announce() {},
  };
  SGS.NullUI = NullUI;

  class Player {
    constructor(game, seat) {
      this.game = game;
      this.seat = seat;
      this.hand = [];
      this.equips = { weapon: null, armor: null, minus: null, plus: null };
      this.judges = [];
      this.alive = true;
      this.chained = false;
      this.turnedOver = false;
      this.marks = {};
      this.skills = [];
      this.turn = {};
      this.skip = {};
      this.identity = null;
      this.revealed = false;
      this.general = null;
      this.hp = 0;
      this.maxHp = 0;
      this.wine = false;
      this.isHuman = false;
      this.controller = null;
    }
    get name() {
      return this.general ? this.general.name : `${this.seat + 1}号位`;
    }
    get kingdom() {
      return this.general ? this.general.kingdom : 'qun';
    }
    get gender() {
      return this.general ? this.general.gender || 'male' : 'male';
    }
    equipList() {
      return ['weapon', 'armor', 'minus', 'plus'].map((k) => this.equips[k]).filter(Boolean);
    }
    cards(areas = 'h') {
      const r = [];
      if (areas.includes('h')) r.push(...this.hand);
      if (areas.includes('e')) r.push(...this.equipList());
      if (areas.includes('j')) r.push(...this.judges);
      return r;
    }
    countCards(areas = 'h') {
      return this.cards(areas).length;
    }
    hasJudge(name) {
      return this.judges.some((c) => c.name === name);
    }
    get lostHp() {
      return this.maxHp - Math.max(this.hp, 0);
    }
  }
  SGS.Player = Player;

  class Game {
    constructor(opts) {
      this.opts = Object.assign({ playerCount: 5, difficulty: 'normal', humanSeat: 0, humanRole: 'random', choiceCount: 5 }, opts || {});
      this.ui = this.opts.ui || NullUI;
      this.seed = this.opts.seed != null ? this.opts.seed : Math.floor(Math.random() * 1e9);
      this.rng = SGS.makeRng(this.seed);
      this.players = [];
      this.deck = [];
      this.discardPile = [];
      this.processing = [];
      this.current = null;
      this.phase = null;
      this.turnCount = 0;
      this.over = false;
      this.aborted = false;
      this.imp = {};
      this.extraTurns = [];
      this.stats = { actions: 0 };
    }

    // ================= 基础工具 =================
    random() {
      return this.rng();
    }
    nm(p) {
      if (!p) return '';
      return `<b class="pn k-${p.kingdom}">${p.name}</b>`;
    }
    log(text) {
      this.ui.log(text);
    }
    refresh() {
      this.ui.refresh();
    }
    async wait(ms) {
      if (this.aborted) throw new SGS.GameAbort();
      await this.ui.wait(ms);
    }
    alivePlayers() {
      return this.players.filter((p) => p.alive);
    }
    nextAlive(p) {
      const n = this.players.length;
      for (let i = 1; i <= n; i++) {
        const q = this.players[(p.seat + i) % n];
        if (q.alive) return q;
      }
      return null;
    }
    prevAlive(p) {
      const n = this.players.length;
      for (let i = 1; i <= n; i++) {
        const q = this.players[(p.seat - i + n * 2) % n];
        if (q.alive) return q;
      }
      return null;
    }
    // 从 start 开始按座次排列的存活角色
    playersFrom(start, includeStart = true) {
      const n = this.players.length;
      const r = [];
      for (let i = includeStart ? 0 : 1; i < n; i++) {
        const q = this.players[(start.seat + i) % n];
        if (q.alive) r.push(q);
      }
      return r;
    }
    playersFromCurrent() {
      return this.playersFrom(this.current || this.players[0]);
    }
    sortBySeat(list, from) {
      const n = this.players.length;
      return list.slice().sort((a, b) => ((a.seat - from.seat + n) % n) - ((b.seat - from.seat + n) % n));
    }
    lord() {
      return this.players.find((p) => p.identity === 'lord');
    }

    // ================= 技能 =================
    hasSkill(p, id) {
      return !!p && p.skills.includes(id) && !(p.marks.noSkill);
    }
    skillsOf(p) {
      const r = [];
      if (!p.marks.noSkill) for (const id of p.skills) if (SGS.Skills[id]) r.push(SGS.Skills[id]);
      const E = SGS.EquipSkills || {};
      for (const c of p.equipList()) if (E[c.name]) r.push(E[c.name]);
      return r;
    }
    async trigger(name, ev) {
      ev = ev || {};
      for (const p of this.playersFromCurrent()) {
        if (!p.alive) continue;
        for (const s of this.skillsOf(p)) {
          const h = s.trigger && s.trigger[name];
          if (!h) continue;
          if (!p.alive && name !== 'death') break;
          await h(this, p, ev, s);
          if (ev.stop) return ev;
        }
      }
      return ev;
    }
    async announce(p, id, text) {
      const s = SGS.Skills[id] || (SGS.EquipSkills && SGS.EquipSkills[id]);
      const name = s ? s.name : id;
      this.log(`${this.nm(p)} 发动了【${name}】${text || ''}`);
      await this.ui.fx('skill', { player: p, name, id });
    }
    modSum(p, key, ...args) {
      let v = 0;
      for (const s of this.skillsOf(p)) if (s.mod && s.mod[key]) v += s.mod[key](this, p, ...args) || 0;
      return v;
    }

    // ================= 距离 =================
    distance(a, b, card) {
      if (a === b) return 0;
      if (!a.alive || !b.alive) return Infinity;
      const alive = this.alivePlayers();
      const ia = alive.indexOf(a),
        ib = alive.indexOf(b);
      const n = alive.length;
      const cw = (ib - ia + n) % n;
      let d = Math.min(cw, n - cw);
      const ex = card ? SGS.realCards(card) : [];
      if (b.equips.plus) d += 1;
      if (a.equips.minus && !ex.includes(a.equips.minus)) d -= 1;
      d += this.modSum(b, 'distanceTo', a);
      d -= this.modSum(a, 'distanceFrom', b);
      return Math.max(1, d);
    }
    attackRange(p, card) {
      const w = p.equips.weapon;
      const ex = card ? SGS.realCards(card) : [];
      let r = w && !ex.includes(w) ? w.def.range : 1;
      return r + this.modSum(p, 'attackRange');
    }
    inAttackRange(a, b, card) {
      return a !== b && this.distance(a, b, card) <= this.attackRange(a, card);
    }
    slashInRange(a, b, card) {
      if (a.turn && a.turn.tianyiWin && this.current === a) return a !== b;
      return this.inAttackRange(a, b, card);
    }
    slashLimit(p) {
      if (p.turn.noSlash) return 0;
      if (p.equips.weapon && p.equips.weapon.name === '诸葛连弩') return Infinity;
      if (this.hasSkill(p, 'paoxiao')) return Infinity;
      return 1 + (p.turn.extraSlash || 0) + this.modSum(p, 'slashLimit');
    }
    canSlashMore(p, c) {
      if (!p.turn) return false;
      if (c && c.virtual && c.subcards.includes(p.equips.weapon) && p.equips.weapon.name === '诸葛连弩') return p.turn.slashCount < 1;
      return p.turn.slashCount < this.slashLimit(p);
    }
    slashMaxTargets(p, c) {
      let n = 1;
      if (p.equips.weapon && p.equips.weapon.name === '方天画戟' && c) {
        const subs = SGS.realCards(c);
        if (p.hand.length > 0 && p.hand.every((h) => subs.includes(h))) n += 2;
      }
      if (p.turn && p.turn.tianyiWin) n += 1;
      return n;
    }
    handLimit(p) {
      return Math.max(0, p.hp) + this.modSum(p, 'handLimit');
    }
    canTarget(user, t, card) {
      if (!t.alive) return false;
      for (const s of this.skillsOf(t)) if (s.mod && s.mod.targetable && s.mod.targetable(this, t, card, user) === false) return false;
      return true;
    }
    dummySlash() {
      return new SGS.VCard('杀', []);
    }
    suitOf(card, p) {
      if (p && this.hasSkill(p, 'hongyan') && card.suit === 'spade') return 'heart';
      return card.suit;
    }

    // ================= 牌区移动 =================
    _remove(card) {
      const o = card.owner;
      switch (card.zone) {
        case 'h':
          SGS.remove(o.hand, card);
          break;
        case 'e':
          for (const k in o.equips) if (o.equips[k] === card) o.equips[k] = null;
          break;
        case 'j': {
          const i = o.judges.findIndex((e) => e === card || (e.virtual && e.subcards.includes(card)));
          if (i >= 0) o.judges.splice(i, 1);
          break;
        }
        case 'deck':
          SGS.remove(this.deck, card);
          break;
        case 'discard':
          SGS.remove(this.discardPile, card);
          break;
        case 'processing':
          SGS.remove(this.processing, card);
          break;
      }
      card.zone = null;
      card.owner = null;
    }
    _put(card, zone, owner) {
      card.owner = owner || null;
      card.zone = zone;
      if (zone === 'h') owner.hand.push(card);
      else if (zone === 'e') owner.equips[card.subtype] = card;
      else if (zone === 'deckTop') {
        card.zone = 'deck';
        this.deck.unshift(card);
      } else if (zone === 'deckBottom') {
        card.zone = 'deck';
        this.deck.push(card);
      } else if (zone === 'discard') {
        this.discardPile.push(card);
        card.owner = null;
      } else if (zone === 'processing') {
        this.processing.push(card);
        card.owner = null;
      }
    }
    reshuffle() {
      if (!this.discardPile.length) return;
      this.deck = SGS.shuffle(this.discardPile.splice(0), this.rng);
      for (const c of this.deck) {
        c.zone = 'deck';
        c.owner = null;
      }
      this.log('<i>牌堆已耗尽，弃牌堆洗混成为新的牌堆</i>');
      this.ui.fx('shuffle', {});
    }
    takeTop(n) {
      const r = [];
      for (let i = 0; i < n; i++) {
        if (!this.deck.length) this.reshuffle();
        if (!this.deck.length) throw new SGS.GameOver([], '牌堆耗尽，游戏平局');
        const c = this.deck[0];
        this._remove(c);
        r.push(c);
      }
      return r;
    }
    async moveCards(cards, to, opts = {}) {
      cards = SGS.realCards(cards).filter(Boolean);
      if (!cards.length) return;
      const lost = new Map();
      const moves = [];
      for (const c of cards) {
        const from = { zone: c.zone, owner: c.owner };
        if (from.owner && (from.zone === 'h' || from.zone === 'e')) {
          if (!lost.has(from.owner)) lost.set(from.owner, { hand: [], equip: [] });
          lost.get(from.owner)[from.zone === 'h' ? 'hand' : 'equip'].push(c);
        }
        moves.push({ card: c, from });
        this._remove(c);
        this._put(c, to.zone, to.player);
      }
      this.refresh();
      await this.ui.animMove({ moves, to, visible: opts.visible, reason: opts.reason });
      this.refresh();
      for (const [p, info] of lost) {
        const ev = { player: p, cards: [...info.hand, ...info.equip], hand: info.hand, equip: info.equip, to, reason: opts.reason };
        if (p.alive && info.equip.some((c) => c.name === '白银狮子') && p.hp < p.maxHp) {
          this.log(`${this.nm(p)} 失去【白银狮子】，回复1点体力`);
          await this.recover(p, 1, null);
        }
        await this.trigger('cardsLost', ev);
      }
    }
    async draw(p, n, opts = {}) {
      if (n <= 0 || !p.alive) return [];
      const cards = this.takeTop(n);
      this.log(`${this.nm(p)} 摸了 ${n} 张牌`);
      await this.moveCards(cards, { zone: 'h', player: p }, { reason: 'draw', visible: false });
      return cards;
    }
    async discard(p, cards, opts = {}) {
      cards = SGS.realCards(cards);
      if (!cards.length) return;
      this.log(`${this.nm(p)} 弃置了 ${cards.map(SGS.cardText).join('')}`);
      await this.moveCards(cards, { zone: 'discard' }, { reason: 'discard', visible: true });
    }
    async discardFrom(t, cards, by) {
      cards = SGS.realCards(cards);
      if (!cards.length) return;
      this.log(`${this.nm(by)} 弃置了 ${this.nm(t)} 的 ${cards.map(SGS.cardText).join('')}`);
      await this.moveCards(cards, { zone: 'discard' }, { reason: 'discard', visible: true });
    }
    async obtain(p, cards, opts = {}) {
      cards = SGS.realCards(cards);
      if (!cards.length || !p.alive) return;
      const txt = opts.visible ? cards.map(SGS.cardText).join('') : `${cards.length} 张牌`;
      this.log(`${this.nm(p)} 获得了${opts.from ? ` ${this.nm(opts.from)} 的` : ''} ${txt}`);
      await this.moveCards(cards, { zone: 'h', player: p }, { reason: 'obtain', visible: opts.visible });
    }
    async give(from, to, cards) {
      cards = SGS.realCards(cards);
      if (!cards.length) return;
      this.log(`${this.nm(from)} 将 ${cards.length} 张牌交给了 ${this.nm(to)}`);
      await this.moveCards(cards, { zone: 'h', player: to }, { reason: 'give' });
    }
    async equip(p, card) {
      const slot = card.subtype;
      const old = p.equips[slot];
      if (old) await this.moveCards([old], { zone: 'discard' }, { reason: 'replace', visible: true });
      await this.moveCards([card], { zone: 'e', player: p }, { reason: 'equip', visible: true });
      this.log(`${this.nm(p)} 装备了 ${SGS.cardText(card)}`);
      await this.ui.fx('equip', { player: p, card });
    }
    async placeDelay(t, card) {
      const reals = SGS.realCards(card);
      for (const c of reals) {
        const from = { zone: c.zone, owner: c.owner };
        this._remove(c);
        c.zone = 'j';
        c.owner = t;
        await this.ui.animMove({ moves: [{ card: c, from }], to: { zone: 'j', player: t }, visible: true });
      }
      t.judges.push(card);
      this.refresh();
    }
    async passLightning(p, card) {
      let q = this.nextAlive(p);
      const reals = SGS.realCards(card);
      for (let i = 0; i < this.players.length && q; i++) {
        if (!q.hasJudge('闪电') && this.canTarget(p, q, card)) break;
        q = this.nextAlive(q);
      }
      if (!q) q = p;
      for (const c of reals) if (c.zone === 'processing') this._remove(c);
      for (const c of reals) {
        c.zone = 'j';
        c.owner = q;
      }
      q.judges.push(card);
      this.log(`【闪电】移动到了 ${this.nm(q)} 的判定区`);
      await this.ui.animMove({ moves: reals.map((c) => ({ card: c, from: { zone: 'j', owner: p } })), to: { zone: 'j', player: q }, visible: true });
      this.refresh();
    }

    // ================= 询问 =================
    async ask(p, req) {
      if (this.aborted) throw new SGS.GameAbort();
      req.player = p;
      this.stats.actions++;
      const res = await p.controller.handle(req);
      if (this.aborted) throw new SGS.GameAbort();
      return res;
    }
    async chooseCards(p, opts) {
      const from = opts.from || 'h';
      const cands = p.cards(from).filter((c) => !opts.filter || opts.filter(c));
      const min = Math.min(opts.min != null ? opts.min : 1, cands.length);
      const max = Math.min(opts.max != null ? opts.max : min, cands.length);
      if (max <= 0) return [];
      if (opts.autoAll && min === cands.length) return cands;
      const res = (await this.ask(p, Object.assign({}, opts, { type: 'cards', cands, min, max, from }))) || [];
      const valid = res.filter((c) => cands.includes(c));
      const uniq = [...new Set(valid)].slice(0, max);
      if (uniq.length < min) {
        for (const c of cands) if (uniq.length < min && !uniq.includes(c)) uniq.push(c);
      }
      return uniq;
    }
    async chooseTargets(p, opts) {
      const cands = (opts.candidates || this.alivePlayers()).filter((t) => t.alive && (!opts.filter || opts.filter(t)));
      const min = Math.min(opts.min != null ? opts.min : 1, cands.length);
      const max = Math.min(opts.max != null ? opts.max : 1, cands.length);
      if (max <= 0) return [];
      const res = (await this.ask(p, Object.assign({}, opts, { type: 'targets', cands, min, max }))) || [];
      const uniq = [...new Set(res.filter((t) => cands.includes(t)))].slice(0, max);
      if (uniq.length < min) for (const t of cands) if (uniq.length < min && !uniq.includes(t)) uniq.push(t);
      return uniq;
    }
    async confirm(p, prompt, ai, opts) {
      return !!(await this.ask(p, Object.assign({ type: 'confirm', prompt, ai }, opts || {})));
    }
    async chooseOption(p, options, prompt, ai, opts) {
      const r = await this.ask(p, Object.assign({ type: 'option', options, prompt, ai }, opts || {}));
      return typeof r === 'number' && r >= 0 && r < options.length ? r : 0;
    }
    async pickCardFrom(p, t, areas, opts = {}) {
      const all = t.cards(areas);
      if (!all.length) return null;
      const r = await this.ask(p, Object.assign({ type: 'pickCard', target: t, areas }, opts));
      if (r && all.includes(r)) return r;
      return all[Math.floor(this.random() * all.length)];
    }

    // ================= 转化技 / 响应 =================
    viewAsSkills(p, mode) {
      const r = [];
      for (const s of this.skillsOf(p)) {
        if (!s.viewAs) continue;
        if (s.viewAs.when && !s.viewAs.when(this, p, mode)) continue;
        r.push(s);
      }
      return r;
    }
    viewAsName(s, cards) {
      const a = s.viewAs.as;
      return typeof a === 'function' ? a(cards[0], this) : a;
    }
    makeVirtual(s, cards) {
      const name = this.viewAsName(s, cards);
      if (!name) return null;
      return new SGS.VCard(name, cards, { skill: s.id, nature: s.viewAs.nature });
    }
    viewAsCands(p, s, selected = []) {
      const v = s.viewAs;
      return p.cards(v.areas || 'h').filter((c) => !selected.includes(c) && v.filter(this, p, c, selected));
    }
    // 某角色能否响应出 names 中的牌
    canProduce(p, names, mode) {
      if (p.hand.some((c) => names.includes(c.name))) return true;
      for (const s of this.viewAsSkills(p, mode || 'respond')) {
        const v = s.viewAs;
        const cands = this.viewAsCands(p, s);
        if ((v.count || 1) === 1) {
          if (cands.some((c) => names.includes(this.viewAsName(s, [c])))) return true;
        } else if (cands.length >= v.count && names.includes(this.viewAsName(s, cands.slice(0, v.count)))) return true;
      }
      return false;
    }
    proxySkillFor(p, names) {
      if (names.includes('闪') && this.hasSkill(p, 'hujia') && this.alivePlayers().some((q) => q !== p && q.kingdom === 'wei')) return 'hujia';
      if (names.includes('杀') && this.hasSkill(p, 'jijiang') && this.alivePlayers().some((q) => q !== p && q.kingdom === 'shu')) return 'jijiang';
      return null;
    }
    // 只询问，不移动牌
    async askCard(p, names, opts = {}) {
      if (!p.alive) return null;
      const proxy = opts.noProxy ? null : this.proxySkillFor(p, names);
      if (!this.canProduce(p, names, 'respond') && !proxy) return null;
      const res = await this.ask(p, Object.assign({}, opts, { type: 'respond', names, proxy }));
      if (res && res.proxy && proxy) {
        await this.announce(p, proxy);
        const kingdom = proxy === 'hujia' ? 'wei' : 'shu';
        for (const q of this.playersFrom(p, false)) {
          if (q.kingdom !== kingdom) continue;
          const c = await this.askCard(q, names, {
            reason: 'proxy',
            beneficiary: p,
            noProxy: true,
            prompt: `${this.nm(p)} 发动【${SGS.Skills[proxy].name}】，是否替其打出一张【${names[0]}】？`,
          });
          if (c) return c;
        }
        return null;
      }
      if (!res || res.proxy) return null;
      if (!names.includes(res.name)) return null;
      return res;
    }
    // 询问并打出（移入弃牌堆）
    async respond(p, names, opts = {}) {
      const c = await this.askCard(p, names, opts);
      if (!c) return null;
      const owner = SGS.realCards(c)[0] ? SGS.realCards(c)[0].owner : p;
      if (c.skill) await this.announce(owner || p, c.skill);
      this.log(`${this.nm(owner || p)} 打出了 ${SGS.cardText(c)}`);
      await this.moveCards(SGS.realCards(c), { zone: 'discard' }, { reason: 'respond', visible: true });
      await this.ui.fx('respond', { player: owner || p, card: c });
      if (c.name === '杀' && (owner || p) === this.current) (owner || p).turn.slashPlayed = true;
      await this.trigger('cardResponded', { player: owner || p, card: c, names, opts });
      return c;
    }
    // 需要一张闪（含八卦阵）
    async dodge(t, opts = {}) {
      const armorOk = this.armorActive(t, opts) && t.equips.armor.name === '八卦阵';
      const bazhen = !t.equips.armor && this.hasSkill(t, 'bazhen');
      if ((armorOk || bazhen) && t.alive) {
        const nm = armorOk ? '八卦阵' : 'bazhen';
        if (await this.confirm(t, `是否发动【${armorOk ? '八卦阵' : '八阵'}】进行判定？`, () => true, { skill: nm })) {
          await this.announce(t, nm);
          const j = await this.judge(t, armorOk ? '八卦阵' : '八阵', (x) => SGS.isRedSuit(this.suitOf(x, t)));
          if (j.good) {
            this.log(`${this.nm(t)} 视为使用了一张【闪】`);
            await this.ui.fx('respond', { player: t, card: new SGS.VCard('闪', []) });
            await this.trigger('cardResponded', { player: t, card: new SGS.VCard('闪', []), names: ['闪'], opts });
            return true;
          }
        }
      }
      const c = await this.respond(t, ['闪'], Object.assign({ prompt: '请打出一张【闪】' }, opts));
      return !!c;
    }
    armorActive(p, ctx) {
      if (!p.equips.armor) return false;
      if (ctx && ctx.ignoreArmor) return false;
      return true;
    }
    blockedByArmor(t, card, ctx) {
      return false; // 免疫在 useCard 中统一处理
    }
    isImmune(t, card, user, ctx) {
      const name = card.name;
      if (name === '南蛮入侵' && (this.hasSkill(t, 'huoshou') || this.hasSkill(t, 'juxiang'))) {
        this.log(`【南蛮入侵】对 ${this.nm(t)} 无效`);
        return true;
      }
      if ((name === '南蛮入侵' || name === '万箭齐发') && this.armorActive(t) && t.equips.armor.name === '藤甲') {
        this.log(`${this.nm(t)} 的【藤甲】使 ${SGS.cardText(card)} 无效`);
        this.ui.fx('armor', { player: t, name: '藤甲' });
        return true;
      }
      return false;
    }

    // ================= 使用牌 =================
    isUsable(p, card) {
      const def = card.def;
      if (!def) return false;
      if (def.canUse && !def.canUse(this, p, card)) return false;
      if (def.type === 'equip') return true;
      const t = def.targets;
      if (!t) return false;
      if (t.self) return true;
      if (t.all) return this.aoeTargets(p, card).length > 0;
      return this.alivePlayers().some((x) => this.targetOk(p, x, card, []));
    }
    targetOk(p, t, card, sel) {
      const f = card.def.targets && card.def.targets.filter;
      if (!f) return false;
      return !!f(this, p, t, card, sel || []);
    }
    maxTargets(p, card) {
      const m = card.def.targets.max;
      return typeof m === 'function' ? m(this, p, card) : m;
    }
    aoeTargets(p, card) {
      const mode = card.def.targets.all;
      const list = mode === 'others' ? this.playersFrom(p, false).filter((x) => x !== p) : this.playersFrom(p);
      return list.filter((x) => this.canTarget(p, x, card));
    }
    async useCard(user, card, targets, opts = {}) {
      if (card.name === '杀' && !card.nature && user.equips.weapon && user.equips.weapon.name === '朱雀羽扇' && !opts.dying) {
        const enemyT = (targets || []).some((t) => SGS.AI.att(this, user, t) < 0);
        if (await this.confirm(user, '是否发动【朱雀羽扇】，将此【杀】当火【杀】使用？', () => enemyT, { skill: '朱雀羽扇' })) {
          await this.announce(user, '朱雀羽扇');
          card = new SGS.VCard('杀', SGS.realCards(card), { nature: 'fire', skill: card.skill });
        }
      }
      const def = card.def;
      const reals = SGS.realCards(card);
      targets = (targets || []).filter(Boolean);
      if (def.targets && def.targets.self && !targets.length) targets = [user];
      if (def.targets && def.targets.all && !opts.nullify) targets = this.aoeTargets(user, card);
      if (def.split && targets.length === 2 && !opts.ctx) {
        opts.ctx = { victim: targets[1] };
        targets = [targets[0]];
      }
      if (!def.split && targets.length > 1) targets = this.sortBySeat(targets, user);
      if (card.skill && !opts.silentSkill) await this.announce(user, card.skill);
      // 牌移入处理区
      if (reals.length) await this.moveCards(reals, { zone: 'processing' }, { reason: 'use', visible: true });
      const ctx = Object.assign({ card, user, targets: targets.slice() }, opts.ctx || {});
      if (opts.dying) ctx.dying = true;
      if (card.name === '杀') {
        if (user === this.current && !opts.free && this.phase === 'play') user.turn.slashCount++;
        if (user === this.current) user.turn.slashPlayed = true;
        ctx.wine = user.wine ? 1 : 0;
        user.wine = false;
      }
      const tgtText = targets.length && !(def.targets && def.targets.self) ? ` 指定 ${targets.map((t) => this.nm(t)).join('、')}` : '';
      const extra = ctx.victim ? `，令其对 ${this.nm(ctx.victim)} 使用【杀】` : '';
      this.log(`${this.nm(user)} 使用了 ${SGS.cardText(card)}${tgtText}${extra}${ctx.wine ? '（酒）' : ''}`);
      await this.ui.fx('use', { user, card, targets: def.targets && def.targets.self ? [] : targets, victim: ctx.victim });
      SGS.AI && SGS.AI.onUse(this, user, card, targets, ctx);
      await this.trigger('useCard', ctx);
      if (card.name === '无懈可击') {
        await this.cleanProcessing(reals);
        return ctx;
      }
      if (def.type === 'equip') {
        await this.equip(user, card);
        return ctx;
      }
      if (def.type === 'delay') {
        const t = ctx.targets[0];
        if (t && t.alive) await this.placeDelay(t, card);
        else await this.cleanProcessing(reals);
        return ctx;
      }
      if (def.before) await def.before(this, user, ctx.targets, ctx);
      for (const t0 of ctx.targets) {
        if (!t0.alive) continue;
        if (def.skipTarget && def.skipTarget(this, user, t0, ctx)) continue;
        const tev = { user, target: t0, card, ctx, cancel: false };
        await this.trigger('targeted', tev);
        if (tev.cancel) continue;
        const t = tev.target;
        if (!t || !t.alive) continue;
        if (this.isImmune(t, card, user, ctx)) continue;
        if (def.type === 'trick' && (await this.nullifyCheck(card, user, t, ctx))) continue;
        if (!t.alive) continue;
        await def.effect(this, user, t, card, ctx);
      }
      if (def.after) await def.after(this, user, ctx.targets, ctx);
      await this.trigger('useCardDone', ctx);
      await this.cleanProcessing(reals);
      return ctx;
    }
    async cleanProcessing(reals) {
      const left = reals.filter((c) => c.zone === 'processing');
      if (left.length) await this.moveCards(left, { zone: 'discard' }, { reason: 'use', visible: true });
    }
    async recast(p, card) {
      this.log(`${this.nm(p)} 重铸了 ${SGS.cardText(card)}`);
      await this.moveCards([card], { zone: 'discard' }, { reason: 'recast', visible: true });
      await this.draw(p, 1);
    }
    // 无懈可击连锁；返回 true 表示被抵消
    async nullifyCheck(trick, user, target, ctx) {
      let nullified = false;
      for (let guard = 0; guard < 30; guard++) {
        let played = false;
        for (const q of this.playersFromCurrent()) {
          if (!this.canProduce(q, ['无懈可击'], 'respond')) continue;
          const what = target ? `${this.nm(user)} 对 ${this.nm(target)} 的 ${SGS.cardText(trick)}` : SGS.cardText(trick);
          const c = await this.askCard(q, ['无懈可击'], {
            reason: 'nullify',
            trick,
            user,
            target,
            nullified,
            noProxy: true,
            prompt: nullified ? `${what} 即将被抵消，是否使用【无懈可击】？` : `是否对 ${what} 使用【无懈可击】？`,
          });
          if (c) {
            await this.useCard(q, c, [], { nullify: true });
            SGS.AI && SGS.AI.onNullify(this, q, trick, user, target, nullified);
            played = true;
            break;
          }
        }
        if (!played) break;
        nullified = !nullified;
        await this.ui.fx('nullify', { player: target, nullified });
      }
      return nullified;
    }

    // ================= 杀 =================
    async slashEffect(u, t, card, ctx) {
      const sev = { user: u, target: t, card, ctx, need: 1, noDodge: false, ignoreArmor: !!ctx.ignoreArmor, extra: 0 };
      if (u.equips.weapon && u.equips.weapon.name === '青釭剑' && !SGS.realCards(card).includes(u.equips.weapon) && t.equips.armor) {
        sev.ignoreArmor = true;
        await this.announce(u, '青釭剑');
      }
      if (this.hasSkill(u, 'wushuang')) {
        sev.need = 2;
        await this.announce(u, 'wushuang');
      }
      if (this.hasSkill(u, 'roulin') && t.gender === 'female') sev.need = Math.max(sev.need, 2);
      if (this.hasSkill(t, 'roulin') && u.gender === 'female') sev.need = Math.max(sev.need, 2);
      await this.trigger('slashTarget', sev);
      if (!t.alive) return;
      if (!sev.ignoreArmor && this.armorActive(t)) {
        const a = t.equips.armor.name;
        if ((a === '仁王盾' && card.color === 'black') || (a === '藤甲' && !card.nature)) {
          this.log(`${this.nm(t)} 的【${a}】使 ${SGS.cardText(card)} 无效`);
          await this.ui.fx('armor', { player: t, name: a });
          return;
        }
      }
      let dodged = false;
      if (!sev.noDodge) {
        let got = 0;
        for (let i = 0; i < sev.need; i++) {
          const ok = await this.dodge(t, {
            reason: 'slash',
            source: u,
            card,
            ignoreArmor: sev.ignoreArmor,
            wine: ctx.wine,
            prompt: `${this.nm(u)} 对你使用了 ${SGS.cardText(card)}${ctx.wine ? '（酒）' : ''}，请打出一张【闪】${sev.need > 1 ? `（${i + 1}/${sev.need}）` : ''}`,
          });
          if (ok) got++;
          else break;
        }
        dodged = got >= sev.need;
      }
      if (dodged) {
        const mev = { user: u, target: t, card, ctx, hit: false };
        await this.trigger('slashMissed', mev);
        if (!mev.hit) return;
      }
      if (!t.alive) return;
      const hev = { user: u, target: t, card, ctx, cancel: false };
      await this.trigger('slashHit', hev);
      if (hev.cancel || !t.alive) return;
      await this.damage(u, t, 1 + (ctx.wine || 0) + sev.extra, card.nature, card, { slash: true });
    }

    // ================= 伤害 / 体力 =================
    async damage(source, target, num, nature, card, opts = {}) {
      if (!target || !target.alive || num <= 0) return 0;
      if (source && !source.alive) source = null;
      const ev = { source, target, num, nature: nature || null, card, opts, cancel: false };
      await this.trigger('damageBefore', ev);
      if (ev.cancel || !ev.target.alive) return 0;
      target = ev.target;
      const baseNum = ev.num;
      if (this.armorActive(target, ev) && !opts.ignoreArmor) {
        const a = target.equips.armor.name;
        if (a === '藤甲' && ev.nature === 'fire') {
          ev.num += 1;
          this.log(`${this.nm(target)} 的【藤甲】被点燃，伤害+1`);
        }
        if (a === '白银狮子' && ev.num > 1) {
          ev.num = 1;
          this.log(`${this.nm(target)} 的【白银狮子】防止了多余的伤害`);
          await this.ui.fx('armor', { player: target, name: a });
        }
      }
      if (ev.num <= 0) return 0;
      ev.dist = source ? this.distance(source, target) : Infinity;
      target.hp -= ev.num;
      const natTxt = ev.nature === 'fire' ? '火焰' : ev.nature === 'thunder' ? '雷电' : '';
      this.log(`${source ? this.nm(source) + ' 对 ' : ''}${this.nm(target)} 造成了 ${ev.num} 点${natTxt}伤害${source ? '' : '（无来源）'}，体力值为 ${Math.max(target.hp, 0)}`);
      if (source && source !== target && SGS.AI && !(card && card.def && card.def.aoe) && !opts.chainSpread && !opts.duel && !opts.slash) SGS.AI.observe(this, source, target, -1);
      this.refresh();
      await this.ui.fx('damage', { source, target, num: ev.num, nature: ev.nature });
      const spread = target.chained && ev.nature && !opts.chainSpread;
      if (target.chained && ev.nature) {
        target.chained = false;
        this.refresh();
      }
      if (target.hp <= 0) await this.dying(target, source, ev);
      await this.trigger('damaged', ev);
      await this.trigger('damageDone', ev);
      if (spread) {
        for (const p of this.playersFromCurrent()) {
          if (p.alive && p.chained && p !== target) {
            this.log(`铁索连环传导至 ${this.nm(p)}`);
            await this.ui.fx('chainSpread', { from: target, to: p });
            await this.damage(source, p, baseNum, ev.nature, card, { chainSpread: true });
          }
        }
      }
      return ev.num;
    }
    async recover(p, n, source) {
      if (!p.alive) return 0;
      n = Math.min(n, p.maxHp - p.hp);
      if (n <= 0) return 0;
      p.hp += n;
      this.log(`${this.nm(p)} 回复了 ${n} 点体力，体力值为 ${p.hp}`);
      this.refresh();
      await this.ui.fx('recover', { player: p, num: n });
      if (source && source !== p && SGS.AI) SGS.AI.observe(this, source, p, 1);
      await this.trigger('recovered', { player: p, num: n, source });
      return n;
    }
    async loseHp(p, n) {
      if (!p.alive || n <= 0) return;
      p.hp -= n;
      this.log(`${this.nm(p)} 失去了 ${n} 点体力`);
      this.refresh();
      await this.ui.fx('loseHp', { player: p, num: n });
      if (p.hp <= 0) await this.dying(p, null);
    }
    async loseMaxHp(p, n) {
      if (!p.alive) return;
      p.maxHp -= n;
      if (p.hp > p.maxHp) p.hp = p.maxHp;
      this.log(`${this.nm(p)} 减少了 ${n} 点体力上限`);
      this.refresh();
      await this.ui.fx('loseHp', { player: p, num: n });
      if (p.maxHp <= 0) await this.die(p, null);
    }
    async setChained(p, v) {
      p.chained = v;
      this.log(`${this.nm(p)} ${v ? '被横置（铁索连环）' : '被重置'}`);
      this.refresh();
      await this.ui.fx('chain', { player: p, chained: v });
    }
    async turnOver(p) {
      p.turnedOver = !p.turnedOver;
      this.log(`${this.nm(p)} 将武将牌翻面${p.turnedOver ? '（背面朝上）' : '（正面朝上）'}`);
      this.refresh();
      await this.ui.fx('turnOver', { player: p });
    }
    async dying(p, source, dmgEv) {
      if (!p.alive || p.hp > 0) return;
      p.dying = true;
      this.log(`${this.nm(p)} 进入濒死状态`);
      this.refresh();
      await this.ui.fx('dying', { player: p });
      const ev = { player: p, source };
      await this.trigger('dying', ev);
      if (p.hp <= 0 && p.alive) {
        const wansha = this.current && this.current.alive && this.hasSkill(this.current, 'wansha') ? this.current : null;
        if (wansha) await this.announce(wansha, 'wansha');
        for (const q of this.playersFromCurrent()) {
          if (wansha && q !== wansha && q !== p) continue;
          let guard = 0;
          while (p.hp <= 0 && q.alive && p.alive && guard++ < 10) {
            const names = q === p ? ['桃', '酒'] : ['桃'];
            const c = await this.askCard(q, names, {
              reason: 'dying',
              dying: p,
              noProxy: true,
              prompt: q === p ? `你处于濒死状态，是否使用【桃】或【酒】？（需要 ${1 - p.hp} 张）` : `${this.nm(p)} 处于濒死状态，是否对其使用【桃】？（需要 ${1 - p.hp} 张）`,
            });
            if (!c) break;
            await this.useCard(q, c, [p], { dying: true });
          }
          if (p.hp > 0 || !p.alive) break;
        }
      }
      p.dying = false;
      if (p.alive && p.hp <= 0) await this.die(p, source);
      this.refresh();
    }
    async die(p, source) {
      if (!p.alive) return;
      p.alive = false;
      p.dying = false;
      p.revealed = true;
      this.log(`<span class="death">${this.nm(p)} 阵亡，身份为【${SGS.ROLE_NAME[p.identity]}】</span>`);
      this.refresh();
      await this.ui.fx('death', { player: p });
      const ev = { player: p, source };
      for (const s of this.skillsOf(p)) if (s.trigger && s.trigger.selfDeath) await s.trigger.selfDeath(this, p, ev, s);
      await this.trigger('death', ev);
      const rest = p.cards('hej');
      if (rest.length) await this.moveCards(rest, { zone: 'discard' }, { reason: 'death', visible: true });
      p.chained = false;
      p.wine = false;
      this.refresh();
      this.checkWin();
      if (source && source.alive) {
        if (p.identity === 'rebel') {
          this.log(`${this.nm(source)} 击杀反贼，摸三张牌`);
          await this.draw(source, 3);
        } else if (p.identity === 'loyal' && source.identity === 'lord') {
          this.log(`${this.nm(source)} 误杀忠臣，弃置所有牌`);
          const all = source.cards('he');
          if (all.length) await this.moveCards(all, { zone: 'discard' }, { reason: 'discard', visible: true });
        }
      }
    }
    checkWin() {
      const lord = this.lord();
      const alive = this.alivePlayers();
      if (!lord.alive) {
        if (alive.length === 1 && alive[0].identity === 'spy') throw new SGS.GameOver(['spy'], '内奸笑到了最后');
        throw new SGS.GameOver(['rebel'], '主公阵亡，反贼获胜');
      }
      if (!alive.some((p) => p.identity === 'rebel' || p.identity === 'spy')) throw new SGS.GameOver(['lord', 'loyal'], '反贼与内奸全部伏诛，主忠获胜');
    }

    // ================= 判定 / 拼点 =================
    async judge(p, reason, goodFn, opts = {}) {
      const [card] = this.takeTop(1);
      this._put(card, 'processing');
      const ev = { player: p, card, reason, goodFn };
      this.log(`${this.nm(p)} 的【${reason}】判定牌为 ${SGS.cardText(card)}`);
      await this.ui.fx('judge', { player: p, card, reason });
      await this.trigger('judgeModify', ev);
      ev.good = goodFn ? !!goodFn(ev.card) : true;
      await this.ui.fx('judgeResult', { player: p, card: ev.card, good: ev.good, reason });
      if (opts.after) await opts.after(ev);
      await this.trigger('judgeDone', ev);
      if (ev.card.zone === 'processing') await this.moveCards([ev.card], { zone: 'discard' }, { reason: 'judge', visible: true });
      return ev;
    }
    async pindian(a, b, reason) {
      const want = (me, other) => (SGS.AI.att(this, me, other) > 0 && me !== a ? -1 : 1);
      const pick = async (me, other) =>
        (
          await this.chooseCards(me, {
            min: 1,
            max: 1,
            from: 'h',
            prompt: `【${reason}】拼点：选择一张手牌（对手：${other.name}）`,
            purpose: 'pindian',
            ai: (x) => want(me, other) * x.number * 1.2 - SGS.AI.cardValue(this, me, x),
          })
        )[0];
      const ca = await pick(a, b);
      const cb = await pick(b, a);
      if (!ca || !cb) return { win: false };
      await this.moveCards([ca, cb], { zone: 'processing' }, { reason: 'pindian', visible: true });
      const win = ca.number > cb.number;
      this.log(`${this.nm(a)} 拼点 ${SGS.cardText(ca)}，${this.nm(b)} 拼点 ${SGS.cardText(cb)}，${win ? this.nm(a) : this.nm(b)} 赢`);
      await this.ui.fx('pindian', { a, b, ca, cb, win });
      await this.cleanProcessing([ca, cb]);
      return { win, ca, cb };
    }

    // ================= 游戏流程 =================
    setupPlayers() {
      const n = this.opts.playerCount;
      const roles = SGS.shuffle(ROLE_SETS[n].slice(), this.rng);
      const hs = this.opts.humanSeat;
      if (hs != null && this.opts.humanRole && this.opts.humanRole !== 'random') {
        const i = roles.indexOf(this.opts.humanRole);
        if (i >= 0) [roles[hs], roles[i]] = [roles[i], roles[hs]];
      }
      for (let i = 0; i < n; i++) {
        const p = new Player(this, i);
        p.identity = roles[i];
        p.revealed = roles[i] === 'lord';
        this.players.push(p);
        this.imp[i] = roles[i] === 'lord' ? 10 : 0;
      }
      for (const p of this.players) {
        if (hs != null && p.seat === hs && this.opts.makeHuman) {
          p.isHuman = true;
          p.controller = this.opts.makeHuman(this, p);
        } else p.controller = new SGS.AIController(this, p, this.opts.difficulty);
      }
    }
    applyGeneral(p, id) {
      const g = SGS.Generals[id];
      p.general = g;
      p.maxHp = g.hp + (p.identity === 'lord' && this.players.length >= 5 ? 1 : 0);
      p.hp = p.maxHp;
      p.skills = g.skills.filter((s) => SGS.Skills[s] && (!SGS.Skills[s].lord || p.identity === 'lord'));
    }
    async chooseGenerals() {
      const all = SGS.shuffle(Object.keys(SGS.Generals), this.rng);
      const take = (k, pred) => {
        const r = [];
        for (let i = 0; i < all.length && r.length < k; i++)
          if (!pred || pred(all[i])) {
            r.push(all[i]);
            all.splice(i, 1);
            i--;
          }
        return r;
      };
      const lord = this.lord();
      const lordChoices = [...take(3, (id) => SGS.Generals[id].lordSkill), ...take(Math.max(1, this.opts.choiceCount - 3))];
      const lid = await this.ask(lord, { type: 'general', choices: lordChoices, prompt: '你是主公，请选择你的武将' });
      const lordPick = lordChoices.includes(lid) ? lid : lordChoices[0];
      this.applyGeneral(lord, lordPick);
      for (const id of lordChoices) if (id !== lordPick) all.push(id);
      SGS.shuffle(all, this.rng);
      this.log(`主公 ${this.nm(lord)} 登场`);
      this.refresh();
      await this.ui.fx('lordReveal', { player: lord });
      const others = this.playersFrom(lord, false);
      const choiceMap = new Map();
      for (const p of others) choiceMap.set(p, take(this.opts.choiceCount));
      for (const p of others.filter((p) => p.isHuman).concat(others.filter((p) => !p.isHuman))) {
        const ch = choiceMap.get(p);
        const r = await this.ask(p, { type: 'general', choices: ch, prompt: `你的身份是【${SGS.ROLE_NAME[p.identity]}】，请选择武将` });
        this.applyGeneral(p, ch.includes(r) ? r : ch[0]);
      }
      this.refresh();
    }
    async start() {
      try {
        this.setupPlayers();
        this.deck = SGS.shuffle(SGS.buildDeck(), this.rng);
        for (const c of this.deck) c.zone = 'deck';
        this.refresh();
        await this.chooseGenerals();
        await this.ui.fx('gameStart', {});
        await this.trigger('gameStart', {});
        for (const p of this.players) await this.draw(p, 4);
        let cur = this.lord();
        this.round = 0;
        for (let guard = 0; guard < 3000; guard++) {
          if (cur.identity === 'lord') this.round++;
          await this.playTurn(cur);
          while (this.extraTurns.length) {
            const x = this.extraTurns.shift();
            if (x.alive) await this.playTurn(x);
          }
          cur = this.nextAlive(cur);
          if (!cur) break;
        }
        throw new SGS.GameOver([], '回合数过多，游戏平局');
      } catch (e) {
        if (e instanceof SGS.GameOver) {
          this.over = true;
          this.result = e;
          for (const p of this.players) p.revealed = true;
          this.refresh();
          return e;
        }
        if (e instanceof SGS.GameAbort) return null;
        throw e;
      }
    }
    async playTurn(p) {
      if (!p.alive) return;
      this.current = p;
      p.turn = { slashCount: 0, skillUses: {}, wineUsed: false, slashPlayed: false, phase: null };
      p.wine = false;
      this.turnCount++;
      this.phase = null;
      this.log(`<div class="turn-sep">${this.nm(p)} 的回合</div>`);
      this.refresh();
      await this.ui.fx('turnStart', { player: p });
      if (p.turnedOver) {
        await this.turnOver(p);
        this.log(`${this.nm(p)} 跳过了此回合`);
        return;
      }
      await this.trigger('turnStart', { player: p });
      for (const phase of PHASES) {
        if (!p.alive) break;
        this.phase = phase;
        p.turn.phase = phase;
        this.refresh();
        if (p.skip[phase]) {
          delete p.skip[phase];
          this.log(`${this.nm(p)} 跳过了${PHASE_NAME[phase]}`);
          continue;
        }
        const ev = { player: p, phase, skip: false };
        await this.trigger('phaseBefore', ev);
        if (ev.skip || !p.alive) continue;
        await this['phase_' + phase](p);
        if (!p.alive) break;
        await this.trigger('phaseAfter', ev);
      }
      p.wine = false;
      p.skip = {};
      this.phase = null;
      if (p.alive) await this.trigger('turnEnd', { player: p });
      this.refresh();
    }
    async phase_start(p) {
      await this.trigger('phaseStart', { player: p });
    }
    async phase_judge(p) {
      for (let guard = 0; guard < 6 && p.alive && p.judges.length; guard++) {
        const card = p.judges[p.judges.length - 1];
        const reals = SGS.realCards(card);
        p.judges.pop();
        for (const c of reals) {
          c.zone = 'processing';
          c.owner = null;
          this.processing.push(c);
        }
        this.refresh();
        this.log(`${this.nm(p)} 的 ${SGS.cardText(card)} 开始判定`);
        await this.ui.fx('judgeStart', { player: p, card });
        if (await this.nullifyCheck(card, null, p, {})) {
          if (card.name === '闪电') await this.passLightning(p, card);
          else await this.moveCards(reals, { zone: 'discard' }, { visible: true });
          continue;
        }
        await card.def.judgeEffect(this, p, card);
      }
    }
    async phase_draw(p) {
      const ev = { player: p, num: 2 };
      await this.trigger('drawPhase', ev);
      if (ev.num > 0 && p.alive) await this.draw(p, ev.num);
      if (p.alive) await this.trigger('drawPhaseAfter', ev);
    }
    async phase_play(p) {
      for (let guard = 0; guard < 120 && p.alive; guard++) {
        const act = await this.ask(p, { type: 'play' });
        if (!act || act.type === 'end') break;
        await this.doPlayAction(p, act);
        if (!p.alive || p.turn.endPlay) break;
      }
    }
    async doPlayAction(p, act) {
      if (act.type === 'card') {
        const card = act.card;
        const reals = SGS.realCards(card);
        if (!reals.every((c) => (c.zone === 'h' || c.zone === 'e') && c.owner === p)) return;
        if (!this.isUsable(p, card)) return;
        let targets = act.targets || [];
        const def = card.def;
        if (def.targets && !def.targets.self && !def.targets.all && def.type !== 'equip') {
          if (!targets.length) return;
          const sel = [];
          for (const t of targets) {
            if (!this.targetOk(p, t, card, sel)) return;
            sel.push(t);
          }
          if (sel.length < def.targets.min || sel.length > this.maxTargets(p, card)) return;
        }
        await this.useCard(p, card, targets);
      } else if (act.type === 'skill') {
        const s = SGS.Skills[act.skill] || (SGS.EquipSkills && SGS.EquipSkills[act.skill]);
        if (!s || !s.enable) return;
        if (s.enable.canUse && !s.enable.canUse(this, p)) return;
        p.turn.skillUses[act.skill] = (p.turn.skillUses[act.skill] || 0) + 1;
        await s.enable.effect(this, p, act.cards || [], act.targets || []);
      } else if (act.type === 'recast') {
        if (act.card.zone === 'h' && act.card.owner === p && act.card.def.recast) await this.recast(p, act.card);
      }
    }
    async phase_discard(p) {
      const limit = this.handLimit(p);
      const over = p.hand.length - limit;
      if (over > 0) {
        const cards = await this.chooseCards(p, {
          min: over,
          max: over,
          from: 'h',
          prompt: `弃牌阶段：请弃置 ${over} 张手牌（手牌上限 ${limit}）`,
          purpose: 'discard',
        });
        await this.discard(p, cards);
        await this.trigger('discardPhaseDiscard', { player: p, cards });
      }
    }
    async phase_end(p) {
      await this.trigger('phaseEnd', { player: p });
    }
  }
  SGS.Game = Game;
})();
