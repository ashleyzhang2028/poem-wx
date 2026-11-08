"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const OUT_DIR = path.join(__dirname, "..", "audio");

const MODEL = "inclusionAI/Ming-3.0-tts-0.5b";
const PROMPT_WAV = "C:\\p\\ashley-poem\\Ming-3.0-tts\\data\\voice_presets\\voice_audio\\ashley.wav";
const PROMPT_TEXT = "小时不识月，呼作白玉盘。又疑瑶台镜，飞在青云端。";

const BOOKS = [
  { file: "kenei", id: "poems", minusCourse: false },
  { file: "tangshi300", id: "tangshi300", minusCourse: true },
  { file: "songci300", id: "songci300", minusCourse: true },
  { file: "tongxinshihua", id: "tongxin", minusCourse: true }
];

const LETTERS = {
  骆: "luo", 绅: "shen", 鹳: "guan", 涣: "huan", 绍: "shao", 钺: "yue", 邸: "di", 亥: "hai",
  肖: "xiao", 翃: "hong", 鲍: "bao", 燮: "xie", 敦: "dun", 郦: "li", 桢: "zhen", 洢: "yi",
  筠: "yun", 磐: "pan", 煜: "yu", 皂: "zao", 逍: "xiao", 佺: "quan", 掾: "yuan", 斋: "zhai",
  裴: "pei", 眘: "shen", 鄂: "e", 稹: "zhen", 漳: "zhang", 邽: "gui", 祜: "hu", 馀: "yu",
  绰: "chuo", 碑: "bei", 筹: "chou", 萝: "luo", 嵬: "wei", 畋: "tian", 韬: "tao", 偓: "wo",
  泌: "bi", 哥: "ge", 旭: "xu", 綦: "qi", 迪: "di", 颀: "qi", 觱: "bi", 篥: "li", 岘: "xian",
  朓: "tiao", 斛: "hu", 濬: "jun", 儋: "dan", 盱: "xu", 眙: "yi", 燎: "liao", 蹴: "cu",
  晔: "ye", 凯: "kai", 钦: "qin", 缪: "miao", 昱: "yu", 邱: "qiu", 骈: "pian", 珝: "xu",
  锺: "zhong", 庵: "an"
};

