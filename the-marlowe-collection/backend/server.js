import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import pkg from 'pg';

const { Pool } = pkg;

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const explicitSsl = process.env.DATABASE_SSL;
const isProduction = ((process.env.NODE_ENV || '').toLowerCase() === 'production') || Boolean(process.env.RENDER);
const DEFAULT_LOCAL_DB = 'postgresql://localhost:5432/marlowe_collection';
const DATABASE_URL = process.env.DATABASE_URL || (!isProduction ? DEFAULT_LOCAL_DB : '');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not configured. Set it in the environment so the server can reach PostgreSQL.');
  process.exit(1);
}

const useSSL = typeof explicitSsl === 'string'
  ? explicitSsl.toLowerCase() === 'true'
  : isProduction;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'change-me';
const ADMIN_COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || process.env.SESSION_NAME || 'marlowe_admin';
const ADMIN_SESSION_TTL_MS = Number.parseInt(process.env.ADMIN_SESSION_TTL_MS || process.env.ADMIN_SESSION_TTL || `${1000 * 60 * 60 * 8}`, 10);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

const INVENTORY_SELECT = `
  SELECT
    sku,
    name,
    category,
    supplier,
    notes,
    price_retail AS "priceRetail",
    price_contractor AS "priceContractor",
    qty_available AS "qtyAvailable",
    reorder_point AS "reorderPoint"
  FROM inventory
  ORDER BY name COLLATE "C"
`;

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function mapInventoryRow(row) {
  if (!row) {
    return row;
  }
  return {
    ...row,
    priceRetail: Number(row.priceRetail),
    priceContractor: Number(row.priceContractor),
    qtyAvailable: Number(row.qtyAvailable),
    reorderPoint: Number(row.reorderPoint)
  };
}

function mapInventoryRows(rows = []) {
  return rows.map(mapInventoryRow);
}

function normalizeInventoryPayload(payload = {}, { requireSku = true } = {}) {
  const errors = [];

  const sku = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  if (requireSku && !sku) {
    errors.push('SKU is required.');
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    errors.push('Name is required.');
  }

  const category = typeof payload.category === 'string' ? payload.category.trim() : '';
  const supplier = typeof payload.supplier === 'string' ? payload.supplier.trim() : '';
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';

  const priceRetail = Number.parseFloat(payload.priceRetail);
  if (!Number.isFinite(priceRetail) || priceRetail < 0) {
    errors.push('Retail price must be a non-negative number.');
  }

  const priceContractor = Number.parseFloat(payload.priceContractor);
  if (!Number.isFinite(priceContractor) || priceContractor < 0) {
    errors.push('Contractor price must be a non-negative number.');
  }

  const qtyAvailable = Number.parseInt(payload.qtyAvailable, 10);
  if (!Number.isFinite(qtyAvailable) || qtyAvailable < 0) {
    errors.push('Quantity available must be a non-negative integer.');
  }

  const reorderPointRaw = payload.reorderPoint;
  let reorderPoint = null;
  if (reorderPointRaw === '' || reorderPointRaw === null || reorderPointRaw === undefined) {
    reorderPoint = 0;
  } else {
    const parsed = Number.parseInt(reorderPointRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push('Reorder point must be a non-negative integer.');
    } else {
      reorderPoint = parsed;
    }
  }

  return {
    errors,
    item: {
      sku: sku || undefined,
      name,
      category: category || null,
      supplier: supplier || null,
      notes: notes || null,
      priceRetail: Number.isFinite(priceRetail) && priceRetail >= 0 ? priceRetail : undefined,
      priceContractor: Number.isFinite(priceContractor) && priceContractor >= 0 ? priceContractor : undefined,
      qtyAvailable: Number.isFinite(qtyAvailable) && qtyAvailable >= 0 ? qtyAvailable : undefined,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint >= 0 ? reorderPoint : 0
    }
  };
}

class InventoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
    this.details = details;
  }
}

