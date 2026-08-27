/* ==========================================================================
   FINANCE ME - Real Data Management & Google Pay (GPay) Engine
   ========================================================================== */

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
let SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG'; 

let transactions = JSON.parse(localStorage.getItem('finance_me_transactions') || '[]');
let lastParsedTransaction = null;
let currentAppVersion = null;
let deferredPwaPrompt = null;
let isPrivateModeActive = false;

// Chart.js Instances
let categoryChartInstance = null;
let cashflowChartInstance = null;

// Profile Settings
let userProfile = JSON.parse(localStorage.getItem('finance_me_profile') || '{"name":"Shan","salary":100000,"currency":"₹"}');

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('inputDate');
  if (dateInput) dateInput.valueAsDate = new Date();
  
  initTheme();
  loadProfileSettings();
  restoreFromVaultBackupIfEmpty();

  renderGpayAvatars();
  renderTransactions();
  updateMetricsAndTaxonomy();

  // Initial Fetch & Fast 4-Second Auto Sync Polling
  fetchTransactionsFromSupabase();
  setInterval(fetchTransactionsFromSupabase, 4000);

  checkAutoUpdate();
  setInterval(checkAutoUpdate, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('[PWA]: Service Worker Registered'))
      .catch(err => console.log('[PWA SW Error]:', err));
  }

  initPwaInstallPrompt();
});

/* ==========================================================================
   LIGHT / DARK MODE THEME SWITCHER
   ========================================================================== */