const WORDS = [
  ["汉乐府", "hanyuefu"],
  ["清平乐", "qingpingyue"],
  ["永遇乐", "yongyuyue"],
  ["齐天乐", "qitianyue"],
  ["夜半乐", "yebanyue"],
  ["还京乐", "huanjingyue"],
  ["乐游原", "leyouyuan"],
  ["酬乐天", "chouletian"],
  ["和乐天", "heletian"],
  ["清平调", "qingpingdiao"],
  ["长相思", "changxiangsi"],
  ["长干", "changgan"],
  ["长亭", "changting"],
  ["长淮", "changhuai"],
  ["长安", "changan"],
  ["长江", "changjiang"],
  ["长恨", "changhen"],
  ["长门", "changmen"],
  ["长风", "changfeng"],
  ["长沙", "changsha"],
  ["长空", "changkong"],
  ["长卿", "changqing"],
  ["长史", "changshi"],
  ["长文", "changwen"],
  ["长笛", "changdi"],
  ["长松", "changsong"],
  ["长堤", "changdi"],
  ["长川", "changchuan"],
  ["长亭怨慢", "changtingyuanman"],
  ["长征", "changzheng"],
  ["长年", "changnian"],
  ["长是", "changshi"],
  ["长垂", "changchui"],
  ["长别", "changbie"],
  ["长夜", "changye"],
  ["长天", "changtian"],
  ["长存", "changcun"],
  ["长啸", "changxiao"],
  ["长歌", "changge"],
  ["长河", "changhe"],
  ["长流", "changliu"],
  ["长洲", "changzhou"],
  ["长白", "changbai"],
  ["长乐", "changle"],
  ["长安道", "changandao"],
  ["水调歌头", "shuidiaogetou"],
  ["岑参", "censhen"],
  ["受降城", "shouxiangcheng"],
  ["汤显祖", "tangxianzu"],
  ["阴重", "yinzhong"],
  ["还乡", "huanxiang"],
  ["给事", "jishi"],
  ["屈原列传", "quyuanliezhuan"],
  ["种树郭橐驼传", "zhongshuguotuotuozhuan"],
  ["阿房宫赋", "epanggongfu"],
  ["将进酒", "qiangjinjiu"],
  ["万俟咏", "moqiyong"],
  ["尉迟杯", "yuchibei"],
  ["綦毋潜", "qiwuqian"],
  ["查慎行", "zhashenxing"],
  ["查荎", "zhachi"],
  ["生查子", "shengchazi"],
  ["曾几", "zengji"],
  ["园田居", "yuantianju"],
  ["缪氏", "miaoshi"],
  ["东都", "dongdu"],
  ["南都", "nandu"],
  ["都护", "duhu"],
  ["成都", "chengdu"],
  ["大都", "dadu"],
  ["名都", "mingdu"],
  ["京都", "jingdu"],
  ["故都", "gudu"],
  ["旧都", "jiudu"],
  ["都城", "ducheng"],
  ["都门", "dumen"],
  ["都市", "dushi"],
  ["都邑", "duyi"],
  ["皇都", "huangdu"],
  ["清都", "qingdu"],
  ["玄都", "xuandu"],
  ["天都", "tiandu"],
  ["仙都", "xiandu"],
  ["幽都", "youdu"],
  ["中都", "zhongdu"],
  ["留都", "liudu"],
  ["行都", "xingdu"],
  ["都人", "duren"],
  ["都忘", "duwang"],
  ["都不", "doubu"],
  ["都来", "doulai"],
  ["都是", "doushi"],
  ["都作", "douzuo"],
  ["都付", "doufu"],
  ["都成", "doucheng"]
];

const SINGLE = { 长: "chang", 乐: "le", 脉: "mai", 重: "chong", 还: "hai", 给: "ji", 汤: "tang", 参: "can", 降: "jiang", 园: "yuan" };

const TONE_MARKS = /[\u0100-\u01ff\u0250-\u02af\u0300-\u036f]/g;

function bare(reading) {
  return String(reading || "")
    .replace(/[üǖǘǚǜ]/g, "v")
    .normalize("NFD")
    .replace(TONE_MARKS, "")
    .toLowerCase();
}

WORDS.sort(function (a, b) { return b[0].length - a[0].length; });

function wordAt(text, i) {
  for (let k = 0; k < WORDS.length; k += 1) {
    if (text.startsWith(WORDS[k][0], i)) return { reading: WORDS[k][1], length: WORDS[k][0].length };
  }
  return null;
}

function lettersOf(P, text) {
  const src = String(text || "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const hit = wordAt(src, i);
    if (hit) { out += hit.reading; i += hit.length; continue; }
    const ch = src[i];
    if (!/\p{Script=Han}/u.test(ch)) { i += 1; continue; }
    if (SINGLE[ch]) { out += SINGLE[ch]; i += 1; continue; }
    if (LETTERS[ch]) { out += LETTERS[ch]; i += 1; continue; }
    const reading = P.readOf(ch, src, i) || P.read(ch);
    const bare1 = bare(reading);
    if (!bare1) throw new Error("读不出读音：" + ch + "（" + src + "）");
    out += bare1.split("/")[0];
    i += 1;
  }
  return out;
}

function dedupKey(text) {
  return String(text || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, "")
    .toLowerCase();
}

function flattenText(text) {
  return String(text || "").replace(/[\s\u3000]+/g, "");
}

function tidy(text) {
  return String(text || "").replace(/[\s\u3000]+/g, " ").trim();
}

function plainTitle(title) {
  return String(title || "").replace(/[（(][^）)]*[）)]/g, "").trim();
}

