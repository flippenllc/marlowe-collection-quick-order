function openLoginModal(){
  document.getElementById('loginModal').style.display='block';
}

function closeLoginModal(){
  document.getElementById('loginModal').style.display='none';
}
let INVENTORY=[], CART=[];
let AUTH_TOKEN = localStorage.getItem('marlowe_auth') || null;

function isLoggedIn(){ return !!AUTH_TOKEN; }

function updateLoginBadge(){
  const badge = document.getElementById('loginBadge');
  if(!badge) return;
  badge.textContent = isLoggedIn() ? 'Signed in (contractor)' : '';
}

function showContractorOption(){
  const tierSel = document.getElementById('tier');
  const contractorOption = [...tierSel.options].find(o=>o.value==='contractor');
  if(!contractorOption) return;
  if(isLoggedIn()){
    contractorOption.disabled = false;
  }else{
    if(tierSel.value==='contractor') tierSel.value='retail';
    contractorOption.disabled = true;
  }
}

async function contractorSignIn(){
  const email = document.getElementById('loginEmail').value.trim();
  const code  = document.getElementById('loginCode').value.trim();
  if(!email || !code){ alert('Enter email and code'); return; }

  const res = await fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, code })
  });
  const data = await res.json();
  if(data.ok){
    AUTH_TOKEN = data.token;
    localStorage.setItem('marlowe_auth', AUTH_TOKEN);
    alert('Signed in as contractor.');
    document.querySelector('.signin').style.display='none';
    document.querySelector('.signout').style.display='inline-block';
    closeLoginModal();
    showContractorOption(); renderItems(); renderCart();
  }else{
    alert('Login failed: '+data.error);
  }
}

function contractorSignOut(){
  AUTH_TOKEN = null;
  localStorage.removeItem('marlowe_auth');
  alert('Signed out.');
  document.querySelector('.signin').style.display='inline-block';
  document.querySelector('.signout').style.display='none';
  showContractorOption(); renderItems(); renderCart();
}


async function loadInventory(){
  const res = await fetch('/api/inventory');
  INVENTORY = await res.json();
  const categories = [...new Set(INVENTORY.map(i=>i.category))].sort();
  const catSel = document.getElementById('category');
  catSel.innerHTML = '<option value="">All Categories</option>' + categories.map(c=>`<option>${c}</option>`).join('');
  renderItems();
}

function currency(n){return (Math.round(n*100)/100).toFixed(2)}

function filtered(){
  const q = document.getElementById('search').value.toLowerCase();
  const c = document.getElementById('category').value;
  return INVENTORY.filter(i=>{
    const matchQ = !q || (i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    const matchC = !c || i.category===c;
    return matchQ && matchC;
  });
}

function renderItems(){
  const tier = document.getElementById('tier').value;
  const arr = filtered();
  const wrap = document.getElementById('items');
  wrap.innerHTML = arr.map(i=>{
    const price = tier==='contractor' ? i.priceContractor : i.priceRetail;
    return `<div class="item">
      <div class="meta">
        <div class="name">${i.name}</div>
        <div class="price">SKU ${i.sku} · ${i.category} · $${currency(price)} ${tier==='contractor'?'(contractor)':'(retail)'} · In stock: ${i.qtyAvailable}</div>
      </div>
      <div class="qty">
        <input type="number" min="1" value="1" id="qty-${i.sku}" />
        <button onclick="addToCart('${i.sku}')">Add</button>
      </div>
    </div>`;
  }).join('');
}

function addToCart(sku){
  const item = INVENTORY.find(i=>i.sku===sku);
  const qty = parseInt(document.getElementById('qty-'+sku).value||'1',10);
  const existing = CART.find(c=>c.sku===sku);
  if(existing){ existing.qty += qty; } else {
    CART.push({sku:item.sku, name:item.name, priceRetail:item.priceRetail, priceContractor:item.priceContractor, qty});
  }
  renderCart();
}

function removeFromCart(sku){
  CART = CART.filter(c=>c.sku!==sku);
  renderCart();
}

function renderCart(){
  const tier = document.getElementById('tier').value;
  const cartDiv = document.getElementById('cart');
  if(CART.length===0){ cartDiv.innerHTML = '<p class="small">Cart is empty.</p>'; updateTotals(); return; }
  cartDiv.innerHTML = CART.map(c=>{
    const price = tier==='contractor'?c.priceContractor:c.priceRetail;
    return `<div class="row">
      <div class="left">
        <strong>${c.name}</strong>
        <span>SKU ${c.sku}</span>
      </div>
      <div>
        <input type="number" min="1" value="${c.qty}" onchange="updateQty('${c.sku}', this.value)" style="width:70px;text-align:center;margin-right:8px;" />
        x $${currency(price)} = $${currency(price*c.qty)}
        <button style="margin-left:8px" onclick="removeFromCart('${c.sku}')">Remove</button>
      </div>
    </div>`;
  }).join('');
  updateTotals();
}

function updateQty(sku,val){
  const it = CART.find(c=>c.sku===sku);
  it.qty = Math.max(1, parseInt(val||'1',10));
  renderCart();
}

function updateTotals(){
  const tier = document.getElementById('tier').value;
  let subtotal = 0;
  CART.forEach(c=>{
    const price = tier==='contractor'?c.priceContractor:c.priceRetail;
    subtotal += price*c.qty;
  });
  const tax = subtotal*0.0925;
  const total = subtotal+tax;
  document.getElementById('subtotal').textContent = currency(subtotal);
  document.getElementById('tax').textContent = currency(tax);
  document.getElementById('total').textContent = currency(total);
}

async function submitOrder(){
  const payload = {
    company: document.getElementById('company').value,
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    address: document.getElementById('address').value,
    po: document.getElementById('po').value,
    tier: document.getElementById('tier').value,
    items: CART,
    authToken: AUTH_TOKEN   // <— include token
  };
  const res = await fetch('/api/order', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(data.ok){
    alert('Order submitted! A confirmation email with PDF PO has been sent.');
    CART = [];
    renderCart();
  } else {
    alert('There was a problem submitting the order: '+data.error);
  }
}

document.getElementById('tier').addEventListener('change', ()=>{ renderItems(); renderCart(); });
document.getElementById('search').addEventListener('input', renderItems);
document.getElementById('category').addEventListener('change', renderItems);
document.getElementById('submitBtn').addEventListener('click', submitOrder);
document.getElementById('year').textContent = new Date().getFullYear();

loadInventory();
showContractorOption();
updateLoginBadge();
