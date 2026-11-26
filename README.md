# PAI — WhatsApp claim routing

Portfolio project for routing citizen-request PDFs to the right municipal area over WhatsApp (Baileys) or email. Operators upload a PDF, the app suggests a destination, and a backend session sends the file.

This repository does not contain credentials. Configuration lives in environment variables.

## Setup

1. Copy the template and fill in your own project values:

   ```bash
   cp .env.example .env
   ```

2. Create a Supabase project and run [`schema.sql`](schema.sql) in the SQL editor. Apply the `migration_*.sql` files if you need groups, the protocol banner, or SAC jobs.

3. In Supabase → Project Settings → API, copy the project URL, the `anon` key, and the `service_role` key into `.env`.

   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are the only Supabase values the browser may see.
   - `SUPABASE_SERVICE_ROLE_KEY` is server-only (Docker, the Node backend, `seed_subtypes.js`). Do not put it in Netlify build variables that are exposed to the client, and do not commit it.

4. Install and run locally (Node 18+):

   ```bash
   npm install
   npm install --prefix frontend
   npm run dev
   ```

   The Vite dev server reads the root `.env`. The UI calls the backend through `/api`, which the dev server proxies to `http://127.0.0.1:3001` (override with `VITE_API_PROXY`).

5. Start the backend with the same `.env` (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required):

   ```bash
   npm start
   ```

   `SESSION_ID` selects the WhatsApp session stored in Supabase. Scan the QR from the logs once.

## Static hosting

The published site is the Vite app in `frontend/`. On Netlify (see [`netlify.toml`](netlify.toml)):

- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build environment variables.
- Set `SUPABASE_URL` for the functions that resolve the backend from the storage registry.
- Set `SAC_AUTOMATION_TOKEN` only if you use the SAC proxy. The function injects it; the browser never sees it.

Without those variables the UI shows a configuration notice instead of calling a project baked into the source.

## Security notes

The `anon` key is public by design: anyone can extract it from the built site. Access must be limited by Row Level Security and storage policies, not by hiding the key. The policies in `schema.sql` allow the browser to read and write contacts, groups, shipments, and the `pdfs` bucket so the current UI works. Tighten those policies before storing real citizen data. Keep the `service_role` key out of git, issues, and the frontend.

Phone fields in the UI use the example number `5491100000000`. It is not a real line.

## More detail

Local Docker, tunnels, and the dashboard: [`docs/LOCAL_STACK.md`](docs/LOCAL_STACK.md).

Profile: https://github.com/CynarJulep