function assign(named, base, key) {
  const seen = named.get(base) || [];
  const same = seen.filter(function (x) { return x.key === key; })[0];
  if (same) return same.slug;
  let slug = base;
  let n = 1;
  while (seen.some(function (x) { return x.slug === slug; })) {
    n += 1;
    slug = base + "_" + n;
  }
  seen.push({ key: key, slug: slug });
  named.set(base, seen);
  return slug;
}

function collect(W, P) {
  const rows = seed.seedRows(W);
  const course = (W.SITE_INDEX || []).filter(function (p) { return !p.isBook && p.book === "poems"; });
  const courseKeys = new Set(course.map(function (p) { return dedupKey(p.text); }));

  const byBook = {};
  byBook.poems = course.map(function (p) {
    return { title: tidy(p.title), dynasty: tidy(p.dynasty), author: tidy(p.author), text: p.text };
  });

  ["tangshi300", "songci300", "tongxin"].forEach(function (id) {
    const texts = W.CATALOG_TEXTS[id] || null;
    const notes = W.TONGXIN_TEXT[id] || null;
    byBook[id] = rows.catalog.filter(function (c) { return c.book_id === id; }).map(function (c) {
      const body = texts ? texts[c.pos][3] : notes[String(c.pos + 1)][2];
      return { title: tidy(c.title), dynasty: tidy(c.note), author: tidy(c.author), text: body };
    });
  });

  const named = new Map();
  const out = [];
  BOOKS.forEach(function (b) {
    const list = byBook[b.id].filter(function (it) {
      if (!it.text) throw new Error(b.file + " 有篇目没有正文：" + it.title);
      return b.minusCourse ? !courseKeys.has(dedupKey(it.text)) : true;
    }).map(function (it) {
      return {
        title: it.title,
        dynasty: it.dynasty,
        author: it.author,
        text: it.text,
        base: lettersOf(P, plainTitle(it.title)) + "_" + lettersOf(P, it.author),
        key: dedupKey(it.text)
      };
    });
    list.forEach(function (it) {
      out.push({
        book: b.file,
        title: it.title,
        dynasty: it.dynasty,
        author: it.author,
        text: it.text,
        slug: assign(named, it.base, it.key)
      });
    });
  });
  return out;
}

function command(it) {
  return "python infer.py" +
    " --model_path " + MODEL +
    " --task TTS" +
    " --language_id Chinese" +
    ' --text "' + it.title + " " + it.dynasty + " " + it.author + " " + flattenText(it.text) + '"' +
    " --prompt_wav_path " + PROMPT_WAV +
    ' --prompt_text "' + PROMPT_TEXT + '"' +
    " --use_spk_emb" +
    " --output .\\output\\" + it.slug + ".wav" +
    " --device cpu" +
    " --no_text_normalization";
}

function table(items) {
  const head = ["| 标题 | 朝代 | 作者 | 音频文件名 |", "| -- | -- | -- | -- |"];
  const body = items.map(function (it) {
    return "| " + [it.title, it.dynasty, it.author, it.slug + ".wav"].join(" | ") + " |";
  });
  return head.concat(body).join("\n") + "\n";
}

function main() {
  const W = seed.loadCorpus();
  const vm = require("vm");
  const sandbox = { window: W, console: console };
  vm.createContext(sandbox);
  ["data/common-chars.js", "js/pinyin.js"].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(seed.CORPUS_DIR, rel), "utf8"), sandbox, { filename: rel });
  });
  const P = sandbox.window.Pinyin;

  const all = collect(W, P);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  BOOKS.forEach(function (b) {
    const mine = all.filter(function (it) { return it.book === b.file; });
    fs.writeFileSync(path.join(OUT_DIR, b.file + "_py.txt"),
      mine.map(command).join("\n") + "\n");
    fs.writeFileSync(path.join(OUT_DIR, b.file + "_map.md"), table(mine));
    process.stdout.write(b.file + " " + mine.length + "\n");
  });
  process.stdout.write("合计 " + all.length + "\n");
}

main();
