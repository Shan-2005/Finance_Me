/* ==========================================================================
   FINANCE ME - Real Data Management & Dynamic Savings Intelligence Engine
   ========================================================================== */

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
let SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG'; 

// Load Real User Transactions from LocalStorage as fallback
let transactions = JSON.parse(localStorage.getItem('finance_me_transactions') || '[]');
let lastParsedTransaction = null;
let currentAppVersion = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('inputDate');
  if (dateInput) dateInput.valueAsDate = new Date();
  
  renderTransactions();
  updateMetricsAndTaxonomy();

  fetchTransactionsFromSupabase();

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

// Automatic Version Check to force fresh code on Git push
function checkAutoUpdate() {
  fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      if (data && data.version) {
        if (!currentAppVersion) {
          currentAppVersion = data.version;
        } else if (currentAppVersion !== data.version) {
          console.log('[Auto-Update]: New Git build detected! Refreshing...');
          window.location.reload(true);
        }
      }
    })
    .catch(err => console.log('[Auto-Update Check]: Local offline mode'));
}

// Save to LocalStorage
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

// Aspect Ratio Switcher
function setDeviceRatio(mode, btnElement) {
  const frame = document.getElementById('deviceFrame');
  document.querySelectorAll('.ratio-btn').forEach(btn => btn.classList.remove('active'));
  btnElement.classList.add('active');

  frame.className = `device-frame mode-${mode}`;
}

