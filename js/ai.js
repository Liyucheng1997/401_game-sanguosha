// AI：身份推断、局势评估、出牌规划与响应决策
(function () {
  const SGS = globalThis.SGS;
  const AI = (SGS.AI = {});

  const LEVELS = {
    easy: { noise: 4, mistake: 0.35, cheat: false, impNoise: 1.6, infer: false, nullifyTh: 4, label: '简单' },
    normal: { noise: 0.8, mistake: 0.05, cheat: false, impNoise: 0.3, infer: true, nullifyTh: 1.6, label: '普通' },
    hard: { noise: 0, mistake: 0, cheat: false, impNoise: 0, infer: true, nullifyTh: 1.0, label: '困难' },
    hell: { noise: 0, mistake: 0, cheat: true, impNoise: 0, infer: true, nullifyTh: 0.9, label: '地狱' },
  };
  AI.LEVELS = LEVELS;
  const lv = (p) => LEVELS[(p.controller && p.controller.level) || 'hard'] || LEVELS.normal;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------- 身份推断 ----------------
  function roleCount(g, role) {
    const total = SGS.ROLE_SETS[g.players.length].filter((r) => r === role).length;
    const dead = g.players.filter((p) => !p.alive && p.identity === role).length;
    return total - dead;
  }
  function perceived(g, me, o) {
    if (o === me) return me.identity;
    if (o.identity === 'lord' || o.revealed) return o.identity;
    const L = lv(me);
    if (L.cheat) return o.identity;
    let imp = g.imp[o.seat] || 0;
    if (L.impNoise) imp += (((me.seat * 7 + o.seat * 13) % 5) - 2) * L.impNoise * 0.35;
    if (imp >= 0.8) return 'loyal';
    if (imp <= -0.8) return 'rebel';
    return 'unknown';
  }
  AI.perceived = perceived;
  function power(g, me, side) {
    let s = 0;
    for (const p of g.alivePlayers()) {
      if (p === me) continue;
      const r = perceived(g, me, p);
      const isSide = side === 'lord' ? r === 'lord' || r === 'loyal' : r === 'rebel';
      if (isSide) s += Math.max(p.hp, 0) + p.hand.length * 0.4 + p.equipList().length * 0.3;
    }
    return s;
  }
  function spyAtt(g, me, o, r) {
    const alive = g.alivePlayers();
    const rebelsLeft = roleCount(g, 'rebel');
    if (r === 'lord') {
      if (alive.length === 2) return -3;
      if (rebelsLeft === 0 && alive.length > 2) return 0.2;
      return o.hp <= 1 ? 2 : 0.6;
    }
    if (rebelsLeft === 0) return r === 'loyal' || r === 'unknown' ? -2 : -1;
    const rp = power(g, me, 'rebel'),
      lp = power(g, me, 'lord');
    if (r === 'rebel') return rp >= lp * 0.7 ? -1.6 : -0.4;
    if (r === 'loyal') return lp > rp * 1.4 ? -1.2 : 0.3;
    return 0;
  }
  // 态度：>0 友方，<0 敌方
  AI.att = function (g, me, o) {
    if (!me || !o) return 0;
    if (me === o) return 3;
    if (!o.alive) return 0;
    const r = perceived(g, me, o);
    const L = lv(me);
    switch (me.identity) {
      case 'lord':
      case 'loyal': {
        if (r === 'lord') return 4;
        if (L.infer && r === 'loyal' && me.identity === 'lord' && roleCount(g, 'loyal') <= 0) return -2;
        if (r === 'loyal') return 2;
        if (r === 'rebel') return -2;
        if (r === 'spy') return roleCount(g, 'rebel') > 0 ? -0.3 : -2.5;
        if (L.infer) {
          // 推理：已知的忠臣数达到剩余忠臣数，其余未知者必为敌
          const loyalLeft = roleCount(g, 'loyal') - (me.identity === 'loyal' ? 1 : 0);
          if (loyalLeft <= 0) return -2;
          const knownLoyal = g.alivePlayers().filter((p) => p !== me && p.identity !== 'lord' && perceived(g, me, p) === 'loyal').length;
          if (knownLoyal >= loyalLeft) return -1.2;
        }
        return 0;
      }
      case 'rebel': {
        if (r === 'lord') return -3;
        if (r === 'loyal') return -2;
        if (r === 'rebel') return 2;
        if (r === 'spy') return -0.8;
        if (L.infer) {
          const rebelLeft = roleCount(g, 'rebel') - 1;
          const knownRebel = g.alivePlayers().filter((p) => p !== me && perceived(g, me, p) === 'rebel').length;
          if (knownRebel >= rebelLeft) return -1.2;
        }
        return 0;
      }
      case 'spy':
        return spyAtt(g, me, o, r);
    }
    return 0;
  };
  AI.isFriend = (g, a, b) => AI.att(g, a, b) > 0;
  AI.isEnemy = (g, a, b) => AI.att(g, a, b) < 0;
  AI.friends = (g, p) => g.alivePlayers().filter((x) => AI.att(g, p, x) > 0);
  AI.enemies = (g, p) => g.alivePlayers().filter((x) => x !== p && AI.att(g, p, x) < 0);

  // 行为观察：delta>0 友善，<0 敌意
  AI.observe = function (g, src, tgt, delta) {
    if (!src || !tgt || src === tgt || !g.imp) return;
    if (src.identity === 'lord') {
      if (!tgt.revealed && tgt.identity !== 'lord') g.imp[tgt.seat] = clamp((g.imp[tgt.seat] || 0) + (delta < 0 ? -0.35 : 0.25) * Math.abs(delta), -6, 6);
      return;
    }
    let side;
    if (tgt.identity === 'lord') side = 3;
    else if (tgt.revealed) side = tgt.identity === 'loyal' ? 2 : tgt.identity === 'rebel' ? -2 : 0;
    else side = clamp(g.imp[tgt.seat] || 0, -2.5, 2.5);
    g.imp[src.seat] = clamp((g.imp[src.seat] || 0) + delta * side * 0.5, -6, 6);
  };
  const HOSTILE = { 杀: 1, 决斗: 1, 过河拆桥: 0.8, 顺手牵羊: 0.8, 乐不思蜀: 1, 兵粮寸断: 1, 火攻: 0.8, 借刀杀人: 0.6 };
  AI.onUse = function (g, user, card, targets, ctx) {
    const w = HOSTILE[card.name];
    for (const t of targets) {
      if (t === user) continue;
      if (w) {
        if ((card.name === '过河拆桥' || card.name === '顺手牵羊') && t.judges.length) continue;
        AI.observe(g, user, t, -w);
      } else if (card.name === '铁索连环') AI.observe(g, user, t, t.chained ? 0.5 : -0.4);
    }
  };
  AI.onNullify = function (g, q, trick, user, target, wasNullified) {
    if (!target) return;
    const good = !!(trick.def && trick.def.good);
    const sign = (good ? 1 : -1) * (wasNullified ? 1 : -1);
    AI.observe(g, q, target, sign * 0.8);
  };

  // ---------------- 牌价值 ----------------
  const BASE = {
    杀: 4.5, 闪: 5.5, 桃: 9, 酒: 4.2, 无懈可击: 7, 无中生有: 8, 顺手牵羊: 6.8, 过河拆桥: 6.2, 决斗: 5, 借刀杀人: 4,
    南蛮入侵: 5, 万箭齐发: 5, 桃园结义: 3.5, 五谷丰登: 3.2, 火攻: 3.2, 铁索连环: 3.2, 乐不思蜀: 7, 兵粮寸断: 6.2, 闪电: 2.5,
  };
  const EQV = {
    诸葛连弩: 4, 青釭剑: 4.6, 雌雄双股剑: 4.2, 寒冰剑: 4.6, 古锭刀: 4.6, 青龙偃月刀: 4.6, 丈八蛇矛: 4.7, 贯石斧: 5, 朱雀羽扇: 4.6,
    方天画戟: 4.2, 麒麟弓: 4.3, 八卦阵: 6.8, 仁王盾: 6.2, 藤甲: 5.2, 白银狮子: 6.3,
  };
  AI.equipValue = function (g, p, c) {
    let v = EQV[c.name];
    if (v == null) v = c.subtype === 'plus' ? 5.6 : 5;
    if (c.name === '诸葛连弩') v += Math.min(3, p.hand.filter((x) => x.name === '杀').length) * 1.2;
    if (c.name === '藤甲' && (p.chained || p.hp <= 1)) v -= 2;
    if (c.name === '白银狮子' && p.hp < p.maxHp) v += 0.5;
    if (c.subtype === 'weapon' && g.hasSkill(p, 'paoxiao') && c.name === '诸葛连弩') v = 2;
    if (c.subtype === 'armor' && g.hasSkill(p, 'bazhen')) v -= 1.5;
    if (g.hasSkill(p, 'xiaoji')) v += 1.5;
    return v;
  };
  AI.cardValue = function (g, p, c) {
    if (!c) return 0;
    let v;
    if (c.type === 'equip') {
      const cur = p.equips[c.subtype];
      if (c.zone === 'e' && c.owner === p) v = AI.equipValue(g, p, c) + 1.2;
      else if (cur && cur !== c) v = Math.max(1.5, AI.equipValue(g, p, c) - AI.equipValue(g, p, cur) + 1.8);
      else v = AI.equipValue(g, p, c);
    } else v = BASE[c.name] != null ? BASE[c.name] : 4;
    if (c.name === '闪') v = p.hand.filter((x) => x.name === '闪').length <= 1 ? 6.6 : 4.4;
    if (c.name === '杀') {
      v = p.hand.filter((x) => x.name === '杀').length <= 1 ? 5 : 3.8;
      if (c.nature) v += 0.4;
    }
    if (c.name === '桃') v = p.hp <= 2 ? 10 : 8.6;
    if (c.name === '酒') v = p.hp <= 1 ? 7.5 : 4.2;
    if (c.name === '无懈可击') v = 7;
    for (const s of g.viewAsSkills(p, 'respond').concat(g.viewAsSkills(p, 'play')))
      if ((s.viewAs.count || 1) === 1 && s.viewAs.filter(g, p, c, [])) v += 0.4;
    if (g.hasSkill(p, 'lianying') && p.hand.length <= 1) v -= 1;
    return v;
  };

  // ---------------- 出牌规划 ----------------
  const subCost = (g, p, c) => (c.virtual ? c.subcards.reduce((s, x) => s + AI.cardValue(g, p, x), 0) * 0.3 + 0.2 : 0);
  function legal(g, p, c, sel) {
    return g.alivePlayers().filter((t) => g.targetOk(p, t, c, sel || []));
  }
  function slashTargetScore(g, p, t, c, ctx) {
    const a = AI.att(g, p, t);
    if (a >= 0) return -1;
    let s = 3.8 + Math.min(-a, 3) * 0.6;
    const dmg = 1 + (p.wine || (ctx && ctx.wine) ? 1 : 0) + (p.turn && p.turn.luoyi ? 1 : 0);
    const qg = p.equips.weapon && p.equips.weapon.name === '青釭剑';
    const armor = !qg && t.equips.armor ? t.equips.armor.name : null;
    const bagua = armor === '八卦阵' || (!t.equips.armor && g.hasSkill(t, 'bazhen'));
    if (armor === '仁王盾' && c.color === 'black') return -5;
    if (armor === '藤甲' && !c.nature) return -5;
    if (armor === '藤甲' && c.nature === 'fire') s += 2;
    if (armor === '白银狮子' && dmg > 1) s -= 1.5;
    if (bagua) s -= 1.3;
    if (t.hp <= dmg) s += 3;
    if (t.hp <= dmg && t.identity === 'lord' && p.identity === 'spy' && g.alivePlayers().length > 2) return -5;
    s -= Math.min(t.hand.length, 4) * 0.35;
    if (!t.hand.length && !bagua) s += 1.5;
    if (g.hasSkill(t, 'liuli') && t.countCards('he')) s -= 1.2;
    if (g.hasSkill(t, 'yiji') && t.hp > 2) s -= 1.5;
    if (g.hasSkill(t, 'ganglie') && p.hand.length < 3) s -= 0.8;
    if (g.hasSkill(t, 'tianxiang') && t.hand.length) s -= 0.8;
    if (g.hasSkill(t, 'xiangle')) s -= p.hand.some((x) => x.type === 'basic' && x !== c && !SGS.realCards(c).includes(x)) ? 0.8 : 5;
    if (c.nature && t.chained) s += g.alivePlayers().filter((x) => x !== t && x.chained && AI.att(g, p, x) < 0).length * 1.5 - g.alivePlayers().filter((x) => x.chained && AI.att(g, p, x) > 0).length * 2;
    if (t.identity === 'lord' && p.identity === 'rebel') s += 0.8;
    return s;
  }
  AI.slashTargetScore = slashTargetScore;
  function aoeScore(g, p, c) {
    let s = 0.5;
    const isNan = c.name === '南蛮入侵';
    for (const t of g.aoeTargets(p, c)) {
      if (isNan && (g.hasSkill(t, 'huoshou') || g.hasSkill(t, 'juxiang'))) continue;
      if (t.equips.armor && t.equips.armor.name === '藤甲') continue;
      const a = AI.att(g, p, t);
      const resist = Math.min(t.hand.length, 4) * 0.15 + (!isNan && t.equips.armor && t.equips.armor.name === '八卦阵' ? 0.4 : 0);
      if (a < 0) s += 1.3 - resist + (t.hp <= 1 ? 1.6 : 0);
      else if (a > 0) s -= 1.4 - resist + (t.hp <= 1 ? 3 : 0) + (t.identity === 'lord' ? 1.2 : 0);
      else s -= 0.2;
      if (p.identity === 'spy' && t.identity === 'lord' && t.hp <= 1 && g.alivePlayers().length > 2) s -= 6;
    }
    return s;
  }
  function judgeBad(t) {
    return t.judges.find((c) => c.name === '乐不思蜀') || t.judges.find((c) => c.name === '兵粮寸断') || null;
  }
  function takeScore(g, p, t, steal) {
    const a = AI.att(g, p, t);
    if (a > 0) return judgeBad(t) ? 8 : -1;
    if (a === 0 && !(p.identity === 'rebel' && t.identity === 'lord')) return -1;
    const nonJudge = t.hand.length + t.equipList().length;
    if (!nonJudge) return -1;
    let s = 4.2 + (steal ? 1 : 0);
    if (t.equips.armor) s += 1.2;
    if (t.equips.weapon && t.equips.weapon.name === '诸葛连弩') s += 1;
    if (t.hand.length <= 2 && t.hp <= 2) s += 1;
    if (g.hasSkill(t, 'xiaoji') && !t.hand.length) s -= 2;
    if (g.hasSkill(t, 'lianying') && t.hand.length === 1 && !t.equipList().length) s -= 2;
    return s;
  }
  function bestOf(list, f) {
    let best = null,
      bs = -Infinity;
    for (const x of list) {
      const s = f(x);
      if (s > bs) {
        bs = s;
        best = x;
      }
    }
    return [best, bs];
  }
  AI.plan = function (g, p, c) {
    const def = c.def;
    if (!def) return null;
    if (def.type === 'equip') {
      const cur = p.equips[c.subtype];
      const nv = AI.equipValue(g, p, c),
        ov = cur ? AI.equipValue(g, p, cur) : 0;
      if (cur && nv <= ov + 0.3) return null;
      let s = 6 + (nv - ov) * 0.5;
      if (c.subtype === 'weapon') {
        const reach = AI.enemies(g, p).some((t) => g.distance(p, t) <= c.def.range);
        if (!reach && !cur) s -= 1;
      }
      return { score: s, targets: [] };
    }
    switch (c.name) {
      case '杀': {
        const T = legal(g, p, c);
        const scored = T.map((t) => [t, slashTargetScore(g, p, t, c)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
        if (!scored.length) return null;
        const max = g.maxTargets(p, c);
        const pick = scored.slice(0, max);
        return { score: pick[0][1] + (pick.length - 1) * 1.5, targets: pick.map((x) => x[0]) };
      }
      case '酒': {
        if (p.wine) return null;
        const others = p.hand.filter((x) => x.name === '杀' && !SGS.realCards(c).includes(x));
        if (!others.length || !g.canSlashMore(p, others[0])) return null;
        const T = legal(g, p, others[0]);
        const [, bs] = bestOf(T, (t) => slashTargetScore(g, p, t, others[0], { wine: 1 }));
        if (bs < 5) return null;
        if (p.hp <= 1 && p.hand.filter((x) => x.name === '酒' || x.name === '桃').length <= 1) return null;
        return { score: bs + 1.2, targets: [] };
      }
      case '桃': {
        if (p.hp >= p.maxHp) return null;
        let s = 3 + (p.maxHp - p.hp) * 1.5 + (p.hp <= 1 ? 4 : 0);
        if (lv(p).infer && p.hp >= 3 && p.hand.length <= g.handLimit(p) && AI.friends(g, p).some((f) => f !== p && f.hp <= 1)) s = 1;
        return { score: s, targets: [] };
      }
      case '无中生有':
        return { score: 9, targets: [] };
      case '五谷丰登': {
        let s = 2;
        for (const t of g.alivePlayers()) s += AI.att(g, p, t) > 0 ? 0.6 : AI.att(g, p, t) < 0 ? -0.6 : 0;
        return { score: s, targets: [] };
      }
      case '桃园结义': {
        let s = 0;
        for (const t of g.alivePlayers()) if (t.hp < t.maxHp) s += AI.att(g, p, t) > 0 ? 1.6 + (t.hp <= 1 ? 1 : 0) : AI.att(g, p, t) < 0 ? -1.6 : 0;
        return { score: s, targets: [] };
      }
      case '南蛮入侵':
      case '万箭齐发':
        return { score: aoeScore(g, p, c), targets: [] };
      case '决斗': {
        const mySlash = p.hand.filter((x) => x.name === '杀' && !SGS.realCards(c).includes(x)).length + (g.hasSkill(p, 'wusheng') ? 1 : 0);
        const T = legal(g, p, c);
        const [t, s] = bestOf(T, (t) => {
          const a = AI.att(g, p, t);
          if (a >= 0) return -1;
          if (p.identity === 'spy' && t.identity === 'lord' && t.hp <= 1) return -1;
          let s = 4.2 + (t.hp <= 1 ? 2.5 : 0) + (mySlash - t.hand.length * 0.45) * 0.9 + (g.hasSkill(p, 'wushuang') ? 2 : 0);
          if (p.turn && p.turn.luoyi) s += 1.5;
          if (g.hasSkill(t, 'wushuang')) s -= 2.5;
          if (!mySlash && t.hand.length >= 2) s -= 2.5;
          return s;
        });
        return s > 0 ? { score: s, targets: [t] } : null;
      }
      case '过河拆桥':
      case '顺手牵羊': {
        const T = legal(g, p, c);
        const [t, s] = bestOf(T, (t) => takeScore(g, p, t, c.name === '顺手牵羊'));
        return s > 0 ? { score: s, targets: [t] } : null;
      }
      case '借刀杀人': {
        let best = null;
        for (const a of legal(g, p, c, [])) {
          if (AI.att(g, p, a) > 0) continue;
          for (const b of legal(g, p, c, [a])) {
            const ab = AI.att(g, p, b);
            if (ab > 0) continue;
            const s = 3.5 + (ab < 0 ? 1 : 0) + (AI.att(g, p, a) < 0 ? 1 : 0) + (AI.equipValue(g, p, a.equips.weapon) > 4.5 ? 0.5 : 0);
            if (!best || s > best.score) best = { score: s, targets: [a, b] };
          }
        }
        return best;
      }
      case '乐不思蜀':
      case '兵粮寸断': {
        const T = legal(g, p, c);
        const [t, s] = bestOf(T, (t) => {
          if (AI.att(g, p, t) >= 0) return -1;
          let s = (c.name === '乐不思蜀' ? 5.8 : 5) + Math.min(t.hand.length, 5) * 0.2;
          if (t.identity === 'lord') s += 0.5;
          if (g.hasSkill(t, 'guicai') || g.hasSkill(t, 'guidao')) s -= 2;
          return s;
        });
        return s > 0 ? { score: s, targets: [t] } : null;
      }
      case '闪电': {
        if (g.hasSkill(p, 'guicai') || g.hasSkill(p, 'guidao')) return { score: 4.5, targets: [] };
        const fr = AI.friends(g, p).filter((x) => x !== p).length;
        const en = AI.enemies(g, p).length;
        return p.hp >= 3 && en > fr ? { score: 1.6, targets: [] } : null;
      }
      case '火攻': {
        if (p.hand.length < 4) return null;
        const T = legal(g, p, c).filter((t) => t !== p);
        const [t, s] = bestOf(T, (t) => (AI.att(g, p, t) < 0 ? 2.2 + (t.hp <= 1 ? 2 : 0) + (t.equips.armor && t.equips.armor.name === '藤甲' ? 2 : 0) + (t.chained ? 1 : 0) : -1));
        return s > 0 ? { score: s, targets: [t] } : null;
      }
      case '铁索连环': {
        const T = legal(g, p, c);
        const unchain = T.filter((t) => t.chained && AI.att(g, p, t) > 0);
        const chain = T.filter((t) => !t.chained && AI.att(g, p, t) < 0);
        const hasNature = p.hand.some((x) => (x.name === '杀' && x.nature) || x.name === '火攻') || g.hasSkill(p, 'leiji');
        if (unchain.length) return { score: 3.5, targets: unchain.slice(0, 2) };
        if (chain.length >= 2 && hasNature) return { score: 3.5, targets: chain.slice(0, 2) };
        return null;
      }
    }
    return null;
  };
  AI.quickPlayScore = function (g, p, c) {
    if (!g.isUsable(p, c)) return 0;
    const r = AI.plan(g, p, c);
    return r ? r.score : 0;
  };

  // ---------------- 控制器 ----------------
  class AIController {
    constructor(g, p, level) {
      this.g = g;
      this.p = p;
      this.level = level || 'normal';
      this.L = LEVELS[this.level] || LEVELS.normal;
    }
    rand() {
      return this.g.random();
    }
    async handle(req) {
      const g = this.g;
      switch (req.type) {
        case 'play': {
          const act = this.play();
          if (act.type !== 'end') await g.wait(380);
          return act;
        }
        case 'respond': {
          const r = this.respond(req);
          if (r) await g.wait(260);
          return r;
        }
        case 'cards':
          return this.cards(req);
        case 'targets':
          return this.targets(req);
        case 'confirm': {
          let r = req.ai ? !!req.ai() : true;
          if (this.L.mistake && this.rand() < this.L.mistake * 0.5) r = !r && !req.forced ? r : r;
          return r;
        }
        case 'option':
          return req.ai ? req.ai() : 0;
        case 'pickCard':
          return this.pickCard(req);
        case 'guanxing':
          return this.guanxing(req);
        case 'wugu': {
          await g.wait(250);
          return req.cards.slice().sort((a, b) => AI.cardValue(g, this.p, b) - AI.cardValue(g, this.p, a))[0];
        }
        case 'general':
          return this.general(req);
      }
      return null;
    }
    general(req) {
      const p = this.p;
      if (this.level === 'easy') return req.choices[Math.floor(this.rand() * req.choices.length)];
      return req.choices.slice().sort((a, b) => this.genScore(b) - this.genScore(a))[0];
    }
    genScore(id) {
      const gen = SGS.Generals[id];
      let s = gen.rating + gen.hp * 0.2;
      if (this.p.identity === 'lord' && gen.lordSkill) s += 0.8;
      if (this.p.identity === 'lord' && gen.hp <= 3) s -= 0.4;
      return s + this.rand() * 0.6;
    }

    // 枚举出牌
    candidates() {
      const g = this.g,
        p = this.p;
      const out = [];
      const opts = p.hand.slice();
      for (const s of g.viewAsSkills(p, 'play')) {
        const n = s.viewAs.count || 1;
        if (n === 1) {
          for (const c of g.viewAsCands(p, s)) {
            const vc = g.makeVirtual(s, [c]);
            if (vc) opts.push(vc);
          }
        } else {
          const sel = [];
          for (let k = 0; k < n; k++) {
            const cs = g.viewAsCands(p, s, sel).filter((c) => c.zone === 'h').sort((a, b) => AI.cardValue(g, p, a) - AI.cardValue(g, p, b));
            if (!cs.length) break;
            sel.push(cs[0]);
          }
          if (sel.length === n) {
            const vc = g.makeVirtual(s, sel);
            if (vc) opts.push(vc);
          }
        }
      }
      for (const c of opts) {
        if (!g.isUsable(p, c)) continue;
        if (c.name === '铁索连环' && !c.virtual) {
          const r = AI.plan(g, p, c);
          if (r && r.score > 1.5) out.push({ score: r.score, act: { type: 'card', card: c, targets: r.targets } });
          else out.push({ score: 1.4, act: { type: 'recast', card: c } });
          continue;
        }
        const r = AI.plan(g, p, c);
        if (!r || !(r.score > 0)) continue;
        const score = r.score - subCost(g, p, c);
        out.push({ score, act: { type: 'card', card: c, targets: r.targets } });
      }
      for (const id of p.skills.concat(p.equips.weapon ? [p.equips.weapon.name] : [])) {
        const s = SGS.Skills[id] || SGS.EquipSkills[id];
        if (!s || !s.enable || !s.enable.ai) continue;
        if (s.enable.canUse && !s.enable.canUse(g, p)) continue;
        let r = null;
        try {
          r = s.enable.ai(g, p);
        } catch (e) {
          r = null;
        }
        if (r && r.score > 0) out.push({ score: r.late ? Math.min(r.score, 2.2) : r.score, act: { type: 'skill', skill: id, cards: r.cards || [], targets: r.targets || [] } });
      }
      return out;
    }
    play() {
      const p = this.p;
      if ((p.turn.aiActs = (p.turn.aiActs || 0) + 1) > 60) return { type: 'end' };
      const cands = this.candidates();
      if (!cands.length) return { type: 'end' };
      for (const c of cands) c.score += (this.rand() - 0.5) * this.L.noise;
      cands.sort((a, b) => b.score - a.score);
      let pick = cands[0];
      if (this.L.mistake && cands.length > 1 && this.rand() < this.L.mistake) pick = cands[1];
      if (pick.score <= 0.6) return { type: 'end' };
      // 防止同一技能在失败后无限重复
      if (pick.act.type === 'skill') {
        const k = 'ai_' + pick.act.skill;
        p.turn[k] = (p.turn[k] || 0) + 1;
        if (p.turn[k] > 8) return { type: 'end' };
      }
      return pick.act;
    }

    // 可用于响应的牌（含转化），按代价升序
    responseOptions(names) {
      const g = this.g,
        p = this.p;
      const out = [];
      for (const c of p.hand) if (names.includes(c.name)) out.push({ card: c, cost: AI.cardValue(g, p, c) });
      for (const s of g.viewAsSkills(p, 'respond')) {
        const n = s.viewAs.count || 1;
        if (n === 1) {
          for (const c of g.viewAsCands(p, s)) {
            const vc = g.makeVirtual(s, [c]);
            if (vc && names.includes(vc.name)) out.push({ card: vc, cost: AI.cardValue(g, p, c) + 0.1 });
          }
        } else {
          const sel = [];
          for (let k = 0; k < n; k++) {
            const cs = g.viewAsCands(p, s, sel).sort((a, b) => AI.cardValue(g, p, a) - AI.cardValue(g, p, b));
            if (!cs.length) break;
            sel.push(cs[0]);
          }
          if (sel.length === n) {
            const vc = g.makeVirtual(s, sel);
            if (vc && names.includes(vc.name)) out.push({ card: vc, cost: sel.reduce((a, c) => a + AI.cardValue(g, p, c), 0) });
          }
        }
      }
      return out.sort((a, b) => a.cost - b.cost).map((x) => x.card);
    }
    respond(req) {
      const g = this.g,
        p = this.p;
      const att = (o) => AI.att(g, p, o);
      let want = true;
      switch (req.reason) {
        case 'duel':
          want = !(req.source && att(req.source) > 0 && p.hp > 1);
          break;
        case 'slash':
          if (lv(p).infer && g.hasSkill(p, 'yiji') && p.hp >= 3 && !req.wine && req.source && att(req.source) < 0) want = this.rand() < 0.3;
          break;
        case 'jiedao':
          want = !(req.target && att(req.target) > 0);
          break;
        case 'tiaoxin':
          want = !(req.source && att(req.source) > 0);
          break;
        case 'qinglong':
          want = req.target && att(req.target) < 0;
          break;
        case 'luanwu':
          want = (req.candidates || []).some((x) => att(x) <= 0) || p.hp <= 1;
          break;
        case 'dying': {
          const d = req.dying;
          if (d === p) want = true;
          else if (this.level === 'easy') want = att(d) >= 3 || (d.identity === 'lord' && p.identity === 'loyal');
          else want = att(d) > 0;
          break;
        }
        case 'proxy':
          want = att(req.beneficiary) > 0;
          break;
        case 'nullify':
          want = this.wantNullify(req);
          break;
      }
      if (!want) return null;
      const opts = this.responseOptions(req.names);
      if (req.reason === 'proxy') {
        const c = opts[0];
        if (!c) return null;
        if (req.names.includes('闪') && p.hand.filter((x) => x.name === '闪').length <= 1 && p.hp <= 2 && att(req.beneficiary) < 3) return null;
        return c;
      }
      if (!opts.length) return req.proxy ? { proxy: true } : null;
      return opts[0];
    }
    wantNullify(req) {
      const g = this.g,
        p = this.p;
      const { trick, target, nullified } = req;
      if (!target) return false;
      const a = AI.att(g, p, target);
      if (a === 0) return false;
      const good = !!trick.def.good;
      let imp = 1;
      switch (trick.name) {
        case '乐不思蜀':
          imp = 3;
          break;
        case '兵粮寸断':
          imp = 2.5;
          break;
        case '闪电':
          imp = target.hp <= 3 ? 1.6 : 0.8;
          break;
        case '决斗':
          imp = target.hp <= 1 ? 3 : 1.4;
          break;
        case '南蛮入侵':
        case '万箭齐发': {
          if (target === p) {
            const need = trick.name === '南蛮入侵' ? '杀' : '闪';
            imp = this.responseOptions([need]).length ? 0.2 : p.hp <= 1 ? 3.5 : 1.3;
          } else imp = target.hp <= 1 ? 2.2 : 0.6;
          break;
        }
        case '过河拆桥':
        case '顺手牵羊':
          imp = target.judges.length && a > 0 ? 0.2 : 1.3;
          break;
        case '无中生有':
          imp = 1.3;
          break;
        case '火攻':
          imp = target.hp <= 1 ? 2.5 : 0.9;
          break;
        case '铁索连环':
          imp = 0.3;
          break;
        case '桃园结义':
          imp = target.hp <= 1 ? 1.5 : 0.6;
          break;
        default:
          imp = 0.8;
      }
      const benefit = (good ? 1 : -1) * Math.sign(a) * Math.min(Math.abs(a), 3) * imp;
      let th = this.L.nullifyTh;
      const myNull = this.responseOptions(['无懈可击']).length;
      if (myNull <= 1 && target !== p) th += 0.6;
      if (this.level === 'easy' && target !== p) return false;
      if (!nullified && benefit < -th) return true;
      if (nullified && benefit > th) return true;
      return false;
    }
    cards(req) {
      const g = this.g,
        p = this.p;
      if (req.aiPick) {
        const r = req.aiPick() || [];
        return r.filter((c) => req.cands.includes(c)).slice(0, req.max);
      }
      let scoreFn = req.ai;
      if (!scoreFn) {
        if (req.purpose === 'pindian') scoreFn = (c) => c.number - AI.cardValue(g, p, c) * 0.5;
        else scoreFn = (c) => -AI.cardValue(g, p, c) - (c.zone === 'e' ? 1 : 0);
      }
      const scored = req.cands.map((c) => [c, scoreFn(c)]).sort((a, b) => b[1] - a[1]);
      const res = [];
      for (const [c, s] of scored) {
        if (res.length < req.min) res.push(c);
        else if (res.length < req.max && req.ai && s > 0) res.push(c);
      }
      return res;
    }
    targets(req) {
      const g = this.g,
        p = this.p;
      if (req.aiPick) {
        const r = req.aiPick() || [];
        return r.filter((t) => req.cands.includes(t)).slice(0, req.max);
      }
      const f = req.ai || ((t) => -AI.att(g, p, t));
      const scored = req.cands.map((t) => [t, f(t)]).sort((a, b) => b[1] - a[1]);
      const res = [];
      for (const [t, s] of scored) {
        if (res.length < req.min) res.push(t);
        else if (res.length < req.max && s > 0) res.push(t);
      }
      return res;
    }
    pickCard(req) {
      const g = this.g,
        p = this.p,
        t = req.target;
      const areas = req.areas || 'hej';
      const a = AI.att(g, p, t);
      const hand = areas.includes('h') ? t.hand : [];
      const eq = areas.includes('e') ? t.equipList() : [];
      const jd = areas.includes('j') ? t.judges : [];
      const randHand = () => hand[Math.floor(this.rand() * hand.length)];
      if (a > 0) {
        const bad = jd.find((c) => c.name === '乐不思蜀') || jd.find((c) => c.name === '兵粮寸断') || jd.find((c) => c.name === '闪电');
        if (bad) return bad;
        if (hand.length) return randHand();
        return eq.slice().sort((x, y) => AI.equipValue(g, t, x) - AI.equipValue(g, t, y))[0] || jd[0];
      }
      const opts = [];
      for (const c of eq) {
        let s = AI.equipValue(g, t, c);
        if (c.name === '白银狮子' && t.hp < t.maxHp) s -= 3;
        if (g.hasSkill(t, 'xiaoji')) s -= 2;
        if (req.purpose === 'steal') s += Math.max(0, AI.equipValue(g, p, c) - (p.equips[c.subtype] ? AI.equipValue(g, p, p.equips[c.subtype]) : 0)) * 0.3;
        opts.push([c, s]);
      }
      if (hand.length) opts.push(['hand', 5.2 + (t.hand.length <= 2 && t.hp <= 2 ? 1.5 : 0) - (g.hasSkill(t, 'lianying') && t.hand.length === 1 ? 2 : 0)]);
      for (const c of jd) opts.push([c, c.name === '闪电' ? 0.5 : -5]);
      opts.sort((x, y) => y[1] - x[1]);
      const best = opts[0];
      if (!best) return null;
      return best[0] === 'hand' ? randHand() : best[0];
    }
    guanxing(req) {
      const g = this.g,
        p = this.p;
      const pool = req.cards.slice();
      const top = [];
      const judges = p.judges.slice().reverse();
      for (const j of judges) {
        let good;
        if (j.name === '乐不思蜀') good = (c) => g.suitOf(c, p) === 'heart';
        else if (j.name === '兵粮寸断') good = (c) => g.suitOf(c, p) === 'club';
        else if (j.name === '闪电') good = (c) => !(g.suitOf(c, p) === 'spade' && c.number >= 2 && c.number <= 9);
        else good = () => true;
        let i = pool.findIndex(good);
        if (i < 0) i = pool.reduce((bi, c, k) => (AI.cardValue(g, p, c) < AI.cardValue(g, p, pool[bi]) ? k : bi), 0);
        top.push(pool.splice(i, 1)[0]);
      }
      pool.sort((a, b) => AI.cardValue(g, p, b) - AI.cardValue(g, p, a));
      const keep = pool.filter((c) => AI.cardValue(g, p, c) >= 4.3);
      const drop = pool.filter((c) => AI.cardValue(g, p, c) < 4.3);
      return { top: top.concat(keep), bottom: drop };
    }
  }
  SGS.AIController = AIController;
})();
