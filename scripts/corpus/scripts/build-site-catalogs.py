import json
import os
import sys

from opencc import OpenCC

DATA = os.environ.get("POETRY_DATA") or sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "site-catalogs.js")
T2S = OpenCC("t2s")

BOOKS = [
    ("tangshi300", "唐诗三百首", "首", "唐", ("tag", "唐诗三百首", ["唐/诗/全唐诗"])),
    ("songci300", "宋词三百首", "首", "宋", ("tag", "宋词三百首", ["宋/宋词"])),
    ("gwgz", "古文观止", "篇", "", ("outline", "汇编/古文观止/古文观止·选目.json")),
    ("wenxuan", "昭明文选", "篇", "", ("dirs", ["汇编/昭明文选"])),
    ("yuefuji", "乐府诗集", "首", "", ("dirs", ["汇编/乐府诗集"])),
    ("huajianji", "花间集", "首", "五代十国", ("dirs", ["五代十国/词/五代诗词/huajianji"])),
    ("chuci", "楚辞", "篇", "先秦", ("files", ["先秦/楚辞/chuci.json"])),
    ("shijing", "诗经", "篇", "先秦", ("files", ["先秦/诗经/shijing.json"])),
    ("sishu", "四书", "篇", "先秦", ("files", ["先秦/论语/lunyu.json", "先秦/孟子/mengzi.json", "先秦/大学/daxue.json", "先秦/中庸/zhongyong.json"])),
    ("jingzhuan", "经传选", "篇", "先秦", ("files", ["先秦/文/" + n + ".json" for n in ["liji", "zhouli", "zhouyi", "shangshu", "gongyangzhuan", "guliangzhuan", "chunqiuguliangzhuan"]])),
    ("daodejing", "道德经", "章", "先秦", ("files", ["先秦/文/daodejing.json"])),
    ("zhuangzi", "庄子", "篇", "先秦", ("files", ["先秦/文/zhuangzi.json"])),
    ("zhuzi", "诸子选", "篇", "先秦", ("files", ["先秦/文/" + n + ".json" for n in ["xunzi", "mozi", "guanzi", "hanfeizi", "guiguzi", "lushichunqiu", "yanzichunqiu"]])),
    ("zuozhuan", "左传", "篇", "先秦", ("files", ["先秦/文/zuozhuan.json"])),
    ("bingfa", "兵法", "篇", "先秦", ("files", ["先秦/文/sunzibingfa.json", "先秦/文/sanshiliuji.json"])),
    ("shanhaijing", "山海经", "篇", "先秦", ("files", ["先秦/文/shanhaijing.json"])),
    ("sanguo", "三国演义", "则", "明", ("files", ["明/小说/三国演义/sanguoyanyi.json"])),
    ("shuihu", "水浒传", "回", "明", ("files", ["明/小说/水浒传/shuihuzhuan.json"])),
    ("xiyou", "西游记", "回", "明", ("files", ["明/小说/西游记/xiyouji.json"])),
    ("honglou", "红楼梦", "回", "清", ("files", ["清/小说/红楼梦/hongloumeng.json"])),
    ("rulin", "儒林外史", "回", "清", ("files", ["清/小说/儒林外史/rulinwaishi.json"])),
    ("jinghua", "镜花缘", "回", "清", ("files", ["清/小说/镜花缘/jinghuayuan.json"])),
    ("fengshen", "封神演义", "回", "明", ("files", ["明/小说/封神演义/fengshenyanqi.json"])),
    ("dongzhou", "东周列国志", "回", "明", ("files", ["明/小说/东周列国志/dongzhoulieguozhi.json"])),
    ("yushi", "喻世明言", "篇", "明", ("files", ["明/小说/三言二拍/yushimingyan.json"])),
    ("jingshi", "警世通言", "篇", "明", ("files", ["明/小说/三言二拍/jingshitongyan.json"])),
    ("erke", "二刻拍案惊奇", "篇", "明", ("files", ["明/小说/三言二拍/erkipaianjingqi.json"])),
    ("liaozhai", "聊斋志异", "篇", "清", ("files", ["清/小说/聊斋志异/liaozhaizhiyi.json"])),
    ("yuewei", "阅微草堂笔记", "卷", "清", ("files", ["清/小说/阅微草堂笔记/yueweicaotangbiji.json"])),
    ("fusheng", "浮生六记", "卷", "清", ("files", ["清/小说/浮生六记/fushengliuji.json"])),
    ("taoan", "陶庵梦忆", "篇", "明", ("files", ["明/小说/陶庵梦忆/taoanzhmyi.json"])),
    ("yuchu", "虞初新志", "篇", "清", ("files", ["清/小说/虞初新志/yuchuxinzhi.json"])),
    ("xiaochuang", "小窗幽记", "卷", "明", ("files", ["明/小说/小窗幽记/xiaochuangyouji.json"])),
    ("rongzhai", "容斋随笔", "卷", "宋", ("files", ["宋/小说/容斋随笔/rongzhaishuibi.json"])),
    ("soushen", "搜神记", "卷", "晋", ("files", ["晋/小说/搜神记/soushenji.json"])),
]

