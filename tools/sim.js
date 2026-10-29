// 无界面自动对局测试：node tools/sim.js [局数] [难度]
const path = require('path');
for (const f of ['util', 'cards', 'engine', 'skills', 'generals', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const SGS = globalThis.SGS;

const N = +process.argv[2] || 200;
const level = process.argv[3] || 'hard';
const wins = {};
let errors = 0,
  draws = 0,
  turns = 0;
const t0 = Date.now();
const genStats = {};

(async () => {
  console.log('牌堆张数：', SGS.buildDeck().length, '武将数：', Object.keys(SGS.Generals).length);
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i;
    const n = 4 + (i % 5);
    const g = new SGS.Game({ playerCount: n, difficulty: level, humanSeat: null, seed });
    try {
      const r = await g.start();
      if (!r || !r.winners.length) draws++;
      else wins[r.winners.join('+')] = (wins[r.winners.join('+')] || 0) + 1;
      turns += g.turnCount;
      for (const p of g.players) {
        const id = p.general.id;
        genStats[id] = genStats[id] || [0, 0];
        genStats[id][0]++;
        if (r && r.winners.includes(p.identity)) genStats[id][1]++;
      }
      // 牌守恒检查
      const all = g.deck.length + g.discardPile.length + g.processing.length + g.players.reduce((s, p) => s + p.hand.length + p.equipList().length + SGS.realCards(p.judges).length, 0);
      if (all !== 160) {
        console.log(`seed ${seed}: 牌数不守恒 ${all}`);
        errors++;
      }
    } catch (e) {
      errors++;
      console.log(`seed ${seed} (${n}人) 出错:`, e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
    }
  }
  console.log(`${N} 局，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，错误 ${errors}，平局 ${draws}，平均回合 ${(turns / N).toFixed(1)}`);
  console.log('胜方统计：', wins);
  const top = Object.entries(genStats)
    .filter((x) => x[1][0] >= 5)
    .map(([id, [n, w]]) => [SGS.Generals[id].name, n, ((w / n) * 100).toFixed(0) + '%'])
    .sort((a, b) => parseInt(b[2]) - parseInt(a[2]));
  console.log('武将胜率：', top.map((x) => x.join(' ')).join(' | '));
})();
