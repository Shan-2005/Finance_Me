/* ==========================================================================
   FINANCE ME - Real Data Management & Dynamic Savings Intelligence Engine
   ========================================================================== */

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
let SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG'; 

// Load Real User Transactions from LocalStorage as fallback
let transactions = JSON.parse(localStorage.getItem('finance_me_transactions') || '[]');
let lastParsedTransaction = null;
let currentAppVersion = null;
let deferredPwaPrompt = null;
let isPrivateModeActive = false;

// Profile Settings
let userProfile = JSON.parse(localStorage.getItem('finance_me_profile') || '{"name":"Shan","salary":100000,"currency":"₹"}');

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('inputDate');
  if (dateInput) dateInput.valueAsDate = new Date();
  
  loadProfileSettings();
  renderTransactions();
  updateMetricsAndTaxonomy();

  fetchTransactionsFromSupabase();

  checkAutoUpdate();
  setInterval(checkAutoUpdate, 30000);

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('[PWA]: Service Worker Registered'))
      .catch(err => console.log('[PWA SW Error]:', err));
  }

  // Handle PWA Install Prompt
  initPwaInstallPrompt();
});

// Load & Save User Profile Settings
function loadProfileSettings() {
  const nameInput = document.getElementById('userNameInput');
  const salaryInput = document.getElementById('userSalaryInput');
  const currSelect = document.getElementById('userCurrencySelect');
  const avatarChar = document.getElementById('profileAvatarChar');

  if (nameInput) nameInput.value = userProfile.name || 'Shan';
  if (salaryInput) salaryInput.value = userProfile.salary || 100000;
  if (currSelect) currSelect.value = userProfile.currency || '₹';
  if (avatarChar) avatarChar.innerText = (userProfile.name || 'S').charAt(0).toUpperCase();
}

function saveProfileSettings() {
  const nameInput = document.getElementById('userNameInput');
  const salaryInput = document.getElementById('userSalaryInput');
  const currSelect = document.getElementById('userCurrencySelect');
  const avatarChar = document.getElementById('profileAvatarChar');

  userProfile.name = nameInput ? nameInput.value.trim() : 'Shan';
  userProfile.salary = salaryInput ? parseFloat(salaryInput.value) || 100000 : 100000;
  userProfile.currency = currSelect ? currSelect.value : '₹';

  if (avatarChar) avatarChar.innerText = userProfile.name.charAt(0).toUpperCase();

  localStorage.setItem('finance_me_profile', JSON.stringify(userProfile));
  updateMetricsAndTaxonomy();
}

// Copy Webhook URL to Clipboard
function copyWebhookUrl() {
  const box = document.getElementById('webhookUrlBox');
  if (!box) return;

  box.select();
  navigator.clipboard.writeText(box.value).then(() => {
    alert('✅ Webhook URL copied to clipboard!\nPaste this into your MacroDroid HTTP POST action.');
  }).catch(() => {
    alert('Webhook URL selected! Press Ctrl+C / Cmd+C to copy.');
  });
}

// Toggle Private Mode Blur
function togglePrivateMode() {
  isPrivateModeActive = !isPrivateModeActive;
  const elements = document.querySelectorAll('.maskable-amount');
  const btnText = document.getElementById('privacyBtnText');
  const privacyIcon = document.getElementById('privacyIcon');

  elements.forEach(el => {
    if (isPrivateModeActive) {
      el.classList.add('privacy-blur');
    } else {
      el.classList.remove('privacy-blur');
    }
  });

  if (btnText) btnText.innerText = isPrivateModeActive ? 'Disable Privacy Mode (Show Amounts)' : 'Enable Privacy Mode (Blur Amounts)';
  if (privacyIcon) privacyIcon.className = isPrivateModeActive ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
}