DAILY_MAX_CHARS = 64
DAILY_MAX_ROWS = 800
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


def collect(kind):
    mode = kind[0]
    if mode == "files":
        return [r for rel in kind[1] for r in records(rel)]
    if mode == "dirs":
        return [r for d in kind[1] for rel in json_files(d) for r in records(rel)]
    if mode == "tag":
        return [r for d in kind[2] for rel in json_files(d) for r in records(rel) if kind[1] in (r.get("tags") or [])]
    out = []
    for e in load(kind[1]):
        rel, _, rid = e["记录"].partition("#")
        hit = [r for r in records(rel) if r.get("id") == rid]
        if hit:
            out.append(hit[0])
    return out


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


def build_daily():
    base = os.path.join(HAITANG)
    quotes = {str(x["work_id"]) for x in load(base + "/quotes.json")}
    collection_works = load(base + "/collection_works.json")
    textbook = {c["name"] for c in load(base + "/collections.json") if c.get("kind") == "课本"}
    familiar = set()
    for cw in collection_works:
        if cw["collection"] in FAMILIAR or cw["collection"] in textbook:
            familiar.add(str(cw["work_id"]))
    wanted = []
    for n in range(1, 9):
        for w in load(base + "/works_%d.json" % n):
            if str(w["id"]) in quotes and str(w["id"]) not in familiar and w.get("kind") in ("shi", "ci"):
                if han_count({"paragraphs": w.get("content") or ""}) <= DAILY_MAX_CHARS:
                    wanted.append(w)

    chars = set()
    texts = []
    for rel, r in all_records():
        text = paragraphs_text(r)
        texts.append((rel, r, text))
        chars.update(ch for ch in text if "一" <= ch <= "鿿")
    for w in wanted:
        chars.update(ch for ch in w["content"] if "一" <= ch <= "鿿")
    cmap = {ch: T2S.convert(ch) for ch in chars}

    by_content = {}
    by_title = {}
    for rel, r, text in texts:
        k = row(r)
        by_title[k] = by_title.get(k, 0) + 1
        if han_count(r) <= DAILY_MAX_CHARS:
            by_content.setdefault(han_key(text, cmap), []).append(r)

    out = []
    seen = set()
    for w in wanted:
        hits = by_content.get(han_key(w["content"], cmap), [])
        if len(hits) != 1:
            continue
        t, a = row(hits[0])
        if not t or not a or by_title.get((t, a)) != 1 or (t, a) in seen:
            continue
        seen.add((t, a))
        out.append([t, a, w.get("dynasty") or "", "名句"])
    step = len(out) / float(DAILY_MAX_ROWS) if len(out) > DAILY_MAX_ROWS else 1
    return [out[int(i * step)] for i in range(min(len(out), DAILY_MAX_ROWS))]


def build():
    result = {}
    for bid, name, unit, dynasty, kind in BOOKS:
        seen = set()
        rows = []
        for r in collect(kind):
            t, a = row(r)
            if not t or (t, a) in seen:
                continue
            seen.add((t, a))
            rows.append([t, a, dynasty])
        result[bid] = (name, unit, rows)
    return result, build_daily()


def write_daily(daily):
    body = ",\n".join("    " + json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in daily)
    text = '(function () {\n  "use strict";\n\n  window.SITE_DAILY = [\n' + body + '\n  ];\n})();\n'
    with open(OUT_DAILY, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def write(result):
    lines = ["(function () {", '  "use strict";', "", "  var CATALOGS = {"]
    body = []
    for bid, name, unit, _, _ in BOOKS:
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


if __name__ == "__main__":
    res, daily = build()
    write(res)
    write_daily(daily)
    print("daily", len(daily))
    for bid, name, unit, _, _ in BOOKS:
        print(bid, name, len(res[bid][2]))
