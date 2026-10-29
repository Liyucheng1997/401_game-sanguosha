// 卡牌定义：标准版 + EX + 军争篇，共 160 张
(function () {
  const SGS = globalThis.SGS;
  const D = (SGS.CardDefs = {});

  const selfTarget = { self: true };
  const equipDef = (subtype, desc, extra) =>
    Object.assign({ type: 'equip', subtype, desc, targets: selfTarget, canUse: () => true }, extra || {});

  // ---------------- 基本牌 ----------------
  D['杀'] = {
    type: 'basic',
    desc: '出牌阶段限一次，对你攻击范围内的一名其他角色使用，目标须使用一张【闪】，否则受到你造成的1点伤害。',
    canUse: (g, p, c) => g.canSlashMore(p, c),
    targets: {
      min: 1,
      max: (g, p, c) => g.slashMaxTargets(p, c),
      filter: (g, p, t, c) => t !== p && g.slashInRange(p, t, c) && g.canTarget(p, t, c),
    },
    effect: (g, u, t, c, ctx) => g.slashEffect(u, t, c, ctx),
  };
  D['闪'] = { type: 'basic', desc: '当【杀】对你生效前，抵消此【杀】的效果。', canUse: () => false };
  D['桃'] = {
    type: 'basic',
    desc: '出牌阶段对自己使用，回复1点体力；或当一名角色处于濒死状态时，对其使用，令其回复1点体力。',
    canUse: (g, p) => p.hp < p.maxHp,
    targets: selfTarget,
    effect: async (g, u, t, c, ctx) => {
      let n = 1;
      if (ctx.dying && t !== u && t.identity === 'lord' && g.hasSkill(t, 'jiuyuan') && u.kingdom === 'wu') {
        await g.announce(t, 'jiuyuan');
        n = 2;
      }
      await g.recover(t, n, u);
    },
  };
  D['酒'] = {
    type: 'basic',
    desc: '出牌阶段限一次，令你本回合使用的下一张【杀】伤害+1；或处于濒死状态时对自己使用，回复1点体力。',
    canUse: (g, p) => !p.turn.wineUsed,
    targets: selfTarget,
    effect: async (g, u, t, c, ctx) => {
      if (ctx.dying || t.hp <= 0) {
        await g.recover(t, 1, u);
      } else {
        t.turn.wineUsed = true;
        t.wine = true;
        g.ui.fx('wine', { player: t });
        g.refresh();
      }
    },
  };

  // ---------------- 普通锦囊 ----------------
  D['决斗'] = {
    type: 'trick',
    desc: '对一名其他角色使用。由其开始，其与你轮流打出【杀】，首先不出【杀】的一方受到另一方造成的1点伤害。',
    targets: { min: 1, max: 1, filter: (g, p, t, c) => t !== p && g.canTarget(p, t, c) },
    effect: async (g, u, t, c, ctx) => {
      let cur = t,
        other = u;
      for (let round = 0; round < 60; round++) {
        if (!cur.alive || !other.alive) return;
        const need = g.hasSkill(other, 'wushuang') ? 2 : 1;
        if (need > 1 && round < 2) await g.announce(other, 'wushuang');
        let ok = true;
        for (let i = 0; i < need; i++) {
          const r = await g.respond(cur, ['杀'], {
            reason: 'duel',
            source: other,
            card: c,
            prompt: `【决斗】请打出一张【杀】${need > 1 ? `（${i + 1}/${need}）` : ''}，否则受到${g.nm(other)}造成的1点伤害`,
          });
          if (!r) {
            ok = false;
            break;
          }
        }
        if (!ok) {
          await g.damage(other, cur, 1, null, c, { duel: true });
          return;
        }
        [cur, other] = [other, cur];
      }
    },
  };
  D['过河拆桥'] = {
    type: 'trick',
    desc: '出牌阶段，对区域里有牌的一名其他角色使用，你弃置其区域里的一张牌。',
    targets: { min: 1, max: 1, filter: (g, p, t, c) => t !== p && t.countCards('hej') > 0 && g.canTarget(p, t, c) },
    effect: async (g, u, t) => {
      if (t.countCards('hej') === 0) return;
      const card = await g.pickCardFrom(u, t, 'hej', { prompt: `【过河拆桥】弃置${g.nm(t)}的一张牌`, purpose: 'dismantle' });
      if (card) {
        if (card.zone === 'j' || (card.virtual && t.judges.includes(card))) SGS.AI && SGS.AI.observe(g, u, t, 1);
        await g.discardFrom(t, [card], u);
      }
    },
  };
  D['顺手牵羊'] = {
    type: 'trick',
    desc: '出牌阶段，对距离为1且区域里有牌的一名其他角色使用，你获得其区域里的一张牌。',
    targets: {
      min: 1,
      max: 1,
      filter: (g, p, t, c) =>
        t !== p && t.countCards('hej') > 0 && (g.hasSkill(p, 'qicai') || g.distance(p, t) <= 1) && g.canTarget(p, t, c),
    },
    effect: async (g, u, t) => {
      if (t.countCards('hej') === 0) return;
      const card = await g.pickCardFrom(u, t, 'hej', { prompt: `【顺手牵羊】获得${g.nm(t)}的一张牌`, purpose: 'steal' });
      if (card) {
        if (card.zone === 'j' || (card.virtual && t.judges.includes(card))) SGS.AI && SGS.AI.observe(g, u, t, 1);
        await g.obtain(u, SGS.realCards(card), { from: t, visible: card.zone !== 'h' });
      }
    },
  };
  D['无中生有'] = {
    type: 'trick',
    good: true,
    desc: '出牌阶段，对自己使用，摸两张牌。',
    targets: selfTarget,
    effect: (g, u, t) => g.draw(t, 2),
  };
  D['借刀杀人'] = {
    type: 'trick',
    split: true,
    desc: '出牌阶段，对装备区里有武器牌的一名其他角色使用，令其对你指定的另一名角色使用一张【杀】，否则将武器牌交给你。',
    targets: {
      min: 2,
      max: 2,
      filter: (g, p, t, c, sel) => {
        if (sel.length === 0) {
          if (t === p || !t.equips.weapon || !g.canTarget(p, t, c)) return false;
          return g.alivePlayers().some((v) => v !== t && g.slashInRange(t, v, null) && g.canTarget(t, v, g.dummySlash()));
        }
        const a = sel[0];
        return t !== a && g.slashInRange(a, t, null) && g.canTarget(a, t, g.dummySlash());
      },
    },
    effect: async (g, u, t, c, ctx) => {
      const v = ctx.victim;
      if (!t.equips.weapon) return;
      let used = false;
      if (v && v.alive) {
        const s = await g.askCard(t, ['杀'], {
          reason: 'jiedao',
          source: u,
          target: v,
          mode: 'use',
          prompt: `${g.nm(u)}对你使用【借刀杀人】，请对${g.nm(v)}使用一张【杀】，否则交出武器`,
        });
        if (s) {
          used = true;
          await g.useCard(t, s, [v], { free: true });
        }
      }
      if (!used && t.equips.weapon && u.alive) await g.obtain(u, [t.equips.weapon], { from: t, visible: true });
    },
  };
  D['南蛮入侵'] = {
    type: 'trick',
    aoe: true,
    desc: '出牌阶段，对所有其他角色使用，每名目标角色须打出一张【杀】，否则受到你造成的1点伤害。',
    targets: { all: 'others' },
    effect: async (g, u, t, c, ctx) => {
      if (g.blockedByArmor(t, c, ctx)) return;
      const r = await g.respond(t, ['杀'], { reason: 'nanman', source: u, card: c, prompt: '【南蛮入侵】请打出一张【杀】，否则受到1点伤害' });
      if (!r) await g.damage(ctx.source || u, t, 1, null, c);
    },
  };
  D['万箭齐发'] = {
    type: 'trick',
    aoe: true,
    desc: '出牌阶段，对所有其他角色使用，每名目标角色须打出一张【闪】，否则受到你造成的1点伤害。',
    targets: { all: 'others' },
    effect: async (g, u, t, c, ctx) => {
      if (g.blockedByArmor(t, c, ctx)) return;
      const ok = await g.dodge(t, { reason: 'wanjian', source: u, card: c, prompt: '【万箭齐发】请打出一张【闪】，否则受到1点伤害' });
      if (!ok) await g.damage(u, t, 1, null, c);
    },
  };
  D['桃园结义'] = {
    type: 'trick',
    good: true,
    aoe: true,
    desc: '出牌阶段，对所有角色使用，每名目标角色回复1点体力。',
    targets: { all: 'all' },
    skipTarget: (g, u, t) => t.hp >= t.maxHp,
    effect: (g, u, t) => g.recover(t, 1, u),
  };
  D['五谷丰登'] = {
    type: 'trick',
    good: true,
    aoe: true,
    desc: '出牌阶段，对所有角色使用。亮出牌堆顶等于角色数的牌，每名目标角色依次获得其中一张。',
    targets: { all: 'all' },
    before: async (g, u, targets, ctx) => {
      ctx.pool = g.takeTop(targets.length);
      for (const c of ctx.pool) g._put(c, 'processing');
      await g.ui.fx('wuguShow', { cards: ctx.pool });
    },
    effect: async (g, u, t, c, ctx) => {
      if (!ctx.pool.length) return;
      const pick = await g.ask(t, { type: 'wugu', cards: ctx.pool.slice(), prompt: '【五谷丰登】选择一张牌获得' });
      const card = ctx.pool.includes(pick) ? pick : ctx.pool[0];
      SGS.remove(ctx.pool, card);
      await g.ui.fx('wuguPick', { player: t, card });
      await g.obtain(t, [card], { visible: true });
    },
    after: async (g, u, targets, ctx) => {
      await g.ui.fx('wuguEnd', {});
      if (ctx.pool.length) await g.moveCards(ctx.pool, { zone: 'discard' });
    },
  };
  D['无懈可击'] = {
    type: 'trick',
    desc: '抵消目标锦囊牌对一名角色产生的效果，或抵消另一张【无懈可击】的效果。',
    canUse: () => false,
  };
  D['火攻'] = {
    type: 'trick',
    desc: '出牌阶段，对一名有手牌的角色使用。目标角色展示一张手牌，然后你可以弃置一张与之花色相同的手牌，对其造成1点火焰伤害。',
    targets: { min: 1, max: 1, filter: (g, p, t, c) => t.hand.length > 0 && g.canTarget(p, t, c) },
    effect: async (g, u, t, c) => {
      if (!t.hand.length) return;
      const [shown] = await g.chooseCards(t, {
        min: 1,
        max: 1,
        from: 'h',
        prompt: `【火攻】请展示一张手牌`,
        purpose: 'show',
        ai: (x) => -SGS.AI.cardValue(g, t, x) + (u.hand.some((h) => h.suit === x.suit) ? -3 : 0),
      });
      if (!shown) return;
      g.log(`${g.nm(t)} 展示了 ${SGS.cardText(shown)}`);
      await g.ui.fx('show', { player: t, cards: [shown] });
      if (!u.alive) return;
      const suit = shown.suit;
      const pay = await g.chooseCards(u, {
        min: 0,
        max: 1,
        from: 'h',
        filter: (x) => x.suit === suit,
        prompt: `【火攻】弃置一张${SGS.SUIT_NAME[suit]}手牌，对${g.nm(t)}造成1点火焰伤害`,
        purpose: 'cost',
        ai: (x) => (SGS.AI.att(g, u, t) < 0 ? 7 + (t.hp <= 1 ? 2 : 0) - SGS.AI.cardValue(g, u, x) : -1),
      });
      if (pay.length) {
        await g.discard(u, pay);
        await g.damage(u, t, 1, 'fire', c);
      }
    },
  };
  D['铁索连环'] = {
    type: 'trick',
    recast: true,
    desc: '出牌阶段，选择一至两名角色，横置或重置其武将牌；或将此牌重铸（弃置并摸一张牌）。',
    targets: { min: 1, max: 2, filter: (g, p, t, c) => g.canTarget(p, t, c) },
    effect: async (g, u, t) => {
      await g.setChained(t, !t.chained);
    },
  };

  // ---------------- 延时锦囊 ----------------
  D['乐不思蜀'] = {
    type: 'delay',
    desc: '出牌阶段，对一名其他角色使用。判定阶段进行判定：若结果不为红桃，跳过其出牌阶段。',
    targets: {
      min: 1,
      max: 1,
      filter: (g, p, t, c) => t !== p && !t.hasJudge('乐不思蜀') && g.canTarget(p, t, c),
    },
    judgeEffect: async (g, p, card) => {
      const j = await g.judge(p, '乐不思蜀', (x) => g.suitOf(x, p) === 'heart');
      if (!j.good) {
        p.skip.play = true;
        g.log(`${g.nm(p)} 将跳过出牌阶段`);
      }
      await g.moveCards(SGS.realCards(card), { zone: 'discard' });
    },
  };
  D['兵粮寸断'] = {
    type: 'delay',
    desc: '出牌阶段，对距离为1的一名其他角色使用。判定阶段进行判定：若结果不为梅花，跳过其摸牌阶段。',
    targets: {
      min: 1,
      max: 1,
      filter: (g, p, t, c) =>
        t !== p &&
        !t.hasJudge('兵粮寸断') &&
        (g.hasSkill(p, 'qicai') || g.distance(p, t) <= (c && c.skill === 'duanliang' ? 2 : 1)) &&
        g.canTarget(p, t, c),
    },
    judgeEffect: async (g, p, card) => {
      const j = await g.judge(p, '兵粮寸断', (x) => g.suitOf(x, p) === 'club');
      if (!j.good) {
        p.skip.draw = true;
        g.log(`${g.nm(p)} 将跳过摸牌阶段`);
      }
      await g.moveCards(SGS.realCards(card), { zone: 'discard' });
    },
  };
  D['闪电'] = {
    type: 'delay',
    desc: '出牌阶段，对自己使用。判定阶段进行判定：若结果为黑桃2~9，受到3点雷电伤害；否则将之移动到下家的判定区里。',
    canUse: (g, p) => !p.hasJudge('闪电'),
    targets: selfTarget,
    judgeEffect: async (g, p, card) => {
      const j = await g.judge(p, '闪电', (x) => !(g.suitOf(x, p) === 'spade' && x.number >= 2 && x.number <= 9));
      if (!j.good) {
        await g.moveCards(SGS.realCards(card), { zone: 'discard' });
        await g.ui.fx('lightning', { player: p });
        await g.damage(null, p, 3, 'thunder', card, { lightning: true });
      } else {
        await g.passLightning(p, card);
      }
    },
  };

  // ---------------- 装备牌 ----------------
  D['诸葛连弩'] = equipDef('weapon', '攻击范围1。锁定技，你使用【杀】无次数限制。', { range: 1 });
  D['青釭剑'] = equipDef('weapon', '攻击范围2。锁定技，你使用【杀】无视目标角色的防具。', { range: 2 });
  D['雌雄双股剑'] = equipDef('weapon', '攻击范围2。你使用【杀】指定异性角色为目标后，可令其选择一项：弃置一张手牌，或令你摸一张牌。', { range: 2 });
  D['寒冰剑'] = equipDef('weapon', '攻击范围2。你使用【杀】对目标造成伤害时，若其有牌，你可以防止此伤害，改为依次弃置其两张牌。', { range: 2 });
  D['古锭刀'] = equipDef('weapon', '攻击范围2。锁定技，你使用【杀】对目标造成伤害时，若其没有手牌，此伤害+1。', { range: 2 });
  D['青龙偃月刀'] = equipDef('weapon', '攻击范围3。你使用的【杀】被【闪】抵消后，你可以对相同目标再使用一张【杀】。', { range: 3 });
  D['丈八蛇矛'] = equipDef('weapon', '攻击范围3。你可以将两张手牌当【杀】使用或打出。', { range: 3 });
  D['贯石斧'] = equipDef('weapon', '攻击范围3。你使用的【杀】被【闪】抵消后，你可以弃置两张牌，令此【杀】依然造成伤害。', { range: 3 });
  D['朱雀羽扇'] = equipDef('weapon', '攻击范围4。你可以将一张普通【杀】当火【杀】使用。', { range: 4 });
  D['方天画戟'] = equipDef('weapon', '攻击范围4。你使用的【杀】是你最后的手牌时，可以额外指定至多两个目标。', { range: 4 });
  D['麒麟弓'] = equipDef('weapon', '攻击范围5。你使用【杀】对目标造成伤害时，可以弃置其装备区里的一张坐骑牌。', { range: 5 });
  D['八卦阵'] = equipDef('armor', '当你需要使用或打出【闪】时，可以进行判定：若结果为红色，视为你使用或打出了一张【闪】。');
  D['仁王盾'] = equipDef('armor', '锁定技，黑色【杀】对你无效。');
  D['藤甲'] = equipDef('armor', '锁定技，【南蛮入侵】、【万箭齐发】和普通【杀】对你无效；你受到火焰伤害时，此伤害+1。');
  D['白银狮子'] = equipDef('armor', '锁定技，你受到大于1点的伤害时，防止多余的伤害；当你失去装备区里的【白银狮子】后，回复1点体力。');
  for (const n of ['绝影', '的卢', '爪黄飞电', '骅骝']) D[n] = equipDef('plus', '+1马：其他角色计算与你的距离+1。');
  for (const n of ['赤兔', '大宛', '紫骍']) D[n] = equipDef('minus', '-1马：你计算与其他角色的距离-1。');

  for (const k in D) D[k].name = k;
  for (const k in D) {
    const d = D[k];
    d.typeName = { basic: '基本牌', trick: '锦囊牌', delay: '延时锦囊', equip: '装备牌' }[d.type];
    if (d.type === 'equip') d.typeName = { weapon: '武器', armor: '防具', plus: '防御马', minus: '进攻马' }[d.subtype];
  }

  // ---------------- 牌堆 ----------------
  const S = 'spade',
    H = 'heart',
    C = 'club',
    Dm = 'diamond';
  const LIST = [
    // 标准版 黑桃
    ['决斗', S, 1], ['闪电', S, 1], ['雌雄双股剑', S, 2], ['八卦阵', S, 2], ['寒冰剑', S, 2],
    ['过河拆桥', S, 3], ['顺手牵羊', S, 3], ['过河拆桥', S, 4], ['顺手牵羊', S, 4],
    ['青龙偃月刀', S, 5], ['绝影', S, 5], ['青釭剑', S, 6], ['乐不思蜀', S, 6],
    ['杀', S, 7], ['南蛮入侵', S, 7], ['杀', S, 8], ['杀', S, 8], ['杀', S, 9], ['杀', S, 9],
    ['杀', S, 10], ['杀', S, 10], ['顺手牵羊', S, 11], ['无懈可击', S, 11],
    ['过河拆桥', S, 12], ['丈八蛇矛', S, 12], ['南蛮入侵', S, 13], ['大宛', S, 13],
    // 标准版 红桃
    ['桃园结义', H, 1], ['万箭齐发', H, 1], ['闪', H, 2], ['闪', H, 2], ['桃', H, 3], ['五谷丰登', H, 3],
    ['桃', H, 4], ['无中生有', H, 4], ['麒麟弓', H, 5], ['赤兔', H, 5], ['桃', H, 6], ['乐不思蜀', H, 6],
    ['桃', H, 7], ['无中生有', H, 7], ['桃', H, 8], ['无中生有', H, 8], ['桃', H, 9], ['无中生有', H, 9],
    ['杀', H, 10], ['杀', H, 10], ['杀', H, 11], ['无中生有', H, 11],
    ['桃', H, 12], ['过河拆桥', H, 12], ['闪电', H, 12], ['闪', H, 13], ['爪黄飞电', H, 13],
    // 标准版 梅花
    ['决斗', C, 1], ['诸葛连弩', C, 1], ['杀', C, 2], ['八卦阵', C, 2], ['仁王盾', C, 2],
    ['杀', C, 3], ['过河拆桥', C, 3], ['杀', C, 4], ['过河拆桥', C, 4], ['杀', C, 5], ['的卢', C, 5],
    ['杀', C, 6], ['乐不思蜀', C, 6], ['杀', C, 7], ['南蛮入侵', C, 7], ['杀', C, 8], ['杀', C, 8],
    ['杀', C, 9], ['杀', C, 9], ['杀', C, 10], ['杀', C, 10], ['杀', C, 11], ['杀', C, 11],
    ['借刀杀人', C, 12], ['无懈可击', C, 12], ['借刀杀人', C, 13], ['无懈可击', C, 13],
    // 标准版 方块
    ['决斗', Dm, 1], ['诸葛连弩', Dm, 1], ['闪', Dm, 2], ['闪', Dm, 2], ['闪', Dm, 3], ['顺手牵羊', Dm, 3],
    ['闪', Dm, 4], ['顺手牵羊', Dm, 4], ['闪', Dm, 5], ['贯石斧', Dm, 5], ['杀', Dm, 6], ['闪', Dm, 6],
    ['杀', Dm, 7], ['闪', Dm, 7], ['杀', Dm, 8], ['闪', Dm, 8], ['杀', Dm, 9], ['闪', Dm, 9],
    ['杀', Dm, 10], ['闪', Dm, 10], ['闪', Dm, 11], ['闪', Dm, 11],
    ['桃', Dm, 12], ['方天画戟', Dm, 12], ['无懈可击', Dm, 12], ['杀', Dm, 13], ['紫骍', Dm, 13],
    // 军争篇 黑桃
    ['古锭刀', S, 1], ['藤甲', S, 2], ['酒', S, 3], ['杀', S, 4, 'thunder'], ['杀', S, 5, 'thunder'],
    ['杀', S, 6, 'thunder'], ['杀', S, 7, 'thunder'], ['杀', S, 8, 'thunder'], ['酒', S, 9],
    ['兵粮寸断', S, 10], ['铁索连环', S, 11], ['铁索连环', S, 12], ['无懈可击', S, 13],
    // 军争篇 红桃
    ['无懈可击', H, 1], ['火攻', H, 2], ['火攻', H, 3], ['杀', H, 4, 'fire'], ['桃', H, 5], ['桃', H, 6],
    ['杀', H, 7, 'fire'], ['闪', H, 8], ['闪', H, 9], ['杀', H, 10, 'fire'], ['闪', H, 11], ['闪', H, 12],
    ['无懈可击', H, 13],
    // 军争篇 梅花
    ['白银狮子', C, 1], ['藤甲', C, 2], ['酒', C, 3], ['兵粮寸断', C, 4], ['杀', C, 5, 'thunder'],
    ['杀', C, 6, 'thunder'], ['杀', C, 7, 'thunder'], ['杀', C, 8, 'thunder'], ['酒', C, 9],
    ['铁索连环', C, 10], ['铁索连环', C, 11], ['铁索连环', C, 12], ['铁索连环', C, 13],
    // 军争篇 方块
    ['朱雀羽扇', Dm, 1], ['桃', Dm, 2], ['桃', Dm, 3], ['杀', Dm, 4, 'fire'], ['杀', Dm, 5, 'fire'],
    ['闪', Dm, 6], ['闪', Dm, 7], ['闪', Dm, 8], ['酒', Dm, 9], ['闪', Dm, 10], ['闪', Dm, 11],
    ['火攻', Dm, 12], ['骅骝', Dm, 13],
  ];
  SGS.DECK_LIST = LIST;
  SGS.buildDeck = function () {
    return LIST.map((e, i) => new SGS.Card(i + 1, e[0], e[1], e[2], e[3]));
  };
})();
