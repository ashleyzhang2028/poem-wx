const store = require("./store");
const auth = require("./auth");
const loginFlow = require("./login-flow");

const GUEST_GRADE = 1;

const PUBLIC_ACTIONS = [
  "browse-home",
  "browse-grade",
  "login",
  "about"
];

function logged() {
  return auth.logged();
}

function allow(action) {
  if (logged()) return true;
  return PUBLIC_ACTIONS.indexOf(action) >= 0;
}

function canRead() {
  return logged();
}

function guard(what, page, onPass) {
  return open(onPass, page);
}

function open(onPass, page) {
  if (logged()) {
    loginFlow.resume(page);
    if (onPass) onPass();
    return true;
  }
  loginFlow.after(onPass, page);
  loginFlow.start(page).catch(() => {});
  return false;
}

function cancel(page) {
  loginFlow.cancel(page);
}

function ask(page) {
  return loginFlow.askLogin(page).catch(() => null);
}

function resume(page) {
  return loginFlow.resume(page);
}

function grade() {
  if (!logged()) return GUEST_GRADE;
  return store.settings().grade;
}

module.exports = {
  GUEST_GRADE,
  PUBLIC_ACTIONS,
  logged,
  allow,
  canRead,
  guard,
  open,
  cancel,
  ask,
  resume,
  grade
};
