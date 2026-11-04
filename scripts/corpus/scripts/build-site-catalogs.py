import json
import os
import re
import sys

from opencc import OpenCC

DATA = os.environ.get("POETRY_DATA") or sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "site-catalogs.js")
T2S = OpenCC("t2s")

Y = "先秦"
BOOKS = [
    ("tangshi300", "唐诗三百首", "首", "唐", ("keep",), ""),
    ("songci300", "宋词三百首", "首", "宋", ("keep",), ""),
    ("xiaoguwen", "必读小古文", "篇", "", ("xiaoguwen",), ""),
    ("tongxin", "童心诗话", "首", "", ("tongxin",), ""),
    ("qianjiashi", "千家诗", "首", "宋", ("qianjia",), ""),
    ("huajianji", "花间集", "首", "五代十国", ("dirs", ["五代十国/词/五代诗词/huajianji"], "huajian"), ""),
    ("gushiyuan", "古诗源", "首", "", ("dirs", ["汉/古诗源"], "gushiyuan"), ""),
    ("yuefuji", "乐府诗集", "首", "", ("dirs", ["汇编/乐府诗集"], "yuefu"), ""),
    ("cizong", "词综", "首", "", ("dirs", ["汇编/词综"], "cizong"), ""),
    ("chuci", "楚辞", "篇", Y, ("files", ["先秦/楚辞/chuci.json"]), ""),
    ("gwgz", "古文观止", "篇", "", ("keep",), ""),
    ("wenxuan", "昭明文选", "篇", "", ("dirs", ["汇编/昭明文选"], ""), ""),

    ("sanzijing", "三字经", "篇", "宋", ("files", ["汇编/蒙学/sanzijing.json"]), ""),
    ("baijiaxing", "百家姓", "篇", "宋", ("files", ["汇编/蒙学/baijiaxing.json"]), ""),
    ("dizigui", "弟子规", "章", "清", ("nested", "汇编/蒙学/dizigui.json"), ""),
    ("qianziwen", "千字文", "篇", "南北朝", ("files", ["汇编/蒙学/qianziwen.json"]), ""),
    ("zengguang", "增广贤文", "章", "明", ("nested", "汇编/蒙学/zengguangxianwen.json"), ""),
    ("shenglv", "声律启蒙", "章", "清", ("nested", "汇编/蒙学/shenglvqimeng.json"), ""),
    ("liweng", "笠翁对韵", "章", "清", ("nested", "汇编/蒙学/liwengduiyun.json"), ""),
    ("youxue", "幼学琼林", "章", "明", ("nested", "汇编/蒙学/youxueqionglin.json"), ""),
    ("longwen", "龙文鞭影", "章", "明", ("nested", "汇编/蒙学/longwenbianying.json"), ""),
    ("jijiu", "急就章", "章", "汉", ("nested", "汇编/蒙学/jijiuzhang.json"), ""),
    ("lishi", "李氏蒙求", "篇", "唐", ("files", ["汇编/蒙学/lishimengqiu.json"]), ""),
    ("wuzijian", "五字鉴", "章", "明", ("nested", "汇编/蒙学/wuzijian.json"), ""),

    ("lunyu", "论语", "篇", Y, ("files", ["先秦/论语/lunyu.json"]), "孔门弟子"),
    ("mengzi", "孟子", "篇", Y, ("files", ["先秦/孟子/mengzi.json"]), "孟子"),
    ("daxue", "大学", "篇", Y, ("nested", "先秦/大学/daxue.json"), "曾子"),
    ("zhongyong", "中庸", "篇", Y, ("nested", "先秦/中庸/zhongyong.json"), "子思"),
    ("shijing", "诗经", "篇", Y, ("files", ["先秦/诗经/shijing.json"]), ""),
    ("shangshu", "尚书", "篇", Y, ("files", ["先秦/文/shangshu.json"]), ""),
    ("zhouyi", "周易", "卦", Y, ("files", ["先秦/文/zhouyi.json"]), ""),
    ("zuozhuan", "春秋左氏传", "篇", Y, ("files", ["史书/春秋左氏传/zuozhuan.json"]), "左丘明"),
    ("daodejing", "道德经", "章", Y, ("files", ["先秦/文/daodejing.json"]), "老子"),
    ("sunzi", "孙子兵法", "篇", Y, ("files", ["先秦/文/sunzibingfa.json"]), "孙武"),
    ("sanshiliuji", "三十六计", "计", Y, ("files", ["先秦/文/sanshiliuji.json"]), ""),
    ("shanhaijing", "山海经", "篇", Y, ("files", ["先秦/文/shanhaijing.json"]), ""),

    ("yisuo", "伊索寓言", "篇", "古希腊", ("files", ["汇编/伊索寓言/yisuoyuyan.json"]), "伊索"),
    ("gelin", "格林童话", "篇", "德国", ("files", ["汇编/格林童话/gelintonghua.json"]), "格林兄弟"),
    ("andersen", "安徒生童话", "篇", "丹麦", ("files", ["汇编/安徒生童话/antushengtonghua.json"]), "安徒生"),

    ("zhanguoce", "战国策", "篇", Y, ("files", ["史书/战国策/zhanguoce.json"]), "刘向"),
    ("shiji", "史记", "篇", "汉", ("files", ["史书/史记/shiji.json"]), "司马迁"),
    ("sanguozhi", "三国志", "篇", "晋", ("files", ["史书/三国志/sanguozhi.json"]), "陈寿"),

    ("honglou", "红楼梦", "回", "清", ("files", ["清/小说/红楼梦/hongloumeng.json"]), ""),
    ("sanguo", "三国演义", "回", "明", ("files", ["明/小说/三国演义/sanguoyanyi.json"]), ""),
    ("shuihu", "水浒传", "回", "明", ("files", ["明/小说/水浒传/shuihuzhuan.json"]), ""),
    ("xiyou", "西游记", "回", "明", ("files", ["明/小说/西游记/xiyouji.json"]), ""),
    ("rulin", "儒林外史", "回", "清", ("files", ["清/小说/儒林外史/rulinwaishi.json"]), ""),
    ("liaozhai", "聊斋志异", "篇", "清", ("files", ["清/小说/聊斋志异/liaozhaizhiyi.json"]), ""),
    ("dongzhou", "东周列国志", "回", "明", ("files", ["明/小说/东周列国志/dongzhoulieguozhi.json"]), ""),
    ("fengshen", "封神演义", "回", "明", ("files", ["明/小说/封神演义/fengshenyanqi.json"]), ""),
    ("jinghua", "镜花缘", "回", "清", ("files", ["清/小说/镜花缘/jinghuayuan.json"]), ""),
    ("yushi", "喻世明言", "卷", "明", ("files", ["明/小说/三言二拍/yushimingyan.json"]), ""),
    ("jingshi", "警世通言", "卷", "明", ("files", ["明/小说/三言二拍/jingshitongyan.json"]), ""),
    ("xingshi", "醒世恒言", "卷", "明", ("files", ["明/小说/三言二拍/xingshihengyan.json"]), ""),
    ("chuke", "初刻拍案惊奇", "卷", "明", ("files", ["清/小说/初刻拍案惊奇/chukepaiangjiqi.json"]), ""),
    ("erke", "二刻拍案惊奇", "卷", "明", ("files", ["清/小说/二刻拍案惊奇/erkipaianjingqi.json"]), ""),
    ("suitang", "隋唐演义", "回", "清", ("files", ["清/小说/隋唐演义/suitangyanyi.json"]), ""),
    ("shuoyue", "说岳全传", "回", "清", ("files", ["清/小说/说岳全传/shuoyuequanzhuan.json"]), ""),
    ("xiaolin", "笑林广记", "篇", "清", ("files", ["清/小说/笑林广记/xiaolinguangji.json"]), ""),
    ("xiaofu", "笑府", "篇", "明", ("files", ["明/小说/笑府/xiaofu.json"]), "冯梦龙"),
]

