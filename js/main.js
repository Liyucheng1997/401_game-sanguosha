// 主菜单、图鉴与对局生命周期
(function () {
  const SGS = globalThis.SGS;
  const ui = new SGS.UI(document.getElementById('app'));
  const stage = ui.stage;
  let game = null;
  let lastCfg = null;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : v;
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
  };
  ui.sound.on = store.get('sgs-sound', '1') === '1';
  ui.sound.voiceOn = store.get('sgs-voice', '1') === '1';
  ui.sound.musicOn = store.get('sgs-music', '1') === '1';
  // 浏览器要求用户先交互才能出声：第一次点击时预载音效并开始背景乐
  const unlockAudio = () => {
    document.removeEventListener('pointerdown', unlockAudio, true);
    ui.sound.preload();
    ui.sound.startMusic();
  };
  document.addEventListener('pointerdown', unlockAudio, true);
  const sp = store.get('sgs-speed', '中');
  if (sp && { 慢: 1, 中: 1, 快: 1, 极速: 1 }[sp]) {
    ui.speedName = sp;
    ui.speed = { 慢: 1.5, 中: 1, 快: 0.6, 极速: 0.3 }[sp];
  }

  // 每局一个界面代理：旧对局的回调不会干扰新对局
  let gen = 0;
  function uiProxy() {
    const tok = ++gen;
    const live = () => tok === gen;
    return {
      refresh: () => live() && ui.refresh(),
      log: (h) => live() && ui.log(h),
      fx: async (t, d) => (live() ? ui.fx(t, d) : undefined),
      animMove: async (o) => (live() ? ui.animMove(o) : undefined),
      wait: async (ms) => {
        if (!live()) throw new SGS.GameAbort();
        await ui.wait(ms);
        if (!live()) throw new SGS.GameAbort();
      },
    };
  }

  const OPTS = {
    count: { label: '人数', vals: ['4', '5', '6', '7', '8'], def: '5', fmt: (v) => v + '人' },
    diff: { label: '难度', vals: ['easy', 'normal', 'hard', 'hell'], def: 'hard', fmt: (v) => SGS.AI.LEVELS[v].label },
    role: { label: '身份', vals: ['random', 'lord', 'loyal', 'rebel', 'spy'], def: 'random', fmt: (v) => (v === 'random' ? '随机' : SGS.ROLE_NAME[v]) },
    choice: { label: '候选武将', vals: ['3', '5', '7'], def: '5', fmt: (v) => v + '名' },
    mode: { label: '模式', vals: ['play', 'watch'], def: 'play', fmt: (v) => (v === 'play' ? '亲自上阵' : 'AI 观战') },
  };
  const DIFF_TIP = {
    easy: '随机性大，常犯错，不会推理身份',
    normal: '会根据行为推理身份，偶有失误',
    hard: '精确推理身份与局势，配合默契，善用无懈与酒杀',
    hell: '在困难基础上洞悉所有人的真实身份',
  };
  const cfg = {};
  for (const k in OPTS) cfg[k] = store.get('sgs-' + k, OPTS[k].def);

  const menu = document.createElement('div');
  menu.id = 'menu';
  stage.appendChild(menu);
  function renderMenu() {
    const rows = Object.entries(OPTS)
      .map(
        ([k, o]) => `<div class="m-row"><div class="m-label">${o.label}</div><div class="seg">${o.vals
          .map((v) => `<button class="${cfg[k] === v ? 'on' : ''}" data-opt="${k}" data-val="${v}">${o.fmt(v)}</button>`)
          .join('')}</div></div>`
      )
      .join('');
    menu.innerHTML = `
      <div class="menu-ink"></div>
      <div class="menu-inner">
        <div class="title-wrap">
          <div class="title"><span>三</span><span>国</span><span>杀</span></div>
          <div class="subtitle">身份局 · 标准 / 风火林山 / 军争 · ${Object.keys(SGS.Generals).length} 名武将 · ${SGS.DECK_LIST.length} 张牌</div>
        </div>
        <div class="menu-panel">
          ${rows}
          <div class="m-tip">${DIFF_TIP[cfg.diff]}</div>
          <button class="btn-start" data-m="start">开 始 游 戏</button>
          <div class="menu-links">
            <button data-m="gens">武将图鉴</button><button data-m="cards">卡牌图鉴</button><button data-m="rules">玩法说明</button>
          </div>
        </div>
      </div>
      <div class="m-overlay hidden"></div>`;
  }
  menu.addEventListener('click', (e) => {
    const o = e.target.closest('[data-opt]');
    if (o) {
      cfg[o.dataset.opt] = o.dataset.val;
      store.set('sgs-' + o.dataset.opt, o.dataset.val);
      ui.sound.play('click');
      return renderMenu();
    }
    const m = e.target.closest('[data-m]');
    if (!m) return;
    ui.sound.play('click');
    const a = m.dataset.m;
    if (a === 'start') startGame(Object.assign({}, cfg));
    else if (a === 'gens') showGallery('gens');
    else if (a === 'cards') showGallery('cards');
    else if (a === 'rules') showGallery('rules');
    else if (a === 'close') menu.querySelector('.m-overlay').classList.add('hidden');
  });

  function showGallery(kind) {
    const ov = menu.querySelector('.m-overlay');
    let html = '';
    if (kind === 'gens') {
      for (const k of ['wei', 'shu', 'wu', 'qun']) {
        const list = Object.values(SGS.Generals).filter((g) => g.kingdom === k);
        html += `<h3 class="k-${k}">${SGS.KINGDOM_NAME[k]} · ${list.length}</h3><div class="gal-gens">${list
          .map(
            (g) => `<div class="gal-gen">${ui.portraitHTML(g)}<div class="gal-info"><div class="gal-hp">${g.hp} 体力 · ${g.gender === 'female' ? '女' : '男'}</div>${g.skills
              .map((id) => SGS.Skills[id])
              .map((s) => `<div class="gc-sk"><b>${s.name}${s.lord ? '<em>主公技</em>' : ''}</b>${s.desc}</div>`)
              .join('')}</div></div>`
          )
          .join('')}</div>`;
      }
    } else if (kind === 'cards') {
      const count = {};
      for (const [n, , , nat] of SGS.DECK_LIST) {
        const key = n === '杀' ? (nat === 'fire' ? '火杀' : nat === 'thunder' ? '雷杀' : '杀') : n;
        count[key] = (count[key] || 0) + 1;
      }
      const groups = { basic: '基本牌', trick: '锦囊牌', delay: '延时锦囊', equip: '装备牌' };
      for (const t in groups) {
        const names = Object.keys(count).filter((n) => SGS.CardDefs[n === '火杀' || n === '雷杀' ? '杀' : n].type === t);
        html += `<h3>${groups[t]}</h3><div class="gal-cards">${names
          .map((n) => {
            const nat = n === '火杀' ? 'fire' : n === '雷杀' ? 'thunder' : null;
            const base = nat ? '杀' : n;
            const fake = new SGS.Card('g' + n, base, 'none', 0, nat);
            return `<div class="gal-card">${ui.cardHTML(fake, { cls: 'sm' })}<div><b>${n}</b> × ${count[n]}<p>${SGS.CardDefs[base].desc}</p></div></div>`;
          })
          .join('')}</div>`;
      }
    } else {
      html = `<div class="rules">
        <h3>身份与胜利条件</h3>
        <p><b class="r-lord">主公</b>（身份公开）与 <b class="r-loyal">忠臣</b>：消灭所有反贼和内奸。<br>
        <b class="r-rebel">反贼</b>：杀死主公。<br><b class="r-spy">内奸</b>：先清除其他所有角色，最后单挑杀死主公。</p>
        <p>击杀反贼者摸三张牌；主公误杀忠臣须弃置所有牌。五人及以上时主公体力上限+1。</p>
        <h3>回合流程</h3><p>准备 → 判定 → 摸牌（2张）→ 出牌 → 弃牌（手牌上限=体力值）→ 结束</p>
        <h3>操作</h3>
        <p>· 点击手牌选中，点击发光的角色选择目标，再点「确定」；<b>双击</b>手牌可快速使用（自动选中唯一目标时）。<br>
        · 转化技（如武圣、龙胆、倾国）会自动生效：直接点可转化的牌即可；需两张牌的转化（丈八蛇矛、乱击）请先点技能按钮。<br>
        · 主动技能点击右下技能按钮；右键可取消选择。<br>
        · 将鼠标悬停在牌、角色或技能上查看详细说明。<br>
        · 顶栏「托管」交给 AI 代打，「速度」调节动画节奏，「战报」查看完整记录。</p>
        <h3>AI 难度</h3>
        <p>简单：随机性大；普通：会推理身份；困难：根据每个角色的行为与已知阵亡信息推理身份，评估局势、留牌、酒杀、无懈博弈；地狱：在困难基础上知晓所有身份。</p></div>`;
    }
    ov.innerHTML = `<div class="gal"><div class="gal-head"><span>${{ gens: '武将图鉴', cards: '卡牌图鉴', rules: '玩法说明' }[kind]}</span><button data-m="close" class="btn">关闭</button></div><div class="gal-body">${html}</div></div>`;
    ov.classList.remove('hidden');
  }

  function confirmBox(text, onYes) {
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.innerHTML = `<div class="dlg-box"><div class="dlg-title">${text}</div><div class="dlg-foot"><button class="btn btn-ok">确定</button><button class="btn">取消</button></div></div>`;
    stage.appendChild(box);
    const [y, n] = box.querySelectorAll('button');
    y.onclick = () => {
      box.remove();
      onYes();
    };
    n.onclick = () => box.remove();
  }

  function showMenu() {
    if (game) {
      game.aborted = true;
      gen++;
      ui.abort();
      game = null;
    }
    renderMenu();
    menu.classList.remove('hidden');
    stage.classList.add('in-menu');
  }

  async function startGame(c) {
    lastCfg = c;
    menu.classList.add('hidden');
    stage.classList.remove('in-menu');
    if (game) {
      game.aborted = true;
      ui.abort();
    }
    const g = new SGS.Game({
      playerCount: +c.count,
      difficulty: c.diff,
      humanSeat: 0,
      humanRole: c.role,
      choiceCount: +c.choice,
      spectate: c.mode === 'watch',
      ui: uiProxy(),
      makeHuman: (gm, p) => {
        ui.setMe(p);
        return new SGS.HumanController(ui, gm, p);
      },
    });
    game = g;
    ui.attach(g, () => confirmBox('返回菜单将放弃当前对局，确定吗？', showMenu));
    let r;
    try {
      r = await g.start();
    } catch (e) {
      console.error(e);
      ui.log(`<span class="death">发生错误：${e.message}</span>`);
      return;
    }
    if (g !== game || !r) return;
    ui.showResult(
      r,
      () => startGame(lastCfg),
      () => showMenu()
    );
  }

  document.addEventListener('keydown', (e) => {
    if (!game || !ui.pending) return;
    if (e.key === 'Enter') ui.button('ok');
    else if (e.key === 'Escape') ui.button('cancel');
    else if (e.key === ' ' && ui.pending.req.type === 'play') {
      e.preventDefault();
      ui.button('end');
    }
  });

  renderMenu();
  stage.classList.add('in-menu');
  SGS.app = { ui, startGame, showMenu, get game() { return game; } };
})();
