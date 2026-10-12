const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOAD = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-gushi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/poems-yuefu.js', 'data/poems-jinxiandai.js', 'data/poems-chengyu.js',
  'data/chengyu-support.js',
  /* Issue #516 · 第一批：用户点名的古诗 50 篇（唐诗 35 + 古诗 16）。 */
  'scripts/data/poems-corpus-516a.js',
  /* Issue #516 · 第二批（收尾批）：清单里最后真缺的 20 篇。 */
  'scripts/data/poems-corpus-516b.js',
  'data/poems-mingshu.js', 'data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js',
  'data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js',
  'data/site-books.js', 'data/site-index.js', 'data/works-index.js'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

LOAD.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

(function () {
  var RAW = {};
  [
    { f: 'data/poems-1.js', v: 'POEMS_1' }, { f: 'data/poems-2.js', v: 'POEMS_2' },
    { f: 'data/poems-3.js', v: 'POEMS_3' }, { f: 'data/poems-4.js', v: 'POEMS_4' },
    { f: 'data/poems-5.js', v: 'POEMS_5' }, { f: 'data/poems-6.js', v: 'POEMS_6' },
    { f: 'data/poems-7.js', v: 'POEMS_7' }, { f: 'data/poems-8.js', v: 'POEMS_8' },
    { f: 'data/poems-9.js', v: 'POEMS_9' }, { f: 'data/poems-10.js', v: 'POEMS_10' },
    { f: 'data/poems-11.js', v: 'POEMS_11' }, { f: 'data/poems-12.js', v: 'POEMS_12' },
    { f: 'data/poems-classic.js', v: 'POEMS_CLASSIC' },
    { f: 'data/poems-tangshi.js', v: 'POEMS_TANGSHI' },
    { f: 'data/poems-gushi.js', v: 'POEMS_GUSHI' },
    { f: 'data/poems-songci.js', v: 'POEMS_SONGCI' },
    { f: 'data/poems-guwen.js', v: 'POEMS_GUWEN' },
    { f: 'scripts/data/guwen-corpus-222.js', v: 'GUWEN_CORPUS_222', book: 'guwen' },
    { f: 'data/poems-zhaoming.js', v: 'POEMS_ZHAOMING' },
    { f: 'data/poems-yuanqu.js', v: 'POEMS_YUANQU' },
    { f: 'data/poems-yuefu.js', v: 'POEMS_YUEFU' },
    { f: 'data/poems-jinxiandai.js', v: 'POEMS_JINXIANDAI' },
    { f: 'data/poems-chengyu.js', v: 'POEMS_CHENGYU' },
    /* Issue #505 · 第二批：新补的语料表 —— 壳里只挂 textRef，正文在这两份里。
       不登记的话，下面「新建站点索引条目」那一段取不到正文、条目进不了判重表
       （同篇对照会少若干组）。 */
    { f: 'scripts/data/classic-corpus-505b.js', v: 'CLASSIC_CORPUS_505B', book: 'classic' },
    { f: 'scripts/data/poems-corpus-505b.js', v: 'POEMS_CORPUS_505B', split: true },
    /* Issue #505 · 第三批：古文 15 篇。 */
    { f: 'scripts/data/classic-corpus-505c.js', v: 'CLASSIC_CORPUS_505C', book: 'classic' },
    /* Issue #510 · 第一批：唐诗新补 1 首（雁门太守行）。 */
    { f: 'scripts/data/poems-corpus-510a.js', v: 'POEMS_CORPUS_510A', book: 'tangshi' },
    /* Issue #505 · 第四批（末批 · 第 151~200 组）：古文 15 篇 + 古诗 8 首
       （古诗那份按 id 前缀拆分，见 split 分支）。 */
    { f: 'scripts/data/classic-corpus-505d.js', v: 'CLASSIC_CORPUS_505D', book: 'classic' },
    { f: 'scripts/data/poems-corpus-505c.js', v: 'POEMS_CORPUS_505C', split: true },
    /* Issue #516 · 第一批：古诗 50 篇 —— 唐诗 / 古诗「非唐代」两部，split 分派。 */
    { f: 'scripts/data/poems-corpus-516a.js', v: 'POEMS_CORPUS_516A', split: true },
    /* Issue #516 · 第二批：20 篇 —— 同上，split 分派。 */
    { f: 'scripts/data/poems-corpus-516b.js', v: 'POEMS_CORPUS_516B', split: true },
    /* Issue #517 · 第一批：古文 22 篇。 */
    { f: 'scripts/data/classic-corpus-517a.js', v: 'CLASSIC_CORPUS_517A', book: 'classic' },
    /* Issue #517 · 收尾那一批：gw-277…gw-287（其中 gw-285 / gw-287 与《古文观止》
       同篇，正文在 guwen 那一份语料里，这里登记一次让判重表认得出）。 */
    { f: 'scripts/data/classic-corpus-517b.js', v: 'CLASSIC_CORPUS_517B', book: 'classic' }
  ].forEach(function (o) {
    var book = o.f.replace('data/poems-', '').replace('.js', '');
    if (/^\d+$/.test(book)) book = 'poems';
    var LOCAL = { ts: 'tangshi', gs: 'gushi', sc: 'songci', gw: 'classic', gwj: 'guwen' };
    (sandbox[o.v] || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (o.split) {
        var segs = p.id.split('-');
        for (var i = 0; i < segs.length; i += 1) {
          if (LOCAL[segs[i]]) { RAW[LOCAL[segs[i]] + '-' + p.id] = p; return; }
        }
      }
      RAW[book + '-' + p.id] = p;
    });
  });
  var inIndex = {};
  sandbox.SITE_INDEX.forEach(function (p) { if (p && p.id) inIndex[p.id] = true; });

  /* Issue #516 · 第二批：**先把语料表的正文刷新回已在索引里的那些条目**。
     `data/site-index.js` 是用上一版主表装配的，主表里有些条目是按题名兜底认
     正文的 —— 新语料里出现**同题不同文**的作品时（《劝学》荀子 / 颜真卿），
     壳挂的 textRef 会先被主表里那条同名条目认领，拿到别人的正文；两条
     同题不同文的作品于是被误判成「同篇」合流。这一轮 RAW 里那一条才是真的
     （语料表就是源），先覆盖一遍，后面判重拿到的就是各自正文，不会串。 */
  function rawTextOf(raw) {
    if (!raw) return null;
    if (raw.text) return { text: raw.text, translation: raw.translation || '',
      translationSource: raw.translationSource || '' };
    /* 壳只挂 textRef 的那些：正文在它指的那一条上（语料表或同部的壳）。 */
    if (raw.textRef && RAW[raw.textRef]) {
      var up = RAW[raw.textRef];
      if (up.text) return { text: up.text, translation: up.translation || '',
        translationSource: up.translationSource || '' };
    }
    return null;
  }
  /* 主表已经裁定过的条目**不刷**：`data/text-master.js` 才是合流后的定稿
     （课内 `<id>` 与集子 `<书>-<id>` 已并成同一篇）。若用单条语料覆盖，
     那一篇的判重键会与合流后的壳对不上 —— 组数会莫名少一组
     （《赠刘景文》poems-xx3-03 + gushi-gs-125 就是这么丢的）。
     这里只补主表里**还没有**的那些条目。 */
  var settled = {};
  (sandbox.TEXT_MASTER || []).forEach(function (m) {
    if (!m) return;
    if (m.id) settled[m.id] = true;
    (m.entries || []).forEach(function (e) { if (e) settled[e] = true; });
  });
  Object.keys(RAW).forEach(function (id) {
    if (id.indexOf('poems-') === 0) return;
    if (settled[id]) return;
    var t = rawTextOf(RAW[id]);
    if (!t) return;
    for (var i = 0; i < sandbox.SITE_INDEX.length; i++) {
      if (sandbox.SITE_INDEX[i] && sandbox.SITE_INDEX[i].id === id) {
        sandbox.SITE_INDEX[i].text = t.text;
        sandbox.SITE_INDEX[i].translation = t.translation;
        sandbox.SITE_INDEX[i].translationSource = t.translationSource;
        return;
      }
    }
  });

  Object.keys(RAW).forEach(function (id) {
    if (inIndex[id] || id.indexOf('poems-') === 0) return;
    var raw = RAW[id];
    var t = { text: raw.text || '', translation: raw.translation || '',
      translationSource: raw.translationSource || '' };

    if (!t.text && raw.textRef && RAW[raw.textRef]) {
      var up = RAW[raw.textRef];
      if (up.text || up.translation) {
        t = { text: up.text || '', translation: up.translation || '',
          translationSource: up.translationSource || '' };
      }
    }

    if (!t.text) {
      var TM = {};
      (sandbox.TEXT_MASTER || []).forEach(function (m) {
        if (!m) return;
        if (m.id && !TM[m.id]) TM[m.id] = m;
        (m.entries || []).forEach(function (e) { if (e && !TM[e]) TM[e] = m; });
      });
      var hit = TM[id] || (raw.textRef ? TM[raw.textRef] : null);
      if (hit) t = { text: hit.text || '', translation: hit.translation || '',
        translationSource: hit.translationSource || '' };
    }
    if (!t.text) return;
    var book = id.split('-')[0];
    sandbox.SITE_INDEX.push({
      id: id, originId: id.slice(book.length + 1), title: raw.title,
      author: raw.author || '', dynasty: raw.dynasty || '',
      source: raw.source || '', gradeGroup: raw.gradeGroup || '',
      meaning: raw.meaning || '',
      text: t.text, translation: t.translation, translationSource: t.translationSource,
      book: book, bookName: book, page: book + '/'
    });
    inIndex[id] = true;
  });
})();

