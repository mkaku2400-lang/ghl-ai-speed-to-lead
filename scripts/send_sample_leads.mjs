// Sends the sample leads to the workflow's webhook, one at a time.
// Usage: node scripts/send_sample_leads.mjs [index]   (index = 0..4 to send one lead only)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '') + '/webhook/ghl-lead';
const leads = JSON.parse(await readFile(path.join(HERE, '..', 'sample_data', 'sample_leads.json'), 'utf8'));
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : null;

for (const [i, lead] of leads.entries()) {
  if (only !== null && i !== only) continue;
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...lead, source: 'sample lead' }),
  });
  console.log(`${lead.name}: ${res.status}`);
  await new Promise((r) => setTimeout(r, 1500));
}
