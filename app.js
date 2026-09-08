(function () {
  'use strict';
  var DATA = window.ONOMATO_DATA || [];
  var STORE_KEY = 'onomato_v1';
  var DAY = 86400000;

  /* ---------- utils ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function todayKey(t) { var d = new Date(t || Date.now()); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- state ---------- */
  var state = load();
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (!s || !s.cards) s = { cards: {}, stats: {}, settings: {} };
    s.cards = s.cards || {}; s.stats = s.stats || {}; s.gameSeen = s.gameSeen || {};
    s.cardsB = s.cardsB || {};   // 反向卡（兄弟卡）：每词一张，独立 SM-2 状态
    s.stats.perf = s.stats.perf || [];   // 做题记录：{k, acc, dur, t}
    // 辞书迁移：旧版 scope(all/onomato/kanji) → dict(onomato/kanji)
    if (s.settings && s.settings.scope !== undefined && s.settings.dict === undefined) {
      s.settings.dict = s.settings.scope === 'kanji' ? 'kanji' : 'onomato';
    }
    s.settings = Object.assign({ newPerDay: 20, match: 8, quiz: 10, reverse: false, dark: false, accent: '#6c5ce7', dict: 'onomato' }, s.settings || {});
    // 辞书独立设置迁移：dicts = { onomato: {...}, kanji: {...} }，两本辞书互不影响
    if (!s.settings.dicts) {
      s.settings.dicts = {
        onomato: { newPerDay: s.settings.newPerDay, match: s.settings.match, quiz: s.settings.quiz },
        kanji: { newPerDay: s.settings.newPerDay, match: s.settings.match, quiz: s.settings.quiz }
      };
    }
    // 每日新词配额按辞书分开计数（旧版全局 newToday → 迁移到当前辞书）
    if (!s.stats.newTodayByDict) {
      s.stats.newTodayByDict = {};
      if (s.stats.newToday) {
        s.stats.newTodayByDict[(s.settings && s.settings.dict) || 'onomato'] = s.stats.newToday;
        delete s.stats.newToday;
      }
    }
    // 复习日志按辞书分开（旧版全局 reviews → 迁移到当前辞书）
    if (!s.stats.reviewsByDict) {
      s.stats.reviewsByDict = {};
      if (s.stats.reviews) {
        s.stats.reviewsByDict[(s.settings && s.settings.dict) || 'onomato'] = s.stats.reviews;
        delete s.stats.reviews;
      }
    }
    // 做题记录补充辞书字段（旧数据归当前辞书）
    (s.stats.perf || []).forEach(function (p) { if (!p.d) p.d = (s.settings && s.settings.dict) || 'onomato'; });
    // 兄弟卡迁移：已毕业（正向 st>=1）但未解锁反向卡的词，自动创建反向卡，
    // 保证开启「正反向背词」后立即可见反向内容（老数据/旧版双向数据兼容）
    Object.keys(s.cards || {}).forEach(function (word) {
      var c = s.cards[word];
      if (!c) return;
      var st = c.st === undefined ? inferState(c) : c.st;
      if (st >= 1 && !(s.cardsB && s.cardsB[word])) {
        if (!s.cardsB) s.cardsB = {};
        s.cardsB[word] = { ease: 2.5, interval: 0, reps: 0, due: Date.now(), lapses: 0, last: 0, st: 0, step: 0 };
      }
    });
    return s;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

  function ensureCard(word) {
    if (!state.cards[word]) state.cards[word] = { ease: 2.5, interval: 0, reps: 0, due: Date.now(), lapses: 0, last: 0, st: 0, step: 0 };
    return state.cards[word];
  }
  function ensureCardB(word) {
    if (!state.cardsB) state.cardsB = {};
    if (!state.cardsB[word]) state.cardsB[word] = { ease: 2.5, interval: 0, reps: 0, due: Date.now(), lapses: 0, last: 0, st: 0, step: 0 };
    return state.cardsB[word];
  }
  // 双状态推断：旧数据无 st 字段时，按间隔/次数推断（兼容升级前的卡片）
  function inferState(c) {
    if (c.interval >= 21) return 2;                // 已掌握
    if (c.reps > 0 && c.interval >= 1) return 1;   // 复习中
    return 0;                                      // 学习中
  }
  // 单卡状态（学习/复习/已掌握/新）
  function cardStatus(c) {
    if (!c) return 'new';
    var st = c.st === undefined ? inferState(c) : c.st;
    if (st === 0) return c.due <= Date.now() ? 'due' : 'learning';
    if (st === 2) return 'mastered';
    if (c.due <= Date.now()) return 'due';
    return 'learning';
  }
  // 单词状态 = 正反两卡取「较差」者（反向未解锁时只看正向）
  function statusOf(word) {
    var cA = state.cards[word];
    if (!cA) return 'new';
    var stA = cardStatus(cA);
    var cB = state.cardsB && state.cardsB[word];
    if (!cB) return stA;
    var stB = cardStatus(cB);
    if (stA === 'mastered' && stB === 'mastered') return 'mastered';
    if (stA === 'due' || stB === 'due') return 'due';
    if (stA === 'learning' || stB === 'learning') return 'learning';
    return stA;
  }
  // 当前辞书：onomato（拟声词） / kanji（汉字）。所有学习/复习/游戏/统计均以当前辞书为范围。
  function currentDict() { return state.settings.dict === 'kanji' ? 'kanji' : 'onomato'; }
  // 当前辞书的独立设置（每日新词/配对词数/速答题数两本辞书各自一套）
  function dictSettings() {
    var d = currentDict();
    if (!state.settings.dicts) state.settings.dicts = {};
    if (!state.settings.dicts[d]) state.settings.dicts[d] = { newPerDay: 20, match: 8, quiz: 10 };
    return state.settings.dicts[d];
  }
  function scopeData() {
    var d = currentDict();
    return DATA.filter(function (x) { return x.type === d; });
  }
  function dueCount() {
    return scopeData().filter(function (d) {
      var a = state.cards[d.word], b = state.cardsB && state.cardsB[d.word];
      return (a && a.due <= Date.now()) || (b && b.due <= Date.now());
    }).length;
  }
  function learnedCount() {
    return scopeData().filter(function (d) {
      var a = state.cards[d.word], b = state.cardsB && state.cardsB[d.word];
      return (a && a.reps > 0) || (b && b.reps > 0);
    }).length;
  }
  // 每日新词配额按辞书独立计数：学拟声词不占用汉字的当日额度
  function newTodayRef() {
    if (!state.stats.newTodayByDict) state.stats.newTodayByDict = {};
    var d = currentDict();
    if (!state.stats.newTodayByDict[d]) state.stats.newTodayByDict[d] = { date: '', count: 0 };
    return state.stats.newTodayByDict[d];
  }
  function newRemainingToday() {
    var nt = newTodayRef();
    if (nt.date !== todayKey()) return dictSettings().newPerDay;
    return Math.max(0, dictSettings().newPerDay - nt.count);
  }
  function bumpNewToday() {
    var nt = newTodayRef();
    if (nt.date !== todayKey()) { nt.date = todayKey(); nt.count = 0; }
    nt.count++;
  }
  function addReviewLog(n) {
    var k = todayKey(), d = currentDict();
    state.stats.reviewsByDict = state.stats.reviewsByDict || {};
    if (!state.stats.reviewsByDict[d]) state.stats.reviewsByDict[d] = {};
    state.stats.reviewsByDict[d][k] = (state.stats.reviewsByDict[d][k] || 0) + n;
  }
  // 记录一次做题表现（k: 类型, acc: 正确率%, dur: 秒）。保留最近 300 条。
  function recordPerf(k, acc, dur) {
    state.stats.perf = state.stats.perf || [];
    state.stats.perf.push({ k: k, acc: Math.round(acc || 0), dur: Math.round(dur || 0), t: Date.now(), d: currentDict() });
    if (state.stats.perf.length > 300) state.stats.perf = state.stats.perf.slice(-300);
  }

  /* ---------- SM-2 + 短时阶梯（兄弟卡片：正向 A / 反向 B） ---------- */
  var STEPS = [1, 10];        // 短时复习阶梯（分钟）：第 0 步 1 分钟、第 1 步 10 分钟
  var MAX_LAPSES = 5;         // 连续遗忘熔断阈值 → 明日顽固词

  function adjustEase(c, q) {
    c.ease = c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (c.ease < 1.3) c.ease = 1.3;
  }
  // 通用评级：c = 目标卡片（正向或反向共用同一套双状态阶梯逻辑）
  function gradeCardCore(c, wasNew, q) {
    if (wasNew) bumpNewToday();
    var st = c.st === undefined ? inferState(c) : c.st;
    if (st === 0) {
      // 学习中/重学中：分钟级短时阶梯
      if (q >= 4) {
        c.step = (c.step || 0) + 1;
        if (c.step >= STEPS.length) {
          c.st = 1; c.step = 0;
          c.reps = (c.reps || 0) + 1; c.interval = 1;
          c.due = Date.now() + DAY;
        } else {
          c.due = Date.now() + STEPS[c.step] * 60000;
        }
        adjustEase(c, q);
      } else {
        c.step = 0;
        c.lapses = (c.lapses || 0) + 1;
        c.due = Date.now() + STEPS[0] * 60000;
        if (c.lapses >= MAX_LAPSES) c.due = Date.now() + DAY;   // 熔断：明日顽固词
      }
    } else if (st === 1) {
      // 复习中：天级 SM-2
      if (q >= 4) {
        c.reps = (c.reps || 0) + 1;
        if (c.reps === 1) c.interval = 1;
        else if (c.reps === 2) c.interval = 6;
        else c.interval = Math.round(c.interval * c.ease);
        if (c.interval >= 21) c.st = 2;
        c.due = Date.now() + c.interval * DAY;
        adjustEase(c, q);
      } else {
        c.st = 0; c.step = 0;
        c.reps = 0; c.interval = 0;
        c.lapses = (c.lapses || 0) + 1;
        c.ease = Math.max(1.3, c.ease - 0.2);
        c.due = Date.now() + STEPS[0] * 60000;
        if (c.lapses >= MAX_LAPSES) c.due = Date.now() + DAY;
      }
    } else {
      // 已掌握（st=2）
      if (q >= 4) { c.reps += 1; c.interval = Math.round(c.interval * c.ease); c.due = Date.now() + c.interval * DAY; adjustEase(c, q); }
      else { c.st = 0; c.step = 0; c.lapses += 1; c.ease = Math.max(1.3, c.ease - 0.2); c.due = Date.now() + STEPS[0] * 60000; if (c.lapses >= MAX_LAPSES) c.due = Date.now() + DAY; }
    }
    c.last = Date.now();
    return c;
  }
  // 正向卡（Card A）
  function gradeCardA(word, q) {
    var wasNew = !state.cards[word];
    var prev = state.cards[word];
    var before = prev ? (prev.st === undefined ? inferState(prev) : prev.st) : 0;
    var c = gradeCardCore(ensureCard(word), wasNew, q);
    var after = c.st === undefined ? inferState(c) : c.st;
    // 正向刚毕业（st 0→1）→ 解锁反向卡（交替解锁机制）
    if (before === 0 && after === 1) {
      if (!state.cardsB) state.cardsB = {};
      if (!state.cardsB[word]) state.cardsB[word] = { ease: 2.5, interval: 0, reps: 0, due: Date.now(), lapses: 0, last: 0, st: 0, step: 0 };
    }
    state.cards[word] = c;
    save();
    return c;
  }
  // 反向卡（Card B）：状态独立；失败时联动削弱正向卡（交叉惩罚）
  function gradeCardB(word, q) {
    var wasNew = !state.cardsB || !state.cardsB[word];
    var c = gradeCardCore(ensureCardB(word), wasNew, q);
    if (q < 4) {
      var a = state.cards[word];
      if (a) {
        a.interval = Math.max(1, Math.round((a.interval || 1) / 2));   // 正向间隔折半
        a.ease = Math.max(1.3, a.ease - 0.1);                          // 正向难度上升
        a.due = Date.now() + a.interval * DAY;
        state.cards[word] = a;
      }
    }
    state.cardsB[word] = c;
    save();
    return c;
  }

  /* ---------- view switching (separate "pages") ---------- */
  function showView(id, activeTab) {
    $all('.view').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    $all('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === activeTab); });
    window.scrollTo(0, 0);
  }

  /* ---------- game word weighting & small reward ---------- */
  // 熟练度越高，被小游戏选中的概率越低（反相关）
  function gameWeight(word) {
    var c = state.cards[word];
    var revM = 0;
    if (c) {
      revM = (c.interval + (c.ease - 1.3) * 4) / 21;
      if (c.lapses) revM -= 0.15 * c.lapses;
      if (revM < 0) revM = 0;
      if (revM > 1) revM = 1;
    }
    var gs = (state.gameSeen && state.gameSeen[word]) || 0;
    var gameM = Math.min(1, gs / 8);
    var combined = revM * 0.6 + gameM * 0.6;
    if (combined > 1) combined = 1;
    return Math.max(0.2, 1 - 0.8 * combined);
  }
  function weightedSample(n) {
    var items = scopeData().map(function (d) { return { d: d, w: gameWeight(d.word) }; });
    var chosen = [];
    for (var i = 0; i < n && items.length; i++) {
      var total = 0, k;
      for (k = 0; k < items.length; k++) total += items[k].w;
      var r = Math.random() * total, acc = 0, idx = 0;
      for (idx = 0; idx < items.length; idx++) { acc += items[idx].w; if (r <= acc) break; }
      chosen.push(items[idx].d);
      items.splice(idx, 1);
    }
    return chosen;
  }
  // 通过游戏后增加小额熟练度。mult 为熟练度倍率：
  //   配对/翻牌 = 1（约背词模式 1/4），四选一/拼写 = 2（翻倍）
  function gameReward(words, mult) {
    mult = mult || 1;
    state.gameSeen = state.gameSeen || {};
    words.forEach(function (d) {
      var w = d.word;
      state.gameSeen[w] = (state.gameSeen[w] || 0) + mult;
      var c = state.cards[w];
      if (c && c.reps > 0) {
        c.ease = Math.max(1.3, c.ease + 0.025 * mult);
        if (c.reps >= 2) {
          var fullStep = Math.round(c.interval * c.ease);
          c.interval = Math.max(1, Math.round(c.interval + (fullStep - c.interval) / 4 * mult));
          c.due = Date.now() + c.interval * DAY;
        }
        c.last = Date.now();
        state.cards[w] = c;
      }
    });
    save();
  }

  /* ---------- theme accent ---------- */
  function darken(hex, f) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    r = Math.round(r * (1 - f)); g = Math.round(g * (1 - f)); b = Math.round(b * (1 - f));
    function hx(x) { return ('0' + x.toString(16)).slice(-2); }
    return '#' + hx(r) + hx(g) + hx(b);
  }
  function applyAccent() {
    var a = state.settings.accent;
    if (!a) return;
    var root = document.documentElement;
    root.style.setProperty('--primary', a);
    root.style.setProperty('--primary-d', darken(a, 0.12));
    root.style.setProperty('--primary-soft', 'color-mix(in srgb, ' + a + ' 18%, var(--bg))');
  }

  /* ---------- collocation html (aux memory) ---------- */
  function collocHtml(d) {
    if (d.type === 'kanji') {
      // 表格形式：表头（音訓/読み/例）+ 每个读音一行，行内绑定该读音的例词
      var rows = d.rrows && d.rrows.length ? d.rrows : (d.readings || []).map(function (k) { return { k: k, t: 'on', ex: [] }; });
      var h = '<div class="ktable"><div class="khead"><span>音訓</span><span>読み</span><span>例</span></div>';
      rows.forEach(function (r) {
        var kind = r.t === 'on' ? '音读' : '訓読';
        var cls = r.t === 'on' ? 'k-on' : 'k-kun';
        var ex = (r.ex && r.ex.length) ? esc(r.ex.slice(0, 6).join('・')) : '<span class="col-none">—</span>';
        h += '<div class="krow"><span class="kkind ' + cls + '">' + kind + '</span><span class="kkana">' + esc(r.k) + '</span><span class="kex">' + ex + '</span></div>';
      });
      h += '</div>';
      return h;
    }
    var rows = [];
    rows.push(['核心搭配', d.topColloc ? esc(d.topColloc) : '<span class="col-none">—</span>']);
    rows.push(['其他搭配', (d.grammar && d.grammar.length) ? esc(d.grammar.join(' / ')) : '<span class="col-none">—</span>']);
    rows.push(['其他共起动词', d.otherVerbs ? esc(d.otherVerbs) : '<span class="col-none">—</span>']);
    return rows.map(function (r) { return '<div class="col-row"><span class="col-k">' + r[0] + '</span><span class="col-v">' + r[1] + '</span></div>'; }).join('');
  }

  function badge(status) {
    var map = { new: ['new', '未学'], learning: ['learning', '学习中'], due: ['due', '待复习'], mastered: ['mastered', '已掌握'] };
    var m = map[status] || map.new;
    return '<span class="badge ' + m[0] + '">' + m[1] + '</span>';
  }

  /* ---------- home / review ---------- */
  function refreshHome() {
    $('#dueCount').textContent = dueCount();
    $('#newCount').textContent = newRemainingToday();
    $('#learnedCount').textContent = learnedCount();
    $('#headerStat').textContent = '待复习 ' + dueCount();
  }

  var session = [], sessionTotal = 0, sessionReviewed = 0, sessionCorrect = 0;

  // 防干扰：同一单词的正反向卡不允许相邻出现（Sibling Separation）
  function avoidSibling(arr) {
    for (var attempt = 0; attempt < 60; attempt++) {
      var bad = false;
      for (var i = 0; i < arr.length - 1; i++) {
        if ((arr[i].d || arr[i]).word === (arr[i + 1].d || arr[i + 1]).word) { bad = true; break; }
      }
      if (!bad) return arr;
      arr = shuffle(arr);
    }
    return arr;
  }
  function buildSession() {
    var now = Date.now();
    var sd = scopeData();
    var due = sd.filter(function (d) { var c = state.cards[d.word]; return c && c.due <= now; });
    var nw = shuffle(sd.filter(function (d) { return !state.cards[d.word]; })).slice(0, newRemainingToday());
    var items = [];
    due.forEach(function (d) { items.push({ d: d, dir: 'fwd' }); });
    nw.forEach(function (d) { items.push({ d: d, dir: 'fwd' }); });
    // 双向背词：已解锁的反向卡（正向已毕业）到期时也进入队列
    if (state.settings.reverse) {
      sd.forEach(function (d) {
        var b = state.cardsB && state.cardsB[d.word];
        if (b && b.due <= now) items.push({ d: d, dir: 'rev' });
      });
      session = avoidSibling(shuffle(items));
      // 按「词」计数
      var seen = {}; sessionTotal = 0;
      session.forEach(function (it) { var w = (it.d || it).word; if (!seen[w]) { seen[w] = 1; sessionTotal++; } });
    } else {
      session = items;
      sessionTotal = session.length;
    }
    sessionReviewed = 0; sessionCorrect = 0;
  }

  var reviewStart = 0;
  function startReview() {
    buildSession();
    $('#reviewDone').classList.add('hidden');
    showView('#view-review', 'learn');
    if (session.length === 0) {
      $('#reviewArea').classList.remove('hidden');
      $('#reviewArea').innerHTML = '<div class="hero-card" style="text-align:center">🎉 今天没有待复习的词啦！<br><span class="hint">去「词库」浏览或玩个小游戏巩固一下吧。</span></div>';
      return;
    }
    reviewStart = Date.now();
    $('#reviewArea').classList.remove('hidden');
    showNextCard();
  }

  function showNextCard() {
    var item = session[0];
    var d = item.d || item;
    var bidir = !!item.dir;          // 双向背词：fwd / rev
    var front = $('.fc-front'), back = $('#fcBack');
    front.classList.remove('hidden'); back.classList.add('hidden');
    // 正面：正向显示词，反向显示释义
    if (!bidir || item.dir === 'fwd') {
      $('#fcTag').textContent = d.type === 'kanji' ? '汉字' : '单词';
      $('#fcWord').textContent = d.word;
      $('#fcRomaji').textContent = d.romaji || '';
    } else {
      $('#fcTag').textContent = '释义';
      $('#fcWord').textContent = d.translation;
      $('#fcRomaji').textContent = '';
    }
    // 背面：原词 + 释义对照展示
    var transText = d.translation;
    if (d.type === 'kanji') transText = '读音 ' + (d.readings && d.readings.length ? d.readings.join('、') : d.translation);
    var bw = $('#fcBackWord'); if (bw) bw.textContent = d.word;
    $('#fcTranslation').textContent = transText;
    $('#fcColloc').innerHTML = collocHtml(d);
    updateReviewProgress();
  }

  function updateReviewProgress() {
    var remain = session.length;
    // 双向模式：按「词」计数（每词两张卡）
    if (session.length && session[0].dir) {
      var seen = {}; remain = 0;
      session.forEach(function (it) { var w = (it.d || it).word; if (!seen[w]) { seen[w] = 1; remain++; } });
    }
    var done = sessionTotal - remain;
    var pct = sessionTotal ? Math.round(done / sessionTotal * 100) : 0;
    $('#reviewBar').style.width = pct + '%';
    $('#reviewRemain').textContent = '剩余 ' + remain;
    var r2 = $('#reviewRemain2'); if (r2) r2.textContent = '剩余 ' + remain;
  }

  function gradeCurrent(q) {
    var item = session.shift();
    var d = item.d || item;
    var cardObj;
    if (item.dir === 'rev') {
      // 反向卡（Card B）：独立状态，失败联动削弱正向
      cardObj = gradeCardB(d.word, q);
      sessionReviewed++;
      if (q >= 4) sessionCorrect++;
      else if (cardObj.lapses < MAX_LAPSES) session.push({ d: d, dir: 'rev' });
    } else {
      // 正向卡（Card A）
      cardObj = gradeCardA(d.word, q);
      sessionReviewed++;
      if (q >= 4) sessionCorrect++;
      else if (cardObj.lapses < MAX_LAPSES) session.push({ d: d, dir: 'fwd' });
    }
    updateReviewProgress();
    if (session.length === 0) finishSession();
    else showNextCard();
  }

  function finishSession() {
    $('#reviewArea').classList.add('hidden');
    $('#reviewDone').classList.remove('hidden');
    var acc = sessionReviewed ? Math.round(sessionCorrect / sessionReviewed * 100) : 0;
    $('#doneSub').innerHTML = '共 ' + sessionReviewed + ' 词 · 正确率 ' + acc + '%';
    if (sessionReviewed > 0) recordPerf('review', acc, (Date.now() - reviewStart) / 1000);
    addReviewLog(sessionReviewed); save();
    refreshHome();
  }

  /* ---------- games ---------- */
  function gameResult(title, lines, restartLabel, restartFn) {
    var html = '<div class="result-card"><div class="result-emoji">🎉</div><div class="result-score">' + title + '</div>';
    lines.forEach(function (l) { html += '<div class="result-line">' + l + '</div>'; });
    html += '<button class="btn btn-primary btn-block" id="gRestart">' + (restartLabel || '再来一局') + '</button>';
    html += '<button class="btn btn-ghost btn-block" id="gHome" style="margin-top:8px">返回游戏列表</button></div>';
    var area = $('#gameArea'); area.classList.remove('hidden'); area.innerHTML = html;
    $('#gRestart').onclick = restartFn;
    $('#gHome').onclick = backToGames;
    confetti();
  }
  function backToGames() {
    $('#gameArea').innerHTML = '';
    showView('#view-games', 'games');
  }
  function openGameplay() { showView('#view-gameplay', 'games'); }

  function gameHead(title, stat) {
    return '<div class="game-head"><span class="gback" id="gBack">‹ 返回</span><span style="font-weight:800">' + title + '</span><span class="gstat" id="gStat">' + (stat || '') + '</span></div>';
  }

  /* Match / Memory */
  function tileGame(faceDown) {
    var n = dictSettings().match;
    var pool = weightedSample(n);
    var tiles = [];
    pool.forEach(function (d, i) {
      tiles.push({ id: i, side: 'w', text: d.word, word: d.word });
      if (d.type === 'kanji' && d.readings && d.readings.length) {
        // 每局只显示该字的 1 个读音牌（随机选取，多读音跨局轮换出现）
        var pick = d.readings[Math.floor(Math.random() * d.readings.length)];
        tiles.push({ id: i, side: 't', text: pick, word: d.word });
      } else {
        tiles.push({ id: i, side: 't', text: d.translation, word: d.word });
      }
    });
    // 防止读音相同的方块被误匹配：若多个方块显示文字相同（多为一音多词），
    // 在文字后追加所属词条（汉字）予以消歧，保证每块文字全局唯一。
    var byText = {};
    tiles.forEach(function (t) { (byText[t.text] = byText[t.text] || []).push(t); });
    Object.keys(byText).forEach(function (txt) {
      if (byText[txt].length > 1) byText[txt].forEach(function (t) { t.text = t.text + '（' + t.word + '）'; });
    });
    tiles = shuffle(tiles);
    var sel = [], matched = 0, moves = 0, start = Date.now();
    var area = $('#gameArea'); area.classList.remove('hidden');
    area.innerHTML = gameHead(faceDown ? '记忆翻牌' : '配对消消乐', '配对 0/' + n);
    var grid = document.createElement('div'); grid.className = 'tiles'; area.appendChild(grid);

    tiles.forEach(function (t, idx) {
      var el = document.createElement('div');
      el.className = 'tile';
      el.textContent = faceDown ? '?' : t.text;
      el.dataset.idx = idx;
      el.onclick = function () { onPick(idx, el); };
      grid.appendChild(el);
      t.el = el;
    });

    function onPick(idx, el) {
      var t = tiles[idx];
      if (el.classList.contains('matched')) return;
      if (faceDown && !el.classList.contains('flipped')) { el.classList.add('flipped'); el.textContent = t.text; }
      if (sel.length === 2) return;
      // 点击已选中的方块 → 取消选中
      if (sel.indexOf(idx) !== -1) {
        el.classList.remove('selected');
        if (faceDown) { el.classList.remove('flipped'); el.textContent = '?'; }
        sel = [];
        return;
      }
      el.classList.add('selected');
      sel.push(idx);
      if (sel.length === 2) {
        moves++;
        var a = tiles[sel[0]], b = tiles[sel[1]];
        if (a.id === b.id && a.side !== b.side) {
          setTimeout(function () {
            // 该词条的所有牌（汉字 + 全部读音牌）一起消除
            tiles.forEach(function (t2) { if (t2.id === a.id) { t2.el.classList.add('matched'); t2.el.classList.remove('selected', 'flipped'); } });
            sel = []; matched++;
            $('#gStat').textContent = '配对 ' + matched + '/' + n;
            if (matched === n) {
              var sec = Math.round((Date.now() - start) / 1000);
              recordPerf(faceDown ? 'memory' : 'match', n / Math.max(moves, 1) * 100, sec);
              gameReward(pool, 1);
              var vocabHtml = '<div class="vocab-title">本次用到的词汇</div><div class="vocab-list">' +
                pool.map(function (d) {
                  var sub = d.type === 'kanji' ? esc((d.readings || []).join('、')) : esc(d.translation);
                  var rom = (d.type === 'kanji') ? '' : esc(d.romaji || '');
                  return '<div class="vcard"><div class="v-word">' + esc(d.word) + (rom ? '<span class="v-rom">' + rom + '</span>' : '') + '</div><div class="v-trans">' + sub + '</div></div>';
                }).join('') + '</div>';
              gameResult('🏆 通关!', ['用时 ' + sec + ' 秒 · ' + moves + ' 步', vocabHtml], '再来一局', function () { tileGame(faceDown); });
            }
          }, 280);
        } else {
          setTimeout(function () {
            sel.forEach(function (k) { tiles[k].el.classList.remove('selected', 'flipped'); if (faceDown) tiles[k].el.textContent = '?'; });
            sel = [];
          }, 620);
        }
      }
    }
    $('#gBack').onclick = backToGames;
  }

  /* Quiz */
  function startQuiz() {
    var n = dictSettings().quiz, rev = state.settings.reverse;
    var qpool = weightedSample(n);
    var items = [];
    var pool = scopeData();
    for (var i = 0; i < n; i++) {
      var d = qpool[i];
      // 正确项集合：汉字 = 该字全部读音（音读/训读）；拟声词 = 释义。反向题 = 该词
      var correctSet = {}, correctList;
      if (!rev && d.type === 'kanji') {
        (d.readings || []).forEach(function (r) { correctSet[r] = 1; });
        correctList = d.readings.slice();
        if (!correctList.length) { correctSet[d.translation] = 1; correctList = [d.translation]; }
      } else {
        correctSet[rev ? d.word : d.translation] = 1;
        correctList = [rev ? d.word : d.translation];
      }
      var opts = [correctList[0]];
      // 汉字正向题：额外放 1 个其他读音作为正确项（读音少时跳过）
      if (!rev && d.type === 'kanji' && correctList.length > 1) {
        var otherR = shuffle(correctList.slice(1))[0];
        opts.push(otherR);
      }
      var others = shuffle(pool.filter(function (o) { return o.word !== d.word; }));
      for (var j = 0; j < others.length && opts.length < 4; j++) {
        var o = others[j];
        var v = rev ? o.word : o.translation;
        if (correctSet[v]) continue;                 // 排除该字的其他读音
        if (rev && o.translation === d.translation) continue;
        if (opts.indexOf(v) !== -1) continue;
        opts.push(v);
      }
      items.push({ q: d, options: shuffle(opts), correctSet: correctSet, correctList: correctList });
    }
    var cur = 0, score = 0, streak = 0, maxStreak = 0, gStart = Date.now();
    var area = $('#gameArea'); area.classList.remove('hidden');

    function render() {
      var it = items[cur];
      area.innerHTML = gameHead('四选一速答', '第 ' + (cur + 1) + '/' + n);
      // 内容区分栏：左题面 / 右选项（横屏生效）
      var pane = document.createElement('div'); pane.className = 'quiz-pane'; area.appendChild(pane);
      var left = document.createElement('div'); left.className = 'q-left'; pane.appendChild(left);
      var right = document.createElement('div'); right.className = 'q-right'; pane.appendChild(right);
      var w = document.createElement('div'); w.className = 'quiz-word'; w.textContent = rev ? it.q.translation : it.q.word;
      left.appendChild(w);
      if (!rev) { var r = document.createElement('div'); r.className = 'quiz-romaji'; r.textContent = it.q.type === 'kanji' ? '' : (it.q.romaji || ''); left.appendChild(r); }
      var opts = document.createElement('div'); opts.className = 'quiz-opts'; right.appendChild(opts);
      var fb = document.createElement('div'); fb.className = 'quiz-feedback'; right.appendChild(fb);
      it.options.forEach(function (opt) {
        var b = document.createElement('div'); b.className = 'quiz-opt'; b.textContent = opt;
        b.onclick = function () {
          if (b.classList.contains('correct') || b.classList.contains('wrong')) return;
          if (it.correctSet[opt]) { b.classList.add('correct'); score++; streak++; if (streak > maxStreak) maxStreak = streak; fb.textContent = '✓ 正确！连击 ' + streak; }
          else { b.classList.add('wrong'); streak = 0; fb.textContent = '✗ 正确答案：' + it.correctList.join('・'); }
          $all('.quiz-opt', area).forEach(function (o) { if (it.correctSet[o.textContent]) o.classList.add('correct'); o.onclick = null; });
          var nb = document.createElement('button'); nb.className = 'btn btn-primary btn-block'; nb.textContent = (cur + 1 < n) ? '下一题' : '查看结果';
          nb.style.marginTop = '14px'; nb.onclick = function () { cur++; if (cur < n) render(); else done(); };
          right.appendChild(nb);
        };
        opts.appendChild(b);
      });
    }
    function done() {
      recordPerf('quiz', score / n * 100, (Date.now() - gStart) / 1000);
      gameReward(items.map(function (it) { return it.q; }), 2);
      // 结束后展示本轮用到的词汇
      var vocabHtml = '<div class="vocab-title">本轮用到的词汇</div><div class="vocab-list">' +
        items.map(function (it) {
          var d = it.q;
          var sub = d.type === 'kanji' ? esc((d.readings || []).join('、')) : esc(d.translation);
          var rom = d.type === 'kanji' ? '' : esc(d.romaji || '');
          return '<div class="vcard"><div class="v-word">' + esc(d.word) + (rom ? '<span class="v-rom">' + rom + '</span>' : '') + '</div><div class="v-trans">' + sub + '</div></div>';
        }).join('') + '</div>';
      gameResult(score + '/' + n, ['正确率 ' + Math.round(score / n * 100) + '% · 最高连击 ' + maxStreak, vocabHtml], '再来一局', startQuiz);
    }
    render();
    $('#gBack').onclick = backToGames;
  }

  /* Type */
  function startType() {
    var n = dictSettings().quiz;
    var items = weightedSample(n);
    var cur = 0, score = 0, streak = 0, maxStreak = 0, gStart = Date.now();
    var area = $('#gameArea'); area.classList.remove('hidden');

    function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ''); }
    function render() {
      var it = items[cur];
      area.innerHTML = gameHead('拼写挑战', '第 ' + (cur + 1) + '/' + n);
      // 内容区分栏：左题面 / 右输入（横屏生效）
      var pane = document.createElement('div'); pane.className = 'type-pane'; area.appendChild(pane);
      var left = document.createElement('div'); left.className = 't-left'; pane.appendChild(left);
      var right = document.createElement('div'); right.className = 't-right'; pane.appendChild(right);
      var t = document.createElement('div'); t.className = 'type-trans';
      var hint = document.createElement('div'); hint.className = 'type-hint';
      var ansList;
      if (it.type === 'kanji') {
        t.textContent = it.word;   // 题面 = 汉字，拼读音
        ansList = (it.rrows || []).map(function (r) { return norm(r.r || ''); }).filter(Boolean);
        if (!ansList.length) ansList = [norm(it.romaji || '')];
        hint.textContent = '请拼写出该汉字的任一读音罗马音（音读 / 训读均可）';
      } else {
        // 拟声词：词面即读音，不能直接显示词；只给释义，凭释义拼词
        t.textContent = it.translation || it.word;
        ansList = [norm(it.romaji || '')];
        hint.textContent = '请拼写出对应的拟声词罗马音';
      }
      left.appendChild(t); left.appendChild(hint);
      var inp = document.createElement('input'); inp.className = 'type-input'; inp.placeholder = 'romaji…'; inp.autocapitalize = 'off'; inp.autocomplete = 'off'; inp.spellcheck = false;
      var fb = document.createElement('div'); fb.className = 'type-feedback';
      var btn = document.createElement('button'); btn.className = 'btn btn-primary btn-block'; btn.textContent = '确认'; btn.style.marginTop = '12px';
      right.appendChild(inp); right.appendChild(fb); right.appendChild(btn);
      setTimeout(function () { inp.focus(); }, 50);
      function check() {
        var input = norm(inp.value);
        var ok = ansList.indexOf(input) !== -1;
        if (ok) {
          fb.className = 'type-feedback ok';
          if (it.type === 'kanji' && it.rrows && it.rrows.length) {
            // 答对后展示该汉字全部读音（音读/训读），供学习
            var rd = it.rrows.map(function (r) {
              return '<span class="tf-kind ' + (r.t === 'on' ? 'k-on' : 'k-kun') + '">' + (r.t === 'on' ? '音读' : '訓読') + '</span><span class="tf-k">' + esc(r.k) + '</span>';
            }).join('');
            fb.innerHTML = '✓ 正确！<span class="tf-ans">' + esc(input) + '</span><span class="tf-readings">' + rd + '</span>';
          } else {
            fb.textContent = '✓ 正确！' + input;
          }
          score++; streak++; if (streak > maxStreak) maxStreak = streak;
        }
        else { fb.className = 'type-feedback no'; fb.textContent = '✗ 正确答案：' + ansList.join(' / '); streak = 0; }
        btn.textContent = (cur + 1 < n) ? '下一题' : '查看结果';
        btn.onclick = function () { cur++; if (cur < n) render(); else done(); };
        inp.disabled = true;
      }
      btn.onclick = check;
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
    }
    function done() {
      recordPerf('type', score / n * 100, (Date.now() - gStart) / 1000);
      gameReward(items, 2);
      gameResult(score + '/' + n, ['正确率 ' + Math.round(score / n * 100) + '% · 最高连击 ' + maxStreak], '再来一局', startType);
    }
    render();
    $('#gBack').onclick = backToGames;
  }

  /* ---------- dictionary ---------- */
  var dictFilter = 'all', dictQuery = '';
  function renderDict() {
    var list = $('#dictList'); list.innerHTML = '';
    var q = dictQuery.toLowerCase();
    var items = scopeData().filter(function (d) {
      var st = statusOf(d.word);
      if (dictFilter !== 'all' && st !== dictFilter) return false;
      if (q && (d.word + ' ' + (d.romaji || '') + ' ' + d.translation).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!items.length) { list.innerHTML = '<div class="hint" style="text-align:center;margin-top:30px">没有匹配的词。</div>'; return; }
    var capped = false;
    if (items.length > 500) { items = items.slice(0, 500); capped = true; }
    items.forEach(function (d) {
      var el = document.createElement('div'); el.className = 'dict-item';
      var typeTag = '<span class="di-type ' + (d.type === 'kanji' ? 't-kanji' : 't-ono') + '">' + (d.type === 'kanji' ? '漢' : '擬') + '</span>';
      var romHtml, transHtml;
      if (d.type === 'kanji') {
        // 汉字列表只需大字 + 全部读音（读音少，无需额外概览行）
        romHtml = esc((d.readings && d.readings.length) ? d.readings.join('、') : '');
        transHtml = '';
      } else {
        romHtml = esc(d.romaji || '');
        transHtml = esc(d.translation);
      }
      var mainHtml = '<div class="di-main"><div class="di-rom">' + romHtml + '</div>' + (transHtml ? '<div class="di-trans">' + transHtml + '</div>' : '') + '</div>';
      el.innerHTML = '<div class="di-left"><div class="di-word">' + esc(d.word) + '</div></div>' +
        mainHtml + typeTag + badge(statusOf(d.word));
      el.onclick = function () { openDetail(d); };
      list.appendChild(el);
    });
    if (capped) {
      var note = document.createElement('div'); note.className = 'hint'; note.style.textAlign = 'center'; note.style.marginTop = '14px';
      note.textContent = '仅显示前 500 条，请用搜索或筛选缩小范围。';
      list.appendChild(note);
    }
  }
  function openDetail(d) {
    var typeLabel = d.type === 'kanji' ? '汉字' : '拟声词';
    var headRom = d.type === 'kanji' ? (d.readings && d.readings.length ? d.readings.join('、') : '') : (d.romaji || '');
    // 词义：拟声词显示中文释义
    var meaningRow = (d.type === 'onomato' && d.translation)
      ? '<div class="m-row"><span class="m-k">释义</span><span>' + esc(d.translation) + '</span></div>'
      : '';
    var html = '<h3>词条详情 · ' + typeLabel + '</h3><div class="m-word">' + esc(d.word) + (d.variant ? ' <span class="m-variant">（异体：' + esc(d.variant) + '）</span>' : '') + '</div><div class="m-rom">' + esc(headRom) + '</div>' +
      meaningRow +
      collocHtml(d) +
      '<button class="btn btn-primary btn-block m-close" id="mClose">关闭</button>';
    openModal(html);
    $('#mClose').onclick = closeModal;
  }

  /* ---------- stats ---------- */
  function renderStats() {
    var total = scopeData().length;
    var learned = learnedCount();
    var due = dueCount();
    var revMap = (state.stats.reviewsByDict && state.stats.reviewsByDict[currentDict()]) || {};
    var today = revMap[todayKey()] || 0;
    var mastered = scopeData().filter(function (d) { return statusOf(d.word) === 'mastered'; }).length;
    var learning = scopeData().filter(function (d) { return statusOf(d.word) === 'learning'; }).length;
    var grid = $('#statGrid');
    grid.innerHTML = [
      ['总词数', total], ['已学习', learned], ['待复习(今日)', due], ['今日复习', today], ['已掌握', mastered], ['学习中', learning]
    ].map(function (b) { return '<div class="stat-box"><b>' + b[1] + '</b><span>' + b[0] + '</span></div>'; }).join('');

    var dist = [['new', '未学', '#9aa0b4'], ['learning', '学习中', '#f0a93b'], ['due', '待复习', '#e23b3b'], ['mastered', '已掌握', '#16a34a']];
    var mb = $('#masteryBars'); mb.innerHTML = '';
    dist.forEach(function (d) {
      var cnt = scopeData().filter(function (x) { return statusOf(x.word) === d[0]; }).length;
      var pct = total ? Math.round(cnt / total * 100) : 0;
      mb.innerHTML += '<div class="mrow"><span class="mlabel">' + d[1] + '</span><div class="mbar"><i style="width:' + pct + '%;background:' + d[2] + '"></i></div><span class="mval">' + cnt + '</span></div>';
    });

    var wb = $('#weekBars'); wb.innerHTML = '';
    var max = 1;
    var days = [];
    for (var i = 6; i >= 0; i--) { var dt = new Date(Date.now() - i * DAY); var k = dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate(); var v = revMap[k] || 0; if (v > max) max = v; days.push({ k: k, v: v, d: dt }); }
    days.forEach(function (x) {
      var h = x.v ? Math.max(6, Math.round(x.v / max * 100)) : 4;
      wb.innerHTML += '<div class="wb"><div class="col" style="height:' + h + '%" title="' + x.k + ': ' + x.v + ' 次"></div><div class="d">' + (x.d.getMonth() + 1) + '/' + x.d.getDate() + '</div></div>';
    });

    renderPerf();
  }

  /* ---------- per-game performance charts ---------- */
  var perfFilter = 'all';
  var PERF_KINDS = { all: '全部', review: '背词', quiz: '四选一', type: '拼写', match: '配对', memory: '翻牌' };
  // 迷你折线图（SVG，无外部依赖）
  function lineChart(values, maxVal, color) {
    var w = 300, h = 110, pad = 10;
    if (!values.length) return '';
    if (values.length === 1) {
      var v = values[0];
      var yy = h - pad - (Math.min(v, maxVal) / maxVal) * (h - pad * 2);
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="perf-svg"><circle cx="' + (w / 2) + '" cy="' + yy + '" r="4" fill="' + color + '"/><text x="' + (w / 2) + '" y="' + (yy - 10) + '" text-anchor="middle" font-size="12" fill="' + color + '">' + v + '</text></svg>';
    }
    var n = values.length;
    var grid = '';
    for (var g = 1; g <= 3; g++) {
      var gy = h - pad - (g / 4) * (h - pad * 2);
      grid += '<line class="pgrid" x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy + '"/>';
    }
    var pts = values.map(function (v, i) {
      var x = pad + i * (w - pad * 2) / (n - 1);
      var y = h - pad - (Math.min(v, maxVal) / maxVal) * (h - pad * 2);
      return x + ',' + y;
    });
    var lx = pad + (n - 1) * (w - pad * 2) / (n - 1);
    var ly = h - pad - (Math.min(values[n - 1], maxVal) / maxVal) * (h - pad * 2);
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="perf-svg">' + grid +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lx + '" cy="' + ly + '" r="3.5" fill="' + color + '"/>' +
      '<text x="' + lx + '" y="' + (ly - 9) + '" text-anchor="middle" font-size="12" font-weight="500" fill="' + color + '">' + values[n - 1] + '</text></svg>';
  }
  function renderPerf() {
    var chips = $('#perfChips'), box = $('#perfCharts');
    if (!chips || !box) return;
    chips.innerHTML = '';
    Object.keys(PERF_KINDS).forEach(function (k) {
      var c = document.createElement('button');
      c.className = 'chip' + (k === perfFilter ? ' active' : '');
      c.textContent = PERF_KINDS[k];
      c.onclick = function () { perfFilter = k; renderPerf(); };
      chips.appendChild(c);
    });
    var list = (state.stats.perf || []).filter(function (p) {
      return (p.d || 'onomato') === currentDict() && (perfFilter === 'all' || p.k === perfFilter);
    });
    if (!list.length) {
      box.innerHTML = '<div class="hint" style="margin-top:10px">暂无做题记录。完成一次背词或小游戏后，这里会显示正确率与完成时间趋势。</div>';
      return;
    }
    var recent = list.slice(-20);
    var sum = function (fn) { return recent.reduce(function (s, p) { return s + fn(p); }, 0); };
    var avgAcc = Math.round(sum(function (p) { return p.acc; }) / recent.length);
    var avgDur = Math.round(sum(function (p) { return p.dur; }) / recent.length);
    var durMax = Math.max.apply(null, recent.map(function (p) { return p.dur; }));
    if (durMax < 1) durMax = 1;
    box.innerHTML =
      '<div class="perf-summary">共 ' + list.length + ' 局 · 平均正确率 ' + avgAcc + '% · 平均用时 ' + avgDur + 's</div>' +
      '<div class="perf-chart"><div class="perf-title">正确率（最近 ' + recent.length + ' 局）</div>' + lineChart(recent.map(function (p) { return p.acc; }), 100, '#16a34a') + '</div>' +
      '<div class="perf-chart"><div class="perf-title">完成时间（最近 ' + recent.length + ' 局）</div>' + lineChart(recent.map(function (p) { return p.dur; }), durMax, '#185FA5') + '</div>';
  }

  /* ---------- modal ---------- */
  function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); }

  /* ---------- confetti ---------- */
  function confetti() {
    var box = $('#confetti'); box.innerHTML = '';
    var colors = ['#6c5ce7', '#fd79a8', '#fdcb6e', '#00b894', '#0984e3', '#e17055'];
    for (var i = 0; i < 110; i++) {
      var p = document.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      box.appendChild(p);
    }
    setTimeout(function () { box.innerHTML = ''; }, 3200);
  }

  /* ---------- settings ---------- */
  function applyTheme() { document.body.setAttribute('data-theme', state.settings.dark ? 'dark' : 'light'); }
  // 同步「当前辞书」相关 UI：顶栏副标题、词库页标签、设置切换按钮与关于行
  function updateDictUI() {
    var d = currentDict();
    var sub = $('#topSub');
    if (sub) sub.textContent = d === 'kanji' ? '汉字辞书 · 常用漢字表' : '拟声词辞书 · オノマトペ';
    var lbl = $('#dictScopeLabel');
    if (lbl) lbl.textContent = '当前辞书：' + (d === 'kanji' ? '汉字' : '拟声词') + '（' + scopeData().length + ' 词条）';
    var sw = $('#dictSwitch');
    if (sw) $all('.dict-btn', sw).forEach(function (b) { b.classList.toggle('active', b.dataset.dict === d); });
    var ab = $('#aboutLine');
    if (ab) ab.textContent = d === 'kanji' ? '汉字' : '拟声词';
  }
  // 将设置滑块同步为当前辞书的独立数值（切换辞书时调用）
  function refreshSettingsControls() {
    var ds = dictSettings();
    var n = $('#setNewPerDay'); if (n) { n.value = ds.newPerDay; $('#setNewPerDayVal').textContent = n.value; }
    var m = $('#setMatch'); if (m) { m.value = ds.match; $('#setMatchVal').textContent = m.value; }
    var qz = $('#setQuiz'); if (qz) { qz.value = ds.quiz; $('#setQuizVal').textContent = qz.value; }
  }
  function bindSettings() {
    var ds = $('#dictSwitch');
    $all('.dict-btn', ds).forEach(function (b) {
      b.onclick = function () {
        state.settings.dict = b.dataset.dict; save();
        $all('.dict-btn', ds).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        updateDictUI(); refreshSettingsControls(); refreshHome();
        if ($('#view-dict').classList.contains('active')) renderDict();
        if ($('#view-stats').classList.contains('active')) renderStats();
      };
    });
    var n = $('#setNewPerDay');
    n.oninput = function () { dictSettings().newPerDay = +n.value; $('#setNewPerDayVal').textContent = n.value; save(); refreshHome(); };
    var m = $('#setMatch');
    m.oninput = function () { dictSettings().match = +m.value; $('#setMatchVal').textContent = m.value; save(); };
    var qz = $('#setQuiz');
    qz.oninput = function () { dictSettings().quiz = +qz.value; $('#setQuizVal').textContent = qz.value; save(); };
    refreshSettingsControls();
    var rv = $('#setReverse'); rv.checked = !!state.settings.reverse; rv.onchange = function () { state.settings.reverse = rv.checked; save(); };
    var dk = $('#setDark'); dk.checked = !!state.settings.dark; dk.onchange = function () { state.settings.dark = dk.checked; save(); applyTheme(); };
    var sw = $('#accentSwatches');
    $all('.swatch', sw).forEach(function (b) {
      b.classList.toggle('active', b.dataset.color === state.settings.accent);
      b.onclick = function () {
        state.settings.accent = b.dataset.color; save(); applyAccent();
        $all('.swatch', sw).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
    });
    $('#exportBtn').onclick = function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'onomato-progress.json'; a.click();
    };
    $('#importBtn').onclick = function () { $('#importFile').click(); };
    $('#importFile').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (confirm('导入进度将覆盖当前的学习记录，确定继续？')) {
            state.cards = s.cards || {}; state.stats = s.stats || {}; state.settings = Object.assign(state.settings, s.settings || {});
            save(); bindSettings(); applyTheme(); refreshHome(); renderStats(); alert('导入成功！');
          }
        } catch (err) { alert('导入失败：文件格式不正确'); }
      };
      rd.readAsText(f); e.target.value = '';
    };
    $('#resetBtn').onclick = function () {
      if (confirm('确定清空所有学习进度？此操作不可撤销（设置会保留）。')) {
        state.cards = {}; state.stats = {}; save(); refreshHome(); renderStats(); alert('已清空进度。');
      }
    };
  }

  /* ---------- tabs ---------- */
  function switchView(v) {
    $all('.view').forEach(function (s) { s.classList.remove('active'); });
    $('#view-' + v).classList.add('active');
    $all('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === v); });
    if (v === 'stats') renderStats();
    if (v === 'dict') renderDict();
    if (v === 'learn') refreshHome();
  }

  /* ---------- init ---------- */
  function init() {
    applyTheme(); applyAccent(); bindSettings(); updateDictUI(); refreshHome();
    $all('.tab').forEach(function (t) { t.onclick = function () { switchView(t.dataset.view); }; });
    $('#startReview').onclick = startReview;
    $('#showAnswer').onclick = function () { $('.fc-front').classList.add('hidden'); $('#fcBack').classList.remove('hidden'); };
    $all('.grade').forEach(function (b) { b.onclick = function () { gradeCurrent(+b.dataset.q); }; });
    $('#doneClose').onclick = function () { $('#reviewDone').classList.add('hidden'); $('#reviewArea').classList.add('hidden'); showView('#view-learn', 'learn'); refreshHome(); };
    $('#reviewBack').onclick = function () { $('#reviewDone').classList.add('hidden'); $('#reviewArea').classList.add('hidden'); showView('#view-learn', 'learn'); refreshHome(); };

    $all('.game-card').forEach(function (c) {
      c.onclick = function () {
        var g = c.dataset.game;
        openGameplay();
        if (g === 'match') tileGame(false);
        else if (g === 'memory') tileGame(true);
        else if (g === 'quiz') startQuiz();
        else if (g === 'type') startType();
      };
    });

    $('#dictSearch').oninput = function () { dictQuery = this.value; renderDict(); };
    $all('#dictChips .chip').forEach(function (c) { c.onclick = function () { dictFilter = c.dataset.filter; $all('#dictChips .chip').forEach(function (x) { x.classList.remove('active'); }); c.classList.add('active'); renderDict(); }; });

    $('#modal').onclick = function (e) { if (e.target === $('#modal')) closeModal(); };

    // PWA service worker (only on http/https)
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // 调试/测试接口（控制台可用）：window.ONOMATO_APP
  window.ONOMATO_APP = {
    gameReward: gameReward, weightedSample: weightedSample, scopeData: scopeData, currentDict: currentDict,
    dictSettings: dictSettings, newRemainingToday: newRemainingToday,
    getState: function () { return state; },
    setState: function (patch) {
      // newPerDay/match/quiz 按当前辞书独立写入
      ['newPerDay', 'match', 'quiz'].forEach(function (k) {
        if (patch[k] !== undefined) { dictSettings()[k] = patch[k]; delete patch[k]; }
      });
      Object.assign(state.settings, patch); save();
    }
  };
})();
