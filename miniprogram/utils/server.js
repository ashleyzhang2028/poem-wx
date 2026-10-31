const CLOUD = {
  env: "poem-d9g1bqeq978682c58",
  service: "poem-wx"
};

function cloud() {
  if (!CLOUD.env || !CLOUD.service) return null;
  return { env: CLOUD.env, service: CLOUD.service };
}

module.exports = { cloud };