DAILY_MAX_CHARS = 64
DAILY_MAX_ROWS = 800
INDEX_MAX_CHARS = 600
HAITANG = "reference/mit_licence_haitangshishe"
FAMILIAR = ["唐诗三百首", "给孩子的诗", "千家诗", "古诗十九首"]
SKIP_TOP = {"reference", "docs", "scripts", "loader", "images", "strains", "rank", "authors", "dynasties", "anthologies", ".git"}
OUT_DAILY = os.path.join(os.path.dirname(__file__), "..", "data", "site-daily.js")


def load(rel):
    with open(os.path.join(DATA, rel), encoding="utf-8") as f:
        return json.load(f)


def json_files(rel):
    root = os.path.join(DATA, rel)
    out = []
    for dirpath, _, names in os.walk(root):
        for n in sorted(names):
            if n.endswith(".json"):
                out.append(os.path.relpath(os.path.join(dirpath, n), DATA))
    return sorted(out)


def records(rel):
    try:
        data = load(rel)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return []
    return [r for r in data if isinstance(r, dict) and r.get("paragraphs")]


def title_of(r):
    rhythmic = (r.get("rhythmic") or "").strip()
    title = (r.get("title") or "").strip()
    if rhythmic:
        return rhythmic + "·" + title if title and title != rhythmic else rhythmic
    return title or (r.get("chapter") or "").strip()


