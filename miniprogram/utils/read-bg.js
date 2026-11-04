const store = require("./store");

const LIST = [
  { id: "", name: "素白", color: "#ffffff" },
  { id: "paper", name: "米黄", color: "#f6efdc" },
  { id: "parchment", name: "羊皮", color: "#eadfc2" },
  { id: "green", name: "豆沙绿", color: "#cce8cf" },
  { id: "blue", name: "雾蓝", color: "#dce8f0" }
];

function find(id) {
  return LIST.filter((x) => x.id === id)[0] || LIST[0];
}

function current() {
  return find(store.settings().readBg).id;
}

function style() {
  return "--bg:" + find(current()).color + ";";
}

function pick(id) {
  const hit = find(id);
  store.saveSettings({ readBg: hit.id });
  return hit.id;
}

module.exports = { LIST, current, style, pick };
