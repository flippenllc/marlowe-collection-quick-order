# The Marlowe Collection – Quick Order Backend

This project powers the quick-order experience for The Marlowe Collection. It now persists inventory in PostgreSQL and automatically decrements stock levels when orders are submitted.

## Prerequisites

- Node.js 18+
- PostgreSQL 13+

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

   > The development container cannot reach the public npm registry. Run the command on your local machine if the install fails in Codespaces or a similar sandbox.

2. Create a PostgreSQL database and update the connection string in `.env` based on [`env.example`](./env.example).
   - Deployments on Render (or any managed provider that enforces TLS) must also set `DATABASE_SSL=true`.

3. Copy the sample environment file and adjust values as needed:

   ```bash
   cp env.example .env
   ```

4. Start the server:

   ```bash
   npm start
   ```

   The API listens on `http://localhost:3000` by default.

## Database

- On startup the server will create an `inventory` table if it does not exist.
- If the table is empty, the existing `backend/inventory.json` seed data is imported automatically.
- Inventory can be managed directly in the database (via SQL clients, admin panels, etc.).

## API Highlights

- `GET /api/inventory` — returns the current inventory list from PostgreSQL.
- `POST /api/order` — validates stock, decrements inventory inside a transaction, generates a PDF purchase order, and emails confirmations. The response includes the refreshed inventory snapshot so the UI can stay in sync.

## Contractor Access

The contractor tier requires a one-time login code that is tracked in-memory per server process. Update `CONTRACTOR_ACCESS_CODE` in `.env` to control access.

## Email

Outgoing mail is handled via Nodemailer using the SMTP settings in `.env`. The same credentials are used to send both the internal notification and customer copy of each purchase order.
