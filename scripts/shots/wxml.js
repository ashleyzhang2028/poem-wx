"use strict";
/**
 * 极简 WXML → HTML：只够预览用。
 * 支持 wx:if / wx:elif / wx:else、wx:for（含 wx:for-item / wx:for-index）、
 * {{}} 插值、class/style、原生控件的外观近似。
 */
const VOID = new Set(["image", "input", "import", "include", "icon", "progress", "slot", "checkbox", "radio", "switch", "slider"]);

function tokenize(src) {
  const res = [];
  // 属性值里的 {{ }} 可能含 < 或 >（三元表达式里的比较），
  // 直接正则会被截断，所以先把 {{...}} 换成不含尖括号的占位
  const holes = [];
  src = src.replace(/\{\{([\s\S]*?)\}\}/g, (m, e) => {
    holes.push(e);
    return "\u0001" + (holes.length - 1) + "\u0002";
  });
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>'"])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[5] !== undefined) { res.push({ kind: "text", text: m[5] }); continue; }
    res.push({ kind: "tag", close: !!m[1], tag: m[2], raw: m[3] || "", self: !!m[4] });
  }
  HOLES = holes;
  return res;
}

let HOLES = [];
function makeValFor(d) { return makeVal(d); }
function holeRestore(str) {
  return String(str).replace(/\u0001(\d+)\u0002/g, (_, i) => "{{" + HOLES[Number(i)] + "}}");
}

function attrsOf(s) {
  const a = {};
  // 属性值里的 {{ }} 可能自带引号（三元），先用安全字面量替掉再解析
  const safe = String(s).replace(/\{\{([\s\S]*?)\}\}/g, (m, e) =>
    "{{" + e.replace(/"/g, "\\u0022").replace(/'/g, "\\u0027") + "}}");
  const re = /([\w:.-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(safe))) {
    if (!m[1] || m[1] === "wx") continue;
    a[m[1]] = m[2] === undefined ? "" : m[2];   // wx:else 这类没有值
  }
  Object.keys(a).forEach((k) => {
    a[k] = a[k].replace(/\\u0022/g, '"').replace(/\\u0027/g, "'");
  });
  return a;
}

function makeVal(d) {
  const ks = Object.keys(d);
  const vals = ks.map((k) => d[k]);
  let fn = null;
  try { fn = new Function(...ks, "return (arguments[0]);"); } catch (e) { fn = null; }
  return (expr) => {
    const e = String(expr).replace(/^\{\{|\}\}$/g, "").trim();
    if (!e) return undefined;
    try { return new Function(...ks, "return (" + e + ")")(...vals); } catch (err) { return undefined; }
  };
}

function interp(str, v) {
  return String(str).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const r = v(e);
    if (r === undefined || r === null) return "";
    return String(r);
  });
}

/** 找到 tag 节点 n 的配对结束下标（返回结束标签的下标），输入是下标 */
function matchEnd(nodes, start) {
  const n = nodes[start];
  if (n.self || VOID.has(n.tag)) return start;
  const stack = [n.tag];
  for (let j = start + 1; j < nodes.length; j++) {
    const t = nodes[j];
    if (t.kind !== "tag") continue;
    if (t.close) {
      if (t.tag === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) return j;       // 与 n 配对的那个
      }
    } else if (!t.self && !VOID.has(t.tag)) {
      stack.push(t.tag);
    }
  }
  return nodes.length;
}

function render(nodes, data, out) {
  const v = makeVal(data);
  let k = 0;
  while (k < nodes.length) {
    const n = nodes[k];
    if (n.kind === "text") { out.push(interp(holeRestore(n.text), makeValFor(data))); k++; continue; }
    if (n.close) { k++; continue; }

    const a = attrsOf(holeRestore(n.raw));
    const end = matchEnd(nodes, k);


    // ---------- 条件链 ----------
    if (a["wx:if"] !== undefined) {
      const chain = [{ node: n, idx: k, end, attrs: a }];
      let p = end + 1;
      while (p < nodes.length) {
        const probe = nodes[p];
        if (probe.kind !== "tag" || probe.close) {
          if (probe.kind === "text" && !probe.text.trim()) { p++; continue; }
          break;
        }
        const na = attrsOf(holeRestore(probe.raw));
        if (na["wx:elif"] === undefined && na["wx:else"] === undefined) break;
        const e2 = matchEnd(nodes, p);
        chain.push({ node: probe, idx: p, end: e2, attrs: na });
        p = e2 + 1;
      }
      let chosen = null;
      for (const br of chain) {
        const cond = br.attrs["wx:if"] !== undefined ? !!v(br.attrs["wx:if"])
          : br.attrs["wx:elif"] !== undefined ? !!v(br.attrs["wx:elif"]) : true;
        if (cond) { chosen = br; break; }
      }
      if (chosen) renderNode(chosen.node, chosen.attrs, nodes.slice(chosen.idx + 1, chosen.end), data, out);
      // 只有真的挑中的那个分支才输出；其余分支整体跳过
      k = chain[chain.length - 1].end + 1;
      continue;
    }
    if (a["wx:else"] !== undefined || a["wx:elif"] !== undefined) { k = end + 1; continue; }

    renderNode(n, a, nodes.slice(k + 1, end), data, out);
    k = end + 1;
  }
}