async function seedInventoryFromFile() {
  const seedPath = path.resolve('backend', 'inventory.json');
  if (!fs.existsSync(seedPath)) {
    return;
  }
  const raw = fs.readFileSync(seedPath, 'utf8');
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertText = `
      INSERT INTO inventory (sku, name, category, supplier, notes, price_retail, price_contractor, qty_available, reorder_point)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (sku) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        supplier = EXCLUDED.supplier,
        notes = EXCLUDED.notes,
        price_retail = EXCLUDED.price_retail,
        price_contractor = EXCLUDED.price_contractor,
        qty_available = EXCLUDED.qty_available,
        reorder_point = EXCLUDED.reorder_point;
    `;
    for (const row of items) {
      const qtyAvailable = Number.isFinite(row.qtyAvailable) ? row.qtyAvailable : Number.parseInt(row.qtyAvailable, 10) || 0;
      const reorderPoint = Number.isFinite(row.reorderPoint) ? row.reorderPoint : Number.parseInt(row.reorderPoint, 10) || 0;
      await client.query(insertText, [
        row.sku,
        row.name,
        row.category || null,
        row.supplier || null,
        row.notes || null,
        Number(row.priceRetail) || 0,
        Number(row.priceContractor) || 0,
        qtyAvailable,
        reorderPoint
      ]);
    }
    await client.query('COMMIT');
    console.log(`Seeded inventory database with ${items.length} items.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to seed inventory database:', err);
  } finally {
    client.release();
  }
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      sku TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      supplier TEXT,
      notes TEXT,
      price_retail NUMERIC NOT NULL,
      price_contractor NUMERIC NOT NULL,
      qty_available INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER DEFAULT 0
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM inventory');
  if (rows[0].count === 0) {
    await seedInventoryFromFile();
  }
}

async function reserveInventory(client, items) {
  const reserved = [];
  for (const { sku, qty } of items) {
    const { rows } = await client.query(
      `SELECT sku, name, category, supplier, notes, price_retail AS "priceRetail", price_contractor AS "priceContractor", qty_available AS "qtyAvailable", reorder_point AS "reorderPoint"
       FROM inventory WHERE sku = $1 FOR UPDATE`,
      [sku]
    );
    const current = rows[0];
    if (!current) {
      throw new InventoryError('NOT_FOUND', `Item with SKU ${sku} could not be found.`, { sku });
    }
    const availableQty = Number(current.qtyAvailable);
    if (!Number.isFinite(availableQty) || availableQty < qty) {
      throw new InventoryError(
        'INSUFFICIENT_STOCK',
        `Not enough stock for SKU ${sku}. Requested ${qty}, only ${availableQty} available.`,
        { sku, requested: qty, available: Number.isFinite(availableQty) ? availableQty : 0 }
      );
    }
    await client.query('UPDATE inventory SET qty_available = qty_available - $1 WHERE sku = $2', [qty, sku]);
    const priceRetail = Number(current.priceRetail);
    const priceContractor = Number(current.priceContractor);
    const reorderPoint = Number(current.reorderPoint);
    reserved.push({
      ...current,
      priceRetail: Number.isFinite(priceRetail) ? priceRetail : 0,
      priceContractor: Number.isFinite(priceContractor) ? priceContractor : 0,
      qtyAvailable: Number.isFinite(availableQty) ? availableQty - qty : 0,
      reorderPoint: Number.isFinite(reorderPoint) ? reorderPoint : 0,
      qty
    });
  }
  return reserved;
}

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.static('frontend'));
// Simple in-memory token store for contractor sessions (MVP)
const contractorSessions = new Set();
const adminSessions = new Map();

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) {
    return {};
  }
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) {
      return acc;
    }
    const key = decodeURIComponent(part.slice(0, index).trim());
    const value = decodeURIComponent(part.slice(index + 1).trim());
    if (key) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function getAdminToken(req) {
  const cookies = parseCookies(req);
  return cookies[ADMIN_COOKIE_NAME];
}

function getAdminSession(req) {
  const token = getAdminToken(req);
  if (!token) {
    return null;
  }
  const session = adminSessions.get(token);
  if (!session) {
    return null;
  }
  const ttl = Number.isFinite(ADMIN_SESSION_TTL_MS) && ADMIN_SESSION_TTL_MS > 0 ? ADMIN_SESSION_TTL_MS : null;
  if (ttl && Date.now() - session.createdAt > ttl) {
    adminSessions.delete(token);
    return null;
  }
  return { ...session, token };
}

function createAdminSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const record = { username, createdAt: Date.now() };
  adminSessions.set(token, record);
  return { token, record };
}

function destroyAdminSession(token) {
  if (token) {
    adminSessions.delete(token);
  }
}

function requireAdmin(req, res, next) {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Admin authentication required' });
  }
  req.adminUser = session.username;
  req.adminToken = session.token;
  return next();
}

app.get('/api/admin/session', (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    return res.json({ ok: false });
  }
  return res.json({ ok: true, admin: { username: session.username } });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Missing username or password' });
  }

  const isUserValid = timingSafeEqual(username, ADMIN_USER);
  const isPasswordValid = timingSafeEqual(password, ADMIN_PASSWORD);

  if (!isUserValid || !isPasswordValid) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const { token, record } = createAdminSession(ADMIN_USER);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  };
  if (Number.isFinite(ADMIN_SESSION_TTL_MS) && ADMIN_SESSION_TTL_MS > 0) {
    cookieOptions.maxAge = ADMIN_SESSION_TTL_MS;
  }
  res.cookie(ADMIN_COOKIE_NAME, token, cookieOptions);
  return res.json({ ok: true, admin: { username: record.username } });
});

app.post('/api/admin/logout', (req, res) => {
  const token = getAdminToken(req);
  destroyAdminSession(token);
  res.clearCookie(ADMIN_COOKIE_NAME, {
    sameSite: 'lax',
    secure: isProduction,
    httpOnly: true
  });
  return res.json({ ok: true });
});

app.get('/api/admin/inventory', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(INVENTORY_SELECT);
    return res.json({ ok: true, items: mapInventoryRows(rows) });
  } catch (error) {
    console.error('Failed to load inventory for admin:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load inventory' });
  }
});

app.post('/api/admin/inventory', requireAdmin, async (req, res) => {
  const { errors, item } = normalizeInventoryPayload(req.body, { requireSku: true });
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, error: errors.join(' ') });
  }

  try {
    const insertQuery = `
      INSERT INTO inventory (sku, name, category, supplier, notes, price_retail, price_contractor, qty_available, reorder_point)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING sku, name, category, supplier, notes, price_retail AS "priceRetail", price_contractor AS "priceContractor", qty_available AS "qtyAvailable", reorder_point AS "reorderPoint";
    `;
    const values = [
      item.sku,
      item.name,
      item.category,
      item.supplier,
      item.notes,
      item.priceRetail,
      item.priceContractor,
      item.qtyAvailable,
      item.reorderPoint
    ];
    const { rows } = await pool.query(insertQuery, values);
    return res.status(201).json({ ok: true, item: mapInventoryRow(rows[0]) });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'An item with this SKU already exists.' });
    }
    console.error('Failed to create inventory item:', error);
    return res.status(500).json({ ok: false, error: 'Unable to create inventory item' });
  }
});

app.put('/api/admin/inventory/:sku', requireAdmin, async (req, res) => {
  const sku = (req.params.sku || '').trim();
  if (!sku) {
    return res.status(400).json({ ok: false, error: 'SKU is required.' });
  }

  const { errors, item } = normalizeInventoryPayload(req.body, { requireSku: false });
  if (req.body && typeof req.body.sku === 'string' && req.body.sku.trim() && req.body.sku.trim() !== sku) {
    return res.status(400).json({ ok: false, error: 'SKU in payload does not match URL parameter.' });
  }

  if (errors.length > 0) {
    return res.status(400).json({ ok: false, error: errors.join(' ') });
  }

  try {
    const updateQuery = `
      UPDATE inventory
      SET name = $1,
          category = $2,
          supplier = $3,
          notes = $4,
          price_retail = $5,
          price_contractor = $6,
          qty_available = $7,
          reorder_point = $8
      WHERE sku = $9
      RETURNING sku, name, category, supplier, notes, price_retail AS "priceRetail", price_contractor AS "priceContractor", qty_available AS "qtyAvailable", reorder_point AS "reorderPoint";
    `;
    const values = [
      item.name,
      item.category,
      item.supplier,
      item.notes,
      item.priceRetail,
      item.priceContractor,
      item.qtyAvailable,
      item.reorderPoint,
      sku
    ];
    const { rows } = await pool.query(updateQuery, values);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item not found.' });
    }
    return res.json({ ok: true, item: mapInventoryRow(rows[0]) });
  } catch (error) {
    console.error('Failed to update inventory item:', error);
    return res.status(500).json({ ok: false, error: 'Unable to update inventory item' });
  }
});

app.delete('/api/admin/inventory/:sku', requireAdmin, async (req, res) => {
  const sku = (req.params.sku || '').trim();
  if (!sku) {
    return res.status(400).json({ ok: false, error: 'SKU is required.' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM inventory WHERE sku = $1', [sku]);
    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Item not found.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete inventory item:', error);
    return res.status(500).json({ ok: false, error: 'Unable to delete inventory item' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, code } = req.body || {};
  const ACCESS = process.env.CONTRACTOR_ACCESS_CODE || 'contractor';
  if(!email || !code) return res.status(400).json({ ok:false, error:'Missing email or code' });
  if(code === ACCESS){
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    contractorSessions.add(token);
    return res.json({ ok:true, token });
  }
  return res.status(401).json({ ok:false, error:'Invalid code' });
});

// serve inventory
app.get('/api/inventory', async (req,res)=>{
  try{
    const { rows } = await pool.query(INVENTORY_SELECT);
    res.json(mapInventoryRows(rows));
  }catch(e){
    console.error('Inventory load error:', e);
    res.status(500).json({ok:false, error:'Inventory not available'});
  }
});

app.get('/database', (req, res) => {
  try {
    const invPath = path.resolve('backend', 'inventory.json');
    const raw = fs.readFileSync(invPath, 'utf8');
    const inventory = JSON.parse(raw);

    const rows = inventory.map(item => `
      <tr>
        <td>${item.sku}</td>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${item.supplier || ''}</td>
        <td>${item.notes || ''}</td>
        <td>$${Number(item.priceRetail).toFixed(2)}</td>
        <td>$${Number(item.priceContractor).toFixed(2)}</td>
        <td>${item.qtyAvailable}</td>
        <td>${item.reorderPoint ?? ''}</td>
      </tr>
    `).join('');

    res.send(`<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Marlowe Collection Inventory</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { margin-bottom: 16px; }
            table { border-collapse: collapse; width: 100%; max-width: 1200px; }
            th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
            th { background: #f4f4f4; }
            tr:nth-child(even) { background: #fafafa; }
            .notice { margin-bottom: 12px; color: #555; }
          </style>
        </head>
        <body>
          <h1>The Marlowe Collection – Inventory</h1>
          <p class="notice">This view is generated directly from <code>backend/inventory.json</code>.</p>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Supplier</th>
                <th>Notes</th>
                <th>Retail Price</th>
                <th>Contractor Price</th>
                <th>Qty Available</th>
                <th>Reorder Point</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="9">No inventory data.</td></tr>'}
            </tbody>
          </table>
        </body>
      </html>`);
  } catch (e) {
    console.error('Inventory load error:', e);
    res.status(500).send('Unable to load inventory.');
  }
});

// create PDF PO
function makePO({company,name,email,phone,address,po,tier,items}){
  return new Promise((resolve,reject)=>{
    const doc = new PDFDocument({margin:40});
    const chunks=[];
    doc.on('data', c=>chunks.push(c));
    doc.on('end', ()=> resolve(Buffer.concat(chunks)));

    // Branding
    try { doc.image(path.join('frontend','marlowe-logo.png'), 40, 30, {width: 120}); } catch(e){}
    doc.fontSize(18).text('Purchase Order – The Marlowe Collection', {align:'right'});
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Date: ${new Date().toLocaleString()}`, {align:'right'});
    doc.moveDown();

    doc.fontSize(14).text('The Marlowe Collection', {continued:false});
    doc.fontSize(10).text('Quick Order — Mobile');
    doc.moveDown();
    doc.fontSize(11).text('Bill To:');
    doc.text(`${company || ''}`);
    doc.text(`${name || ''}`);
    doc.text(`${email || ''}`);
    doc.text(`${phone || ''}`);
    doc.text(`${address || ''}`);
    doc.moveDown();
    if(po) doc.text(`PO / Job #: ${po}`);
    doc.text(`Pricing Tier: ${tier}`);
    doc.moveDown();

    doc.moveTo(40, doc.y+5).lineTo(550, doc.y+5).stroke();
    doc.moveDown(0.5);

    let subtotal = 0;
    items.forEach(it=>{
      const price = tier==='contractor' ? it.priceContractor : it.priceRetail;
      const line = price * it.qty;
      subtotal += line;
      doc.fontSize(10);
      doc.text(`${it.name} (SKU ${it.sku})`, 40);
      doc.text(`Qty: ${it.qty}  @ $${price.toFixed(2)}  = $${line.toFixed(2)}`);
      doc.moveDown(0.25);
    });

    const tax = subtotal*0.0925;
    const total = subtotal+tax;
    doc.moveDown();
    doc.fontSize(12).text(`Subtotal: $${subtotal.toFixed(2)}`);
    doc.text(`Tax (9.25%): $${tax.toFixed(2)}`);
    doc.text(`Total: $${total.toFixed(2)}`);

    doc.moveDown();
    doc.fontSize(10).text('Thank you! We will confirm availability and send an invoice link for remote payment.', {align:'left'});

    doc.end();
  });
}

// email order
app.post('/api/order', async (req,res)=>{
  try{
    const {company,name,email,phone,address,po,tier,items,authToken} = req.body || {};
    if(!email || !name){
      return res.status(400).json({ok:false, error:'Missing name or email'});
    }
    if(!Array.isArray(items) || items.length===0){
      return res.status(400).json({ok:false, error:'Order must include at least one item'});
    }

    const aggregated = new Map();
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem.sku !== 'string') {
        return res.status(400).json({ ok:false, error:'Invalid item payload' });
      }
      const normalizedSku = rawItem.sku.trim();
      const qty = Number.parseInt(rawItem.qty, 10);
      if (!normalizedSku || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ ok:false, error:`Invalid quantity for SKU ${rawItem.sku}` });
      }
      aggregated.set(normalizedSku, (aggregated.get(normalizedSku) || 0) + qty);
    }
    const normalizedItems = Array.from(aggregated.entries()).map(([sku, qty]) => ({ sku, qty }));

    if(tier === 'contractor'){
      if(!authToken || !contractorSessions.has(authToken)){
        return res.status(403).json({ ok:false, error:'Contractor login required' });
      }
    }

    const client = await pool.connect();
    let reservedItems;
    try {
      await client.query('BEGIN');
      reservedItems = await reserveInventory(client, normalizedItems);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof InventoryError) {
        return res.status(400).json({ ok:false, error: error.message, code: error.code, details: error.details });
      }
      throw error;
    } finally {
      client.release();
    }

    const pdf = await makePO({company,name,email,phone,address,po,tier,items: reservedItems});

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const toOwner = process.env.OWNER_EMAIL || 'owner@example.com';
    const subject = `New Order — The Marlowe Collection — ${name} (${company || 'N/A'})`;

    await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: [toOwner, email],
      subject,
      text: `New order received for The Marlowe Collection. PO attached. Contact: ${name} (${email}, ${phone}).`,
      attachments: [{ filename: `PO_${Date.now()}.pdf`, content: pdf }]
    });

    const { rows: updatedRows } = await pool.query(INVENTORY_SELECT);
    const inventory = mapInventoryRows(updatedRows);

    res.json({ok:true, inventory});
  }catch(err){
    console.error(err);
    res.status(500).json({ok:false, error: err.message});
  }
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, ()=>{
      console.log('Server running on http://localhost:'+PORT);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    if (!explicitSsl && isProduction) {
      console.error('Hint: Managed Postgres providers like Render require TLS. Set DATABASE_SSL=true.');
    }
    process.exit(1);
  });
