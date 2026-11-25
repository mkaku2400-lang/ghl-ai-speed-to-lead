# GoHighLevel AI Speed-to-Lead (n8n + Gemini)

Every new lead is read, rated and set up for a call-back in GoHighLevel within seconds, so the
hot ones get a call while they are still waiting by the phone.

When a lead comes in (website form or a GoHighLevel workflow webhook), an n8n workflow:

1. Asks an AI model to rate it **hot / warm / cold / spam**, name the service, set urgency, write a one-line
   summary, say why, and draft a short reply.
2. Creates or updates the **contact** in GoHighLevel with tags (`ai-hot`, `urgent`, `furnace-repair`, ...).
3. Adds an **AI note** to the contact: summary, reason, next step, their message and the reply draft.
4. Puts the lead in the matching **pipeline stage** (spam is kept out of the pipeline).
5. For hot leads, creates a **call-back task** due within the hour.

The demo runs for a fictional home services company (Northside Heating & Plumbing, Columbus, Ohio).
All names, emails and phone numbers in the sample data are made up.

```
Website form ───────┐
                    ├─> Clean up ─> Qualify (AI) ─> Build record ─> GHL contact ─> GHL note ─> Real lead? ─> GHL pipeline ─> Hot? ─> GHL task
GHL workflow hook ──┘                  │
                                    Gemini
```

## Results on the five sample leads

| Lead | AI rating | Service | What happens in GoHighLevel |
|---|---|---|---|
| AC not cooling, 84 degrees inside, newborn at home | hot, urgent | ac repair | Hot stage + call-back task |
| 18-year-old furnace, wants replacement options | warm | furnace replacement | Warm stage, reply asks the scoping questions |
| "How much to clean a kitchen drain?" | cold | drain cleaning | Cold stage, short honest reply, free estimate offer |
| "#1 on Google Maps for $99" | spam | other | Tagged `ai-spam`, kept out of the pipeline |
| Property manager, leaking water heater, needs it before Friday | hot, urgent | water heater | Hot stage + call-back task |

## Guardrails

- The prompt allows only facts from the lead: no invented prices, arrival times or availability.
- Replies never promise a time slot. They say a team member will call to set one.
- The AI output must match a JSON schema with fixed values; a code step checks it again and falls back to `warm`.
- Reply drafts are saved as notes for a person to check. Nothing is texted or emailed to the lead automatically.
- A repeat lead (same phone or email) updates the existing contact and opportunity instead of failing.
- The GoHighLevel token and the Gemini key are stored as encrypted n8n credentials, not in the workflow file.

## Set it up

You need Node.js 20+, a running n8n (`npx n8n`), a free Gemini key (https://aistudio.google.com/apikey)
and a GoHighLevel sub-account.

1. **Pipeline in GoHighLevel.** Opportunities > Pipelines > Create pipeline, named `AI Speed-to-Lead`, with stages
   whose names start with `Hot`, `Warm`, `Cold` and `Spam` (for example "Hot - call today"). A "New lead" stage first is fine.
2. **Token.** Settings > Private Integrations > Create, with the scopes View/Edit Contacts and View/Edit Opportunities.
3. **.env.** Copy `.env.example` to `.env`, paste the token as `GHL_TOKEN`, and set `GHL_LOCATION_ID`
   (the part after `/location/` in your GoHighLevel address bar). Set `N8N_EMAIL`, `N8N_PASSWORD` and `GEMINI_API_KEY`
   in `.env` or your shell.
4. **Install the workflow:**
   ```powershell
   node scripts/setup_n8n.mjs
   ```
   It looks up the pipeline and stage IDs, saves both credentials in n8n, imports the workflow and publishes it.
5. **Try it:** open `http://localhost:5678/form/service-request`, or send the sample leads:
   ```powershell
   node scripts/send_sample_leads.mjs
   ```

### Using leads that already arrive in GoHighLevel

Make a GoHighLevel workflow with the trigger *Form Submitted* (or *Contact Created*) and the action *Webhook*,
POSTing to `https://<your n8n>/webhook/ghl-lead` with the contact fields (`first_name`, `last_name`, `email`,
`phone`, `message`, `contact_id`). n8n has to be reachable from the internet for this (n8n Cloud or a server).

## Adapting it for a business

- **Who the replies are from:** `BUSINESS` and `SIGN_OFF` at the top of the *Clean up the lead* node.
- **Ratings and reply rules:** the schema and system prompt in *Qualify the lead (AI)*.
- **What happens in GoHighLevel:** the four HTTP nodes (contact, note, pipeline, task). Easy to add a workflow
  enrollment, an internal SMS alert, or an owner assignment.
- **Model:** the *Gemini* node uses `gemini-3.5-flash-lite`. Any chat model n8n supports (OpenAI, Anthropic) can replace it.

## Files

| File | Purpose |
|---|---|
| `workflow/ghl_speed_to_lead.json` | The n8n workflow (IDs are filled in by the setup script) |
| `scripts/setup_n8n.mjs` | Finds the pipeline, saves credentials, imports and publishes the workflow |
| `scripts/send_sample_leads.mjs` | Sends the five sample leads to the webhook |
| `sample_data/sample_leads.json` | Five realistic test leads (fictional) |
| `.env.example` | Settings template |