function initTheme() {
  const savedTheme = localStorage.getItem('finance_me_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('finance_me_theme', newTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btnIcon = document.querySelector('#themeToggleBtn i');
  if (btnIcon) {
    btnIcon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  if (typeof renderCharts === 'function') renderCharts();
}

/* ==========================================================================
   QUADRUPLE-LAYER DATA LOSS PREVENTION & VAULT BACKUP SYSTEM
   ========================================================================== */

function saveToLocalStorage() {
  localStorage.setItem('finance_me_transactions', JSON.stringify(transactions));
  if (transactions.length > 0) {
    const backupVault = {
      timestamp: new Date().toISOString(),
      itemCount: transactions.length,
      data: transactions
    };
    localStorage.setItem('finance_me_vault_snapshot', JSON.stringify(backupVault));
  }
}

function restoreFromVaultBackupIfEmpty() {
  if (transactions.length === 0) {
    const rawVault = localStorage.getItem('finance_me_vault_snapshot');
    if (rawVault) {
      try {
        const vault = JSON.parse(rawVault);
        if (vault && Array.isArray(vault.data) && vault.data.length > 0) {
          transactions = vault.data;
          localStorage.setItem('finance_me_transactions', JSON.stringify(transactions));
          console.log('[Data Safeguard]: Auto-restored', transactions.length, 'transactions from vault snapshot!');
        }
      } catch (e) {
        console.error('[Vault Error]:', e);
      }
    }
  }
}

// Load & Save Profile Settings
function loadProfileSettings() {
  const nameInput = document.getElementById('userNameInput');
  const salaryInput = document.getElementById('userSalaryInput');
  const currSelect = document.getElementById('userCurrencySelect');
  const avatarChar = document.getElementById('profileAvatarChar');
  const headerAvatar = document.getElementById('gpayHeaderAvatar');

  const char = (userProfile.name || 'Shan').charAt(0).toUpperCase();

  if (nameInput) nameInput.value = userProfile.name || 'Shan';
  if (salaryInput) salaryInput.value = userProfile.salary || 100000;
  if (currSelect) currSelect.value = userProfile.currency || '₹';
  if (avatarChar) avatarChar.innerText = char;
  if (headerAvatar) headerAvatar.innerText = char;
}

function saveProfileSettings() {
  const nameInput = document.getElementById('userNameInput');
  const salaryInput = document.getElementById('userSalaryInput');
  const currSelect = document.getElementById('userCurrencySelect');
  const avatarChar = document.getElementById('profileAvatarChar');
  const headerAvatar = document.getElementById('gpayHeaderAvatar');

  userProfile.name = nameInput ? nameInput.value.trim() : 'Shan';
  userProfile.salary = salaryInput ? parseFloat(salaryInput.value) || 100000 : 100000;
  userProfile.currency = currSelect ? currSelect.value : '₹';

  const char = userProfile.name.charAt(0).toUpperCase();
  if (avatarChar) avatarChar.innerText = char;
  if (headerAvatar) headerAvatar.innerText = char;

  localStorage.setItem('finance_me_profile', JSON.stringify(userProfile));
  updateMetricsAndTaxonomy();
}

// Render GPAY Signature People & Merchant Avatars Row
function renderGpayAvatars() {
  const container = document.getElementById('gpayAvatarsContainer');
  if (!container) return;

  const merchantsSet = new Set();
  transactions.forEach(t => {
    if (t.merchant) merchantsSet.add(t.merchant);
  });

  const merchantsList = Array.from(merchantsSet).slice(0, 8);
  if (merchantsList.length === 0) {
    merchantsList.push('Swiggy', 'House Rent', 'Zomato', 'SIP Fund', 'Amazon');
  }

  const colorPalettes = [
    'linear-gradient(135deg, #4285F4 0%, #34A853 100%)',
    'linear-gradient(135deg, #EA4335 0%, #FBBC05 100%)',
    'linear-gradient(135deg, #34A853 0%, #4285F4 100%)',
    'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)'
  ];

  container.innerHTML = merchantsList.map((m, idx) => {
    const char = m.charAt(0).toUpperCase();
    const bgGradient = colorPalettes[idx % colorPalettes.length];

    return `
      <div class="gpay-avatar-item" onclick="quickPayMerchant('${m}')">
        <div class="gpay-avatar-bubble" style="background: ${bgGradient}; border-color: rgba(255,255,255,0.3);">
          ${char}
        </div>
        <span class="gpay-avatar-name">${m}</span>
      </div>
    `;
  }).join('');
}

// Quick Pay Merchant Trigger
function quickPayMerchant(merchantName) {
  openAddModal();
  document.getElementById('inputMerchant').value = merchantName;
}

// Copy Webhook URL
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
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
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

// Fetch Real Transactions from Supabase Database (Auto-Merging & Instant UI Sync)
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
      const txMap = new Map();
      data.forEach(t => txMap.set(t.id, t));
      transactions.forEach(t => {
        if (!txMap.has(t.id)) txMap.set(t.id, t);
      });

      const merged = Array.from(txMap.values());
      merged.sort((a, b) => new Date(b.date) - new Date(a.date));

      if (JSON.stringify(merged) !== JSON.stringify(transactions)) {
        transactions = merged;
        saveToLocalStorage();
        renderGpayAvatars();
        renderTransactions();
        console.log('[Supabase Auto-Sync]: Updated', transactions.length, 'transactions');
      }
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

/* ==========================================================================
   VIEW RENDERING & FILTERING
   ========================================================================== */

function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const selectedTab = document.getElementById(`tab-${tabId}`);
  const selectedNav = document.getElementById(`nav-${tabId}`);

  if (selectedTab) selectedTab.classList.add('active');
  if (selectedNav) selectedNav.classList.add('active');

  if (tabId === 'taxonomy' || tabId === 'strategy') {
    renderCharts();
  }
}

function renderTransactions() {
  const container = document.getElementById('txnContainer');
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const categoryFilter = document.getElementById('categoryFilter')?.value || 'ALL';
  const countText = document.getElementById('txnCountText');

  if (!container) return;

  let filtered = transactions.filter(t => {
    const matchesSearch = (t.merchant || '').toLowerCase().includes(search) ||
                          (t.notes || '').toLowerCase().includes(search) ||
                          (t.tags || []).some(tag => tag.toLowerCase().includes(search));
    const matchesCategory = categoryFilter === 'ALL' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (countText) countText.innerText = `${filtered.length} payment${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i class="fa-solid fa-receipt" style="font-size: 36px; color: var(--gpay-blue-light); opacity: 0.5; margin-bottom: 10px;"></i>
        <div style="font-size: 14px; font-weight: 700; color: var(--text-main);">No payment history found</div>
        <div style="font-size: 11px; margin-top: 4px;">Tap "New Pay" to add or send a GPay notification</div>
      </div>
    `;
    updateMetricsAndTaxonomy();
    return;
  }

  const curr = userProfile.currency || '₹';

  const categoryMeta = {
    'Unavoidable / Rent': { icon: 'fa-house-chimney', color: '#4285F4', bg: 'rgba(66, 133, 244, 0.18)' },
    'Unwanted / Leak': { icon: 'fa-bag-shopping', color: '#EA4335', bg: 'rgba(234, 67, 53, 0.18)' },
    'Investments': { icon: 'fa-arrow-trend-up', color: '#34A853', bg: 'rgba(52, 168, 83, 0.18)' },
    'Income': { icon: 'fa-wallet', color: '#FBBC05', bg: 'rgba(251, 188, 5, 0.18)' }
  };

  container.innerHTML = filtered.map(t => {
    const meta = categoryMeta[t.category] || { icon: 'fa-credit-card', color: '#8ab4f8', bg: 'rgba(138, 180, 248, 0.18)' };
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
              <span><i class="fa-solid fa-mobile-screen-button" style="font-size: 10px;"></i> ${t.mode}</span>
              ${tagBadges ? `• ${tagBadges}` : ''}
            </div>
            ${t.notes ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">💬 ${t.notes}</div>` : ''}
          </div>
        </div>
        <div class="txn-right">
          <span class="txn-amount ${t.type === 'Credit' ? 'credit' : 'debit'} maskable-amount ${isPrivateModeActive ? 'privacy-blur' : ''}">
            ${t.type === 'Credit' ? '+' : '-'}${formattedAmount}
          </span>
          <div class="txn-status-tick">
            <i class="fa-solid fa-circle-check"></i> ${t.type === 'Credit' ? 'Received' : 'Paid'}
          </div>
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

// Calculate Summary Metrics, Health Score, Wealth Forecasts & Render Visual Charts
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

  document.getElementById('dashIncome').innerText = `${curr}${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashExpenses').innerText = `${curr}${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashNetCashFlow').innerText = `${curr}${netCashFlow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  document.getElementById('strategyTotalSaved').innerText = `${curr}${netSaved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('strategySavingsRate').innerText = `${savingsRate}% Savings Rate`;

  document.getElementById('unavoidableSum').innerText = `${curr}${unavoidableSum.toLocaleString('en-IN')}`;
  document.getElementById('unwantedSum').innerText = `${curr}${unwantedSum.toLocaleString('en-IN')}`;
  document.getElementById('investmentsSum').innerText = `${curr}${investSum.toLocaleString('en-IN')}`;

  // Top Merchant & Top Category
  let topMerchant = 'None logged';
  let maxMerchantAmt = 0;
  Object.keys(merchantTotals).forEach(m => {
    if (merchantTotals[m] > maxMerchantAmt) {
      maxMerchantAmt = merchantTotals[m];
      topMerchant = m;
    }
  });

  let topCategory = 'None logged';
  let maxCatAmt = 0;
  Object.keys(categoryTotals).forEach(c => {
    if (categoryTotals[c] > maxCatAmt) {
      maxCatAmt = categoryTotals[c];
      topCategory = c;
    }
  });

  document.getElementById('topMerchantVal').innerText = topMerchant;
  document.getElementById('topCategoryVal').innerText = topCategory;

  // Financial Health Score Algorithm (0 to 100)
  let healthScore = 50;
  if (income > 0) {
    if (savingsRate >= 30) healthScore += 30;
    else if (savingsRate >= 15) healthScore += 20;
    else if (savingsRate >= 5) healthScore += 10;

    const unwantedRatio = unwantedSum / income;
    if (unwantedRatio <= 0.15) healthScore += 20;
    else if (unwantedRatio <= 0.30) healthScore += 10;
  } else {
    healthScore = 65;
  }

  healthScore = Math.min(100, Math.max(10, Math.round(healthScore)));
  document.getElementById('healthScoreVal').innerText = healthScore;

  let ratingText = 'Balanced';
  let ratingDesc = 'Healthy financial split between needs and savings';
  if (healthScore >= 85) {
    ratingText = 'Excellent 🚀';
    ratingDesc = 'High savings rate & low spending leaks!';
  } else if (healthScore >= 70) {
    ratingText = 'Good 👍';
    ratingDesc = 'Solid financial management with room for SIP growth.';
  } else {
    ratingText = 'Needs Attention ⚠️';
    ratingDesc = 'High unwanted leaks detected. Review AI recommendations below.';
  }

  document.getElementById('healthScoreRating').innerText = ratingText;
  document.getElementById('healthScoreDesc').innerText = ratingDesc;

  // 1-Year Forecast & 5-Year SIP Wealth Projection
  const forecast1Yr = netSaved * 12;
  const monthlySip = netSaved > 0 ? netSaved * 0.5 : 1000;
  const annualRate = 0.12;
  const months = 60;
  const r = annualRate / 12;
  const sipFutureVal = monthlySip * (((Math.pow(1 + r, months) - 1) / r) * (1 + r));

  document.getElementById('forecast1Year').innerText = `${curr}${forecast1Yr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  document.getElementById('forecast5Year').innerText = `${curr}${sipFutureVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  // 50/30/20 Gauges
  const targetIncome = userProfile.salary || Math.max(income, 50000);
  const needsTarget = targetIncome * 0.5;
  const wantsTarget = targetIncome * 0.3;
  const investTarget = targetIncome * 0.15;
  const savingsTarget = targetIncome * 0.05;

  document.getElementById('taxNeedsVal').innerText = `${curr}${unavoidableSum.toLocaleString('en-IN')} / ${curr}${needsTarget.toLocaleString('en-IN')}`;
  document.getElementById('taxNeedsBar').style.width = `${Math.min(100, (unavoidableSum / needsTarget) * 100)}%`;
  document.getElementById('taxNeedsBar').style.background = unavoidableSum > needsTarget ? 'var(--gpay-red-light)' : 'var(--gpay-blue-light)';

  document.getElementById('taxWantsVal').innerText = `${curr}${unwantedSum.toLocaleString('en-IN')} / ${curr}${wantsTarget.toLocaleString('en-IN')}`;
  document.getElementById('taxWantsBar').style.width = `${Math.min(100, (unwantedSum / wantsTarget) * 100)}%`;
  document.getElementById('taxWantsBar').style.background = unwantedSum > wantsTarget ? 'var(--gpay-red-light)' : 'var(--gpay-yellow-light)';

  document.getElementById('taxInvestVal').innerText = `${curr}${investSum.toLocaleString('en-IN')} / ${curr}${investTarget.toLocaleString('en-IN')}`;
  document.getElementById('taxInvestBar').style.width = `${Math.min(100, (investSum / investTarget) * 100)}%`;
  document.getElementById('taxInvestBar').style.background = 'var(--gpay-green-light)';

  document.getElementById('taxSavingsVal').innerText = `${curr}${netSaved.toLocaleString('en-IN')} / ${curr}${savingsTarget.toLocaleString('en-IN')}`;
  document.getElementById('taxSavingsBar').style.width = `${Math.min(100, (netSaved / savingsTarget) * 100)}%`;
  document.getElementById('taxSavingsBar').style.background = 'var(--gpay-blue-light)';

  renderWaysToSaveAdvice(income, expenses, unavoidableSum, unwantedSum, investSum, netSaved, curr);
}

// Render Interactive Chart.js Graphs
function renderCharts() {
  let incomeSum = 0;
  let unavoidableSum = 0;
  let unwantedSum = 0;
  let investSum = 0;

  transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    if (t.type === 'Credit') {
      incomeSum += amt;
    } else {
      if (t.category === 'Unavoidable / Rent' || t.category === 'Fixed Needs') unavoidableSum += amt;
      else if (t.category === 'Unwanted / Leak' || t.category === 'Variable Wants') unwantedSum += amt;
      else if (t.category === 'Investments') investSum += amt;
      else unavoidableSum += amt;
    }
  });

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const labelColor = currentTheme === 'light' ? '#0f172a' : '#cbd5e1';
  const gridColor = currentTheme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';

  // Chart 1: Category Donut Chart
  const donutCtx = document.getElementById('categoryDonutChart');
  if (donutCtx) {
    if (categoryChartInstance) categoryChartInstance.destroy();

    const dataValues = [unavoidableSum, unwantedSum, investSum, incomeSum];
    const hasData = dataValues.some(v => v > 0);

    categoryChartInstance = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Fixed Needs / Rent', 'Unwanted Leaks', 'Investments', 'Total Income'],
        datasets: [{
          data: hasData ? dataValues : [50, 30, 15, 5],
          backgroundColor: ['#4285F4', '#EA4335', '#34A853', '#FBBC05'],
          borderWidth: 2,
          borderColor: currentTheme === 'light' ? '#ffffff' : '#181920'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: labelColor, font: { size: 11, family: 'Plus Jakarta Sans' }, boxWidth: 12 }
          }
        },
        cutout: '70%'
      }
    });
  }

  // Chart 2: Cash Flow Bar Chart
  const barCtx = document.getElementById('cashflowBarChart');
  if (barCtx) {
    if (cashflowChartInstance) cashflowChartInstance.destroy();

    const totalExpenseSum = unavoidableSum + unwantedSum + investSum;

    cashflowChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: ['Received (Income)', 'Paid (Expenses)', 'Net Saved'],
        datasets: [{
          label: 'Amount (' + (userProfile.currency || '₹') + ')',
          data: [incomeSum, totalExpenseSum, Math.max(0, incomeSum - totalExpenseSum)],
          backgroundColor: ['#34A853', '#EA4335', '#4285F4'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { color: labelColor, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: labelColor, font: { size: 10 } }, grid: { color: gridColor } }
        }
      }
    });
  }
}

