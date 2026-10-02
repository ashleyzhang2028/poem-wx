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

function renderNode(n, a, bodyNodes, data, out) {
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
        bodyNodes, d, out);
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
    out.push(`<div data-tag="slider" class="n-slider ${cls}"><div class="n-slider-fill" style="width:${pc}%"></div><div class="n-slider-knob" style="left:${pc}%"></div></div>`);
    return;
  }
  if (n.tag === "switch") {
    const on = interp(a.checked || "false", v) === "true";
    out.push(`<div data-tag="switch" class="n-switch ${on ? "on" : ""} ${cls}"><div class="n-switch-k"></div></div>`);
    return;
  }
  if (n.tag === "radio" || n.tag === "checkbox") {
    const on = interp(a.checked || "false", v) === "true";
    const dis = interp(a.disabled || "false", v) === "true";
    out.push(`<div data-tag="${n.tag}" class="n-${n.tag} ${on ? "on" : ""} ${dis ? "dis" : ""} ${cls}">${on && n.tag === "checkbox" ? "✓" : ""}</div>`);
    return;
  }

  let inner = "";
  if (!n.self && !VOID.has(n.tag)) {
    const buf = [];
    render(bodyNodes, data, buf);
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