def han_count(r):
    lines = r.get("paragraphs") or []
    text = lines if isinstance(lines, str) else "".join(str(x) for x in lines)
    return sum(1 for ch in text if "一" <= ch <= "鿿")


def row(r):
    t = T2S.convert(title_of(r))
    a = T2S.convert((r.get("author") or "").strip()) or "佚名"
    return t, a


def skip_record(mode, r):
    title = (r.get("title") or "").strip()
    if mode == "huajian":
        return not r.get("rhythmic") or title == "花间集"
    if mode == "yuefu":
        return title == (r.get("category") or "").strip()
    return False


def line_text(r):
    lines = r.get("paragraphs") or []
    return lines if isinstance(lines, str) else "\n".join(str(x) for x in lines)


def mk(title, author, note, text=""):
    return {"title": title, "author": author, "note": note, "text": text}


def collect_files(rels, mode=""):
    out = []
    for rel in rels:
        for r in records(rel):
            if not skip_record(mode, r):
                out.append(mk(title_of(r), (r.get("author") or "").strip(), (r.get("dynasty") or "") if mode == "gushiyuan" else None))
    return out


def collect_dirs(dirs, mode):
    out = []
    for d in dirs:
        for rel in json_files(d):
            if mode == "cizong" and not os.path.basename(rel).startswith("卷"):
                continue
            if mode == "gushiyuan" and not os.path.basename(rel).startswith("卷"):
                continue
            out.extend(collect_files([rel], mode))
    return out


def collect_xiaoguwen():
    out = []
    for rel in json_files("汇编/小古文"):
        theme = os.path.splitext(os.path.basename(rel))[0]
        for r in records(rel):
            out.append(mk(title_of(r), (r.get("author") or "").strip(), theme))
    return out


def chapters_of(rel):
    d = load(rel)
    if isinstance(d, list):
        return "", [(c.get("chapter") or "", c.get("paragraphs") or []) for c in d]
    author = (d.get("author") or "").strip()
    out = []
    for it in d.get("content") or d.get("paragraphs") or []:
        if it.get("content"):
            vol = (it.get("title") or "").strip()
            for c in it["content"]:
                out.append(((vol + " " if vol else "") + (c.get("chapter") or ""), c.get("paragraphs") or []))
        else:
            out.append((it.get("chapter") or "", it.get("paragraphs") or []))
    return author, out


def collect_nested(rel):
    author, chapters = chapters_of(rel)
    out = []
    for name, lines in chapters:
        out.append(mk(name.strip(), author, None, "\n".join(str(x) for x in lines)))
    return out


def collect_qianjia():
    out = []
    for g in load("宋/诗/千家诗/qianjiashi.json")["paragraphs"]:
        for e in g.get("content") or []:
            name = (e.get("chapter") or "").strip()
            who = re.sub(r"^[（(][^）)]*[）)]", "", (e.get("author") or "").strip())
            subs = e.get("paragraphs") or []
            if subs and isinstance(subs[0], dict):
                for sub in subs:
                    out.append(mk(name + "·" + (sub.get("subchapter") or "").strip(), who, ""))
            else:
                out.append(mk(name, who, ""))
    return out