(function () {
  var TM = {};
  (sandbox.TEXT_MASTER || []).forEach(function (m) {
    if (!m) return;
    if (m.id && !TM[m.id]) TM[m.id] = m;
    (m.entries || []).forEach(function (e) { if (e && !TM[e]) TM[e] = m; });
  });
  sandbox.SITE_INDEX.forEach(function (p) {
    if (!p || p.isBook || !p.textRef || p.text) return;
    if (p.book !== 'poems') return;
    var hit = TM[p.textRef] || TM[p.id];
    if (!hit || !hit.text) return;
    p.text = hit.text;
    p.translation = hit.translation || "";
    p.translationSource = hit.translationSource;
  });
  /* 上一步把课内那一条的正文补上了，但集子壳（`gushi-gs-125`）此刻也可能是
     空的 —— 它的正文取不到就没法和课内那条对上判重键。用主表里那一份
     把它补平（主表 `entries` 里点名了它，正是为这件事）。 */
  sandbox.SITE_INDEX.forEach(function (p) {
    if (!p || p.isBook || p.text) return;
    var hit = TM[p.id];
    if (!hit || !hit.text) return;
    p.text = hit.text;
    p.translation = hit.translation || "";
    p.translationSource = hit.translationSource;
  });
})();

(function () {
  const named = {};
  (sandbox.CHENGYU_SUPPORT || []).forEach(function (x) { if (x && x.title) named[x.title] = true; });
  const splitIds = {};
  (sandbox.POEMS_CHENGYU || []).forEach(function (p) {
    if (p && named[p.title]) splitIds['chengyu-' + p.id] = true;
  });
  if (!Object.keys(splitIds).length) return;
    sandbox.WORKS_GROUPS = (sandbox.WORKS_GROUPS || []).map(function (g) {
    const kept = (g.entries || []).filter(function (e) { return !splitIds[e]; });
    if (kept.length === g.entries.length) return g;
    if (kept.length < 2) return null;
    return { wid: g.wid, title: g.title, titles: (g.titles || []).filter(function (t) {
      return !named[t];
    }), entries: kept };
  }).filter(Boolean);
  sandbox.WorksIndex.rebuild(sandbox.SITE_INDEX);
})();

