/* 部署方在打包时把云调用两栏写在这儿 —— 用户开箱即用，不必自己去管理页填。
   两格空着 = 这个包没配服务器，登录与课外正文如实说不就绪。
   用户在「我的 → 同步服务器」填过则以本机那份为准（见 utils/remote.js 的 cloudOf）。 */
const CLOUD = {
  env: "poem-d9g1bqeq978682c58",
  service: "poem-wx"
};

function cloud() {
  if (!CLOUD.env || !CLOUD.service) return null;
  return { env: CLOUD.env, service: CLOUD.service };
}

module.exports = { cloud };
