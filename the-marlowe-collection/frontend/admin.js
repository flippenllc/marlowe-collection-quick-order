(function(){
  const loginView = document.getElementById('loginView');
  const adminView = document.getElementById('adminView');
  const formCard = document.getElementById('formCard');
  const loginForm = document.getElementById('loginForm');
  const loginMessage = document.getElementById('loginMessage');
  const logoutButton = document.getElementById('adminLogout');
  const adminIdentity = document.getElementById('adminIdentity');
  const statusBar = document.getElementById('statusBar');
  const inventoryBody = document.getElementById('inventoryTableBody');
  const inventoryMeta = document.getElementById('inventoryMeta');
  const itemForm = document.getElementById('itemForm');
  const skuInput = document.getElementById('itemSku');
  const nameInput = document.getElementById('itemName');
  const categoryInput = document.getElementById('itemCategory');
  const supplierInput = document.getElementById('itemSupplier');
  const retailInput = document.getElementById('itemRetail');
  const contractorInput = document.getElementById('itemContractor');
  const qtyInput = document.getElementById('itemQty');
  const reorderInput = document.getElementById('itemReorder');
  const notesInput = document.getElementById('itemNotes');
  const resetFormBtn = document.getElementById('resetFormBtn');
  const deleteItemBtn = document.getElementById('deleteItemBtn');
  const saveItemBtn = document.getElementById('saveItemBtn');
  const formTitle = document.getElementById('formTitle');
  const footerYear = document.getElementById('year');

  const state = {
    inventory: [],
    editingSku: null
  };

  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }

  function setLoginMessage(message){
    if (!loginMessage) return;
    loginMessage.textContent = message || '';
  }

  function setStatus(message, type = 'info'){
    if (!statusBar) return;
    statusBar.textContent = message || '';
    if (!message) {
      statusBar.removeAttribute('data-type');
    } else {
      statusBar.setAttribute('data-type', type);
    }
  }

  function showLoginView(message){
    loginView.style.display = 'block';
    adminView.style.display = 'none';
    formCard.style.display = 'none';
    logoutButton.style.display = 'none';
    setStatus('');
    clearTable();
    inventoryMeta.textContent = '';
    setLoginMessage(message || '');
    itemForm.reset();
    state.editingSku = null;
    updateFormMode();
  }

  function showAdminView(username){
    loginView.style.display = 'none';
    adminView.style.display = 'block';
    formCard.style.display = 'block';
    logoutButton.style.display = 'inline-block';
    adminIdentity.textContent = username || 'admin';
    setLoginMessage('');
  }

  function updateFormMode(){
    if (state.editingSku){
      formTitle.textContent = 'Edit Inventory Item';
      saveItemBtn.textContent = 'Update Item';
      skuInput.value = state.editingSku;
      skuInput.setAttribute('readonly', 'readonly');
      deleteItemBtn.disabled = false;
    } else {
      formTitle.textContent = 'Add Inventory Item';
      saveItemBtn.textContent = 'Add Item';
      skuInput.removeAttribute('readonly');
      deleteItemBtn.disabled = true;
    }
  }

  function clearTable(){
    inventoryBody.innerHTML = '';
  }

  function formatCurrency(value){
    const amount = Number(value);
    return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '$0.00';
  }

  function formatInteger(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function renderInventory(){
    clearTable();
    if (!state.inventory.length){
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 10;
      cell.textContent = 'No inventory items yet.';
      row.appendChild(cell);
      inventoryBody.appendChild(row);
      inventoryMeta.textContent = 'No inventory records';
      return;
    }

    state.inventory.forEach((item)=>{
      const row = document.createElement('tr');

      const skuCell = document.createElement('td');
      skuCell.textContent = item.sku;
      row.appendChild(skuCell);

      const nameCell = document.createElement('td');
      nameCell.textContent = item.name;
      row.appendChild(nameCell);

      const categoryCell = document.createElement('td');
      categoryCell.textContent = item.category || '';
      row.appendChild(categoryCell);

      const supplierCell = document.createElement('td');
      supplierCell.textContent = item.supplier || '';
      row.appendChild(supplierCell);

      const retailCell = document.createElement('td');
      retailCell.textContent = formatCurrency(item.priceRetail);
      row.appendChild(retailCell);

      const contractorCell = document.createElement('td');
      contractorCell.textContent = formatCurrency(item.priceContractor);
      row.appendChild(contractorCell);

      const qtyCell = document.createElement('td');
      qtyCell.textContent = formatInteger(item.qtyAvailable);
      row.appendChild(qtyCell);

      const reorderCell = document.createElement('td');
      reorderCell.textContent = formatInteger(item.reorderPoint || 0);
      row.appendChild(reorderCell);

      const notesCell = document.createElement('td');
      notesCell.className = 'notes-cell';
      notesCell.textContent = item.notes || '';
      row.appendChild(notesCell);

      const actionCell = document.createElement('td');
      actionCell.className = 'action-cell';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'table-button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => startEdit(item.sku));
      actionCell.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'table-button danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => confirmAndDelete(item.sku));
      actionCell.appendChild(deleteBtn);

      row.appendChild(actionCell);
      inventoryBody.appendChild(row);
    });

    const count = state.inventory.length;
    inventoryMeta.textContent = `${count} item${count === 1 ? '' : 's'}`;
  }

  function populateForm(item){
    state.editingSku = item.sku;
    skuInput.value = item.sku;
    nameInput.value = item.name || '';
    categoryInput.value = item.category || '';
    supplierInput.value = item.supplier || '';
    retailInput.value = item.priceRetail ?? '';
    contractorInput.value = item.priceContractor ?? '';
    qtyInput.value = formatInteger(item.qtyAvailable);
    reorderInput.value = formatInteger(item.reorderPoint || 0);
    notesInput.value = item.notes || '';
    updateFormMode();
    skuInput.focus();
  }

  function resetForm(event){
    if (event) event.preventDefault();
    itemForm.reset();
    state.editingSku = null;
    updateFormMode();
  }

  function collectFormData(){
    const sku = skuInput.value.trim();
    const name = nameInput.value.trim();
    if (!sku || !name){
      setStatus('SKU and name are required.', 'error');
      return null;
    }

    const priceRetail = Number.parseFloat(retailInput.value);
    if (!Number.isFinite(priceRetail) || priceRetail < 0){
      setStatus('Retail price must be a non-negative number.', 'error');
      return null;
    }

    const priceContractor = Number.parseFloat(contractorInput.value);
    if (!Number.isFinite(priceContractor) || priceContractor < 0){
      setStatus('Contractor price must be a non-negative number.', 'error');
      return null;
    }

    const qtyAvailable = Number.parseInt(qtyInput.value, 10);
    if (!Number.isFinite(qtyAvailable) || qtyAvailable < 0){
      setStatus('Quantity must be a non-negative integer.', 'error');
      return null;
    }

    const reorderRaw = reorderInput.value.trim();
    let reorderPoint = 0;
    if (reorderRaw){
      const parsed = Number.parseInt(reorderRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 0){
        setStatus('Reorder point must be a non-negative integer.', 'error');
        return null;
      }
      reorderPoint = parsed;
    }

    return {
      sku,
      name,
      category: categoryInput.value.trim(),
      supplier: supplierInput.value.trim(),
      notes: notesInput.value.trim(),
      priceRetail,
      priceContractor,
      qtyAvailable,
      reorderPoint
    };
  }

  async function apiFetch(url, options = {}){
    const config = { credentials: 'include', ...options };
    if (config.body && !(config.headers && (config.headers['Content-Type'] || config.headers['content-type']))){
      config.headers = { ...(config.headers || {}), 'Content-Type': 'application/json' };
    }
    const response = await fetch(url, config);
    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    if (!response.ok){
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function handleLogin(event){
    event.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    if (!username || !password){
      setLoginMessage('Enter both username and password.');
      return;
    }
    try {
      await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      showAdminView(username);
      resetForm();
      setStatus('Signed in successfully.', 'success');
      await loadInventory({ quiet: true });
    } catch (error) {
      console.error('Admin login failed:', error);
      setLoginMessage(error.message || 'Unable to sign in.');
    }
  }

  async function handleLogout(){
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      console.error('Admin logout error:', error);
    }
    showLoginView();
  }

  async function loadInventory(options = {}){
    const quiet = Boolean(options.quiet);
    try {
      const data = await apiFetch('/api/admin/inventory');
      state.inventory = Array.isArray(data.items) ? data.items : [];
      renderInventory();
      if (!quiet){
        if (state.inventory.length){
          setStatus('Inventory loaded.', 'success');
        } else {
          setStatus('Inventory is currently empty.', 'info');
        }
      }
    } catch (error) {
      console.error('Failed to load inventory:', error);
      state.inventory = [];
      renderInventory();
      setStatus(error.message || 'Unable to load inventory.', 'error');
    }
  }

  function startEdit(sku){
    const item = state.inventory.find((row) => row.sku === sku);
    if (!item){
      setStatus('Item could not be found for editing.', 'error');
      return;
    }
    populateForm(item);
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function confirmAndDelete(sku){
    const item = state.inventory.find((row) => row.sku === sku);
    const label = item ? `${item.name} (${item.sku})` : sku;
    const ok = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/inventory/${encodeURIComponent(sku)}`, { method: 'DELETE' });
      setStatus(`Deleted ${label}.`, 'success');
      if (state.editingSku === sku){
        resetForm();
      }
      await loadInventory({ quiet: true });
    } catch (error) {
      console.error('Failed to delete item:', error);
      setStatus(error.message || 'Unable to delete item.', 'error');
    }
  }

  async function handleFormSubmit(event){
    event.preventDefault();
    const payload = collectFormData();
    if (!payload) return;
    try {
      if (state.editingSku){
        await apiFetch(`/api/admin/inventory/${encodeURIComponent(state.editingSku)}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        setStatus(`Updated ${payload.name}.`, 'success');
      } else {
        await apiFetch('/api/admin/inventory', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setStatus(`Added ${payload.name}.`, 'success');
      }
      await loadInventory({ quiet: true });
      resetForm();
    } catch (error) {
      console.error('Failed to save inventory item:', error);
      setStatus(error.message || 'Unable to save item.', 'error');
    }
  }

  async function checkSession(){
    try {
      const response = await fetch('/api/admin/session', { credentials: 'include' });
      if (!response.ok){
        throw new Error('Session check failed');
      }
      const data = await response.json();
      if (data && data.ok){
        const username = data.admin && data.admin.username ? data.admin.username : 'admin';
        showAdminView(username);
        await loadInventory();
      } else {
        showLoginView();
      }
    } catch (error) {
      console.error('Unable to verify admin session:', error);
      showLoginView('Please sign in to continue.');
    }
  }

  function bindEvents(){
    loginForm.addEventListener('submit', handleLogin);
    logoutButton.addEventListener('click', handleLogout);
    itemForm.addEventListener('submit', handleFormSubmit);
    resetFormBtn.addEventListener('click', resetForm);
    deleteItemBtn.addEventListener('click', () => {
      if (!state.editingSku) return;
      confirmAndDelete(state.editingSku);
    });
  }

  function init(){
    updateFormMode();
    bindEvents();
    checkSession();
  }

  init();
})();
