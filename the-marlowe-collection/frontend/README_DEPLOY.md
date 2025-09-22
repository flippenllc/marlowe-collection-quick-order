
# The Marlowe Collection — Quick Order (MVP)

## Local Setup
1) Install Node.js 18+
2) In project root, run:
   ```bash
   npm install
   cp .env.example .env
   # Fill in SMTP creds in .env
   npm run dev
   ```
3) Open http://localhost:3000 (on phone via your computer's LAN IP).

## Deploy
- Render.com or Railway: connect GitHub repo, set env vars from `.env.example`, start with `npm start`.

## Notes
- Inventory lives at `backend/inventory.json`.
- Tax is 7% in `/frontend/app.js` and `/backend/server.js`.