// Category Icon & Color Mapping
function getCategoryMeta(category) {
  switch (category) {
    case 'Unavoidable / Rent':
    case 'Fixed Needs':
      return { icon: 'fa-house', bg: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', label: 'Unavoidable' };
    case 'Unwanted / Leak':
    case 'Variable Wants':
      return { icon: 'fa-bag-shopping', bg: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e', label: 'Unwanted Leak' };
    case 'Investments':
      return { icon: 'fa-chart-line', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', label: 'Investment' };
    case 'Income':
      return { icon: 'fa-wallet', bg: 'rgba(99, 102, 241, 0.15)', color: '#6366f1', label: 'Income' };
    default:
      return { icon: 'fa-tag', bg: 'rgba(255, 255, 255, 0.1)', color: '#94a3b8', label: category };
  }
}

// Render Transactions List
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
    const matchesCat = (catFilter === 'ALL') || 
                       (t.category === catFilter) ||
                       (catFilter === 'Unavoidable / Rent' && (t.category === 'Fixed Needs')) ||
                       (catFilter === 'Unwanted / Leak' && (t.category === 'Variable Wants'));
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
          Your Supabase database is connected! Add an entry manually or trigger a GPay notification to start tracking.
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

// Calculate Real Summary Metrics, Savings Intelligence & Dynamic Advice
function updateMetricsAndTaxonomy() {
  let income = 0;
  let expenses = 0;

  let unavoidableSum = 0; // Rent, Bills, EMI, Needs
  let unwantedSum = 0;     // Food delivery, Impulse, Discretionary
  let investSum = 0;       // Stocks, SIPs, Gold

  const merchantTotals = {};
  const categoryTotals = {};

  transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    if (t.type === 'Credit') {
      income += amt;
    } else {
      expenses += amt;

      // Merchant spending tracking
      merchantTotals[t.merchant] = (merchantTotals[t.merchant] || 0) + amt;
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + amt;

      if (t.category === 'Unavoidable / Rent' || t.category === 'Fixed Needs') {
        unavoidableSum += amt;
      } else if (t.category === 'Unwanted / Leak' || t.category === 'Variable Wants') {
        unwantedSum += amt;
      } else if (t.category === 'Investments') {
        investSum += amt;
      } else {
        unavoidableSum += amt; // Default fallback
      }
    }
  });

  const netCashFlow = income - expenses;
  const netSaved = Math.max(0, netCashFlow);
  const savingsRate = income > 0 ? ((netSaved / income) * 100).toFixed(1) : 0;

  // 1. Dashboard Metrics
  document.getElementById('dashIncome').innerText = `₹${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashExpenses').innerText = `₹${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashNetCashFlow').innerText = `₹${netCashFlow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // 2. Savings Strategy Tab Intelligence
  document.getElementById('strategyTotalSaved').innerText = `₹${netSaved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('strategySavingsRate').innerText = `${savingsRate}% Savings Rate`;

  document.getElementById('unavoidableSum').innerText = `₹${unavoidableSum.toLocaleString('en-IN')}`;
  document.getElementById('unwantedSum').innerText = `₹${unwantedSum.toLocaleString('en-IN')}`;
  document.getElementById('investmentsSum').innerText = `₹${investSum.toLocaleString('en-IN')}`;

  // Find Top Merchant & Top Category
  let topMerchant = 'None logged';
  let topMerchantMax = 0;
  for (const m in merchantTotals) {
    if (merchantTotals[m] > topMerchantMax) {
      topMerchantMax = merchantTotals[m];
      topMerchant = `${m} (₹${topMerchantMax.toLocaleString()})`;
    }
  }

  let topCat = 'None logged';
  let topCatMax = 0;
  for (const c in categoryTotals) {
    if (categoryTotals[c] > topCatMax) {
      topCatMax = categoryTotals[c];
      topCat = `${c} (₹${topCatMax.toLocaleString()})`;
    }
  }

  document.getElementById('topMerchantVal').innerText = topMerchant;
  document.getElementById('topCategoryVal').innerText = topCat;

  // 3. Taxonomy 50/30/20 Rule Targets based on Income
  const targetNeeds = income > 0 ? income * 0.50 : 0;
  const targetWants = income > 0 ? income * 0.30 : 0;
  const targetInvest = income > 0 ? income * 0.15 : 0;
  const targetSavings = income > 0 ? income * 0.05 : 0;

  document.getElementById('taxNeedsVal').innerText = `₹${unavoidableSum.toLocaleString()} / ₹${targetNeeds.toLocaleString()}`;
  document.getElementById('taxNeedsBar').style.width = `${income > 0 ? Math.min(100, (unavoidableSum / targetNeeds) * 100) : 0}%`;

  document.getElementById('taxWantsVal').innerText = `₹${unwantedSum.toLocaleString()} / ₹${targetWants.toLocaleString()}`;
  document.getElementById('taxWantsBar').style.width = `${income > 0 ? Math.min(100, (unwantedSum / targetWants) * 100) : 0}%`;

  document.getElementById('taxInvestVal').innerText = `₹${investSum.toLocaleString()} / ₹${targetInvest.toLocaleString()}`;
  document.getElementById('taxInvestBar').style.width = `${income > 0 ? Math.min(100, (investSum / targetInvest) * 100) : 0}%`;

  document.getElementById('taxSavingsVal').innerText = `₹${netSaved.toLocaleString()} / ₹${targetSavings.toLocaleString()}`;
  document.getElementById('taxSavingsBar').style.width = `${income > 0 ? Math.min(100, (netSaved / targetSavings) * 100) : 0}%`;

  // 4. Generate Calculated "Ways to Save" Advisory
  renderWaysToSaveAdvice(income, expenses, unavoidableSum, unwantedSum, investSum, netSaved, topMerchant);
}

// Generate Concrete Actionable "Ways to Save"
function renderWaysToSaveAdvice(income, expenses, unavoidable, unwanted, invest, saved, topMerchant) {
  const container = document.getElementById('waysToSaveContainer');
  if (!container) return;

  const adviceList = [];

  // Advice 1: Unwanted Leaks Reduction
  if (unwanted > 0) {
    const potentialSaving = (unwanted * 0.30).toFixed(0);
    adviceList.push({
      icon: 'fa-triangle-exclamation',
      color: '#f43f5e',
      title: 'Unwanted Spending Leak Detected',
      desc: `You spent <strong>₹${unwanted.toLocaleString()}</strong> on unwanted/discretionary items. Cutting this by 30% will save you <strong>₹${parseFloat(potentialSaving).toLocaleString()}/month</strong>!`
    });
  } else {
    adviceList.push({
      icon: 'fa-circle-check',
      color: '#10b981',
      title: 'Zero Unwanted Leaks Logged',
      desc: `No discretionary leaks logged yet! Keep flagging food delivery, impulsive buys, and subscriptions as 'Unwanted'.`
    });
  }

  // Advice 2: Unavoidable Spending & Rent Ratio
  if (income > 0 && unavoidable > 0) {
    const unavoidableRatio = ((unavoidable / income) * 100).toFixed(1);
    if (unavoidableRatio > 50) {
      adviceList.push({
        icon: 'fa-house-lock',
        color: '#f59e0b',
        title: 'High Unavoidable Expense Ratio',
        desc: `Rent and fixed bills consume <strong>${unavoidableRatio}%</strong> of your income (Target: < 50%). Consider negotiating fixed utility bills or optimizing rent expenses.`
      });
    } else {
      adviceList.push({
        icon: 'fa-thumbs-up',
        color: '#06b6d4',
        title: 'Healthy Unavoidable Rent Ratio',
        desc: `Rent and fixed needs take up <strong>${unavoidableRatio}%</strong> of your monthly income. You are within safe financial margins.`
      });
    }
  }

  // Advice 3: Investment Sweep Recommendation
  if (saved > 5000 && invest < saved * 0.5) {
    const recommendedSIP = (saved * 0.4).toFixed(0);
    adviceList.push({
      icon: 'fa-chart-line',
      color: '#10b981',
      title: 'Surplus Cash Wealth Sweep',
      desc: `You saved <strong>₹${saved.toLocaleString()}</strong> this month! We recommend sweeping <strong>₹${parseFloat(recommendedSIP).toLocaleString()}</strong> into Nifty 50 Index SIPs to compound wealth.`
    });
  }

  // Render Advice Cards
  container.innerHTML = adviceList.map(adv => `
    <div class="advice-card">
      <div class="advice-icon" style="background: rgba(255,255,255,0.08); color: ${adv.color};">
        <i class="fa-solid ${adv.icon}"></i>
      </div>
      <div>
        <div class="advice-title" style="color: ${adv.color};">${adv.title}</div>
        <div class="advice-desc">${adv.desc}</div>
      </div>
    </div>
  `).join('');
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

  let category = 'Unwanted / Leak';
  if (isCredit) {
    category = 'Income';
  } else if (/sip|mutual|index|zerodha|groww|invest|stocks/i.test(raw + merchant)) {
    category = 'Investments';
  } else if (/rent|loan|emi|hdfc|bill|electricity|gas|maintenance|broadband/i.test(raw + merchant)) {
    category = 'Unavoidable / Rent';
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