/**
 * 可多选的一组（`<checkbox-group>`）在预览里补上真机的语义。
 *
 * 页面把一个格子写成
 *     <label class="chip multi {{pickedForms.indexOf(item.key) >= 0 ? 'on' : ''}}">
 *       <checkbox checked="{{pickedForms.indexOf(item.key) >= 0}}" />
 * 而 attrsOf 收进来的是一整串带三元与两个引号的值，这层极简求值算不出它
 * （interp 只会去 new Function 那条路，一失败就 undefined），于是每个格子
 * 都拿到 undefined → **一律画成勾上的**。截图里就是「五格全是选中的重色」，
 * 而真机上明明只勾了三格 —— 用户连着两轮问的就是这件事
 * （「怎么全部都是选中的重色」），**一半是产品，一半是这把尺子**。
 *
 * 与其在极简求值里堆语法支持，不如按平台语义补这一层：可多选的那一组里，
 * 被 bindchange 换出来的那份清单（`X.indexOf(item.key)` 里的 X）就是
 * 「勾了哪几个」的唯一出处，组内每格拿自己的 key 去比。
 *
 * 只认 `indexOf(<item>.<key|id>)` 这一种写法 —— 它是「这组里勾了我没有」
 * 在本项目里唯一的说法，认得窄一点反而不会误判别处的表达式。
 */
function multiPicker(checkedExpr, v) {
  if (!checkedExpr) return null;
  const src = String(checkedExpr).replace(/^\{\{|\}\}$/g, "").trim();
  // 两个都要：接收者是清单，参数是这一格的身份 —— `X.indexOf(item.key)`
  const m = /([A-Za-z_$][\w$.]*)\s*\.\s*indexOf\s*\(\s*[\w$.]*\b(key|id)\b/.exec(src);
  if (!m) return null;
  const list = v(m[1]);
  if (!Array.isArray(list)) return null;
  const prop = m[2];
  return (it) => !!it && list.indexOf(it[prop]) >= 0;
}

/** 在这一组子树里找多选清单写在哪 —— 也就是那处 checked="{{...}}" */
function findCheckedAttr(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind !== "tag") continue;
    const a = attrsOf(holeRestore(n.raw));
    if (a.checked) return a.checked;
    const deeper = findCheckedAttr(nodes.slice(i + 1, matchEnd(nodes, i)));
    if (deeper) return deeper;
  }
  return null;
}

/**
 * 渲染一组多选的成员。
 *
 * pickOf 是「这组清单 → 这一格勾没勾」的判据（multiPicker 给的）。
 * 往下传的是**函数**，不是某一格算好的结果：wx:for 要逐项去问它，
 * 每问一次才算那一格的勾。把某一格的结果沿调用链带下去会串味 ——
 * 组里第一格的勾会盖住后面几格。
 */
function renderMembers(nodes, data, out, pickOf) {
  let k = 0;
  while (k < nodes.length) {
    const n = nodes[k];
    if (n.kind === "text") { out.push(interp(holeRestore(n.text), makeVal(data))); k++; continue; }
    if (n.close) { k++; continue; }
    const end = matchEnd(nodes, k);
    renderNode(n, attrsOf(holeRestore(n.raw)), nodes.slice(k + 1, end), data, out, pickOf);
    k = end + 1;
  }
}