def collect(book):
    spec = book[4]
    mode = spec[0]
    if mode == "files":
        return collect_files(spec[1])
    if mode == "dirs":
        return collect_dirs(spec[1], spec[2])
    if mode == "xiaoguwen":
        return collect_xiaoguwen()
    if mode == "nested":
        return collect_nested(spec[1])
    if mode == "qianjia":
        return collect_qianjia()
    if mode == "tongxin":
        return tongxin_rows()
    raise ValueError(mode)


def han_key(text, cmap):
    return "".join(cmap.get(ch, ch) for ch in text if "一" <= ch <= "鿿")


def all_records():
    for top in sorted(os.listdir(DATA)):
        if top in SKIP_TOP or not os.path.isdir(os.path.join(DATA, top)):
            continue
        for rel in json_files(top):
            for r in records(rel):
                yield rel, r


def paragraphs_text(r):
    lines = r.get("paragraphs") or []
    return lines if isinstance(lines, str) else "".join(str(x) for x in lines)


_INDEX = {}


def corpus_index():
    if _INDEX:
        return _INDEX
    texts = [(r, paragraphs_text(r)) for _, r in all_records()]
    chars = set()
    for _, text in texts:
        chars.update(ch for ch in text if "一" <= ch <= "鿿")
    for w in haitang_works().values():
        chars.update(ch for ch in w["content"] if "一" <= ch <= "鿿")
    cmap = {ch: T2S.convert(ch) for ch in chars}
    by_content = {}
    by_title = {}
    for r, text in texts:
        k = row(r)
        by_title[k] = by_title.get(k, 0) + 1
        if han_count(r) <= INDEX_MAX_CHARS:
            by_content.setdefault(han_key(text, cmap), []).append(r)
    _INDEX.update({"cmap": cmap, "by_content": by_content, "by_title": by_title})
    return _INDEX


_WORKS = {}


def haitang_works():
    if not _WORKS:
        for n in range(1, 9):
            for w in load(HAITANG + "/works_%d.json" % n):
                _WORKS[str(w["id"])] = w
    return _WORKS


def title_key(text):
    return re.sub(r"[\s·・()（）]", "", text)


def haitang_collection(name):
    idx = corpus_index()
    works = haitang_works()
    by_norm = {}
    for k in idx["by_title"]:
        by_norm.setdefault((title_key(k[0]), k[1]), []).append(k)
    items = [cw for cw in load(HAITANG + "/collection_works.json") if cw["collection"] == name]
    items.sort(key=lambda cw: int(cw.get("show_order") or 0))
    out = []
    seen = set()
    for cw in items:
        w = works.get(str(cw["work_id"]))
        if not w:
            continue
        hits = idx["by_content"].get(han_key(w["content"], idx["cmap"]), [])
        key = None
        if len(hits) == 1 and idx["by_title"].get(row(hits[0])) == 1:
            key = row(hits[0])
        if key is None:
            wt, wa = T2S.convert(w["title"]), T2S.convert(w["author"])
            near = by_norm.get((title_key(wt), wa), [])
            if len(near) == 1 and idx["by_title"].get(near[0]) == 1:
                key = near[0]
        if key is None:
            key = (re.sub(r"\s*[·・]\s*", "·", T2S.convert(w["title"]).strip()), T2S.convert(w["author"]).strip() or "佚名")
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": key[0], "author": key[1], "paragraphs": ["-"]})
    return out


