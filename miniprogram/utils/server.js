const CLOUD = {
  env: "",
  service: ""
};

function cloud() {
  if (!CLOUD.env || !CLOUD.service) return null;
  return { env: CLOUD.env, service: CLOUD.service };
}

module.exports = { cloud };