const WI = sandbox.WorksIndex;
const byId0 = {};
(sandbox.SITE_INDEX || []).forEach(function (p) { if (p && p.id) byId0[p.id] = p; });

function orderKey(e) {
  const m = String(e).match(/^(.*?)(\d+)$/);
  return [m ? m[1] : e, m ? Number(m[2]) : 0, e];
}
function byMainFirst(a, b) {
  const ka = orderKey(a), kb = orderKey(b);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return a < b ? -1 : 1;
}
const groups = WI.works
  .filter(function (w) { return w.entries.length > 1; })
  .map(function (w) {
    const entries = w.entries.slice().sort(byMainFirst);
    const rep = entries[0];
    return {
      wid: w.wid,
      title: (byId0[rep] && byId0[rep].title) || w.title,
      titles: w.titles.slice(),
      entries: entries
    };
  });
groups.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

const byId = {};
(sandbox.SITE_INDEX || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });

const BT = '`';
let out = '';
out += '/* ==========================================================================\n';
out += '   同篇对照表（主表裁定规则的静态成果）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   由 scripts/build-works-map.js 离线算出：**正文（去标点后）一致 = 同一篇作品**。\n';
out += '   只登记「在两部及以上集子里重复出现」的那些作品（共 ' + groups.length + ' 组），\n';
out += '   单条的作品不必登记 —— 它本来就只出现一次，条目 id 自己就是作品 id。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑，\n';
out += '      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。\n';
out += '\n';
out += '   为什么要单独落成一份**静态数据**而不是每页现算：\n';
out += '     现算要先备齐九部集子的全部数据（约 3MB）。集子索引页只加载自己那一部，\n';
out += '     它也要判重（「这篇是不是已经在课内背过了」），现算就会得到一张残表。\n';
out += '     这一份 8KB，任何页面都能引，判重口径全站一致。\n';
out += '\n';
out += '   ## 为什么不是所有同名篇目都合并\n';
out += '\n';
out += '   教材与选本的文本**真会不一样**，是文献上的差别、不是录入出错：\n';
out += '     · 《静夜思》 教材与《唐诗》正文一致（都是「床前明月光」的教材文本）\n';
out += '       → 合并为同一篇（titles 记两个题名）\n';
out += '     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→ 引号剥掉后\n';
out += '       正文一致，合并\n';
out += '     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗作「回乐峰」→ 一字之差，是两种文本，\n';
out += '       **分成两条并列的作品**，各背各的\n';
out += '   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分两条并列**。\n';
out += '\n';
out += '   至于同一篇作品「用哪一份正文」，那是另一份静态表的裁定 ——\n';
out += '   见 data/canonical-texts.js（课内优先，同一篇只留一份正文）。\n';
out += '\n';
out += '   ## 课内自身重复已按「低年级版本为准」去重\n';
out += '\n';
out += '   课内数据里曾有 12 组篇目在两个年级各存一份（正文一字不差），是逐页录入留下的\n';
out += '   自身重复（《绝句》二年级下 / 三年级下、《师说》高一上 / 高三下……）。\n';
out += '   已各删一条、保留低年级那条，课内条目由 273 降到 261，本表组数由 66 降到 57。\n';
out += '   跨集那 3 组只删课内自身那份，与选集的判重照旧。\n';
out += '\n';
out += '   字段：\n';
out += '     wid     作品 id（' + BT + 'w-' + BT + ' 加首个条目 id）\n';
out += '     title   主条目题名（有课内条目时取教材题名）\n';
out += '     titles  这一篇出现过的全部题名（同诗异题：《夜思》与《静夜思》）\n';
out += '     entries 收录这一篇的全部站点条目 id，与 data/site-index.js 同口径\n';
out += '   ========================================================================== */\n';
out += 'window.WORKS_GROUPS = [\n';
groups.forEach(function (g, i) {
  if (i > 0 && groups[i - 1].entries[0].split('-')[0] !== g.entries[0].split('-')[0]) out += '\n';
  out += '  { wid: ' + JSON.stringify(g.wid) + ', title: ' + JSON.stringify(g.title) +
    ', titles: ' + JSON.stringify(g.titles) + ', entries: ' + JSON.stringify(g.entries) + ' }' +
    (i < groups.length - 1 ? ',' : '') + '\n';
});
out += '];\n';