def build_daily():
    quotes = {str(x["work_id"]) for x in load(HAITANG + "/quotes.json")}
    textbook = {c["name"] for c in load(HAITANG + "/collections.json") if c.get("kind") == "课本"}
    familiar = set()
    for cw in load(HAITANG + "/collection_works.json"):
        if cw["collection"] in FAMILIAR or cw["collection"] in textbook:
            familiar.add(str(cw["work_id"]))
    idx = corpus_index()
    out = []
    seen = set()
    for wid, w in haitang_works().items():
        if wid not in quotes or wid in familiar or w.get("kind") not in ("shi", "ci"):
            continue
        if han_count({"paragraphs": w.get("content") or ""}) > DAILY_MAX_CHARS:
            continue
        hits = idx["by_content"].get(han_key(w["content"], idx["cmap"]), [])
        if len(hits) != 1:
            continue
        t, a = row(hits[0])
        if not t or not a or idx["by_title"].get((t, a)) != 1 or (t, a) in seen:
            continue
        seen.add((t, a))
        out.append([t, a, w.get("dynasty") or "", "名句"])
    step = len(out) / float(DAILY_MAX_ROWS) if len(out) > DAILY_MAX_ROWS else 1
    return [out[int(i * step)] for i in range(min(len(out), DAILY_MAX_ROWS))]


DYNASTY_DIRS = {"唐", "宋", "元", "明", "清", "金", "汉", "晋", "隋", "先秦", "五代十国", "南北朝", "三国"}
LIST_TSV = os.path.join(os.path.dirname(__file__), "..", "data", "tongxin-list.tsv")
KEEP_JSON = os.environ.get("KEEP_JSON") or ""
TEXTS_OUT = os.path.join(os.path.dirname(__file__), "..", "data", "site-texts.js")
TONGXIN_OUT = os.path.join(os.path.dirname(__file__), "..", "data", "tongxin-notes.js")
OLD = {}
OLD_TX = {}
OLD_TN = {}
TONG = []
NOISE_TITLE = re.compile(r"[\s·・()（）\[\]【】]|其[一二三四五六七八九十]+|[一二三四五六七八九十]+首")


def base_title(text):
    return NOISE_TITLE.sub("", T2S.convert(text).split("/")[0])


def han_only(text):
    return "".join(ch for ch in text if "一" <= ch <= "鿿")


_HT = {}


def haitang_index():
    if _HT:
        return _HT
    for w in haitang_works().values():
        key = han_only(T2S.convert(w["content"]))
        if key:
            _HT.setdefault(key[:4], []).append((key, w))
            _HT.setdefault("__all__", []).append((key, w))
    return _HT


def work_lines(w):
    text = T2S.convert(w["content"]).replace("\r", "")
    return "\n".join(x.strip() for x in text.split("\n") if x.strip())


def tongxin_rows():
    idx = haitang_index()
    old_text = OLD_TX.get("tongxin", {})
    old_by_key = {}
    for pos, v in old_text.items():
        old_by_key[han_only(v[2])[:8]] = int(pos)
    out = []
    miss = []
    for line in open(LIST_TSV, encoding="utf-8").read().splitlines():
        if not line.strip():
            continue
        title, first = line.split("\t")
        want = han_only(T2S.convert(first))
        bt = base_title(title)
        hits = [w for key, w in idx.get(want[:4], []) if key.startswith(want[:8])]
        if len(hits) > 1:
            near = [w for w in hits if bt and (bt in base_title(w["title"]) or base_title(w["title"]) in bt)]
            hits = near or hits
        if len(hits) != 1:
            loose = [w for key, w in idx["__all__"] if want[:6] in key[:80]]
            near = [w for w in loose if bt and (bt in base_title(w["title"]) or base_title(w["title"]) in bt)]
            hits = near or (loose if len(loose) == 1 else hits)
            if len(hits) > 1:
                hits = hits[:1]
        if len(hits) != 1:
            miss.append(title)
            out.append(dict(mk(T2S.convert(re.sub(r"\s*[·・]\s*", "·", title)).strip(), "", ""), want=want, old=old_by_key.get(want[:8])))
            continue
        w = hits[0]
        shown = re.sub(r"\s*[·・]\s*", "·", T2S.convert(w["title"]).strip())
        out.append(dict(mk(shown, T2S.convert(w["author"]).strip(), w.get("dynasty") or "", work_lines(w)),
                        want=want, old=old_by_key.get(want[:8]), tr=T2S.convert((w.get("translation") or "").replace("\r", ""))))
    if miss:
        print("tongxin 未对上海棠作品：", len(miss), miss)
    return out


