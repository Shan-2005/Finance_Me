/* ==========================================================================
   FINANCE ME - Real Data Management & Supabase Cloud Integration
   ========================================================================== */

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
let SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG'; 

// Load Real User Transactions from LocalStorage as fallback
let transactions = JSON.parse(localStorage.getItem('finance_me_transactions') || '[]');
let lastParsedTransaction = null;
let currentAppVersion = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Set default date input to today
  const dateInput = document.getElementById('inputDate');
  if (dateInput) dateInput.valueAsDate = new Date();
  
  // Render local state immediately for instant feedback
  renderTransactions();
  updateMetricsAndTaxonomy();

  // Sync with Supabase cloud database
  fetchTransactionsFromSupabase();

  // Start background auto-update check (polls every 30s)
  checkAutoUpdate();
  setInterval(checkAutoUpdate, 30000);
});

// Fetch Real Transactions from Supabase Database
function fetchTransactionsFromSupabase() {
  if (!SUPABASE_KEY) return;

  fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*&order=date.desc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  })
  .then(res => res.json())
  .then(data => {
    if (Array.isArray(data)) {
      transactions = data;
      saveToLocalStorage();
      renderTransactions();
      console.log('[Supabase Cloud Sync]: Loaded', data.length, 'transactions');
    }
  })
  .catch(err => console.log('[Supabase Sync]: Using local offline data', err));
}

// Automatic Version Check to force fresh code on Git push without manual hard refresh
function checkAutoUpdate() {
  fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      if (data && data.version) {
        if (!currentAppVersion) {
          currentAppVersion = data.version;
        } else if (currentAppVersion !== data.version) {
          console.log('[Auto-Update]: New Git build detected! Refreshing assets...');
          window.location.reload(true);
        }
      }
    })
    .catch(err => console.log('[Auto-Update Check]: Local offline mode'));
}

// Save to LocalStorage for persistent real user data
function saveToLocalStorage() {
  localStorage.setItem('finance_me_transactions', JSON.stringify(transactions));
}

// Switch Main Navigation Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(`tab-${tabId}`);
  const targetNav = document.getElementById(`nav-${tabId}`);

  if (targetTab) targetTab.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
}

// Aspect Ratio Switcher for Mobile Simulation
function setDeviceRatio(mode, btnElement) {
  const frame = document.getElementById('deviceFrame');
  document.querySelectorAll('.ratio-btn').forEach(btn => btn.classList.remove('active'));
  btnElement.classList.add('active');

  frame.className = `device-frame mode-${mode}`;
}