function renderNode(n, a, bodyNodes, data, out, pickOf) {
  // ---------- 列表 ----------
  if (a["wx:for"] !== undefined) {
    const v0 = makeVal(data);
    const list = v0(a["wx:for"]) || [];
    const itemName = a["wx:for-item"] || "item";
    const idxName = a["wx:for-index"] || "index";
    (Array.isArray(list) ? list : []).forEach((it, idx) => {
      const d = Object.assign({}, data);
      d[itemName] = it; d[idxName] = idx;
      renderNode(Object.assign({}, n, { raw: n.raw.replace(/\swx:for(?:-item|-index)?="[^"]*"/g, "") }),
        (() => { const c = Object.assign({}, a); delete c["wx:for"]; delete c["wx:for-item"]; delete c["wx:for-index"]; return c; })(),
        bodyNodes, d, out,
        // 一组多选里，「我勾上没有」由自己的 key 定 —— 见 multiPicker
        pickOf ? pickOf(it) : undefined);
    });
    return;
  }
  const v = makeVal(data);
  const cls = a.class ? interp(a.class, v).replace(/\s+/g, " ").trim() : "";
  const style = a.style ? interp(a.style, v) : "";

  if (n.tag === "image") { out.push(`<div data-tag="image" class="n-image ${cls}" style="${style}"></div>`); return; }
  if (n.tag === "input") {
    const ph = a.placeholder ? interp(a.placeholder, v) : "";
    const val = a.value ? interp(a.value, v) : "";
    const type = a.type || "text";
    out.push(`<div data-tag="input" class="n-input ${cls} ${type === "nickname" ? "n-nick" : ""}" style="${style}">${val ? `<span>${val}</span>` : `<span class="n-ph">${ph}</span>`}</div>`);
    return;
  }
  if (n.tag === "slider") {
    const mn = Number(interp(a.min || "0", v)) || 0;
    const mx = Number(interp(a.max || "100", v)) || 100;
    const val = Number(interp(a.value || "0", v)) || 0;
    const pc = mx > mn ? Math.max(0, Math.min(100, ((val - mn) / (mx - mn)) * 100)) : 0;
    // 滑条把「滑轨本体」单独包一层（.n-slider-track）：
    // 真机上 <slider> 的宽度由 flex 分配，而滑轨两端还要给圆钮留半颗身位
    // （否则最左/最右那半颗钮会戳出容器）。预览若把滑轨直接画在 .n-slider 上，
    // 量出来的「滑轨宽」就是容器宽，比真机多半颗钮 —— measure 会算错一行放不放得下。
    // 两端内缩用 CSS 变量 --n-slider-inset（默认 10px = 半颗钮），
    // 由 shoot/measure 按 block-size 覆盖。
    // 原生控件的 color / activeColor / block-color 取不到 WXSS 变量，
    // 页面只能从 WXML 给字面量（主题色就是这么传的）。
    // 预览若忽略它们，滑条永远画成墨黑 —— 截图会说谎：
    // 「选了天青但滑条还是黑的」会被当成 bug，其实是这把尺子没跟上。
    const active = a.activeColor ? interp(a.activeColor, v) : "";
    const blockC = a["block-color"] ? interp(a["block-color"], v) : "";
    const fillStyle = active ? `background:${active};` : "";
    const knobStyle = blockC ? `background:${blockC};` : "";
    out.push(`<div data-tag="slider" class="n-slider ${cls}"><div class="n-slider-track"><div class="n-slider-fill" style="width:${pc}%;${fillStyle}"></div><div class="n-slider-knob" style="left:${pc}%;${knobStyle}"></div></div></div>`);
    return;
  }
  if (n.tag === "switch") {
    const on = interp(a.checked || "false", v) === "true";
    const c = a.color ? interp(a.color, v) : "";
    const onStyle = c ? `background:${c};` : "";
    out.push(`<div data-tag="switch" class="n-switch ${on ? "on" : ""} ${cls}" style="${onStyle}"><div class="n-switch-k"></div></div>`);
    return;
  }
  if (n.tag === "radio" || n.tag === "checkbox") {
    // 多选组里的勾以组给的那份清单为准（见 multiPicker）；
    // 别处仍照页面写的表达式算 —— 那些都是直接的比较。
    const on = typeof pickOf === "boolean"
      ? pickOf
      : interp(a.checked || "false", v) === "true";
    const dis = interp(a.disabled || "false", v) === "true";
    const c = a.color ? interp(a.color, v) : "";
    const cStyle = c && on ? (n.tag === "checkbox" ? `background:${c};border-color:${c};` : `border-color:${c};`) : "";
    out.push(`<div data-tag="${n.tag}" class="n-${n.tag} ${on ? "on" : ""} ${dis ? "dis" : ""} ${cls}" style="${cStyle}">${on && n.tag === "checkbox" ? "✓" : ""}</div>`);
    return;
  }

  let inner = "";
  if (!n.self && !VOID.has(n.tag)) {
    const buf = [];
    if (n.tag === "checkbox-group") {
      // 进了这一组：把那份清单先认出来，换成「这个 key 勾没勾」的判据往下带
      renderMembers(bodyNodes, data, buf, multiPicker(findCheckedAttr(bodyNodes), v));
    } else {
      render(bodyNodes, data, buf);
    }
    inner = buf.join("");
  }
  // 带 hover-class 的元素，预览里标记一下，截图时能看出可点区
  // <block> 是片段不是盒子，直接吐内层
  if (n.tag === "block") { out.push(inner); return; }
  out.push(`<div data-tag="${n.tag}" class="${cls}" style="${style}">${inner}</div>`);
}

function compile(wxml, data) {
  // 简单模板：{{ }} 里如果有 > 或 < 会被 tokenizer 破坏，这里先做占位替换
  const out = [];
  render(tokenize(wxml), data, out);
  return out.join("");
}

module.exports = { compile };