const VARIANT = [
  ['惟', '唯'], ['霪', '淫'], ['蘋', '苹'], ['翦', '剪'], ['皇', '凰'],
  ['懃', '勤'], ['絜', '洁'], ['岀', '出'], ['閒', '闲'], ['彊', '强']
];
function loose(t) {
  let s = String(t || '').replace(/\s+/g, '');
  VARIANT.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  return s;
}
const NEAR = {};
sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.text || !p.id) return;
  const k = loose(p.text);
  if (!k) return;
  (NEAR[k] = NEAR[k] || []).push(p.id);
});
const nearPairs = [];
Object.keys(NEAR).forEach(function (k) {
  const ids = NEAR[k];
  if (ids.length < 2) return;

  const strict = {};
  ids.forEach(function (id) {
    const t = String((byId[id] || {}).text || '').replace(/\s+/g, '');
    (strict[t] = strict[t] || []).push(id);
  });
  if (Object.keys(strict).length < 2) return;
  nearPairs.push({
    entries: ids.slice(),
    reason: '一字之差的两条文本传统（选本原貌 vs 教材 / 通行字），并列而不合并'
  });
});
/* Issue #539（第二轮）：**收录范围不同、又不是一字之差**的那些近重复对。
   `loose()` 只管异体字，管不到「一条是全篇、另一条是节选」——
   《劝学》课内那一课止于「锲而不舍，金石可镂」，《古文》那一条本轮补成了
   《荀子》整篇（十六段）；两条都不该被对方替掉，只能并列。
   这里显式登记，免得下一轮有人看见两条同名就顺手并了。

   ⚠️ 判据写的是「并列不合并」这一条裁定本身，不是文本长度 ——
   长度会随录入变，裁定不会。 */
