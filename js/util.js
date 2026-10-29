// 通用工具与卡牌模型
(function () {
  const SGS = (globalThis.SGS = globalThis.SGS || {});

  SGS.SUIT_SYMBOL = { spade: '♠', heart: '♥', club: '♣', diamond: '♦', none: '' };
  SGS.SUIT_NAME = { spade: '黑桃', heart: '红桃', club: '梅花', diamond: '方块', none: '无色' };
  SGS.KINGDOM_NAME = { wei: '魏', shu: '蜀', wu: '吴', qun: '群' };
  SGS.ROLE_NAME = { lord: '主公', loyal: '忠臣', rebel: '反贼', spy: '内奸' };
  SGS.numStr = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || (n ? String(n) : ''));
  SGS.isRedSuit = (s) => s === 'heart' || s === 'diamond';

  SGS.makeRng = function (seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  SGS.shuffle = function (arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  SGS.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  SGS.remove = function (arr, item) {
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  };

  class GameOver extends Error {
    constructor(winners, reason) {
      super('GameOver');
      this.winners = winners;
      this.reason = reason;
    }
  }
  class GameAbort extends Error {
    constructor() {
      super('GameAbort');
    }
  }
  SGS.GameOver = GameOver;
  SGS.GameAbort = GameAbort;

  // 实体卡牌
  class Card {
    constructor(id, name, suit, number, nature) {
      this.id = id;
      this.name = name;
      this.suit = suit;
      this.number = number;
      this.nature = nature || null;
      this.zone = null;
      this.owner = null;
    }
    get color() {
      return SGS.isRedSuit(this.suit) ? 'red' : 'black';
    }
    get def() {
      return SGS.CardDefs[this.name];
    }
    get type() {
      return this.def.type;
    }
    get subtype() {
      return this.def.subtype;
    }
    get displayName() {
      return SGS.cardDisplayName(this);
    }
    get virtual() {
      return false;
    }
  }
  SGS.Card = Card;

  // 虚拟牌（转化牌）
  class VCard {
    constructor(name, subcards, opts) {
      opts = opts || {};
      this.name = name;
      this.subcards = subcards || [];
      this.nature = opts.nature || null;
      this.skill = opts.skill || null;
      this.id = 'v' + (VCard.seq++);
      if (opts.suit) this.suit = opts.suit;
      else if (this.subcards.length === 1) this.suit = this.subcards[0].suit;
      else this.suit = 'none';
      if (this.subcards.length === 1) this.number = this.subcards[0].number;
      else this.number = 0;
      const colors = new Set(this.subcards.map((c) => c.color));
      this._color = opts.color || (colors.size === 1 ? [...colors][0] : 'none');
    }
    get color() {
      return this._color;
    }
    get def() {
      return SGS.CardDefs[this.name];
    }
    get type() {
      return this.def.type;
    }
    get subtype() {
      return this.def.subtype;
    }
    get displayName() {
      return SGS.cardDisplayName(this);
    }
    get virtual() {
      return true;
    }
  }
  VCard.seq = 1;
  SGS.VCard = VCard;

  SGS.realCards = function (c) {
    if (!c) return [];
    if (Array.isArray(c)) return c.flatMap(SGS.realCards);
    return c.virtual ? c.subcards.slice() : [c];
  };
  SGS.cardDisplayName = function (c) {
    if (c.name === '杀') {
      if (c.nature === 'fire') return '火杀';
      if (c.nature === 'thunder') return '雷杀';
    }
    return c.name;
  };
  SGS.cardText = function (c) {
    if (!c) return '';
    const n = c.displayName;
    if (c.virtual && c.subcards.length !== 1) return `【${n}】`;
    const s = SGS.SUIT_SYMBOL[c.suit] || '';
    const cls = SGS.isRedSuit(c.suit) ? 'lr' : 'lb';
    return `<span class="${cls}">${s}${SGS.numStr(c.number)}</span>【${n}】`;
  };
})();
