// 武将技能与装备技能
(function () {
  const SGS = globalThis.SGS;
  const S = (SGS.Skills = {});
  const E = (SGS.EquipSkills = {});
  const att = (g, a, b) => SGS.AI.att(g, a, b);
  const val = (g, p, c) => SGS.AI.cardValue(g, p, c);
  const def = (id, o) => {
    o.id = id;
    S[id] = o;
  };
  const isSlash = (c) => c && c.name === '杀';
  const others = (g, p) => g.alivePlayers().filter((x) => x !== p);
  // 判定改判 AI：返回让结果符合期望的牌的得分
  const retrialScore = (g, owner, ev, c) => {
    const a = att(g, owner, ev.player);
    if (!ev.goodFn || a === 0) return -1;
    const want = a > 0;
    if (!!ev.goodFn(ev.card) === want) return -1;
    if (!!ev.goodFn(c) !== want) return -1;
    const importance = ['闪电', '乐不思蜀', '兵粮寸断'].includes(ev.reason) ? 4 : 1;
    return 6 + importance - val(g, owner, c);
  };

  // ============ 魏 ============
  def('jianxiong', {
    name: '奸雄',
    desc: '当你受到伤害后，你可以获得对你造成伤害的牌。',
    trigger: {
      damaged: async (g, o, ev) => {
        if (ev.target !== o || !ev.card) return;
        const cards = SGS.realCards(ev.card).filter((c) => c.zone === 'processing' || (c.zone === 'discard' && g.discardPile.slice(-4).includes(c)));
        if (!cards.length) return;
        if (!(await g.confirm(o, `是否发动【奸雄】，获得 ${SGS.cardText(ev.card)}？`, () => true, { skill: 'jianxiong' }))) return;
        await g.announce(o, 'jianxiong');
        await g.obtain(o, cards, { visible: true });
      },
    },
  });
  def('hujia', { name: '护驾', lord: true, desc: '主公技，当你需要使用或打出【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】（视为由你使用或打出）。' });
  def('fankui', {
    name: '反馈',
    desc: '当你受到伤害后，你可以获得伤害来源的一张牌。',
    trigger: {
      damaged: async (g, o, ev) => {
        const s = ev.source;
        if (ev.target !== o || !s || s === o || !s.alive || !s.countCards('he')) return;
        if (!(await g.confirm(o, `是否发动【反馈】，获得${g.nm(s)}的一张牌？`, () => att(g, o, s) <= 0 || s.countCards('he') > 3, { skill: 'fankui' }))) return;
        await g.announce(o, 'fankui');
        const c = await g.pickCardFrom(o, s, 'he', { prompt: '反馈：获得其一张牌', purpose: 'steal' });
        if (c) await g.obtain(o, [c], { from: s, visible: c.zone === 'e' });
      },
    },
  });
  def('guicai', {
    name: '鬼才',
    desc: '当一名角色的判定牌生效前，你可以打出一张手牌代替之。',
    trigger: {
      judgeModify: async (g, o, ev) => {
        if (!o.hand.length) return;
        const [c] = await g.chooseCards(o, {
          min: 0,
          max: 1,
          from: 'h',
          prompt: `${g.nm(ev.player)} 的【${ev.reason}】判定牌为 ${SGS.cardText(ev.card)}，是否发动【鬼才】打出一张手牌代替？`,
          skill: 'guicai',
          ai: (c) => retrialScore(g, o, ev, c),
        });
        if (!c) return;
        await g.announce(o, 'guicai');
        const old = ev.card;
        await g.moveCards([c], { zone: 'processing' }, { visible: true });
        ev.card = c;
        g.log(`判定牌改为 ${SGS.cardText(c)}`);
        await g.ui.fx('judge', { player: ev.player, card: c, reason: ev.reason });
        await g.moveCards([old], { zone: 'discard' }, { visible: true });
      },
    },
  });
  def('ganglie', {
    name: '刚烈',
    desc: '当你受到伤害后，你可以进行判定：若结果不为红桃，伤害来源选择一项：弃置两张手牌，或受到你造成的1点伤害。',
    trigger: {
      damaged: async (g, o, ev) => {
        const s = ev.source;
        if (ev.target !== o || !s || s === o || !s.alive || !o.alive) return;
        if (!(await g.confirm(o, `是否对${g.nm(s)}发动【刚烈】？`, () => att(g, o, s) <= 0, { skill: 'ganglie' }))) return;
        await g.announce(o, 'ganglie');
        const j = await g.judge(o, '刚烈', (c) => g.suitOf(c, o) !== 'heart');
        if (!j.good || !s.alive) return;
        let choice = 1;
        if (s.hand.length >= 2)
          choice = await g.chooseOption(s, ['弃置两张手牌', '受到1点伤害'], `【刚烈】判定成功，请选择`, () =>
            s.hp <= 1 || (s.hp <= 2 && s.hand.length >= 3) || s.hand.length >= 5 ? 0 : 1
          );
        if (choice === 0) {
          const cs = await g.chooseCards(s, { min: 2, max: 2, from: 'h', prompt: '刚烈：弃置两张手牌', purpose: 'discard' });
          await g.discard(s, cs);
        } else await g.damage(o, s, 1, null, null);
      },
    },
  });
  def('tuxi', {
    name: '突袭',
    desc: '摸牌阶段，你可以放弃摸牌，改为获得至多两名其他角色的各一张手牌。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o || ev.num <= 0) return;
        const cands = others(g, o).filter((p) => p.hand.length > 0);
        if (!cands.length) return;
        const ts = await g.chooseTargets(o, {
          candidates: cands,
          min: 0,
          max: 2,
          prompt: '是否发动【突袭】，获得至多两名其他角色的各一张手牌？',
          skill: 'tuxi',
          aiPick: () => {
            const es = cands.filter((p) => att(g, o, p) < 0).sort((a, b) => a.hand.length - b.hand.length);
            const ns = cands.filter((p) => att(g, o, p) === 0);
            const pick = es.concat(ns).slice(0, 2);
            return pick.length >= 2 ? pick : [];
          },
        });
        if (!ts.length) return;
        await g.announce(o, 'tuxi');
        ev.num = 0;
        for (const t of g.sortBySeat(ts, o)) {
          if (!t.hand.length) continue;
          const c = await g.pickCardFrom(o, t, 'h', { prompt: '突袭：获得其一张手牌', purpose: 'steal' });
          if (c) await g.obtain(o, [c], { from: t });
        }
      },
    },
  });
  def('luoyi', {
    name: '裸衣',
    desc: '摸牌阶段，你可以少摸一张牌，然后本回合你使用【杀】或【决斗】造成的伤害+1。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o || ev.num <= 0) return;
        const ai = () => o.hand.filter((c) => c.name === '杀' || c.name === '决斗').length >= 1 && o.hp >= 2 && SGS.AI.enemies(g, o).length > 0;
        if (!(await g.confirm(o, '是否发动【裸衣】，少摸一张牌，本回合【杀】和【决斗】伤害+1？', ai, { skill: 'luoyi' }))) return;
        await g.announce(o, 'luoyi');
        ev.num -= 1;
        o.turn.luoyi = true;
      },
      damageBefore: async (g, o, ev) => {
        if (ev.source !== o || !o.turn.luoyi || g.current !== o || !ev.card) return;
        if (ev.card.name !== '杀' && ev.card.name !== '决斗') return;
        ev.num += 1;
        g.log(`${g.nm(o)} 的【裸衣】使伤害+1`);
      },
    },
  });
  def('tiandu', {
    name: '天妒',
    desc: '当你的判定牌生效后，你可以获得此牌。',
    trigger: {
      judgeDone: async (g, o, ev) => {
        if (ev.player !== o || ev.card.zone !== 'processing') return;
        await g.announce(o, 'tiandu');
        await g.obtain(o, [ev.card], { visible: true });
      },
    },
  });
  def('yiji', {
    name: '遗计',
    desc: '当你受到1点伤害后，你可以观看牌堆顶的两张牌，然后将这些牌任意分配给任意角色。',
    trigger: {
      damaged: async (g, o, ev) => {
        if (ev.target !== o) return;
        for (let i = 0; i < ev.num && o.alive; i++) {
          if (!(await g.confirm(o, '是否发动【遗计】？', () => true, { skill: 'yiji' }))) return;
          await g.announce(o, 'yiji');
          const got = await g.draw(o, 2);
          let pool = got.filter((c) => c.zone === 'h' && c.owner === o);
          for (let k = 0; k < 2 && pool.length; k++) {
            const friends = SGS.AI.friends(g, o).filter((p) => p !== o).sort((a, b) => a.hand.length - b.hand.length);
            const give = await g.chooseCards(o, {
              min: 0,
              max: pool.length,
              from: 'h',
              filter: (c) => pool.includes(c),
              prompt: '遗计：选择要交给其他角色的牌（不选则自己保留）',
              skill: 'yiji',
              aiPick: () => (friends.length && friends[0].hand.length + 1 < o.hand.length - 1 ? pool.slice(0, 1) : []),
            });
            if (!give.length) break;
            const [t] = await g.chooseTargets(o, {
              candidates: others(g, o),
              min: 1,
              max: 1,
              prompt: '遗计：选择获得这些牌的角色',
              ai: (p) => att(g, o, p) * 10 - p.hand.length,
            });
            if (!t) break;
            await g.give(o, t, give);
            SGS.AI.observe(g, o, t, 0.5);
            pool = pool.filter((c) => !give.includes(c));
          }
        }
      },
    },
  });
  def('qingguo', {
    name: '倾国',
    desc: '你可以将一张黑色手牌当【闪】使用或打出。',
    viewAs: { as: '闪', filter: (g, p, c) => c.color === 'black', when: (g, p, mode) => mode === 'respond' },
  });
  def('luoshen', {
    name: '洛神',
    desc: '准备阶段，你可以进行判定：若结果为黑色，你获得判定牌，然后你可以重复此流程。',
    trigger: {
      phaseStart: async (g, o, ev) => {
        if (ev.player !== o) return;
        for (let i = 0; i < 20; i++) {
          if (!(await g.confirm(o, '是否发动【洛神】？', () => true, { skill: 'luoshen' }))) return;
          if (i === 0) await g.announce(o, 'luoshen');
          const j = await g.judge(o, '洛神', (c) => c.color === 'black', {
            after: async (e) => {
              if (e.good && e.card.zone === 'processing') await g.obtain(o, [e.card], { visible: true });
            },
          });
          if (!j.good) return;
        }
      },
    },
  });
  def('shensu', {
    name: '神速',
    desc: '你可以跳过判定阶段和摸牌阶段，视为使用一张无距离限制的【杀】；你可以跳过出牌阶段并弃置一张装备牌，视为使用一张无距离限制的【杀】。',
    trigger: {
      phaseBefore: async (g, o, ev) => {
        if (ev.player !== o) return;
        if (ev.phase !== 'judge' && ev.phase !== 'play') return;
        const slash = g.dummySlash();
        const cands = others(g, o).filter((t) => g.canTarget(o, t, slash));
        if (!cands.length) return;
        const enemies = cands.filter((t) => att(g, o, t) < 0).sort((a, b) => a.hp - b.hp);
        if (ev.phase === 'judge') {
          const bad = o.judges.some((c) => c.name === '乐不思蜀' || c.name === '兵粮寸断');
          const [t] = await g.chooseTargets(o, {
            candidates: cands,
            min: 0,
            max: 1,
            prompt: '是否发动【神速】：跳过判定和摸牌阶段，视为使用一张【杀】？',
            skill: 'shensu',
            aiPick: () => (enemies.length && (bad || (enemies[0].hp <= 1 && o.hand.length >= 3)) ? [enemies[0]] : []),
          });
          if (!t) return;
          await g.announce(o, 'shensu');
          ev.skip = true;
          o.skip.draw = true;
          await g.useCard(o, new SGS.VCard('杀', []), [t], { free: true });
        } else {
          const equips = o.cards('he').filter((c) => c.type === 'equip');
          if (!equips.length) return;
          const [t] = await g.chooseTargets(o, {
            candidates: cands,
            min: 0,
            max: 1,
            prompt: '是否发动【神速】：跳过出牌阶段并弃置一张装备牌，视为使用一张【杀】？',
            skill: 'shensu',
            aiPick: () => {
              const spare = equips.some((c) => c.zone === 'h' && o.equips[c.subtype]);
              const useful = o.hand.filter((c) => g.isUsable(o, c)).length;
              return enemies.length && spare && useful <= 1 ? [enemies[0]] : [];
            },
          });
          if (!t) return;
          const [c] = await g.chooseCards(o, { min: 1, max: 1, from: 'he', filter: (c) => c.type === 'equip', prompt: '神速：弃置一张装备牌', purpose: 'discard' });
          await g.announce(o, 'shensu');
          await g.discard(o, [c]);
          ev.skip = true;
          o.skip.discard = true;
          await g.useCard(o, new SGS.VCard('杀', []), [t], { free: true });
        }
      },
    },
  });
  def('jushou', {
    name: '据守',
    desc: '结束阶段，你可以摸三张牌，然后将武将牌翻面。',
    trigger: {
      phaseEnd: async (g, o, ev) => {
        if (ev.player !== o) return;
        if (!(await g.confirm(o, '是否发动【据守】，摸三张牌并翻面？', () => o.hand.length <= 1 || o.hp <= 2, { skill: 'jushou' }))) return;
        await g.announce(o, 'jushou');
        await g.draw(o, 3);
        await g.turnOver(o);
      },
    },
  });
  def('qiangxi', {
    name: '强袭',
    desc: '出牌阶段限一次，你可以失去1点体力或弃置一张武器牌，然后对你攻击范围内的一名其他角色造成1点伤害。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.qiangxi,
      cards: { min: 0, max: 1, areas: 'he', filter: (g, p, c) => c.subtype === 'weapon' },
      targets: { min: 1, max: 1, filter: (g, p, t, sel, cards) => t !== p && g.inAttackRange(p, t, cards && cards.length ? new SGS.VCard('杀', cards) : null) },
      effect: async (g, p, cards, targets) => {
        await g.announce(p, 'qiangxi');
        if (cards.length) await g.discard(p, cards);
        else await g.loseHp(p, 1);
        if (p.alive && targets[0].alive) await g.damage(p, targets[0], 1, null, null);
      },
      ai: (g, p) => {
        const w = p.cards('he').filter((c) => c.subtype === 'weapon');
        const spare = w.find((c) => c.zone === 'h');
        const cards = spare ? [spare] : [];
        if (!spare && p.hp < 3) return null;
        const ts = SGS.AI.enemies(g, p).filter((t) => g.inAttackRange(p, t, cards.length ? new SGS.VCard('杀', cards) : null)).sort((a, b) => a.hp - b.hp);
        if (!ts.length) return null;
        return { score: spare ? 7 : 4 + (ts[0].hp <= 1 ? 3 : 0), cards, targets: [ts[0]] };
      },
    },
  });
  def('quhu', {
    name: '驱虎',
    desc: '出牌阶段限一次，你可以与体力值大于你的一名角色拼点：若你赢，其对其攻击范围内你选择的另一名角色造成1点伤害；若你没赢，其对你造成1点伤害。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.quhu && p.hand.length > 0,
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p && t.hp > p.hp && t.hand.length > 0 },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'quhu');
        const r = await g.pindian(p, t, '驱虎');
        if (r.win) {
          const cands = others(g, t).filter((x) => g.inAttackRange(t, x));
          if (!cands.length) return;
          const [v] = await g.chooseTargets(p, { candidates: cands, min: 1, max: 1, prompt: `驱虎：选择${t.name}伤害的角色`, ai: (x) => -att(g, p, x) * 5 - x.hp });
          if (v) await g.damage(t, v, 1, null, null);
        } else if (p.alive && t.alive) await g.damage(t, p, 1, null, null);
      },
      ai: (g, p) => {
        const big = p.hand.filter((c) => c.number >= 11).length;
        if (!big) return null;
        const ts = others(g, p).filter((t) => t.hp > p.hp && t.hand.length > 0 && att(g, p, t) < 0);
        for (const t of ts) {
          const victims = others(g, t).filter((x) => g.inAttackRange(t, x) && att(g, p, x) < 0);
          if (victims.length) return { score: 5, targets: [t] };
        }
        return null;
      },
    },
  });
  def('jieming', {
    name: '节命',
    desc: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且至多为5）。',
    trigger: {
      damaged: async (g, o, ev) => {
        if (ev.target !== o) return;
        for (let i = 0; i < ev.num && o.alive; i++) {
          const gain = (p) => Math.max(0, Math.min(5, p.maxHp) - p.hand.length);
          const [t] = await g.chooseTargets(o, {
            candidates: g.alivePlayers(),
            min: 0,
            max: 1,
            prompt: '是否发动【节命】，令一名角色将手牌摸至体力上限（至多5）？',
            skill: 'jieming',
            ai: (p) => (att(g, o, p) > 0 ? gain(p) * att(g, o, p) : -1),
          });
          if (!t) return;
          await g.announce(o, 'jieming');
          await g.draw(t, gain(t));
        }
      },
    },
  });
  def('duanliang', {
    name: '断粮',
    desc: '你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用；你可以对距离为2以内的角色使用【兵粮寸断】。',
    viewAs: {
      as: '兵粮寸断',
      areas: 'he',
      filter: (g, p, c) => c.color === 'black' && (c.type === 'basic' || c.type === 'equip'),
      when: (g, p, mode) => mode === 'play',
    },
  });
  def('xingshang', {
    name: '行殇',
    desc: '当其他角色死亡时，你可以获得其所有牌。',
    trigger: {
      death: async (g, o, ev) => {
        const d = ev.player;
        if (d === o || !d.countCards('he')) return;
        if (!(await g.confirm(o, `是否发动【行殇】，获得${g.nm(d)}的所有牌？`, () => true, { skill: 'xingshang' }))) return;
        await g.announce(o, 'xingshang');
        await g.obtain(o, d.cards('he'), { from: d });
      },
    },
  });
  def('fangzhu', {
    name: '放逐',
    desc: '当你受到伤害后，你可以令一名其他角色摸X张牌（X为你已损失的体力值），然后其将武将牌翻面。',
    trigger: {
      damaged: async (g, o, ev) => {
        if (ev.target !== o || !o.alive) return;
        const X = o.lostHp;
        const [t] = await g.chooseTargets(o, {
          candidates: others(g, o),
          min: 0,
          max: 1,
          prompt: `是否发动【放逐】，令一名其他角色摸${X}张牌并翻面？`,
          skill: 'fangzhu',
          ai: (p) => {
            const a = att(g, o, p);
            if (p.turnedOver) return a > 0 ? 10 : -5;
            if (a < 0) return X <= 2 ? 6 - X + (p === g.nextAlive(o) ? 1 : 0) : -1;
            return -5;
          },
        });
        if (!t) return;
        await g.announce(o, 'fangzhu');
        await g.draw(t, X);
        await g.turnOver(t);
        SGS.AI.observe(g, o, t, t.turnedOver ? -1 : 1);
      },
    },
  });
  def('songwei', {
    name: '颂威',
    lord: true,
    desc: '主公技，当其他魏势力角色的判定牌为黑色且生效后，其可以令你摸一张牌。',
    trigger: {
      judgeDone: async (g, o, ev) => {
        const p = ev.player;
        if (p === o || p.kingdom !== 'wei' || ev.card.color !== 'black' || !p.alive) return;
        if (!(await g.confirm(p, `是否令${g.nm(o)}发动【颂威】摸一张牌？`, () => att(g, p, o) > 0))) return;
        await g.announce(o, 'songwei');
        await g.draw(o, 1);
      },
    },
  });

  // ============ 蜀 ============
  def('rende', {
    name: '仁德',
    desc: '出牌阶段，你可以将任意张手牌交给其他角色，然后若你于此阶段以此法给出的牌首次达到两张或更多，你回复1点体力。',
    enable: {
      canUse: (g, p) => p.hand.length > 0,
      cards: { min: 1, max: 99, areas: 'h', filter: () => true },
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'rende');
        const before = p.turn.rendeCount || 0;
        await g.give(p, t, cards);
        SGS.AI.observe(g, p, t, 1);
        p.turn.rendeCount = before + cards.length;
        if (before < 2 && p.turn.rendeCount >= 2) await g.recover(p, 1, p);
      },
      ai: (g, p) => {
        const friends = SGS.AI.friends(g, p).filter((x) => x !== p);
        const given = p.turn.rendeCount || 0;
        const sorted = p.hand.slice().sort((a, b) => val(g, p, a) - val(g, p, b));
        const usable = (c) => g.isUsable(p, c) && SGS.AI.quickPlayScore(g, p, c) > 2;
        const spare = sorted.filter((c) => !usable(c));
        if (friends.length) {
          const f = friends.sort((a, b) => a.hand.length - b.hand.length)[0];
          if (given < 2 && p.hp < p.maxHp && spare.length >= 2 - given) return { score: 6, cards: spare.slice(0, Math.max(2 - given, 1)), targets: [f] };
          const extra = p.hand.length - g.handLimit(p);
          if (extra > 0 && spare.length) return { score: 4, cards: spare.slice(0, Math.min(extra, spare.length)), targets: [f] };
        } else if (given < 2 && p.hp < p.maxHp && p.hp <= 2 && spare.length >= 2) {
          const n = others(g, p).filter((x) => att(g, p, x) >= 0).sort((a, b) => a.hand.length - b.hand.length);
          if (n.length) return { score: 3, cards: spare.slice(0, 2 - given), targets: [n[0]] };
        }
        return null;
      },
    },
  });
  def('jijiang', {
    name: '激将',
    lord: true,
    desc: '主公技，当你需要使用或打出【杀】时，你可以令其他蜀势力角色选择是否打出一张【杀】（视为由你使用或打出）。',
    enable: {
      canUse: (g, p) => !p.turn.jijiangFail && g.canSlashMore(p, null) && g.alivePlayers().some((q) => q !== p && q.kingdom === 'shu'),
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p && g.slashInRange(p, t, null) && g.canTarget(p, t, g.dummySlash()) },
      effect: async (g, p, cards, targets) => {
        await g.announce(p, 'jijiang');
        for (const q of g.playersFrom(p, false)) {
          if (q.kingdom !== 'shu') continue;
          const c = await g.askCard(q, ['杀'], { reason: 'proxy', beneficiary: p, noProxy: true, prompt: `${g.nm(p)} 发动【激将】，是否替其打出一张【杀】？` });
          if (c) {
            await g.useCard(p, c, targets, { silentSkill: true });
            return;
          }
        }
        p.turn.jijiangFail = true;
        g.log('无人响应【激将】');
      },
      ai: (g, p) => {
        if (p.hand.some((c) => c.name === '杀')) return null;
        const helpers = SGS.AI.friends(g, p).filter((q) => q !== p && q.kingdom === 'shu' && q.hand.length >= 2);
        if (!helpers.length) return null;
        const ts = SGS.AI.enemies(g, p).filter((t) => g.slashInRange(p, t, null) && g.canTarget(p, t, g.dummySlash()));
        if (!ts.length) return null;
        return { score: 3, targets: [ts.sort((a, b) => a.hp - b.hp)[0]] };
      },
    },
  });
  def('wusheng', {
    name: '武圣',
    desc: '你可以将一张红色牌当【杀】使用或打出。',
    viewAs: { as: '杀', areas: 'he', filter: (g, p, c) => c.color === 'red' },
  });
  def('paoxiao', { name: '咆哮', desc: '锁定技，你使用【杀】无次数限制。' });
  def('guanxing', {
    name: '观星',
    desc: '准备阶段，你可以观看牌堆顶的X张牌（X为全场角色数且至多为5），然后将其中任意数量的牌以任意顺序置于牌堆顶，其余以任意顺序置于牌堆底。',
    trigger: {
      phaseStart: async (g, o, ev) => {
        if (ev.player !== o) return;
        if (!(await g.confirm(o, '是否发动【观星】？', () => true, { skill: 'guanxing' }))) return;
        await g.announce(o, 'guanxing');
        const X = Math.min(5, g.alivePlayers().length);
        const cards = g.takeTop(X);
        let res = await g.ask(o, { type: 'guanxing', cards: cards.slice(), prompt: '观星：调整牌堆顶与牌堆底的牌' });
        const top = (res && res.top) || cards;
        const bottom = (res && res.bottom) || [];
        const all = new Set([...top, ...bottom]);
        if (all.size !== cards.length || cards.some((c) => !all.has(c))) {
          top.length = 0;
          top.push(...cards);
          bottom.length = 0;
        }
        for (let i = top.length - 1; i >= 0; i--) g._put(top[i], 'deckTop');
        for (const c of bottom) g._put(c, 'deckBottom');
        g.log(`${g.nm(o)} 将 ${top.length} 张牌置于牌堆顶，${bottom.length} 张牌置于牌堆底`);
        g.refresh();
      },
    },
  });
  def('kongcheng', {
    name: '空城',
    desc: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
    mod: { targetable: (g, o, card) => !(o.hand.length === 0 && card && (card.name === '杀' || card.name === '决斗')) },
  });
  def('longdan', {
    name: '龙胆',
    desc: '你可以将一张【杀】当【闪】、一张【闪】当【杀】使用或打出。',
    viewAs: { as: (c) => (c ? (c.name === '杀' ? '闪' : c.name === '闪' ? '杀' : null) : null), filter: (g, p, c) => c.name === '杀' || c.name === '闪' },
  });
  def('mashu', { name: '马术', desc: '锁定技，你计算与其他角色的距离-1。', mod: { distanceFrom: () => 1 } });
  def('tieqi', {
    name: '铁骑',
    desc: '当你使用【杀】指定目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】响应此【杀】。',
    trigger: {
      slashTarget: async (g, o, ev) => {
        if (ev.user !== o) return;
        if (!(await g.confirm(o, `是否对${g.nm(ev.target)}发动【铁骑】？`, () => true, { skill: 'tieqi' }))) return;
        await g.announce(o, 'tieqi');
        const j = await g.judge(o, '铁骑', (c) => c.color === 'red');
        if (j.good) {
          ev.noDodge = true;
          g.log(`${g.nm(ev.target)} 不能使用【闪】响应此【杀】`);
        }
      },
    },
  });
  def('jizhi', {
    name: '集智',
    desc: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
    trigger: {
      useCard: async (g, o, ctx) => {
        if (ctx.user !== o || ctx.card.type !== 'trick') return;
        await g.announce(o, 'jizhi');
        await g.draw(o, 1);
      },
    },
  });
  def('qicai', { name: '奇才', desc: '锁定技，你使用锦囊牌无距离限制。' });
  def('liegong', {
    name: '烈弓',
    desc: '当你于出牌阶段内使用【杀】指定目标后，若目标角色的手牌数不小于你的体力值或不大于你的攻击范围，你可以令其不能使用【闪】响应此【杀】。',
    trigger: {
      slashTarget: async (g, o, ev) => {
        if (ev.user !== o || g.current !== o || g.phase !== 'play') return;
        const n = ev.target.hand.length;
        if (!(n >= o.hp || n <= g.attackRange(o))) return;
        if (!(await g.confirm(o, `是否对${g.nm(ev.target)}发动【烈弓】？`, () => att(g, o, ev.target) < 0, { skill: 'liegong' }))) return;
        await g.announce(o, 'liegong');
        ev.noDodge = true;
      },
    },
  });
  def('kuanggu', {
    name: '狂骨',
    desc: '锁定技，当你对距离1以内的一名角色造成1点伤害后，你回复1点体力。',
    trigger: {
      damageDone: async (g, o, ev) => {
        if (ev.source !== o || ev.dist > 1 || o.hp >= o.maxHp) return;
        await g.announce(o, 'kuanggu');
        await g.recover(o, ev.num, o);
      },
    },
  });
  def('bazhen', { name: '八阵', desc: '锁定技，若你的装备区里没有防具牌，视为你装备着【八卦阵】。' });
  def('huoji', {
    name: '火计',
    desc: '你可以将一张红色手牌当【火攻】使用。',
    viewAs: { as: '火攻', filter: (g, p, c) => c.color === 'red', when: (g, p, mode) => mode === 'play' },
  });
  def('kanpo', {
    name: '看破',
    desc: '你可以将一张黑色手牌当【无懈可击】使用。',
    viewAs: { as: '无懈可击', filter: (g, p, c) => c.color === 'black', when: (g, p, mode) => mode === 'respond' },
  });
  def('lianhuan', {
    name: '连环',
    desc: '你可以将一张梅花手牌当【铁索连环】使用。',
    viewAs: { as: '铁索连环', filter: (g, p, c) => c.suit === 'club', when: (g, p, mode) => mode === 'play' },
  });
  def('niepan', {
    name: '涅槃',
    limited: true,
    desc: '限定技，当你处于濒死状态时，你可以弃置你区域里的所有牌，然后复原你的武将牌，摸三张牌，并将体力回复至3点。',
    trigger: {
      dying: async (g, o, ev) => {
        if (ev.player !== o || o.marks.niepanUsed) return;
        if (!(await g.confirm(o, '是否发动【涅槃】？', () => true, { skill: 'niepan' }))) return;
        o.marks.niepanUsed = true;
        await g.announce(o, 'niepan');
        await g.ui.fx('rebirth', { player: o });
        const all = o.cards('hej');
        if (all.length) await g.moveCards(all, { zone: 'discard' }, { visible: true });
        o.chained = false;
        o.turnedOver = false;
        await g.draw(o, 3);
        const t = Math.min(3, o.maxHp);
        if (o.hp < t) await g.recover(o, t - o.hp, o);
      },
    },
  });
  def('juxiang', {
    name: '巨象',
    desc: '锁定技，【南蛮入侵】对你无效；当其他角色使用的【南蛮入侵】结算完毕后，你获得之。',
    trigger: {
      useCardDone: async (g, o, ctx) => {
        if (ctx.card.name !== '南蛮入侵' || ctx.user === o) return;
        const cs = SGS.realCards(ctx.card).filter((c) => c.zone === 'processing');
        if (!cs.length) return;
        await g.announce(o, 'juxiang');
        await g.obtain(o, cs, { visible: true });
      },
    },
  });
  def('lieren', {
    name: '烈刃',
    desc: '当你使用【杀】对目标角色造成伤害后，你可以与其拼点：若你赢，你获得其一张牌。',
    trigger: {
      damageDone: async (g, o, ev) => {
        const t = ev.target;
        if (ev.source !== o || !isSlash(ev.card) || !t.alive || !o.hand.length || !t.hand.length || t === o) return;
        if (!(await g.confirm(o, `是否对${g.nm(t)}发动【烈刃】？`, () => att(g, o, t) < 0 && o.hand.some((c) => c.number >= 10), { skill: 'lieren' })))
          return;
        await g.announce(o, 'lieren');
        const r = await g.pindian(o, t, '烈刃');
        if (r.win && t.countCards('he')) {
          const c = await g.pickCardFrom(o, t, 'he', { prompt: '烈刃：获得其一张牌', purpose: 'steal' });
          if (c) await g.obtain(o, [c], { from: t, visible: c.zone === 'e' });
        }
      },
    },
  });
  def('huoshou', {
    name: '祸首',
    desc: '锁定技，【南蛮入侵】对你无效；你是其他角色使用的【南蛮入侵】造成伤害的来源。',
    trigger: {
      useCard: async (g, o, ctx) => {
        if (ctx.card.name === '南蛮入侵' && ctx.user !== o) {
          ctx.source = o;
          await g.announce(o, 'huoshou');
        }
      },
    },
  });
  def('zaiqi', {
    name: '再起',
    desc: '摸牌阶段，若你已受伤，你可以放弃摸牌，改为亮出牌堆顶的X张牌（X为你已损失的体力值），你每亮出一张红桃牌回复1点体力并将之置入弃牌堆，然后获得其余的牌。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o || o.lostHp <= 0 || ev.num <= 0) return;
        if (!(await g.confirm(o, `是否发动【再起】（亮出${o.lostHp}张牌）？`, () => o.lostHp >= 2, { skill: 'zaiqi' }))) return;
        await g.announce(o, 'zaiqi');
        ev.num = 0;
        const cards = g.takeTop(o.lostHp);
        for (const c of cards) g._put(c, 'processing');
        await g.ui.fx('show', { player: o, cards });
        g.log(`${g.nm(o)} 亮出了 ${cards.map(SGS.cardText).join('')}`);
        const hearts = cards.filter((c) => c.suit === 'heart');
        if (hearts.length) {
          await g.recover(o, hearts.length, o);
          await g.moveCards(hearts, { zone: 'discard' }, { visible: true });
        }
        const rest = cards.filter((c) => c.suit !== 'heart');
        if (rest.length) await g.obtain(o, rest, { visible: true });
      },
    },
  });
  def('xiangle', {
    name: '享乐',
    desc: '锁定技，当其他角色使用【杀】指定你为目标时，其须弃置一张基本牌，否则此【杀】对你无效。',
    trigger: {
      targeted: async (g, o, ev) => {
        if (ev.target !== o || !isSlash(ev.card) || ev.user === o) return;
        await g.announce(o, 'xiangle');
        const cs = await g.chooseCards(ev.user, {
          min: 0,
          max: 1,
          from: 'h',
          filter: (c) => c.type === 'basic',
          prompt: `【享乐】弃置一张基本牌，否则此【杀】对${o.name}无效`,
          ai: (c) => (att(g, ev.user, o) < 0 ? 8 - val(g, ev.user, c) : -1),
        });
        if (cs.length) await g.discard(ev.user, cs);
        else {
          ev.cancel = true;
          g.log(`此【杀】对 ${g.nm(o)} 无效`);
        }
      },
    },
  });
  def('fangquan', {
    name: '放权',
    desc: '你可以跳过出牌阶段，然后此回合结束时，你可以弃置一张手牌，令一名其他角色进行一个额外的回合。',
    trigger: {
      phaseBefore: async (g, o, ev) => {
        if (ev.player !== o || ev.phase !== 'play') return;
        const friends = SGS.AI.friends(g, o).filter((p) => p !== o);
        const ai = () => friends.length > 0 && o.hand.filter((c) => g.isUsable(o, c)).length <= 1 && o.hand.length >= 1;
        if (!(await g.confirm(o, '是否发动【放权】，跳过出牌阶段？', ai, { skill: 'fangquan' }))) return;
        await g.announce(o, 'fangquan');
        ev.skip = true;
        o.turn.fangquan = true;
      },
      turnEnd: async (g, o, ev) => {
        if (ev.player !== o || !o.turn.fangquan || !o.hand.length) return;
        const [t] = await g.chooseTargets(o, {
          candidates: others(g, o),
          min: 0,
          max: 1,
          prompt: '放权：弃置一张手牌，令一名其他角色进行一个额外回合',
          ai: (p) => att(g, o, p) * 3 + p.hand.length * 0.2,
        });
        if (!t || att(g, o, t) < 0 && !o.isHuman) return;
        const cs = await g.chooseCards(o, { min: 1, max: 1, from: 'h', prompt: '放权：弃置一张手牌', purpose: 'discard' });
        await g.discard(o, cs);
        g.log(`${g.nm(t)} 将进行一个额外的回合`);
        g.extraTurns.push(t);
      },
    },
  });
  def('tiaoxin', {
    name: '挑衅',
    desc: '出牌阶段限一次，你可以令攻击范围内含有你的一名角色对你使用一张【杀】，否则你弃置其一张牌。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.tiaoxin,
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p && g.inAttackRange(t, p) },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'tiaoxin');
        SGS.AI.observe(g, p, t, -0.5);
        const s = g.canTarget(t, p, g.dummySlash())
          ? await g.askCard(t, ['杀'], { reason: 'tiaoxin', source: p, target: p, mode: 'use', prompt: `${g.nm(p)} 对你发动【挑衅】，请对其使用一张【杀】，否则其弃置你一张牌` })
          : null;
        if (s) await g.useCard(t, s, [p], { free: true });
        else if (t.countCards('he') && p.alive) {
          const c = await g.pickCardFrom(p, t, 'he', { prompt: '挑衅：弃置其一张牌', purpose: 'dismantle' });
          if (c) await g.discardFrom(t, [c], p);
        }
      },
      ai: (g, p) => {
        const ts = SGS.AI.enemies(g, p).filter((t) => g.inAttackRange(t, p) && t.countCards('he') > 0);
        if (!ts.length) return null;
        const safe = p.hand.filter((c) => c.name === '闪').length > 0 || p.hp >= 3;
        if (!safe) return null;
        return { score: 4, targets: [ts.sort((a, b) => b.countCards('he') - a.countCards('he'))[0]] };
      },
    },
  });
  def('zhiji', {
    name: '志继',
    awaken: true,
    desc: '觉醒技，准备阶段，若你没有手牌，你回复1点体力或摸两张牌，然后减1点体力上限，获得技能【观星】。',
    trigger: {
      phaseStart: async (g, o, ev) => {
        if (ev.player !== o || o.marks.zhiji || o.hand.length) return;
        o.marks.zhiji = true;
        await g.announce(o, 'zhiji');
        await g.ui.fx('awaken', { player: o, name: '志继' });
        const opts = o.hp < o.maxHp ? ['回复1点体力', '摸两张牌'] : ['摸两张牌'];
        const i = await g.chooseOption(o, opts, '志继：请选择', () => (opts.length > 1 && o.hp <= 1 ? 0 : opts.length - 1));
        if (opts[i] === '回复1点体力') await g.recover(o, 1, o);
        else await g.draw(o, 2);
        await g.loseMaxHp(o, 1);
        if (o.alive && !o.skills.includes('guanxing')) {
          o.skills.push('guanxing');
          g.refresh();
        }
      },
    },
  });

  // ============ 吴 ============
  def('zhiheng', {
    name: '制衡',
    desc: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.zhiheng && p.countCards('he') > 0,
      cards: { min: 1, max: 99, areas: 'he', filter: () => true },
      targets: { min: 0, max: 0 },
      effect: async (g, p, cards) => {
        await g.announce(p, 'zhiheng');
        await g.discard(p, cards);
        await g.draw(p, cards.length);
      },
      ai: (g, p) => {
        const bad = p.cards('he').filter((c) => {
          if (c.zone === 'e') return false;
          if (c.type === 'equip' && p.equips[c.subtype]) return true;
          return val(g, p, c) < 4.5 && !(c.name === '闪' && p.hand.filter((x) => x.name === '闪').length <= 1);
        });
        if (!bad.length) return null;
        return { score: 1 + bad.length * 0.8, cards: bad, targets: [], late: true };
      },
    },
  });
  def('jiuyuan', { name: '救援', lord: true, desc: '主公技，锁定技，其他吴势力角色对处于濒死状态的你使用【桃】时，你额外回复1点体力。' });
  def('qixi', {
    name: '奇袭',
    desc: '你可以将一张黑色牌当【过河拆桥】使用。',
    viewAs: { as: '过河拆桥', areas: 'he', filter: (g, p, c) => c.color === 'black', when: (g, p, mode) => mode === 'play' },
  });
  def('keji', {
    name: '克己',
    desc: '若你未于出牌阶段内使用或打出过【杀】，你可以跳过弃牌阶段。',
    trigger: {
      phaseBefore: async (g, o, ev) => {
        if (ev.player !== o || ev.phase !== 'discard' || o.turn.slashPlayed) return;
        if (o.hand.length <= g.handLimit(o)) return;
        await g.announce(o, 'keji');
        ev.skip = true;
      },
    },
  });
  def('kurou', {
    name: '苦肉',
    desc: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
    enable: {
      canUse: (g, p) => p.hp > 0,
      targets: { min: 0, max: 0 },
      effect: async (g, p) => {
        await g.announce(p, 'kurou');
        await g.loseHp(p, 1);
        if (p.alive) await g.draw(p, 2);
      },
      ai: (g, p) => {
        const saves = p.hand.filter((c) => c.name === '桃' || c.name === '酒').length;
        const uses = p.turn.skillUses.kurou || 0;
        if (p.hp >= 3 || (p.hp === 2 && (saves >= 1 || p.hand.length <= 1)) || (p.hp === 1 && saves >= 1 && uses < 4)) return { score: 2.5, late: true };
        return null;
      },
    },
  });
  def('yingzi', {
    name: '英姿',
    desc: '摸牌阶段，你可以多摸一张牌。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o) return;
        await g.announce(o, 'yingzi');
        ev.num += 1;
      },
    },
  });
  def('fanjian', {
    name: '反间',
    desc: '出牌阶段限一次，你可以令一名其他角色选择一种花色，然后其获得你的一张手牌并展示之，若此牌花色与其所选的不同，你对其造成1点伤害。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.fanjian && p.hand.length > 0,
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'fanjian');
        const suits = ['spade', 'heart', 'club', 'diamond'];
        const i = await g.chooseOption(t, suits.map((s) => SGS.SUIT_SYMBOL[s] + SGS.SUIT_NAME[s]), `反间：请选择一种花色`, () => Math.floor(g.random() * 4));
        g.log(`${g.nm(t)} 选择了 ${SGS.SUIT_NAME[suits[i]]}`);
        if (!p.hand.length) return;
        const c = await g.pickCardFrom(t, p, 'h', { prompt: '反间：获得其一张手牌', purpose: 'steal' });
        if (!c) return;
        await g.obtain(t, [c], { from: p, visible: true });
        await g.ui.fx('show', { player: t, cards: [c] });
        if (c.suit !== suits[i] && t.alive) await g.damage(p, t, 1, null, null);
      },
      ai: (g, p) => {
        const ts = SGS.AI.enemies(g, p).sort((a, b) => a.hp - b.hp);
        if (!ts.length || !p.hand.length) return null;
        const low = p.hand.slice().sort((a, b) => val(g, p, a) - val(g, p, b))[0];
        if (val(g, p, low) > 6 && p.hand.length <= 2) return null;
        return { score: 4.5 + (ts[0].hp <= 1 ? 2 : 0), targets: [ts[0]] };
      },
    },
  });
  def('guose', {
    name: '国色',
    desc: '你可以将一张方块牌当【乐不思蜀】使用。',
    viewAs: { as: '乐不思蜀', areas: 'he', filter: (g, p, c) => c.suit === 'diamond', when: (g, p, mode) => mode === 'play' },
  });
  def('liuli', {
    name: '流离',
    desc: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色（不能是此【杀】的使用者）。',
    trigger: {
      targeted: async (g, o, ev) => {
        if (ev.target !== o || !isSlash(ev.card) || !o.countCards('he')) return;
        const cands = others(g, o).filter((x) => x !== ev.user && g.inAttackRange(o, x) && g.canTarget(ev.user, x, ev.card));
        if (!cands.length) return;
        const [t] = await g.chooseTargets(o, {
          candidates: cands,
          min: 0,
          max: 1,
          prompt: `是否发动【流离】，弃置一张牌将此【杀】转移？`,
          skill: 'liuli',
          ai: (x) => -att(g, o, x) * 4 - x.hp * 0.5 - (x.hand.length > 3 ? 1 : 0),
        });
        if (!t) return;
        const cs = await g.chooseCards(o, { min: 1, max: 1, from: 'he', prompt: '流离：弃置一张牌', purpose: 'cost' });
        if (!cs.length) return;
        await g.announce(o, 'liuli');
        await g.discard(o, cs);
        ev.target = t;
        g.log(`此【杀】被转移给了 ${g.nm(t)}`);
        await g.ui.fx('redirect', { from: o, to: t });
      },
    },
  });
  def('qianxun', {
    name: '谦逊',
    desc: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
    mod: { targetable: (g, o, card) => !(card && (card.name === '顺手牵羊' || card.name === '乐不思蜀')) },
  });
  def('lianying', {
    name: '连营',
    desc: '当你失去最后的手牌后，你可以摸一张牌。',
    trigger: {
      cardsLost: async (g, o, ev) => {
        if (ev.player !== o || !ev.hand.length || o.hand.length > 0 || !o.alive) return;
        await g.announce(o, 'lianying');
        await g.draw(o, 1);
      },
    },
  });
  def('jieyin', {
    name: '结姻',
    desc: '出牌阶段限一次，你可以弃置两张手牌并选择一名已受伤的男性角色，你与其各回复1点体力。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.jieyin && p.hand.length >= 2,
      cards: { min: 2, max: 2, areas: 'h', filter: () => true },
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p && t.gender === 'male' && t.hp < t.maxHp },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'jieyin');
        await g.discard(p, cards);
        await g.recover(p, 1, p);
        await g.recover(t, 1, p);
      },
      ai: (g, p) => {
        const ts = SGS.AI.friends(g, p).filter((t) => t !== p && t.gender === 'male' && t.hp < t.maxHp);
        if (!ts.length && p.hp >= p.maxHp) return null;
        const cards = p.hand.slice().sort((a, b) => val(g, p, a) - val(g, p, b)).slice(0, 2);
        if (!ts.length) return null;
        return { score: 5 + (p.hp < p.maxHp ? 2 : 0), cards, targets: [ts.sort((a, b) => a.hp - b.hp)[0]] };
      },
    },
  });
  def('xiaoji', {
    name: '枭姬',
    desc: '当你失去装备区里的一张牌后，你可以摸两张牌。',
    trigger: {
      cardsLost: async (g, o, ev) => {
        if (ev.player !== o || !ev.equip.length || !o.alive) return;
        for (let i = 0; i < ev.equip.length; i++) {
          await g.announce(o, 'xiaoji');
          await g.draw(o, 2);
        }
      },
    },
  });
  def('tianxiang', {
    name: '天香',
    desc: '当你受到伤害时，你可以弃置一张红桃手牌，将此伤害转移给一名其他角色，然后其摸X张牌（X为其已损失的体力值）。',
    trigger: {
      damageBefore: async (g, o, ev) => {
        if (ev.target !== o || ev.cancel || ev.opts.tianxiang) return;
        const hearts = o.hand.filter((c) => g.suitOf(c, o) === 'heart');
        if (!hearts.length) return;
        const [t] = await g.chooseTargets(o, {
          candidates: others(g, o),
          min: 0,
          max: 1,
          prompt: `是否发动【天香】，弃置一张红桃手牌转移此伤害（${ev.num}点）？`,
          skill: 'tianxiang',
          ai: (x) => {
            const a = att(g, o, x);
            if (a < 0) return 5 + (x.hp <= ev.num ? 4 : 0);
            if (a > 0 && x.hp > ev.num + 1 && x.lostHp + ev.num >= 2) return 2;
            return -1;
          },
        });
        if (!t) return;
        const cs = await g.chooseCards(o, { min: 1, max: 1, from: 'h', filter: (c) => g.suitOf(c, o) === 'heart', prompt: '天香：弃置一张红桃手牌', purpose: 'cost' });
        if (!cs.length) return;
        await g.announce(o, 'tianxiang');
        await g.discard(o, cs);
        ev.cancel = true;
        await g.ui.fx('redirect', { from: o, to: t });
        await g.damage(ev.source, t, ev.num, ev.nature, ev.card, { tianxiang: true });
        if (t.alive && t.lostHp > 0) await g.draw(t, t.lostHp);
      },
    },
  });
  def('hongyan', { name: '红颜', desc: '锁定技，你的黑桃牌视为红桃牌。' });
  def('tianyi', {
    name: '天义',
    desc: '出牌阶段限一次，你可以与一名角色拼点：若你赢，本回合你使用【杀】无距离限制、可额外指定一个目标且次数上限+1；若你没赢，本回合你不能使用【杀】。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.tianyi && p.hand.length > 0,
      targets: { min: 1, max: 1, filter: (g, p, t) => t !== p && t.hand.length > 0 },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'tianyi');
        const r = await g.pindian(p, t, '天义');
        if (r.win) {
          p.turn.tianyiWin = true;
          p.turn.extraSlash = (p.turn.extraSlash || 0) + 1;
        } else p.turn.noSlash = true;
      },
      ai: (g, p) => {
        const slashes = p.hand.filter((c) => c.name === '杀').length;
        const big = p.hand.filter((c) => c.number >= 11 && c.name !== '杀').length;
        if (!slashes || !big) return null;
        const ts = SGS.AI.enemies(g, p).filter((t) => t.hand.length > 0);
        if (!ts.length) return null;
        return { score: 6.5, targets: [ts.sort((a, b) => a.hand.length - b.hand.length)[0]] };
      },
    },
  });
  def('yinghun', {
    name: '英魂',
    desc: '准备阶段，若你已受伤，你可以选择一名其他角色并选择一项：令其摸X张牌，然后弃置一张牌；或令其摸一张牌，然后弃置X张牌（X为你已损失的体力值）。',
    trigger: {
      phaseStart: async (g, o, ev) => {
        if (ev.player !== o || o.lostHp <= 0) return;
        const X = o.lostHp;
        const [t] = await g.chooseTargets(o, {
          candidates: others(g, o),
          min: 0,
          max: 1,
          prompt: `是否发动【英魂】（X=${X}）？`,
          skill: 'yinghun',
          ai: (x) => {
            const a = att(g, o, x);
            if (a > 0) return X > 1 ? 4 + a : 1;
            if (a < 0) return X > 1 ? 3 + x.countCards('he') * 0.3 : 0.5;
            return -1;
          },
        });
        if (!t) return;
        await g.announce(o, 'yinghun');
        let mode = 0;
        if (X > 1) mode = await g.chooseOption(o, [`令其摸${X}张牌，弃置1张牌`, `令其摸1张牌，弃置${X}张牌`], '英魂：请选择', () => (att(g, o, t) > 0 ? 0 : 1));
        const [d, dis] = mode === 0 ? [X, 1] : [1, X];
        await g.draw(t, d);
        const cs = await g.chooseCards(t, { min: dis, max: dis, from: 'he', prompt: `英魂：弃置${dis}张牌`, purpose: 'discard' });
        await g.discard(t, cs);
        SGS.AI.observe(g, o, t, mode === 0 ? 1 : -1);
      },
    },
  });
  def('haoshi', {
    name: '好施',
    desc: '摸牌阶段，你可以多摸两张牌，然后若你的手牌数大于5，你将一半（向下取整）的手牌交给除你外手牌数最少的一名角色。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o || ev.num <= 0) return;
        const others_ = others(g, o);
        const min = Math.min(...others_.map((p) => p.hand.length));
        const lows = others_.filter((p) => p.hand.length === min);
        const ai = () => o.hand.length + ev.num + 2 <= 5 || lows.some((p) => att(g, o, p) > 0);
        if (!(await g.confirm(o, '是否发动【好施】，多摸两张牌？', ai, { skill: 'haoshi' }))) return;
        await g.announce(o, 'haoshi');
        ev.num += 2;
        o.turn.haoshi = true;
      },
      drawPhaseAfter: async (g, o, ev) => {
        if (ev.player !== o || !o.turn.haoshi) return;
        o.turn.haoshi = false;
        if (o.hand.length <= 5) return;
        const n = Math.floor(o.hand.length / 2);
        const others_ = others(g, o);
        const min = Math.min(...others_.map((p) => p.hand.length));
        const [t] = await g.chooseTargets(o, { candidates: others_.filter((p) => p.hand.length === min), min: 1, max: 1, prompt: `好施：将${n}张手牌交给手牌最少的一名角色`, ai: (p) => att(g, o, p) });
        const cs = await g.chooseCards(o, { min: n, max: n, from: 'h', prompt: `好施：选择${n}张手牌交给${t.name}`, purpose: 'give', ai: (c) => (att(g, o, t) > 0 ? val(g, o, c) : -val(g, o, c)) });
        await g.give(o, t, cs);
      },
    },
  });
  def('dimeng', {
    name: '缔盟',
    desc: '出牌阶段限一次，你可以选择两名其他角色并弃置X张牌（X为这两名角色的手牌数之差），令这两名角色交换手牌。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.dimeng,
      targets: {
        min: 2,
        max: 2,
        filter: (g, p, t, sel) => t !== p && (sel.length === 0 || Math.abs(sel[0].hand.length - t.hand.length) <= p.countCards('he')),
      },
      effect: async (g, p, cards, [a, b]) => {
        const X = Math.abs(a.hand.length - b.hand.length);
        await g.announce(p, 'dimeng');
        if (X > 0) {
          const cs = await g.chooseCards(p, { min: X, max: X, from: 'he', prompt: `缔盟：弃置${X}张牌`, purpose: 'discard' });
          await g.discard(p, cs);
        }
        const ha = a.hand.slice(),
          hb = b.hand.slice();
        await g.moveCards(ha, { zone: 'processing' }, {});
        await g.moveCards(hb, { zone: 'h', player: a }, {});
        await g.moveCards(ha, { zone: 'h', player: b }, {});
        g.log(`${g.nm(a)} 与 ${g.nm(b)} 交换了手牌`);
      },
      ai: (g, p) => {
        const fs = SGS.AI.friends(g, p).filter((x) => x !== p);
        const es = SGS.AI.enemies(g, p);
        let best = null;
        for (const f of fs)
          for (const e of es) {
            const X = e.hand.length - f.hand.length;
            if (X >= 2 && X <= Math.min(2, p.countCards('he'))) {
              const sc = X * 2.2 - X * 1.2;
              if (!best || sc > best.score) best = { score: 2 + sc, targets: [f, e] };
            }
          }
        return best;
      },
    },
  });
  def('jiang', {
    name: '激昂',
    desc: '当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可以摸一张牌。',
    trigger: {
      useCard: async (g, o, ctx) => {
        const c = ctx.card;
        if (ctx.user !== o || !(c.name === '决斗' || (c.name === '杀' && c.color === 'red'))) return;
        await g.announce(o, 'jiang');
        await g.draw(o, 1);
      },
      targeted: async (g, o, ev) => {
        const c = ev.card;
        if (ev.target !== o || ev.user === o || !(c.name === '决斗' || (c.name === '杀' && c.color === 'red'))) return;
        await g.announce(o, 'jiang');
        await g.draw(o, 1);
      },
    },
  });
  def('hunzi', {
    name: '魂姿',
    awaken: true,
    desc: '觉醒技，准备阶段，若你的体力值为1，你减1点体力上限，然后获得【英姿】和【英魂】。',
    trigger: {
      phaseStart: async (g, o, ev) => {
        if (ev.player !== o || o.marks.hunzi || o.hp !== 1) return;
        o.marks.hunzi = true;
        await g.announce(o, 'hunzi');
        await g.ui.fx('awaken', { player: o, name: '魂姿' });
        await g.loseMaxHp(o, 1);
        if (!o.alive) return;
        for (const s of ['yingzi', 'yinghun']) if (!o.skills.includes(s)) o.skills.push(s);
        g.refresh();
        await S.yinghun.trigger.phaseStart(g, o, ev);
      },
    },
  });

  // ============ 群 ============
  def('jijiu', {
    name: '急救',
    desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
    viewAs: { as: '桃', areas: 'he', filter: (g, p, c) => c.color === 'red', when: (g, p, mode) => mode === 'respond' && g.current !== p },
  });
  def('qingnang', {
    name: '青囊',
    desc: '出牌阶段限一次，你可以弃置一张手牌并选择一名已受伤的角色，令其回复1点体力。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.qingnang && p.hand.length > 0,
      cards: { min: 1, max: 1, areas: 'h', filter: () => true },
      targets: { min: 1, max: 1, filter: (g, p, t) => t.hp < t.maxHp },
      effect: async (g, p, cards, [t]) => {
        await g.announce(p, 'qingnang');
        await g.discard(p, cards);
        await g.recover(t, 1, p);
      },
      ai: (g, p) => {
        const ts = SGS.AI.friends(g, p).filter((t) => t.hp < t.maxHp).sort((a, b) => a.hp - b.hp);
        if (!ts.length) return null;
        const c = p.hand.slice().sort((a, b) => val(g, p, a) - val(g, p, b))[0];
        if (val(g, p, c) >= 8) return null;
        return { score: 5 + (ts[0].hp <= 1 ? 3 : 0), cards: [c], targets: [ts[0]] };
      },
    },
  });
  def('wushuang', { name: '无双', desc: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。' });
  def('lijian', {
    name: '离间',
    desc: '出牌阶段限一次，你可以弃置一张牌并选择两名男性角色，令后选择的角色视为对先选择的角色使用一张【决斗】（不能被【无懈可击】响应）。',
    enable: {
      canUse: (g, p) => !p.turn.skillUses.lijian && p.countCards('he') > 0,
      cards: { min: 1, max: 1, areas: 'he', filter: () => true },
      targets: { min: 2, max: 2, filter: (g, p, t, sel) => t !== p && t.gender === 'male' && (sel.length === 0 || g.canTarget(t, sel[0], new SGS.VCard('决斗', []))) },
      effect: async (g, p, cards, [a, b]) => {
        await g.announce(p, 'lijian');
        await g.discard(p, cards);
        if (!a.alive || !b.alive) return;
        const duel = new SGS.VCard('决斗', []);
        g.log(`${g.nm(b)} 视为对 ${g.nm(a)} 使用了【决斗】`);
        await g.ui.fx('use', { user: b, card: duel, targets: [a] });
        await SGS.CardDefs['决斗'].effect(g, b, a, duel, {});
      },
      ai: (g, p) => {
        const males = others(g, p).filter((t) => t.gender === 'male');
        const es = males.filter((t) => att(g, p, t) < 0).sort((a, b) => a.hp - b.hp);
        if (!es.length) return null;
        const a = es[0];
        const bs = males.filter((t) => t !== a && att(g, p, t) <= 0).sort((x, y) => y.hand.length - x.hand.length);
        const b = bs[0] || males.find((t) => t !== a && att(g, p, t) > 0 && t.hp > 2 && t.hand.length >= 3);
        if (!b) return null;
        const c = p.cards('he').sort((x, y) => val(g, p, x) - val(g, p, y))[0];
        return { score: 5.5 + (a.hp <= 1 ? 2 : 0), cards: [c], targets: [a, b] };
      },
    },
  });
  def('biyue', {
    name: '闭月',
    desc: '结束阶段，你可以摸一张牌。',
    trigger: {
      phaseEnd: async (g, o, ev) => {
        if (ev.player !== o) return;
        await g.announce(o, 'biyue');
        await g.draw(o, 1);
      },
    },
  });
  def('luanji', {
    name: '乱击',
    desc: '你可以将两张花色相同的手牌当【万箭齐发】使用。',
    viewAs: {
      as: '万箭齐发',
      count: 2,
      filter: (g, p, c, sel) => !sel || !sel.length || c.suit === sel[0].suit,
      when: (g, p, mode) => mode === 'play',
    },
  });
  def('xueyi', {
    name: '血裔',
    lord: true,
    desc: '主公技，锁定技，你的手牌上限+2X（X为其他群势力角色数）。',
    mod: { handLimit: (g, o) => 2 * g.alivePlayers().filter((p) => p !== o && p.kingdom === 'qun').length },
  });
  def('shuangxiong', {
    name: '双雄',
    desc: '摸牌阶段，你可以放弃摸牌，改为进行判定，你获得判定牌，然后本回合你可以将一张与此牌颜色不同的手牌当【决斗】使用。',
    trigger: {
      drawPhase: async (g, o, ev) => {
        if (ev.player !== o || ev.num <= 0) return;
        const ai = () => SGS.AI.enemies(g, o).length > 0 && o.hand.filter((c) => c.name === '杀').length >= 1 && o.hp >= 2;
        if (!(await g.confirm(o, '是否发动【双雄】？', ai, { skill: 'shuangxiong' }))) return;
        await g.announce(o, 'shuangxiong');
        ev.num = 0;
        await g.judge(o, '双雄', null, {
          after: async (e) => {
            o.turn.shuangxiong = e.card.color;
            if (e.card.zone === 'processing') await g.obtain(o, [e.card], { visible: true });
          },
        });
      },
    },
    viewAs: { as: '决斗', filter: (g, p, c) => p.turn.shuangxiong && c.color !== p.turn.shuangxiong, when: (g, p, mode) => mode === 'play' && !!p.turn.shuangxiong },
  });
  def('mengjin', {
    name: '猛进',
    desc: '当你使用的【杀】被【闪】抵消后，你可以弃置目标角色的一张牌。',
    trigger: {
      slashMissed: async (g, o, ev) => {
        if (ev.user !== o || !ev.target.countCards('he')) return;
        if (!(await g.confirm(o, `是否对${g.nm(ev.target)}发动【猛进】？`, () => att(g, o, ev.target) <= 0, { skill: 'mengjin' }))) return;
        await g.announce(o, 'mengjin');
        const c = await g.pickCardFrom(o, ev.target, 'he', { prompt: '猛进：弃置其一张牌', purpose: 'dismantle' });
        if (c) await g.discardFrom(ev.target, [c], o);
      },
    },
  });
  def('jiuchi', {
    name: '酒池',
    desc: '你可以将一张黑桃手牌当【酒】使用。',
    viewAs: { as: '酒', filter: (g, p, c) => c.suit === 'spade' },
  });
  def('roulin', { name: '肉林', desc: '锁定技，你对女性角色使用的【杀】，或女性角色对你使用的【杀】，需两张【闪】才能抵消。' });
  def('benghuai', {
    name: '崩坏',
    desc: '锁定技，结束阶段，若你的体力值不是全场最少的，你选择一项：失去1点体力，或减1点体力上限。',
    trigger: {
      phaseEnd: async (g, o, ev) => {
        if (ev.player !== o) return;
        if (!g.alivePlayers().some((p) => p !== o && p.hp < o.hp)) return;
        await g.announce(o, 'benghuai');
        const i = await g.chooseOption(o, ['失去1点体力', '减1点体力上限'], '崩坏：请选择', () => (o.maxHp > o.hp ? 1 : o.hp >= 4 ? 0 : 1));
        if (i === 0) await g.loseHp(o, 1);
        else await g.loseMaxHp(o, 1);
      },
    },
  });
  def('baonue', {
    name: '暴虐',
    lord: true,
    desc: '主公技，当其他群势力角色造成1点伤害后，其可以进行判定：若结果为黑桃，你回复1点体力。',
    trigger: {
      damageDone: async (g, o, ev) => {
        const s = ev.source;
        if (!s || s === o || !s.alive || s.kingdom !== 'qun' || o.hp >= o.maxHp) return;
        if (!(await g.confirm(s, `是否为${g.nm(o)}发动【暴虐】进行判定？`, () => att(g, s, o) > 0))) return;
        await g.announce(o, 'baonue');
        const j = await g.judge(s, '暴虐', (c) => c.suit === 'spade');
        if (j.good) await g.recover(o, 1, s);
      },
    },
  });
  def('wansha', { name: '完杀', desc: '锁定技，你的回合内，除你和处于濒死状态的角色外，其他角色不能使用【桃】。' });
  def('luanwu', {
    name: '乱武',
    limited: true,
    desc: '限定技，出牌阶段，你可以令所有其他角色依次对与其距离最近的另一名角色使用一张【杀】，否则失去1点体力。',
    enable: {
      canUse: (g, p) => !p.marks.luanwuUsed,
      targets: { min: 0, max: 0 },
      effect: async (g, p) => {
        p.marks.luanwuUsed = true;
        await g.announce(p, 'luanwu');
        await g.ui.fx('awaken', { player: p, name: '乱武' });
        for (const q of g.playersFrom(p, false)) {
          if (!q.alive) continue;
          const os = others(g, q);
          const minD = Math.min(...os.map((x) => g.distance(q, x)));
          const near = os.filter((x) => g.distance(q, x) === minD && g.slashInRange(q, x, null) && g.canTarget(q, x, g.dummySlash()));
          let done = false;
          if (near.length) {
            const s = await g.askCard(q, ['杀'], {
              reason: 'luanwu',
              source: p,
              candidates: near,
              mode: 'use',
              prompt: `【乱武】请对距离最近的角色（${near.map((x) => x.name).join('、')}）使用一张【杀】，否则失去1点体力`,
            });
            if (s) {
              const [t] = near.length === 1 ? near : await g.chooseTargets(q, { candidates: near, min: 1, max: 1, prompt: '乱武：选择【杀】的目标', ai: (x) => -att(g, q, x) * 3 - x.hp });
              await g.useCard(q, s, [t], { free: true });
              done = true;
            }
          }
          if (!done && q.alive) await g.loseHp(q, 1);
        }
      },
      ai: (g, p) => {
        const es = SGS.AI.enemies(g, p);
        const fs = SGS.AI.friends(g, p).filter((x) => x !== p);
        const lowE = es.filter((x) => x.hp <= 1).length;
        const lowF = fs.filter((x) => x.hp <= 1).length;
        if (es.length >= 2 && lowE >= 1 + lowF && (p.hp <= 2 || g.turnCount > 12)) return { score: 6 };
        return null;
      },
    },
  });
  def('weimu', {
    name: '帷幕',
    desc: '锁定技，你不能成为黑色锦囊牌的目标。',
    mod: { targetable: (g, o, card) => !(card && card.color === 'black' && (card.type === 'trick' || card.type === 'delay')) },
  });
  def('leiji', {
    name: '雷击',
    desc: '当你使用或打出【闪】时，你可以令一名角色进行判定：若结果为黑桃，你对其造成2点雷电伤害。',
    trigger: {
      cardResponded: async (g, o, ev) => {
        if (ev.player !== o || ev.card.name !== '闪') return;
        const [t] = await g.chooseTargets(o, {
          candidates: others(g, o),
          min: 0,
          max: 1,
          prompt: '是否发动【雷击】，令一名角色进行判定？',
          skill: 'leiji',
          ai: (x) => (att(g, o, x) < 0 ? 5 - x.hp + (x.equips.armor && x.equips.armor.name === '藤甲' ? 0 : 0) : -1),
        });
        if (!t) return;
        await g.announce(o, 'leiji');
        await g.ui.fx('lightning', { player: t, small: true });
        const j = await g.judge(t, '雷击', (c) => g.suitOf(c, t) !== 'spade');
        if (!j.good && t.alive) await g.damage(o, t, 2, 'thunder', null);
      },
    },
  });
  def('guidao', {
    name: '鬼道',
    desc: '当一名角色的判定牌生效前，你可以打出一张黑色牌替换之，然后你获得原判定牌。',
    trigger: {
      judgeModify: async (g, o, ev) => {
        const cands = o.cards('he').filter((c) => c.color === 'black');
        if (!cands.length) return;
        const [c] = await g.chooseCards(o, {
          min: 0,
          max: 1,
          from: 'he',
          filter: (c) => c.color === 'black',
          prompt: `${g.nm(ev.player)} 的【${ev.reason}】判定牌为 ${SGS.cardText(ev.card)}，是否发动【鬼道】替换？`,
          skill: 'guidao',
          ai: (c) => {
            const s = retrialScore(g, o, ev, c);
            if (s > 0) return s + val(g, o, ev.card) * 0.3;
            if (ev.goodFn && !!ev.goodFn(c) === !!ev.goodFn(ev.card) && val(g, o, ev.card) - val(g, o, c) > 3) return 1;
            return -1;
          },
        });
        if (!c) return;
        await g.announce(o, 'guidao');
        const old = ev.card;
        await g.moveCards([c], { zone: 'processing' }, { visible: true });
        ev.card = c;
        g.log(`判定牌改为 ${SGS.cardText(c)}`);
        await g.ui.fx('judge', { player: ev.player, card: c, reason: ev.reason });
        await g.obtain(o, [old], { visible: true });
      },
    },
  });
  def('beige', {
    name: '悲歌',
    desc: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令其进行判定：红桃，其回复1点体力；方块，其摸两张牌；梅花，伤害来源弃置两张牌；黑桃，伤害来源将武将牌翻面。',
    trigger: {
      damaged: async (g, o, ev) => {
        const t = ev.target;
        if (!isSlash(ev.card) || !t.alive || !o.countCards('he')) return;
        const s = ev.source;
        const ai = () => att(g, o, t) > 0 && (!s || att(g, o, s) <= 0);
        if (!(await g.confirm(o, `是否对${g.nm(t)}发动【悲歌】？`, ai, { skill: 'beige' }))) return;
        const cs = await g.chooseCards(o, { min: 1, max: 1, from: 'he', prompt: '悲歌：弃置一张牌', purpose: 'cost' });
        if (!cs.length) return;
        await g.announce(o, 'beige');
        await g.discard(o, cs);
        const j = await g.judge(t, '悲歌', null);
        const suit = g.suitOf(j.card, t);
        if (suit === 'heart') await g.recover(t, 1, o);
        else if (suit === 'diamond') await g.draw(t, 2);
        else if (suit === 'club' && s && s.alive) {
          const d = await g.chooseCards(s, { min: 2, max: 2, from: 'he', prompt: '悲歌：弃置两张牌', purpose: 'discard' });
          await g.discard(s, d);
        } else if (suit === 'spade' && s && s.alive) await g.turnOver(s);
      },
    },
  });
  def('duanchang', {
    name: '断肠',
    desc: '锁定技，当你死亡时，杀死你的角色失去所有武将技能。',
    trigger: {
      selfDeath: async (g, o, ev) => {
        const s = ev.source;
        if (!s || !s.alive || s === o) return;
        await g.announce(o, 'duanchang');
        s.skills = [];
        g.log(`${g.nm(s)} 失去了所有武将技能`);
        g.refresh();
      },
    },
  });

  // ============ 装备技能 ============
  E['雌雄双股剑'] = {
    id: '雌雄双股剑',
    name: '雌雄双股剑',
    trigger: {
      targeted: async (g, o, ev) => {
        if (ev.user !== o || !isSlash(ev.card) || ev.target.gender === o.gender) return;
        const t = ev.target;
        if (!(await g.confirm(o, `是否对${g.nm(t)}发动【雌雄双股剑】？`, () => true, { skill: '雌雄双股剑' }))) return;
        await g.announce(o, '雌雄双股剑');
        let c = [];
        if (t.hand.length)
          c = await g.chooseCards(t, {
            min: 0,
            max: 1,
            from: 'h',
            prompt: `【雌雄双股剑】弃置一张手牌，否则${o.name}摸一张牌`,
            ai: (x) => (att(g, t, o) < 0 && val(g, t, x) < 5 ? 5 - val(g, t, x) : -1),
          });
        if (c.length) await g.discard(t, c);
        else await g.draw(o, 1);
      },
    },
  };
  E['寒冰剑'] = {
    id: '寒冰剑',
    name: '寒冰剑',
    trigger: {
      slashHit: async (g, o, ev) => {
        const t = ev.target;
        if (ev.user !== o || ev.cancel || !t.countCards('he')) return;
        const ai = () => att(g, o, t) > 0 || (t.hp > 2 && t.countCards('he') >= 2 && t.equipList().length > 0 && !ev.ctx.wine);
        if (!(await g.confirm(o, `是否发动【寒冰剑】，防止伤害并弃置${g.nm(t)}两张牌？`, ai, { skill: '寒冰剑' }))) return;
        await g.announce(o, '寒冰剑');
        ev.cancel = true;
        for (let i = 0; i < 2 && t.countCards('he'); i++) {
          const c = await g.pickCardFrom(o, t, 'he', { prompt: '寒冰剑：弃置其一张牌', purpose: 'dismantle' });
          if (c) await g.discardFrom(t, [c], o);
        }
      },
    },
  };
  E['古锭刀'] = {
    id: '古锭刀',
    name: '古锭刀',
    trigger: {
      damageBefore: async (g, o, ev) => {
        if (ev.source !== o || !ev.opts.slash || ev.target.hand.length) return;
        await g.announce(o, '古锭刀');
        ev.num += 1;
      },
    },
  };
  E['青龙偃月刀'] = {
    id: '青龙偃月刀',
    name: '青龙偃月刀',
    trigger: {
      slashMissed: async (g, o, ev) => {
        if (ev.user !== o || !ev.target.alive || !g.canTarget(o, ev.target, g.dummySlash())) return;
        const c = await g.askCard(o, ['杀'], {
          reason: 'qinglong',
          target: ev.target,
          mode: 'use',
          noProxy: true,
          prompt: `是否发动【青龙偃月刀】，对${g.nm(ev.target)}再使用一张【杀】？`,
        });
        if (!c) return;
        await g.announce(o, '青龙偃月刀');
        await g.useCard(o, c, [ev.target], { free: true });
      },
    },
  };
  E['丈八蛇矛'] = {
    id: '丈八蛇矛',
    name: '丈八蛇矛',
    viewAs: { as: '杀', count: 2, filter: () => true },
  };
  E['贯石斧'] = {
    id: '贯石斧',
    name: '贯石斧',
    trigger: {
      slashMissed: async (g, o, ev) => {
        if (ev.user !== o || ev.hit) return;
        const cands = o.cards('he').filter((c) => c !== o.equips.weapon);
        if (cands.length < 2) return;
        const t = ev.target;
        const cs = await g.chooseCards(o, {
          min: 0,
          max: 2,
          from: 'he',
          filter: (c) => c !== o.equips.weapon,
          prompt: `是否发动【贯石斧】，弃置两张牌令此【杀】依然造成伤害？`,
          skill: '贯石斧',
          aiPick: () => {
            if (att(g, o, t) >= 0) return [];
            const sorted = cands.slice().sort((a, b) => val(g, o, a) - val(g, o, b));
            const cost = val(g, o, sorted[0]) + val(g, o, sorted[1]);
            return t.hp <= 1 + (ev.ctx.wine || 0) || cost < 8 ? sorted.slice(0, 2) : [];
          },
        });
        if (cs.length < 2) return;
        await g.announce(o, '贯石斧');
        await g.discard(o, cs);
        ev.hit = true;
      },
    },
  };
  E['麒麟弓'] = {
    id: '麒麟弓',
    name: '麒麟弓',
    trigger: {
      slashHit: async (g, o, ev) => {
        const t = ev.target;
        if (ev.user !== o || ev.cancel) return;
        const horses = [t.equips.plus, t.equips.minus].filter(Boolean);
        if (!horses.length) return;
        if (!(await g.confirm(o, `是否发动【麒麟弓】，弃置${g.nm(t)}的一张坐骑牌？`, () => att(g, o, t) < 0, { skill: '麒麟弓' }))) return;
        await g.announce(o, '麒麟弓');
        let h = horses[0];
        if (horses.length > 1) h = horses[await g.chooseOption(o, horses.map((c) => c.name), '麒麟弓：选择弃置的坐骑', () => 0)];
        await g.discardFrom(t, [h], o);
      },
    },
  };
})();
