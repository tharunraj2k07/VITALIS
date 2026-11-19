const urlArgument = process.argv.indexOf("--url");
if (urlArgument !== -1 && !process.argv[urlArgument + 1]) {
  throw new Error("Pass an API origin after --url.");
}
const argumentUrl = urlArgument === -1 ? undefined : process.argv[urlArgument + 1];
const baseUrl = (argumentUrl ?? process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  return response.json();
}

const health = await get("/api/health");
if (health.status !== "ok") throw new Error("Health check did not report ok.");

const crew = await get("/api/crew");
if (!Array.isArray(crew) || crew.length === 0 || !crew[0].id) throw new Error("Crew endpoint returned no usable crew members.");

const crewId = crew[0].id;
const [scores, observations, alerts, protocols] = await Promise.all([
  get(`/api/crew/${encodeURIComponent(crewId)}/scores?day=179`),
  get(`/api/crew/${encodeURIComponent(crewId)}/observations?from=0&to=0`),
  get(`/api/crew/${encodeURIComponent(crewId)}/alerts`),
  get("/api/protocols"),
]);
if (!Array.isArray(scores) || !Array.isArray(observations) || !Array.isArray(alerts) || !Array.isArray(protocols)) {
  throw new Error("A smoke-test endpoint returned an unexpected response shape.");
}
if (alerts.length > 0) await get(`/api/alerts/${encodeURIComponent(alerts[0].id)}/protocol`);

console.log(`VITALIS smoke test passed at ${baseUrl}: health, crew, scores, observations, alerts${alerts.length ? ", protocol" : ""}, protocols.`);
