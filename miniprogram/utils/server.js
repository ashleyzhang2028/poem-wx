/* 构建产物，不入库：值由构建期从环境变量注入（密钥仓库 wechat-ci.yml 的
   CLOUD_ENV / CLOUD_SERVICE，流水线里引）。本机没注入时两格为空，
   界面照实说「这个包还没配同步服务器」。 */
const CLOUD = {
  env: "",
  service: ""
};

function cloud() {
  if (!CLOUD.env || !CLOUD.service) return null;
  return { env: CLOUD.env, service: CLOUD.service };
}

module.exports = { cloud };