// Export Transactions to CSV
function exportTransactionsCSV() {
  if (transactions.length === 0) {
    alert('No real transactions logged to export!');
    return;
  }

  const headers = ['ID', 'Date', 'Merchant', 'Amount', 'Type', 'Category', 'Payment Mode', 'Notes'];
  const rows = transactions.map(t => [
    t.id,
    t.date,
    `"${(t.merchant || '').replace(/"/g, '""')}"`,
    t.amount,
    t.type,
    `"${t.category}"`,
    `"${t.mode}"`,
    `"${(t.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Finance_Me_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// PWA Installation Handler
function initPwaInstallPrompt() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone || 
                       document.referrer.includes('android-app://');

  if (isStandalone) {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner && !sessionStorage.getItem('pwa_banner_dismissed')) {
      banner.style.display = 'flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
    deferredPwaPrompt = null;
  });
}

function triggerPwaInstall() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then((choiceResult) => {
      deferredPwaPrompt = null;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
    });
  } else {
    alert('To install Finance Me app on your home screen:\n\nChrome/Android: Tap menu (⋮) -> "Add to Home screen"\nSafari/iOS: Tap Share button (⎋) -> "Add to Home Screen"');
  }
}

function dismissPwaBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
  sessionStorage.setItem('pwa_banner_dismissed', 'true');
}

// Manual Refresh & Cloud Sync Handler
function manualSyncFromSupabase(btnElement) {
  const icon = btnElement ? btnElement.querySelector('i') : document.querySelector('#refreshBtn i');
  if (icon) icon.classList.add('spin-anim');

  fetchTransactionsFromSupabase(() => {
    setTimeout(() => {
      if (icon) icon.classList.remove('spin-anim');
    }, 600);
  });
}

// Fetch Real Transactions from Supabase Database
function fetchTransactionsFromSupabase(onComplete) {
  if (!SUPABASE_KEY) {
    if (onComplete) onComplete();
    return;
  }

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
    }
    if (onComplete) onComplete();
  })
  .catch(err => {
    console.log('[Supabase Sync]: Using local offline data', err);
    if (onComplete) onComplete();
  });
}

// Automatic Version Check
function checkAutoUpdate() {
  fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      if (data && data.version) {
        if (!currentAppVersion) {
          currentAppVersion = data.version;
        } else if (currentAppVersion !== data.version) {
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

// Category Meta Mapping
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
  const curr = userProfile.currency || '₹';

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
    const formattedAmount = `${curr}${parseFloat(t.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
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
          <span class="txn-amount ${t.type === 'Credit' ? 'credit' : 'debit'} maskable-amount ${isPrivateModeActive ? 'privacy-blur' : ''}">
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

// Calculate Summary Metrics, Savings Intelligence & Strategy
function updateMetricsAndTaxonomy() {
  let income = 0;
  let expenses = 0;

  let unavoidableSum = 0;
  let unwantedSum = 0;
  let investSum = 0;

  const merchantTotals = {};
  const categoryTotals = {};
  const curr = userProfile.currency || '₹';

  transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    if (t.type === 'Credit') {
      income += amt;
    } else {
      expenses += amt;

      merchantTotals[t.merchant] = (merchantTotals[t.merchant] || 0) + amt;
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + amt;

      if (t.category === 'Unavoidable / Rent' || t.category === 'Fixed Needs') {
        unavoidableSum += amt;
      } else if (t.category === 'Unwanted / Leak' || t.category === 'Variable Wants') {
        unwantedSum += amt;
      } else if (t.category === 'Investments') {
        investSum += amt;
      } else {
        unavoidableSum += amt;
      }
    }
  });

  const netCashFlow = income - expenses;
  const netSaved = Math.max(0, netCashFlow);
  const savingsRate = income > 0 ? ((netSaved / income) * 100).toFixed(1) : 0;

  // Dashboard Metrics
  document.getElementById('dashIncome').innerText = `${curr}${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashExpenses').innerText = `${curr}${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashNetCashFlow').innerText = `${curr}${netCashFlow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // Strategy Tab Metrics
  document.getElementById('strategyTotalSaved').innerText = `${curr}${netSaved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('strategySavingsRate').innerText = `${savingsRate}% Savings Rate`;

  document.getElementById('unavoidableSum').innerText = `${curr}${unavoidableSum.toLocaleString('en-IN')}`;
  document.getElementById('unwantedSum').innerText = `${curr}${unwantedSum.toLocaleString('en-IN')}`;
  document.getElementById('investmentsSum').innerText = `${curr}${investSum.toLocaleString('en-IN')}`;

  // Top Merchant & Category
  let topMerchant = 'None logged';
  let topMerchantMax = 0;
  for (const m in merchantTotals) {
    if (merchantTotals[m] > topMerchantMax) {
      topMerchantMax = merchantTotals[m];
      topMerchant = `${m} (${curr}${topMerchantMax.toLocaleString()})`;
    }
  }

  let topCat = 'None logged';
  let topCatMax = 0;
  for (const c in categoryTotals) {
    if (categoryTotals[c] > topCatMax) {
      topCatMax = categoryTotals[c];
      topCat = `${c} (${curr}${topCatMax.toLocaleString()})`;
    }
  }

  document.getElementById('topMerchantVal').innerText = topMerchant;
  document.getElementById('topCategoryVal').innerText = topCat;

  // 50/30/20 Budget Targets based on Salary or Income
  const baseTargetIncome = income > 0 ? income : (userProfile.salary || 100000);
  const targetNeeds = baseTargetIncome * 0.50;
  const targetWants = baseTargetIncome * 0.30;
  const targetInvest = baseTargetIncome * 0.15;
  const targetSavings = baseTargetIncome * 0.05;

  document.getElementById('taxNeedsVal').innerText = `${curr}${unavoidableSum.toLocaleString()} / ${curr}${targetNeeds.toLocaleString()}`;
  document.getElementById('taxNeedsBar').style.width = `${Math.min(100, (unavoidableSum / targetNeeds) * 100)}%`;

  document.getElementById('taxWantsVal').innerText = `${curr}${unwantedSum.toLocaleString()} / ${curr}${targetWants.toLocaleString()}`;
  document.getElementById('taxWantsBar').style.width = `${Math.min(100, (unwantedSum / targetWants) * 100)}%`;

  document.getElementById('taxInvestVal').innerText = `${curr}${investSum.toLocaleString()} / ${curr}${targetInvest.toLocaleString()}`;
  document.getElementById('taxInvestBar').style.width = `${Math.min(100, (investSum / targetInvest) * 100)}%`;

  document.getElementById('taxSavingsVal').innerText = `${curr}${netSaved.toLocaleString()} / ${curr}${targetSavings.toLocaleString()}`;
  document.getElementById('taxSavingsBar').style.width = `${Math.min(100, (netSaved / targetSavings) * 100)}%`;

  // Dynamic Ways to Save
  renderWaysToSaveAdvice(income, expenses, unavoidableSum, unwantedSum, investSum, netSaved, curr);
}

// Generate Ways to Save Advice
function renderWaysToSaveAdvice(income, expenses, unavoidable, unwanted, invest, saved, curr) {
  const container = document.getElementById('waysToSaveContainer');
  if (!container) return;

  const adviceList = [];

  if (unwanted > 0) {
    const potentialSaving = (unwanted * 0.30).toFixed(0);
    adviceList.push({
      icon: 'fa-triangle-exclamation',
      color: '#f43f5e',
      title: 'Unwanted Spending Leak Detected',
      desc: `You spent <strong>${curr}${unwanted.toLocaleString()}</strong> on unwanted/discretionary items. Cutting this by 30% saves <strong>${curr}${parseFloat(potentialSaving).toLocaleString()}/month</strong>!`
    });
  } else {
    adviceList.push({
      icon: 'fa-circle-check',
      color: '#10b981',
      title: 'Zero Unwanted Leaks Logged',
      desc: `No discretionary leaks logged yet! Keep tagging food delivery, impulsive buys, and unused subscriptions as 'Unwanted'.`
    });
  }

  if (income > 0 && unavoidable > 0) {
    const ratio = ((unavoidable / income) * 100).toFixed(1);
    if (ratio > 50) {
      adviceList.push({
        icon: 'fa-house-lock',
        color: '#f59e0b',
        title: 'High Unavoidable Expense Ratio',
        desc: `Rent & fixed bills take up <strong>${ratio}%</strong> of income (Target < 50%). Consider negotiating fixed utility contracts or optimizing rent.`
      });
    } else {
      adviceList.push({
        icon: 'fa-thumbs-up',
        color: '#06b6d4',
        title: 'Healthy Rent & Fixed Needs Ratio',
        desc: `Rent & fixed bills take up <strong>${ratio}%</strong> of income. You are within safe financial margins!`
      });
    }
  }

  if (saved > 5000 && invest < saved * 0.5) {
    const sip = (saved * 0.4).toFixed(0);
    adviceList.push({
      icon: 'fa-chart-line',
      color: '#10b981',
      title: 'Surplus Cash Wealth Sweep',
      desc: `You saved <strong>${curr}${saved.toLocaleString()}</strong> this month! We recommend sweeping <strong>${curr}${parseFloat(sip).toLocaleString()}</strong> into SIPs to compound wealth.`
    });
  }

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
  const merchantRegex = /(?:to|at|vpa|paid to|credited from|credited with|sent to|spent at|transferred to|towards)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i;
  const typeRegex = /(debited|credited|sent|received|paid|spent|deposited)/i;

  const amountMatch = raw.match(amountRegex);
  const merchantMatch = raw.match(merchantRegex);
  const typeMatch = raw.match(typeRegex);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0.00;
  let merchant = merchantMatch ? merchantMatch[1].trim() : 'GPay Merchant';
  merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 32);

  const isCredit = typeMatch && /credited|received|deposited/i.test(typeMatch[1]);
  const type = isCredit ? 'Credit' : 'Debit';

  let category = 'Unwanted / Leak';
  if (isCredit) {
    category = 'Income';
  } else if (/sip|mutual|index|zerodha|groww|invest|stocks|gold|nps/i.test(raw + merchant)) {
    category = 'Investments';
  } else if (/rent|loan|emi|hdfc|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(raw + merchant)) {
    category = 'Unavoidable / Rent';
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const curr = userProfile.currency || '₹';

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
  document.getElementById('resAmount').innerText = `${curr}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
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
