import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const inventoryPath = path.resolve('backend', 'inventory.json');

function loadInventory() {
  const raw = fs.readFileSync(inventoryPath, 'utf8');
  return JSON.parse(raw);
}

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));
// Simple in-memory token store for contractor sessions (MVP)
const contractorSessions = new Set();

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
app.get('/api/inventory', (req,res)=>{
  try{
    res.json(loadInventory());
  }catch(e){
    console.error('Inventory load error:', e);
    res.status(500).json({ok:false, error:'Inventory not available'});
  }
});

app.post('/api/session/validate', (req, res) => {
  const { token } = req.body || {};
  if (token && contractorSessions.has(token)) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Session invalid' });
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
    const {company,name,email,phone,address,po,tier,items,authToken} = req.body;
    if(!email || !name || !Array.isArray(items) || items.length===0){
      return res.status(400).json({ok:false, error:'Missing name/email/items'});
    }
    const normalizedTier = tier === 'contractor' ? 'contractor' : 'retail';
    if(normalizedTier === 'contractor'){
      if(!authToken || !contractorSessions.has(authToken)){
        return res.status(403).json({ ok:false, error:'Contractor login required' });
      }
    }

    const inventory = loadInventory();
    const inventoryBySku = new Map(inventory.map(item => [item.sku, item]));
    const sanitizedItems = items.map((incoming) => {
      const sku = incoming && typeof incoming.sku === 'string' ? incoming.sku : null;
      const inv = sku ? inventoryBySku.get(sku) : undefined;
      const qty = Number(incoming?.qty);
      if(!inv){
        throw new Error(`Unknown SKU: ${sku || 'unspecified'}`);
      }
      if(!Number.isInteger(qty) || qty <= 0){
        throw new Error(`Invalid quantity for SKU ${inv.sku}`);
      }
      return {
        sku: inv.sku,
        name: inv.name,
        priceRetail: inv.priceRetail,
        priceContractor: inv.priceContractor,
        qty
      };
    });

    const pdf = await makePO({company,name,email,phone,address,po,tier: normalizedTier,items: sanitizedItems});

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

    res.json({ok:true});
  }catch(err){
    console.error(err);
    if (err.message && err.message.startsWith('Unknown SKU')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (err.message && err.message.startsWith('Invalid quantity')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ok:false, error: err.message});
  }
});

app.listen(PORT, ()=>{
  console.log('Server running on http://localhost:'+PORT);
});