const SCOPE_PAIRS = [
  {
    entries: ['classic-gw-114', 'poems-gz10-10'],
    reason: '同一篇的两个收录范围：课内那一课是教材节选（止于「锲而不舍，金石可镂」），' +
            '《古文》那一条是《荀子》整篇全文；教材的节选范围不该被选本覆盖，' +
            '全文也不该只因为课本里只有节选就不收 —— 并列，各背各的'
  }
];
SCOPE_PAIRS.forEach(function (p) {
  if (p.entries.every(function (e) { return !!byId[e]; })) nearPairs.push(p);
});
nearPairs.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

out += '/* ==========================================================================\n';
out += '   近重复对（看着像同一篇、**故意不合并**的那些）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   共 ' + nearPairs.length + ' 组，由 scripts/build-works-map.js 与上面那张表一起算出。\n';
out += '\n';
out += '   判重键是「正文去标点后逐字相同」。下面这些是**再走一步**才能对上、\n';
out += '   却仍然不该并的两类 ——\n';
out += '\n';
out += '   ① 一字之差的两种文本传统（异体 / 通行字）：\n';
out += '\n';
out += '     《将进酒》  课内「但愿长醉不愿醒」 vs 唐诗「但愿长醉不复醒」\n';
out += '     《岳阳楼记》古文观止「霪雨霏霏」   vs 课内「淫雨霏霏」\n';
out += '     《天香》    宋词「剪春灯」         vs 宋词「翦春灯」（籀文正体）\n';
out += '     《北山移文》古文观止「比洁」       vs 昭明「比絜」（选本用本字）\n';
out += '     《答苏武书》古文观止「勤勤」       vs 昭明「懃懃」（选本用本字）\n';
out += '\n';
out += '   ② 同一篇的两个收录范围（一篇是全文、另一篇是节选）—— 这一类\n';
out += '      连异体字都不用找，差的是一整段：\n';
out += '\n';
out += '     《劝学》 课内高一上「教材节选」 vs 《古文》「《荀子》整篇」（Issue #539）\n';
out += '\n';
out += '   按本表的规则（课内以教材为准、选集以选本原貌为准、冲突时分两条并列），\n';
out += '   它们**各背各的**。写在同一处，是因为它们最容易被顺手合并：\n';
out += '   正文差不多、题名往往只差一点、搜出来还并排站着。一旦并了，\n';
out += '   学生的课本作「淫雨霏霏」，页面上却成了「霪雨霏霏」—— 不报错，只是变了。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑。\n';
out += '   字段：entries 条目 id（两条及以上）；reason 为什么不并\n';
out += '   ========================================================================== */\n';
out += 'window.WORKS_NEAR_DUP = [\n';
nearPairs.forEach(function (p) {
  out += '  { entries: [' + p.entries.map(function (e) { return JSON.stringify(e); }).join(', ') +
    '], reason: ' + JSON.stringify(p.reason) + ' },\n';
});
out += '];\n';
out += '\n';
const target = path.join(ROOT, 'data/works-map.js');
const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, out);
console.log('data/works-map.js: ' + groups.length + ' 组' +
  (prev === out ? '（内容无变化）' : '（已更新）'));
