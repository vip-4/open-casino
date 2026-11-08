/* Open Casino — 零依赖游戏逻辑
 * 运行时约束：无 fetch / XHR / WebSocket / eval / innerHTML，全部结果由 Web Crypto 本地生成。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'opencasino.balance';
  var DEFAULT_BALANCE = 200;

  /* 权重之和 = 100；triple 为「三个相同」的总返还倍数（含本金） */
  var SYMBOLS = [
    { glyph: '🍒', name: '樱桃', weight: 30, triple: 2 },
    { glyph: '🍋', name: '柠檬', weight: 25, triple: 3 },
    { glyph: '🔔', name: '铃铛', weight: 20, triple: 4 },
    { glyph: '⭐', name: '星星', weight: 15, triple: 6 },
    { glyph: '💎', name: '钻石', weight: 8,  triple: 12 },
    { glyph: '7️⃣', name: '七',   weight: 2,  triple: 40 }
  ];
  var PAIR_MULTIPLIER = 1.6;
  var HILO_MULTIPLIER = 2;
  var COIN_MULTIPLIER = 1.95;
  var DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  var REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var balance = readBalance();
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };
  var balanceEl = $('balance');
  var reelsEl = $('reels');
  var diceEl = $('dice');
  var coinEl = $('coin-face');
  var playButtons = Array.prototype.slice.call(document.querySelectorAll('.play'));
  var results = {
    slots: $('slots-result'),
    hilo: $('hilo-result'),
    coin: $('coin-result')
  };

  /* ---------- 工具 ---------- */
  function round2(n) { return Math.round(n * 100) / 100; }

  function format(n) {
    if (n % 1 === 0) { return String(n); }
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function readBalance() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) { return DEFAULT_BALANCE; }
      var n = Number(raw);
      return isFinite(n) && n >= 0 && n <= 1000000 ? round2(n) : DEFAULT_BALANCE;
    } catch (e) { return DEFAULT_BALANCE; }
  }

  function saveBalance() {
    try { window.localStorage.setItem(STORAGE_KEY, String(balance)); } catch (e) { /* 隐私模式下静默降级 */ }
  }

  function renderBalance() {
    balanceEl.textContent = format(balance);
    balanceEl.setAttribute('aria-label', '当前虚拟积分余额 ' + format(balance) + ' 积分');
  }

  /* Web Crypto + 拒绝采样：消除取模偏差 */
  function randomInt(max) {
    var range = 0x100000000;
    var limit = Math.floor(range / max) * max;
    var buf = new Uint32Array(1);
    var value;
    do {
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(buf);
        value = buf[0];
      } else {
        value = Math.floor(Math.random() * range); /* 极旧浏览器降级，仅影响随机强度 */
      }
    } while (value >= limit);
    return value % max;
  }

  function checkedValue(name, fallback) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? Number(el.value) : fallback;
  }

  function getBet() { return checkedValue('bet', 10); }

  function announce(game, text) {
    var el = results[game];
    el.textContent = '';
    /* 清空后写入，确保连续相同结果也会触发屏幕阅读器播报 */
    window.setTimeout(function () { el.textContent = text; }, 0);
  }

  function syncControls() {
    var disabled = busy || balance < getBet();
    playButtons.forEach(function (btn) { btn.disabled = disabled; });
  }

  function setBusy(value) { busy = value; syncControls(); }

  /* 统一动画封装：动画期间禁用按钮，reduced-motion 时立即结算 */
  function withSpin(container, tick, finish) {
    setBusy(true);
    if (REDUCE_MOTION) {
      finish();
      setBusy(false);
      return;
    }
    var n = 0;
    container.classList.add('spinning');
    var timer = window.setInterval(function () {
      tick();
      n += 1;
      if (n >= 8) {
        window.clearInterval(timer);
        container.classList.remove('spinning');
        finish();
        setBusy(false);
      }
    }, 55);
  }

  /* 开局：校验余额 -> 扣注 -> 动画 -> 结算 */
  function begin(game, container, tick, finish) {
    if (busy) { return; }
    var bet = getBet();
    if (balance < bet) {
      announce(game, '余额不足（当前 ' + format(balance) + ' 积分，需 ' + bet + ' 积分）。请调低下注额或点击「重置余额」。');
      syncControls();
      return;
    }
    balance = round2(balance - bet);
    saveBalance();
    renderBalance();
    withSpin(container, tick, function () {
      finish(bet);
      saveBalance();
      renderBalance();
      syncControls();
    });
  }

  function settle(multiplier, bet) {
    var payout = round2(bet * multiplier);
    balance = round2(balance + payout);
    return payout;
  }

  /* ---------- 3 轴老虎机 ---------- */
  function pickSymbol() {
    var r = randomInt(100);
    var acc = 0;
    for (var i = 0; i < SYMBOLS.length; i += 1) {
      acc += SYMBOLS[i].weight;
      if (r < acc) { return SYMBOLS[i]; }
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function paintReels(list) {
    var spans = reelsEl.querySelectorAll('.reel');
    for (var i = 0; i < spans.length; i += 1) { spans[i].textContent = list[i].glyph; }
    reelsEl.setAttribute('aria-label', '老虎机转轴：' + list.map(function (s) { return s.name; }).join('、'));
  }

  function playSlots() {
    begin('slots', reelsEl, function () {
      paintReels([pickSymbol(), pickSymbol(), pickSymbol()]);
    }, function (bet) {
      var final = [pickSymbol(), pickSymbol(), pickSymbol()];
      paintReels(final);
      var names = final.map(function (s) { return s.name; });
      var triple = final[0] === final[1] && final[1] === final[2];
      var pair = !triple && (final[0] === final[1] || final[0] === final[2] || final[1] === final[2]);
      var multiplier = triple ? final[0].triple : (pair ? PAIR_MULTIPLIER : 0);
      var payout = settle(multiplier, bet);
      var outcome = triple
        ? '三个' + final[0].name + '，命中 ' + multiplier + '× 赔率'
        : (pair ? '恰好两个相同，返回 ' + PAIR_MULTIPLIER + '×' : '三个互不相同，未中奖');
      announce('slots', '转轴：' + names.join(' · ') + '。' + outcome + '，本局返还 ' + format(payout) + ' 积分（下注 ' + bet + '）。当前余额 ' + format(balance) + ' 积分。');
    });
  }

  /* ---------- 三骰猜大小 ---------- */
  function rollDice() {
    return [randomInt(6) + 1, randomInt(6) + 1, randomInt(6) + 1];
  }

  function paintDice(values) {
    var spans = diceEl.querySelectorAll('.die');
    var sum = values[0] + values[1] + values[2];
    for (var i = 0; i < spans.length; i += 1) { spans[i].textContent = DICE_FACES[values[i] - 1]; }
    diceEl.setAttribute('aria-label', '三颗骰子：' + values.join(' 点、') + ' 点，合计 ' + sum + ' 点');
    return sum;
  }

  function playHiLo() {
    var side = document.querySelector('input[name="hilo"]:checked').value;
    begin('hilo', diceEl, function () { paintDice(rollDice()); }, function (bet) {
      var values = rollDice();
      var sum = paintDice(values);
      var isTriple = values[0] === values[1] && values[1] === values[2];
      var guessedSmall = side === 'small';
      var win = !isTriple && (guessedSmall ? sum <= 10 : sum >= 11);
      var payout = settle(win ? HILO_MULTIPLIER : 0, bet);
      var reason = isTriple ? '豹子通杀' : (win ? '猜中' + (guessedSmall ? '「小」' : '「大」') : '未猜中');
      announce('hilo', '骰子 ' + values.join(' + ') + ' = ' + sum + ' 点，押' + (guessedSmall ? '小 3–10' : '大 11–18') + '。' + reason + '，本局返还 ' + format(payout) + ' 积分（下注 ' + bet + '）。当前余额 ' + format(balance) + ' 积分。');
    });
  }

  /* ---------- 抛硬币 ---------- */
  function paintCoin(text) {
    coinEl.querySelector('span').textContent = text;
    coinEl.setAttribute('aria-label', '硬币：' + text);
  }

  function playCoin() {
    var side = document.querySelector('input[name="coin"]:checked').value;
    begin('coin', coinEl.parentNode, function () { paintCoin(randomInt(2) ? '正' : '反'); }, function (bet) {
      var isHeads = randomInt(2) === 0;
      var face = isHeads ? '正面' : '反面';
      paintCoin(isHeads ? '正' : '反');
      var win = (side === 'heads') === isHeads;
      var payout = settle(win ? COIN_MULTIPLIER : 0, bet);
      announce('coin', '硬币为' + face + '，你押' + (side === 'heads' ? '正面' : '反面') + '，' + (win ? '猜中，返回 ' + COIN_MULTIPLIER + '×' : '未猜中') + '。本局返还 ' + format(payout) + ' 积分（下注 ' + bet + '）。当前余额 ' + format(balance) + ' 积分。');
    });
  }

  /* ---------- 事件绑定 ---------- */
  var handlers = { slots: playSlots, hilo: playHiLo, coin: playCoin };
  playButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fn = handlers[btn.getAttribute('data-game')];
      if (fn) { fn(); }
    });
  });

  Array.prototype.slice.call(document.querySelectorAll('input[name="bet"]')).forEach(function (input) {
    input.addEventListener('change', syncControls);
  });

  $('reset').addEventListener('click', function () {
    if (busy) { return; }
    balance = DEFAULT_BALANCE;
    saveBalance();
    renderBalance();
    syncControls();
    Object.keys(results).forEach(function (game) {
      announce(game, '余额已重置为 ' + DEFAULT_BALANCE + ' 积分。');
    });
  });

  renderBalance();
  syncControls();
}());