// Generate Ways to Save Advice & Strategy Insights
function renderWaysToSaveAdvice(income, expenses, unavoidable, unwanted, invest, saved, curr) {
  const container = document.getElementById('waysToSaveContainer');
  if (!container) return;

  const adviceList = [];

  if (unwanted > 0) {
    const monthlyLeak = unwanted;
    const yearlyLeak = monthlyLeak * 12;
    adviceList.push({
      icon: 'fa-fire-flame-curved',
      color: '#EA4335',
      title: `Plug ${curr}${monthlyLeak.toLocaleString('en-IN')} Monthly Unwanted Spending`,
      desc: `You spent ${curr}${monthlyLeak.toLocaleString('en-IN')} on impulse & unwanted leaks this month. Cutting this by 50% saves ${curr}${(yearlyLeak / 2).toLocaleString('en-IN')} annually!`
    });
  }

  if (saved > 0) {
    const recommendedSip = Math.round(saved * 0.6);
    adviceList.push({
      icon: 'fa-arrow-trend-up',
      color: '#34A853',
      title: `Automate a ${curr}${recommendedSip.toLocaleString('en-IN')}/mo Mutual Fund SIP`,
      desc: `Investing 60% of your current monthly savings (${curr}${saved.toLocaleString('en-IN')}) into an Index Mutual Fund compounding at 12% grows into significant wealth over 5 years!`
    });
  }

  adviceList.push({
    icon: 'fa-shield-halved',
    color: '#4285F4',
    title: `Maintain Emergency Buffer Fund`,
    desc: `Ensure you have 3 to 6 months of fixed unavoidable expenses (${curr}${(unavoidable * 3).toLocaleString('en-IN')}) liquid in a high-yield savings account or liquid fund.`
  });

  container.innerHTML = adviceList.map(adv => `
    <div class="advice-card">
      <div class="advice-icon" style="background: rgba(66, 133, 244, 0.12); color: ${adv.color};">
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
  document.getElementById('modalHeaderTitle').innerText = 'New Payment Entry';
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

  document.getElementById('modalHeaderTitle').innerText = 'Edit Payment Entry';
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

/* ==========================================================================
   SAFEGUARDED DELETION MECHANISMS
   ========================================================================== */

function deleteTransaction(id) {
  const target = transactions.find(item => item.id === id);
  if (!target) return;

  const curr = userProfile.currency || '₹';
  const message = `⚠️ CONFIRM DELETION:\n\nAre you sure you want to delete payment:\n• Payee: ${target.merchant}\n• Amount: ${curr}${target.amount}\n• Date: ${target.date}\n\nThis will remove the transaction from your device and Supabase Cloud database.`;

  if (confirm(message)) {
    const targetId = id;
    transactions = transactions.filter(item => item.id !== targetId);
    saveToLocalStorage();
    renderGpayAvatars();
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
  if (transactions.length === 0) {
    alert('No real transactions logged to clear!');
    return;
  }

  const promptInput = prompt(`🚨 EXTREME CAUTION: DATA LOSS WARNING!\n\nYou are about to permanently delete ALL ${transactions.length} logged transactions.\n\nTo confirm, please type "DELETE ALL" in the box below:`);
  
  if (promptInput === 'DELETE ALL') {
    if (confirm('Final check: Are you 100% sure? This action CANNOT be undone!')) {
      transactions = [];
      saveToLocalStorage();
      renderGpayAvatars();
      renderTransactions();

      if (SUPABASE_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/transactions?id=gt.0`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }).catch(err => console.log('Supabase Clear error:', err));
      }
      alert('All transactions cleared successfully.');
    }
  } else if (promptInput !== null) {
    alert('❌ Confirmation failed! You did not type "DELETE ALL". Deletion cancelled.');
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
  renderGpayAvatars();
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
   AUTOMATED REGEX INGESTION ENGINE
   ========================================================================== */

function loadSampleText(key) {
  const input = document.getElementById('rawNotificationInput');
  if (!input) return;

  if (key === 'swiggy') {
    input.value = "Paid ₹480.00 to Swiggy via Google Pay UPI Ref 4239105. HDFC Bank A/C XX8912 debited.";
  } else if (key === 'hdfc') {
    input.value = "Rs. 12,500.00 debited from A/C XX8912 towards House Rent via HDFC NetBanking on 27-AUG-26.";
  } else if (key === 'salary') {
    input.value = "Credited with Rs. 1,00,000.00 from ACME Corp Salary Transfer to A/C XX8912 on 27-AUG-26.";
  }
  parseRawNotification();
}

function parseRawNotification() {
  const raw = document.getElementById('rawNotificationInput').value.trim();
  if (!raw) return;

  const amountRegex = /(?:rs\.?|re\.?|rupee|rupees|inr|₹|debited|credited|paid|spent|sent|transferred|amount|sum)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i;
  const merchantRegex = /(?:to|at|vpa|paid to|credited from|credited with|sent to|spent at|transferred to|towards)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i;
  const typeRegex = /(debited|credited|sent|received|paid|spent|deposited)/i;

  const amountMatch = raw.match(amountRegex);
  const merchantMatch = raw.match(merchantRegex);
  const typeMatch = raw.match(typeRegex);

  let amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0.00;
  if (!amount || amount === 0) {
    const anyNumMatch = raw.match(/(\d+(?:\.\d{1,2})?)/);
    if (anyNumMatch) amount = parseFloat(anyNumMatch[1]);
  }

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
  renderGpayAvatars();
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
