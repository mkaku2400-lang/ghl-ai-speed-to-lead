// One-time setup for a local n8n: GoHighLevel + Gemini credentials and the workflow.
//
// Usage (n8n must be running):
//   1. Copy .env.example to .env and fill in GHL_TOKEN and GHL_LOCATION_ID.
//   2. node scripts/setup_n8n.mjs
//
// Other settings come from environment variables when set:
//   N8N_URL (default http://localhost:5678), N8N_EMAIL, N8N_PASSWORD, GEMINI_API_KEY,
//   N8N_LOGIN_FILE (a file with email=... and password=... lines), GEMINI_ENV_FILE (a .env with GEMINI_API_KEY).
//
// Safe to run again: the GHL credential and the workflow are replaced, the Gemini credential is reused.
// No secret is printed.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const WORKFLOW_FILE = path.join(ROOT, 'workflow', 'ghl_speed_to_lead.json');
const PIPELINE_NAME = process.env.GHL_PIPELINE_NAME || 'AI Speed-to-Lead';
const GHL_API = 'https://services.leadconnectorhq.com';

function fail(message) {
  console.error(`Setup stopped: ${message}`);
  process.exit(1);
}

async function readEnvFile(file) {
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const local = await readEnvFile(path.join(ROOT, '.env'));
const env = (key) => (process.env[key] || local[key] || '').trim();

const BASE = (env('N8N_URL') || 'http://localhost:5678').replace(/\/$/, '');
const GHL_TOKEN = env('GHL_TOKEN');
const LOCATION_ID = env('GHL_LOCATION_ID');
let EMAIL = env('N8N_EMAIL');
let PASSWORD = env('N8N_PASSWORD');
let GEMINI_API_KEY = env('GEMINI_API_KEY');

if (!EMAIL || !PASSWORD) {
  const login = await readEnvFile(env('N8N_LOGIN_FILE'));
  EMAIL ||= login.email || '';
  PASSWORD ||= login.password || '';
}
if (!GEMINI_API_KEY) GEMINI_API_KEY = ((await readEnvFile(env('GEMINI_ENV_FILE'))).GEMINI_API_KEY || '').trim();

if (!GHL_TOKEN) fail('put your GoHighLevel private integration token in .env as GHL_TOKEN.');
if (!LOCATION_ID) fail('put your GoHighLevel location (sub-account) ID in .env as GHL_LOCATION_ID.');
if (!EMAIL || !PASSWORD) fail('set N8N_EMAIL and N8N_PASSWORD (or N8N_LOGIN_FILE) to your n8n login.');

// 1. Find the pipeline and its stages in GoHighLevel.
const ghlRes = await fetch(`${GHL_API}/opportunities/pipelines?locationId=${encodeURIComponent(LOCATION_ID)}`, {
  headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
});
if (!ghlRes.ok) {
  fail(`GoHighLevel returned ${ghlRes.status} when reading pipelines. Check the token, its scopes (opportunities.readonly) and the location ID.`);
}
const pipelines = (await ghlRes.json()).pipelines || [];
const pipeline = pipelines.find((p) => p.name.trim().toLowerCase() === PIPELINE_NAME.toLowerCase());
if (!pipeline) fail(`no pipeline named "${PIPELINE_NAME}" in this GoHighLevel location. Create it first (see README).`);
const stageId = {};
for (const category of ['hot', 'warm', 'cold', 'spam']) {
  const stage = pipeline.stages.find((s) => s.name.trim().toLowerCase().startsWith(category));
  if (!stage) fail(`pipeline "${PIPELINE_NAME}" needs a stage whose name starts with "${category}".`);
  stageId[category] = stage.id;
}
console.log(`Found pipeline "${pipeline.name}" with stages for hot, warm, cold and spam`);

// 2. Log in to n8n and make a short-lived API key for this script.
let cookie = '';
async function call(method, url, body, { apiKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey;
  else if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && !apiKey) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) fail(`${method} ${url} returned ${res.status}: ${(data.message || text).slice(0, 300)}`);
  return data.data !== undefined && !Array.isArray(data) && Object.keys(data).length === 1 ? data.data : data;
}

await call('POST', '/rest/login', { emailOrLdapLoginId: EMAIL, password: PASSWORD });
const scopes = await call('GET', '/rest/api-keys/scopes');
const key = await call('POST', '/rest/api-keys', {
  label: `ghl setup script ${Date.now()}`,
  scopes,
  expiresAt: Date.now() + 60 * 60 * 1000,
});
const apiKey = key.rawApiKey || key.apiKey;
if (!apiKey) fail('n8n did not return an API key.');
const api = (method, url, body) => call(method, `/api/v1${url}`, body, { apiKey });

// 3. Credentials. Secrets are stored encrypted inside n8n, never in the workflow file.
const saved = await call('GET', '/rest/credentials');
const savedList = Array.isArray(saved) ? saved : [];

let gemini = savedList.find((c) => c.name === 'Gemini API' && c.type === 'googlePalmApi');
if (gemini) {
  console.log('Reusing the saved Gemini credential');
} else {
  if (!GEMINI_API_KEY) fail('set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey).');
  gemini = await api('POST', '/credentials', {
    name: 'Gemini API',
    type: 'googlePalmApi',
    data: { host: 'https://generativelanguage.googleapis.com', apiKey: GEMINI_API_KEY },
  });
  console.log('Saved the Gemini credential');
}

for (const old of savedList.filter((c) => c.name === 'GoHighLevel token' && c.type === 'httpHeaderAuth')) {
  await api('DELETE', `/credentials/${old.id}`);
}
const ghlCredential = await api('POST', '/credentials', {
  name: 'GoHighLevel token',
  type: 'httpHeaderAuth',
  data: { name: 'Authorization', value: `Bearer ${GHL_TOKEN}` },
});
console.log('Saved the GoHighLevel credential');

// 4. Workflow: fill in the IDs, replace any older copy, then publish it.
let text = await readFile(WORKFLOW_FILE, 'utf8');
const fill = {
  __GEMINI_CREDENTIAL_ID__: gemini.id,
  __GHL_CREDENTIAL_ID__: ghlCredential.id,
  __GHL_LOCATION_ID__: LOCATION_ID,
  __GHL_PIPELINE_ID__: pipeline.id,
  '__GHL_STAGE_ID:hot__': stageId.hot,
  '__GHL_STAGE_ID:warm__': stageId.warm,
  '__GHL_STAGE_ID:cold__': stageId.cold,
  '__GHL_STAGE_ID:spam__': stageId.spam,
};
for (const [placeholder, value] of Object.entries(fill)) text = text.split(placeholder).join(value);
const workflow = JSON.parse(text);

const existing = (await api('GET', '/workflows?limit=100')).data || [];
for (const old of existing.filter((w) => w.name === workflow.name)) {
  if (old.active) await api('POST', `/workflows/${old.id}/deactivate`);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}/api/v1/workflows/${old.id}`, { method: 'DELETE', headers: { 'X-N8N-API-KEY': apiKey } });
    if (res.ok || res.status === 404) break;
    if (res.status !== 409 || attempt === 15) fail(`could not remove the old workflow (${res.status}).`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const created = await api('POST', '/workflows', {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings,
});
await api('POST', `/workflows/${created.id}/activate`);

console.log(`\nWorkflow is live: ${BASE}/workflow/${created.id}`);
console.log(`Service form:      ${BASE}/form/service-request`);
console.log(`Webhook (POST):    ${BASE}/webhook/ghl-lead`);