// Category Icon & Color Mapping
function getCategoryMeta(category) {
  switch (category) {
    case 'Fixed Needs':
      return { icon: 'fa-house', bg: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4' };
    case 'Variable Wants':
      return { icon: 'fa-bag-shopping', bg: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e' };
    case 'Investments':
      return { icon: 'fa-chart-line', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' };
    case 'Income':
      return { icon: 'fa-wallet', bg: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' };
    default:
      return { icon: 'fa-tag', bg: 'rgba(255, 255, 255, 0.1)', color: '#94a3b8' };
  }
}

// Render Transactions List (Module 2 Dashboard)
function renderTransactions() {
  const container = document.getElementById('txnContainer');
  const searchInput = document.getElementById('searchInput');
  const catFilterInput = document.getElementById('categoryFilter');

  const searchQuery = searchInput ? searchInput.value.toLowerCase() : '';
  const catFilter = catFilterInput ? catFilterInput.value : 'ALL';

  const filtered = transactions.filter(t => {
    const matchesSearch = (t.merchant || '').toLowerCase().includes(searchQuery) ||
                          (t.notes || '').toLowerCase().includes(searchQuery) ||
                          (t.tags || []).some(tag => tag.toLowerCase().includes(searchQuery));
    const matchesCat = (catFilter === 'ALL') || (t.category === catFilter);
    return matchesSearch && matchesCat;
  });

  const txnCountText = document.getElementById('txnCountText');
  if (txnCountText) {
    txnCountText.innerText = transactions.length === 0 
      ? '0 transactions logged' 
      : `Showing ${filtered.length} of ${transactions.length} real items`;
  }

  if (transactions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-color); border-radius: 20px;">
        <i class="fa-solid fa-wallet" style="font-size: 40px; color: var(--primary-emerald); margin-bottom: 12px;"></i>
        <h4 style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px;">No Real Transactions Logged Yet</h4>
        <p style="font-size: 12px; color: var(--text-muted); max-width: 280px; margin: 0 auto 16px auto; line-height: 1.4;">
          Your Supabase database is connected! Add an entry manually or trigger a GPay notification to begin tracking.
        </p>
        <button class="btn" onclick="openAddModal()">
          <i class="fa-solid fa-plus"></i> Add First Real Transaction
        </button>
      </div>
    `;
    updateMetricsAndTaxonomy();
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p style="font-size: 13px;">No transactions match your search filter.</p>
      </div>
    `;
    updateMetricsAndTaxonomy();
    return;
  }

  container.innerHTML = filtered.map(t => {
    const meta = getCategoryMeta(t.category);
    const formattedAmount = `₹${parseFloat(t.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const tagBadges = (t.tags || []).map(tag => `<span class="txn-tag">${tag}</span>`).join(' ');

    return `
      <div class="txn-item">
        <div class="txn-left">
          <div class="txn-category-icon" style="background: ${meta.bg}; color: ${meta.color};">
            <i class="fa-solid ${meta.icon}"></i>
          </div>
          <div class="txn-details">
            <span class="txn-merchant">${t.merchant}</span>
            <div class="txn-meta">
              <span>${t.date}</span> • 
              <span>${t.mode}</span>
              ${tagBadges ? `• ${tagBadges}` : ''}
            </div>
            ${t.notes ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">💬 ${t.notes}</div>` : ''}
          </div>
        </div>
        <div class="txn-right">
          <span class="txn-amount ${t.type === 'Credit' ? 'credit' : 'debit'}">
            ${t.type === 'Credit' ? '+' : '-'}${formattedAmount}
          </span>
          <div class="txn-actions">
            <button class="icon-btn" onclick="editTransaction('${t.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" onclick="deleteTransaction('${t.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  updateMetricsAndTaxonomy();
}

// Calculate Real Summary Metrics & Taxonomy (Module 3 & 5)
function updateMetricsAndTaxonomy() {
  let income = 0;
  let expenses = 0;

  let needsSum = 0;
  let wantsSum = 0;
  let investSum = 0;

  transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    if (t.type === 'Credit') {
      income += amt;
    } else {
      expenses += amt;
      if (t.category === 'Fixed Needs') needsSum += amt;
      if (t.category === 'Variable Wants') wantsSum += amt;
      if (t.category === 'Investments') investSum += amt;
    }
  });

  const netCashFlow = income - expenses;

  document.getElementById('dashIncome').innerText = `₹${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashExpenses').innerText = `₹${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashNetCashFlow').innerText = `₹${netCashFlow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // 50 / 30 / 20 Taxonomy Targets based on Net Income
  const targetNeeds = income > 0 ? income * 0.50 : 0;
  const targetWants = income > 0 ? income * 0.30 : 0;
  const targetInvest = income > 0 ? income * 0.15 : 0;
  const targetSavings = income > 0 ? income * 0.05 : 0;

  document.getElementById('taxNeedsVal').innerText = `₹${needsSum.toLocaleString()} / ₹${targetNeeds.toLocaleString()}`;
  document.getElementById('taxNeedsBar').style.width = `${income > 0 ? Math.min(100, (needsSum / targetNeeds) * 100) : 0}%`;

  document.getElementById('taxWantsVal').innerText = `₹${wantsSum.toLocaleString()} / ₹${targetWants.toLocaleString()}`;
  document.getElementById('taxWantsBar').style.width = `${income > 0 ? Math.min(100, (wantsSum / targetWants) * 100) : 0}%`;

  document.getElementById('taxInvestVal').innerText = `₹${investSum.toLocaleString()} / ₹${targetInvest.toLocaleString()}`;
  document.getElementById('taxInvestBar').style.width = `${income > 0 ? Math.min(100, (investSum / targetInvest) * 100) : 0}%`;

  const calculatedSavings = Math.max(0, netCashFlow - investSum);
  document.getElementById('taxSavingsVal').innerText = `₹${calculatedSavings.toLocaleString()} / ₹${targetSavings.toLocaleString()}`;
  document.getElementById('taxSavingsBar').style.width = `${income > 0 ? Math.min(100, (calculatedSavings / targetSavings) * 100) : 0}%`;
}

// Modal Handlers (CRUD)
function openAddModal() {
  document.getElementById('modalHeaderTitle').innerText = 'Add New Real Transaction';
  document.getElementById('txnForm').reset();
  document.getElementById('txnId').value = '';
  document.getElementById('inputDate').valueAsDate = new Date();
  document.getElementById('txnModal').classList.add('active');
}

function closeModal() {
  document.getElementById('txnModal').classList.remove('active');
}

function editTransaction(id) {
  const t = transactions.find(item => item.id === id);
  if (!t) return;

  document.getElementById('modalHeaderTitle').innerText = 'Edit Real Transaction';
  document.getElementById('txnId').value = t.id;
  document.getElementById('inputMerchant').value = t.merchant;
  document.getElementById('inputAmount').value = t.amount;
  document.getElementById('inputType').value = t.type;
  document.getElementById('inputCategory').value = t.category;
  document.getElementById('inputMode').value = t.mode;
  document.getElementById('inputDate').value = t.date;
  document.getElementById('inputTags').value = (t.tags || []).join(', ');
  document.getElementById('inputNotes').value = t.notes || '';

  document.getElementById('txnModal').classList.add('active');
}

function deleteTransaction(id) {
  if (confirm('Are you sure you want to delete this real transaction?')) {
    const targetId = id;
    transactions = transactions.filter(item => item.id !== targetId);
    saveToLocalStorage();
    renderTransactions();

    if (SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${targetId}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }).catch(err => console.log('Supabase Delete error:', err));
    }
  }
}

function clearAllRealData() {
  if (confirm('CAUTION: This will delete ALL your saved real transactions! Are you sure?')) {
    transactions = [];
    saveToLocalStorage();
    renderTransactions();
  }
}

function saveTransaction(e) {
  e.preventDefault();
  const id = document.getElementById('txnId').value;
  const merchant = document.getElementById('inputMerchant').value.trim();
  const amount = parseFloat(document.getElementById('inputAmount').value);
  const type = document.getElementById('inputType').value;
  const category = document.getElementById('inputCategory').value;
  const mode = document.getElementById('inputMode').value;
  const date = document.getElementById('inputDate').value;
  const tagsRaw = document.getElementById('inputTags').value;
  const notes = document.getElementById('inputNotes').value.trim();

  const tags = tagsRaw.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
    .map(tag => tag.startsWith('#') ? tag : `#${tag}`);

  const txnObj = {
    id: id || `txn-${Date.now()}`,
    merchant, amount, type, category, mode, date, tags, notes
  };

  if (id) {
    const idx = transactions.findIndex(t => t.id === id);
    if (idx !== -1) transactions[idx] = txnObj;
  } else {
    transactions.unshift(txnObj);
  }

  saveToLocalStorage();
  closeModal();
  renderTransactions();

  // Push to Supabase
  if (SUPABASE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(txnObj)
    }).catch(err => console.log('Supabase Save error:', err));
  }
}

/* ==========================================================================
   MODULE 1: AUTOMATED REGEX INGESTION ENGINE
   ========================================================================== */

function parseRawNotification() {
  const raw = document.getElementById('rawNotificationInput').value.trim();
  if (!raw) return;

  const amountRegex = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const merchantRegex = /(?:to|at|by|vpa|paid to|credited with|transferred to)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\.|$)/i;
  const typeRegex = /(debited|credited|sent|received|paid)/i;

  const amountMatch = raw.match(amountRegex);
  const merchantMatch = raw.match(merchantRegex);
  const typeMatch = raw.match(typeRegex);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0.00;
  const merchant = merchantMatch ? merchantMatch[1].trim() : 'GPay Merchant';
  const isCredit = typeMatch && /credited|received/i.test(typeMatch[1]);
  const type = isCredit ? 'Credit' : 'Debit';

  let category = 'Variable Wants';
  if (isCredit) {
    category = 'Income';
  } else if (/sip|mutual|index|zerodha|groww|invest|stocks/i.test(raw + merchant)) {
    category = 'Investments';
  } else if (/loan|emi|rent|hdfc|bill|electricity|gas|maintenance|broadband/i.test(raw + merchant)) {
    category = 'Fixed Needs';
  }

  const timestamp = new Date().toISOString().split('T')[0];

  lastParsedTransaction = {
    merchant,
    amount,
    type,
    category,
    mode: 'GPay / UPI Auto-Sync',
    date: timestamp,
    tags: ['#auto-ingested', `#${merchant.toLowerCase().replace(/[^a-z0-9]/g, '')}`],
    notes: `Real Notification: "${raw.substring(0, 50)}..."`
  };

  document.getElementById('resMerchant').innerText = merchant;
  document.getElementById('resAmount').innerText = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('resType').innerText = type;
  document.getElementById('resCategory').innerText = category;
  document.getElementById('resTime').innerText = timestamp;

  document.getElementById('parsedOutputCard').style.display = 'block';
}

function ingestParsedTransaction() {
  if (!lastParsedTransaction) return;

  const newTxn = {
    id: `txn-${Date.now()}`,
    ...lastParsedTransaction
  };

  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();
  switchTab('dashboard');

  fetch('/api/ingest-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawText: lastParsedTransaction.notes,
      sender: lastParsedTransaction.merchant,
      timestamp: lastParsedTransaction.date
    })
  }).catch(err => console.log('Offline mode active:', err));
  
  document.getElementById('parsedOutputCard').style.display = 'none';
  document.getElementById('rawNotificationInput').value = '';
}
