"use strict";

const VOID = new Set(["image", "input", "import", "include", "icon", "progress", "slot", "checkbox", "radio", "switch", "slider"]);

function tokenize(src) {
  const res = [];

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

  const safe = String(s).replace(/\{\{([\s\S]*?)\}\}/g, (m, e) =>
    "{{" + e.replace(/"/g, "\\u0022").replace(/'/g, "\\u0027") + "}}");
  const re = /([\w:.-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(safe))) {
    if (!m[1] || m[1] === "wx") continue;
    a[m[1]] = m[2] === undefined ? "" : m[2];
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
        if (!stack.length) return j;
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

      k = chain[chain.length - 1].end + 1;
      continue;
    }
    if (a["wx:else"] !== undefined || a["wx:elif"] !== undefined) { k = end + 1; continue; }

    renderNode(n, a, nodes.slice(k + 1, end), data, out);
    k = end + 1;
  }
}

function multiPicker(checkedExpr, v) {
  if (!checkedExpr) return null;
  const src = String(checkedExpr).replace(/^\{\{|\}\}$/g, "").trim();

  const m = /([A-Za-z_$][\w$.]*)\s*\.\s*indexOf\s*\(\s*[\w$.]*\b(key|id)\b/.exec(src);
  if (!m) return null;
  const list = v(m[1]);
  if (!Array.isArray(list)) return null;
  const prop = m[2];
  return (it) => !!it && list.indexOf(it[prop]) >= 0;
}

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

let IMAGE_INTRINSIC = null;
function setImageIntrinsic(fn) { IMAGE_INTRINSIC = fn; }

function renderNode(n, a, bodyNodes, data, out, pickOf) {

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

        pickOf ? pickOf(it) : undefined);
    });
    return;
  }
  const v = makeVal(data);
  const cls = a.class ? interp(a.class, v).replace(/\s+/g, " ").trim() : "";
  const style = a.style ? interp(a.style, v) : "";

  if (n.tag === "image") {
    let extra = "";
    if (IMAGE_INTRINSIC && IMAGE_INTRINSIC(cls)) extra = "height:auto;aspect-ratio:4/3;";
    out.push(`<div data-tag="image" class="n-image ${cls}" style="${extra}${style}"></div>`);
    return;
  }
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

      renderMembers(bodyNodes, data, buf, multiPicker(findCheckedAttr(bodyNodes), v));
    } else {
      render(bodyNodes, data, buf);
    }
    inner = buf.join("");
  }

  if (n.tag === "block") { out.push(inner); return; }
  out.push(`<div data-tag="${n.tag}" class="${cls}" style="${style}">${inner}</div>`);
}

function compile(wxml, data) {

  const out = [];
  render(tokenize(wxml), data, out);
  return out.join("");
}

module.exports = { compile, setImageIntrinsic };