def build():
    if KEEP_JSON:
        dump = json.load(open(KEEP_JSON, encoding="utf-8"))
        OLD.update(dump["cat"])
        OLD_TX.update(dump.get("tx") or {})
        OLD_TN.update(dump.get("tn") or {})
    result = {}
    texts = {}
    for book in BOOKS:
        bid, name, unit, dynasty, spec, who = book
        rows = []
        if spec[0] == "keep":
            rows = [list(r) for r in OLD[bid]["rows"]]
        else:
            items = collect(book)
            if spec[0] == "tongxin":
                TONG.extend(items)
            for it in items:
                t = T2S.convert(it["title"]).strip()
                a = T2S.convert(it["author"]).strip() or who or "佚名"
                if not t:
                    continue
                note = dynasty if it["note"] is None else it["note"]
                rows.append([t, a, note])
                if spec[0] == "tongxin":
                    it["pos"] = len(rows)
                elif it["text"]:
                    texts.setdefault(bid, []).append([len(rows), bid + "-" + str(len(rows)), "", T2S.convert(it["text"]), ""])
        result[bid] = (name, unit, rows)
    return result, texts


def tongxin_notes(items):
    text = {}
    notes = {}
    old_notes = OLD_TN.get("tongxin", {})
    for it in items:
        if not it.get("pos"):
            continue
        pos = str(it["pos"])
        old = OLD_TX.get("tongxin", {}).get(str(it["old"])) if it.get("old") else None
        if it["text"]:
            body = it["text"]
        elif old:
            body = old[2]
        else:
            continue
        tr = (old[3] if old and old[3] else it.get("tr")) or ""
        text[pos] = ["", "", body, tr]
        if it.get("old") and old_notes.get(str(it["old"])):
            notes[pos] = old_notes[str(it["old"])]
    return text, notes


def write_tongxin(text, notes):
    def dump(obj):
        return json.dumps(obj, ensure_ascii=False, indent=2)

    body = (
        '(function () {\n  "use strict";\n\n  window.TONGXIN_TEXT = {\n    "tongxin": '
        + dump(text).replace("\n", "\n    ")
        + "\n  };\n\n  window.TONGXIN_NOTES = {\n    \"tongxin\": "
        + dump(notes).replace("\n", "\n    ")
        + "\n  };\n})();\n"
    )
    with open(TONGXIN_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)


def write_daily(daily):
    body = ",\n".join("    " + json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in daily)
    text = '(function () {\n  "use strict";\n\n  window.SITE_DAILY = [\n' + body + '\n  ];\n})();\n'
    with open(OUT_DAILY, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def write(result):
    lines = ["(function () {", '  "use strict";', "", "  var CATALOGS = {"]
    body = []
    for bid, name, unit, _, _, _ in BOOKS:
        n, u, rows = result[bid]
        rs = ",\n".join("        " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
        body.append(
            "    %s: {\n      name: %s,\n      src: %s,\n      unit: %s,\n      rows: [\n%s\n      ]\n    }"
            % (bid, json.dumps(n, ensure_ascii=False), json.dumps(bid + "s"), json.dumps(u, ensure_ascii=False), rs)
        )
    lines.append(",\n".join(body))
    lines.append("  };")
    lines.append("")
    lines.append("  var ORDER = " + json.dumps([b[0] for b in BOOKS]) + ";")
    lines.append("")
    lines.append("  window.SITE_CATALOGS = CATALOGS;")
    lines.append("  window.SITE_CATALOG_ORDER = ORDER;")
    lines.append("})();")
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def write_texts(texts):
    lines = ["(function () {", '  "use strict";', "", "  window.SITE_TEXTS = {"]
    body = []
    for bid in [b[0] for b in BOOKS if b[0] in texts]:
        rs = ",\n".join("      " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in texts[bid])
        body.append("    %s: [\n%s\n    ]" % (bid, rs))
    lines.append(",\n".join(body))
    lines.append("  };")
    lines.append("})();")
    with open(TEXTS_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    res, texts = build()
    write(res)
    write_texts(texts)
    tx, tn = tongxin_notes(TONG)
    write_tongxin(tx, tn)
    print("tongxin 正文", len(tx), "注释", len(tn))
    for bid, name, unit, _, _, _ in BOOKS:
        print(bid, name, len(res[bid][2]), len(texts.get(bid, [])))
