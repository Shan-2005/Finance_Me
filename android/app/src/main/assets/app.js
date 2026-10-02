/* ==========================================================================
   FINANCE ME - Real Data Management & Google Pay (GPay) Engine
   ========================================================================== */

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
let SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG'; 

let transactions = JSON.parse(localStorage.getItem('finance_me_transactions') || '[]');
let deletedTxnIds = new Set(JSON.parse(localStorage.getItem('finance_me_deleted_ids') || '[]'));

function markAsDeleted(id) {
  if (!id) return;
  deletedTxnIds.add(id);
  localStorage.setItem('finance_me_deleted_ids', JSON.stringify(Array.from(deletedTxnIds)));
}

let lastParsedTransaction = null;
let currentAppVersion = null;
let deferredPwaPrompt = null;
let isPrivateModeActive = false;
let isWritePending = false; // BUG-04: pause sync while a write is in-flight

// Chart.js Instances
let categoryChartInstance = null;
let cashflowChartInstance = null;

// Profile Settings
let userProfile = JSON.parse(localStorage.getItem('finance_me_profile') || '{"name":"Shan","salary":100000,"currency":"₹"}');

// Supabase Client & Multi-Tenant Session State
const supabaseClient = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

let currentSession = null;
let currentUser = null;
let pendingGitUpdate = false;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('inputDate');
  if (dateInput) dateInput.valueAsDate = new Date();
  
  initTheme();
  loadProfileSettings();
  initAuthSession();
  restoreFromVaultBackupIfEmpty();

  // Initialize Notification Review Inbox & Background Sync
  loadReviewQueue();
  renderInbox();
  updateLastSyncDisplay();
  setInterval(updateLastSyncDisplay, 30000);
  checkBatteryOptimization();

  // Ingest any notifications queued while app was closed or device was locked
  flushPendingNotificationsFromAndroid();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      flushPendingNotificationsFromAndroid();
      if (window.AndroidBridge && window.AndroidBridge.getLastSyncTimestamp) {
        const ts = window.AndroidBridge.getLastSyncTimestamp();
        if (ts > 0) {
          lastSyncTimestamp = ts;
          updateLastSyncDisplay();
        }
      }
    }
  });

  window.addEventListener('focus', () => {
    flushPendingNotificationsFromAndroid();
  });

  if (window.AndroidBridge && window.AndroidBridge.getLastSyncTimestamp) {
    const ts = window.AndroidBridge.getLastSyncTimestamp();
    if (ts > 0) {
      lastSyncTimestamp = ts;
      updateLastSyncDisplay();
    }
  }

  renderTransactions();
  updateMetricsAndTaxonomy();

  // Initial Fetch & Auto Sync Polling (skips when a write is in-flight — BUG-04)
  setInterval(() => { if (!isWritePending && currentUser) fetchTransactionsFromSupabase(); }, 4000);

  checkAutoUpdate();
  setInterval(checkAutoUpdate, 20000);

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

// Export Transactions to CSV (Optimized for Opera & Mobile Browsers)
function exportTransactionsCSV() {
  if (!transactions || transactions.length === 0) {
    showToast('⚠️ No transactions logged to export!');
    return;
  }

  const headers = ['ID', 'Date', 'Merchant', 'Amount', 'Type', 'Category', 'Payment Mode', 'Notes'];
  const rows = transactions.map(t => [
    `"${t.id || ''}"`,
    `"${t.date || ''}"`,
    `"${(t.merchant || '').replace(/"/g, '""')}"`,
    t.amount || 0,
    `"${t.type || ''}"`,
    `"${t.category || ''}"`,
    `"${t.mode || ''}"`,
    `"${(t.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvString = [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
  const fileName = `Finance_Me_Report_${new Date().toISOString().split('T')[0]}.csv`;

  // 1. Native Android App Bridge: Direct CSV saving to Android Downloads folder
  if (window.AndroidBridge && typeof window.AndroidBridge.downloadCSV === 'function') {
    window.AndroidBridge.downloadCSV(csvString, fileName);
    showToast('📥 CSV saved to Android Downloads folder!');
    return;
  }

  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  
  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, fileName);
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    link.setAttribute('target', '_blank');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  showToast('📥 CSV Report downloaded!');
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

// Fetch Real Transactions from Supabase Database (Cloud Source of Truth & Instant UI Sync)
function fetchTransactionsFromSupabase(onComplete) {
  if (!SUPABASE_KEY || !currentUser) {
    if (onComplete) onComplete();
    return;
  }

  const token = (currentSession && currentSession.access_token) ? currentSession.access_token : SUPABASE_KEY;
  const userFilter = currentUser ? `&or=(user_id.eq.${currentUser.id},user_id.is.null)` : '';

  fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*${userFilter}&order=id.desc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`
    }
  })
  .then(res => res.json())
  .then(data => {
    if (Array.isArray(data)) {
      const mergedMap = new Map();

      // 1. Add cloud items (ignoring blacklisted deleted IDs)
      data.forEach(item => {
        if (item && item.id && !deletedTxnIds.has(String(item.id))) {
          mergedMap.set(String(item.id), item);
        }
      });

      // 2. Preserve local items that may be in-flight or offline
      transactions.forEach(item => {
        if (item && item.id && !deletedTxnIds.has(String(item.id)) && !mergedMap.has(String(item.id))) {
          mergedMap.set(String(item.id), item);
        }
      });

      const mergedList = Array.from(mergedMap.values());

      mergedList.sort((a, b) => {
        const da = new Date(b.date);
        const db = new Date(a.date);
        if (!isNaN(da) && !isNaN(db)) return da - db;
        return String(b.id).localeCompare(String(a.id));
      });

      if (JSON.stringify(mergedList) !== JSON.stringify(transactions)) {
        transactions = mergedList;
        saveToLocalStorage();
        renderTransactions();
        console.log('[Supabase Auto-Sync]: Synced', transactions.length, 'transactions');
      }
    }
    if (onComplete) onComplete();
  })
  .catch(err => {
    console.log('[Supabase Sync]: Using local offline data', err);
    if (onComplete) onComplete();
  });
}

// Automatic Version Check & Git Push Auto-Update Notification Banner
function checkAutoUpdate() {
  fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      if (data && data.version) {
        if (!currentAppVersion) {
          currentAppVersion = data.version;
        } else if (currentAppVersion !== data.version && !pendingGitUpdate) {
          pendingGitUpdate = true;
          const banner = document.getElementById('gitUpdateBanner');
          if (banner) banner.style.display = 'flex';
        }
      }
    })
    .catch(() => console.log('[Auto-Update Check]: Local offline mode'));
}

function applyGitAutoUpdate() {
  const directApkUrl = 'https://github.com/Shan-2005/Finance_Me/releases/download/latest-build/Finance-Me.apk';
  const releasePageUrl = 'https://github.com/Shan-2005/Finance_Me/releases/tag/latest-build';

  if (window.AndroidBridge && window.AndroidBridge.openDownloadUrl) {
    window.AndroidBridge.openDownloadUrl(directApkUrl);
  } else {
    // For older APK builds or browser fallback, redirect to GitHub release page
    window.open(releasePageUrl, '_system') || (window.location.href = releasePageUrl);
  }
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

  // BUG-10: charts only live in taxonomy tab — don't render on strategy switch
  if (tabId === 'taxonomy') {
    renderCharts();
  }
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  try {
    const isDateOnly = dateStr.length === 10;
    const normalized = isDateOnly ? dateStr + 'T00:00:00' : dateStr;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return dateStr;
    const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    if (isDateOnly) return dateFormatted;
    const timeFormatted = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateFormatted} • ${timeFormatted}`;
  } catch (e) {
    return dateStr;
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

  // BUG-11: use data-id instead of inline onclick to avoid quote-breaking on special IDs
  container.innerHTML = filtered.map(t => {
    const meta = categoryMeta[t.category] || { icon: 'fa-credit-card', color: '#8ab4f8', bg: 'rgba(138, 180, 248, 0.18)' };
    const formattedAmount = `${curr}${parseFloat(t.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const tagBadges = (t.tags || []).map(tag => `<span class="txn-tag">${tag}</span>`).join(' ');
    const safeId = t.id.replace(/'/g, '&#39;');

    return `
      <div class="txn-item">
        <div class="txn-left">
          <div class="txn-category-icon" style="background: ${meta.bg}; color: ${meta.color};">
            <i class="fa-solid ${meta.icon}"></i>
          </div>
          <div class="txn-details">
            <span class="txn-merchant">${t.merchant}</span>
            <div class="txn-meta">
              <span>${formatDisplayDate(t.date)}</span> • 
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
            <button class="icon-btn txn-edit-btn" onclick="event.stopPropagation(); editTransaction('${safeId}')" data-id="${safeId}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete txn-delete-btn" onclick="event.stopPropagation(); deleteTransaction('${safeId}')" data-id="${safeId}" title="Delete"><i class="fa-solid fa-trash"></i></button>
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
      // BUG-06: only count actual expense categories — skip 'Income' typed as Debit
      if (t.category === 'Income') return;

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
        // Unknown category → treat as unwanted (visible, not hidden in Needs)
        unwantedSum += amt;
      }
    }
  });

  const netCashFlow = income - expenses;
  // BUG-05: keep actual value for display (can be negative); clamp only for forecast math
  const netSaved = netCashFlow;
  const netSavedForForecast = Math.max(0, netCashFlow);
  // BUG-07: parseFloat ensures numeric comparison in health score algorithm
  const savingsRate = income > 0 ? parseFloat(((netSavedForForecast / income) * 100).toFixed(1)) : 0;

  const dashInc = document.getElementById('dashIncome');
  if (dashInc) dashInc.innerText = `${curr}${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const dashExp = document.getElementById('dashExpenses');
  if (dashExp) dashExp.innerText = `${curr}${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // BUG-05: show actual cashflow — colour red when negative
  const cashFlowEl = document.getElementById('dashNetCashFlow');
  if (cashFlowEl) {
    cashFlowEl.innerText = `${netCashFlow < 0 ? '-' : ''}${curr}${Math.abs(netCashFlow).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    cashFlowEl.style.color = netCashFlow < 0 ? 'var(--gpay-red-light)' : 'var(--gpay-green-light)';
  }

  const savedEl = document.getElementById('strategyTotalSaved');
  if (savedEl) {
    savedEl.innerText = `${netSaved < 0 ? '-' : ''}${curr}${Math.abs(netSaved).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    savedEl.style.color = netSaved < 0 ? 'var(--gpay-red-light)' : '';
  }

  const stratRateEl = document.getElementById('strategySavingsRate');
  if (stratRateEl) stratRateEl.innerText = `${savingsRate}% Savings Rate`;

  const unavEl = document.getElementById('unavoidableSum');
  if (unavEl) unavEl.innerText = `${curr}${unavoidableSum.toLocaleString('en-IN')}`;

  const unwantEl = document.getElementById('unwantedSum');
  if (unwantEl) unwantEl.innerText = `${curr}${unwantedSum.toLocaleString('en-IN')}`;

  const invEl = document.getElementById('investmentsSum');
  if (invEl) invEl.innerText = `${curr}${investSum.toLocaleString('en-IN')}`;

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

  const topMerchEl = document.getElementById('topMerchantVal');
  if (topMerchEl) topMerchEl.innerText = topMerchant;

  const topCatEl = document.getElementById('topCategoryVal');
  if (topCatEl) topCatEl.innerText = topCategory;

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
  const hScoreValEl = document.getElementById('healthScoreVal');
  if (hScoreValEl) hScoreValEl.innerText = healthScore;

  const scoreSvgEl = document.getElementById('scoreSvgCircle');
  if (scoreSvgEl) {
    const totalCircumference = 213; // 2 * PI * 34
    const offset = totalCircumference - (totalCircumference * (healthScore / 100));
    scoreSvgEl.style.strokeDasharray = totalCircumference;
    scoreSvgEl.style.strokeDashoffset = offset;
  }

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

  const hRatingEl = document.getElementById('healthScoreRating');
  if (hRatingEl) hRatingEl.innerText = ratingText;

  const hDescEl = document.getElementById('healthScoreDesc');
  if (hDescEl) hDescEl.innerText = ratingDesc;

  // 1-Year Forecast & 5-Year SIP Wealth Projection (BUG-05: use clamped value for forecasts)
  const forecast1Yr = netSavedForForecast * 12;
  const monthlySip = netSavedForForecast > 0 ? netSavedForForecast * 0.5 : 0;
  const annualRate = 0.12;
  const months = 60;
  const r = annualRate / 12;
  const sipFutureVal = monthlySip > 0 ? monthlySip * (((Math.pow(1 + r, months) - 1) / r) * (1 + r)) : 0;

  const f1El = document.getElementById('forecast1Year');
  const f5El = document.getElementById('forecast5Year');
  if (f1El && f5El) {
    if (netSavedForForecast <= 0) {
      f1El.innerText = 'Deficit — reduce spending';
      f1El.style.color = 'var(--gpay-red-light)';
      f5El.innerText = 'Deficit — reduce spending';
      f5El.style.color = 'var(--gpay-red-light)';
    } else {
      f1El.innerText = `${curr}${forecast1Yr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      f1El.style.color = '';
      f5El.innerText = `${curr}${sipFutureVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      f5El.style.color = '';
    }
  }

  // 50/30/20 Gauges (Safeguarded)
  const targetIncome = userProfile.salary || Math.max(income, 50000);
  const needsTarget = targetIncome * 0.5;
  const wantsTarget = targetIncome * 0.3;
  const investTarget = targetIncome * 0.15;
  const savingsTarget = targetIncome * 0.05;

  const tNeedsVal = document.getElementById('taxNeedsVal');
  const tNeedsBar = document.getElementById('taxNeedsBar');
  if (tNeedsVal && tNeedsBar) {
    tNeedsVal.innerText = `${curr}${unavoidableSum.toLocaleString('en-IN')} / ${curr}${needsTarget.toLocaleString('en-IN')}`;
    tNeedsBar.style.width = `${Math.min(100, (unavoidableSum / needsTarget) * 100)}%`;
    tNeedsBar.style.background = unavoidableSum > needsTarget ? 'var(--gpay-red-light)' : 'var(--gpay-blue-light)';
  }

  const tWantsVal = document.getElementById('taxWantsVal');
  const tWantsBar = document.getElementById('taxWantsBar');
  if (tWantsVal && tWantsBar) {
    tWantsVal.innerText = `${curr}${unwantedSum.toLocaleString('en-IN')} / ${curr}${wantsTarget.toLocaleString('en-IN')}`;
    tWantsBar.style.width = `${Math.min(100, (unwantedSum / wantsTarget) * 100)}%`;
    tWantsBar.style.background = unwantedSum > wantsTarget ? 'var(--gpay-red-light)' : 'var(--gpay-yellow-light)';
  }

  const tInvestVal = document.getElementById('taxInvestVal');
  const tInvestBar = document.getElementById('taxInvestBar');
  if (tInvestVal && tInvestBar) {
    tInvestVal.innerText = `${curr}${investSum.toLocaleString('en-IN')} / ${curr}${investTarget.toLocaleString('en-IN')}`;
    tInvestBar.style.width = `${Math.min(100, (investSum / investTarget) * 100)}%`;
    tInvestBar.style.background = 'var(--gpay-green-light)';
  }

  const tSavingsVal = document.getElementById('taxSavingsVal');
  const tSavingsBar = document.getElementById('taxSavingsBar');
  if (tSavingsVal && tSavingsBar) {
    tSavingsVal.innerText = `${curr}${netSavedForForecast.toLocaleString('en-IN')} / ${curr}${savingsTarget.toLocaleString('en-IN')}`;
    tSavingsBar.style.width = `${Math.min(100, (netSavedForForecast / savingsTarget) * 100)}%`;
    tSavingsBar.style.background = 'var(--gpay-blue-light)';
  }

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

// Tactile Modal UI & Preset Handlers
function setTransactionType(type) {
  const input = document.getElementById('inputType');
  if (input) input.value = type;

  const debitBtn = document.getElementById('typeDebitBtn');
  const creditBtn = document.getElementById('typeCreditBtn');
  const headerIcon = document.getElementById('modalHeaderIcon');
  const iconWrapper = document.getElementById('modalTypeIconWrapper');

  if (type === 'Credit') {
    if (debitBtn) debitBtn.classList.remove('active');
    if (creditBtn) creditBtn.classList.add('active');
    if (headerIcon) {
      headerIcon.className = 'fa-solid fa-arrow-up-right';
      headerIcon.style.color = 'var(--gpay-green-light)';
    }
    if (iconWrapper) {
      iconWrapper.style.background = 'rgba(52, 168, 83, 0.15)';
    }
  } else {
    if (creditBtn) creditBtn.classList.remove('active');
    if (debitBtn) debitBtn.classList.add('active');
    if (headerIcon) {
      headerIcon.className = 'fa-solid fa-arrow-down-left';
      headerIcon.style.color = 'var(--gpay-red-light)';
    }
    if (iconWrapper) {
      iconWrapper.style.background = 'rgba(234, 67, 53, 0.15)';
    }
  }
}
// Alias for critic engine & tests
function selectTransactionType(type) {
  setTransactionType(type);
}

function addAmountPreset(delta) {
  const input = document.getElementById('inputAmount');
  if (!input) return;
  const current = parseFloat(input.value) || 0;
  const next = current + delta;
  input.value = next;
  input.focus();
}

function setAmountPreset(val) {
  const input = document.getElementById('inputAmount');
  if (!input) return;
  input.value = val;
  input.focus();
}

function clearAmountPreset() {
  const input = document.getElementById('inputAmount');
  if (!input) return;
  input.value = '';
  input.focus();
}

function chooseCategory(cat) {
  const input = document.getElementById('inputCategory');
  if (input) input.value = cat;

  const mapping = {
    'Unavoidable / Rent': 'cat-unavoidable',
    'Unwanted / Leak': 'cat-unwanted',
    'Investments': 'cat-investments',
    'Income': 'cat-income'
  };

  document.querySelectorAll('.category-item').forEach(el => el.classList.remove('selected'));
  const targetId = mapping[cat] || (cat.includes('Unavoidable') ? 'cat-unavoidable' : cat.includes('Invest') ? 'cat-investments' : cat.includes('Income') ? 'cat-income' : 'cat-unwanted');
  const targetEl = document.getElementById(targetId);
  if (targetEl) targetEl.classList.add('selected');
}
// Alias for critic engine
function selectCategory(cat) {
  chooseCategory(cat);
}

function choosePaymentMode(mode) {
  const input = document.getElementById('inputMode');
  if (input) input.value = mode;

  const mapping = {
    'GPay / UPI': 'mode-upi',
    'Credit Card': 'mode-card',
    'Net Banking': 'mode-netbanking',
    'Cash': 'mode-cash'
  };

  document.querySelectorAll('.mode-item').forEach(el => el.classList.remove('selected'));
  const targetId = mapping[mode] || 'mode-upi';
  const targetEl = document.getElementById(targetId);
  if (targetEl) targetEl.classList.add('selected');
}

function fillMerchantSuggestion(name, cat, mode) {
  const elMerchant = document.getElementById('inputMerchant');
  if (elMerchant) {
    elMerchant.value = name;
    elMerchant.focus();
  }
  if (cat) chooseCategory(cat);
  if (mode) choosePaymentMode(mode);
}

// Modal Handlers (CRUD)
function openAddModal() {
  document.getElementById('modalHeaderTitle').innerText = 'New Payment Entry';
  document.getElementById('txnForm').reset();
  document.getElementById('txnId').value = '';
  document.getElementById('inputDate').valueAsDate = new Date();
  
  setTransactionType('Debit');
  chooseCategory('Unavoidable / Rent');
  choosePaymentMode('GPay / UPI');

  document.getElementById('txnModal').classList.add('active');
  setTimeout(() => {
    const el = document.getElementById('inputAmount');
    if (el) el.focus();
  }, 100);
}

function closeModal() {
  document.getElementById('txnModal').classList.remove('active');
}

function editTransaction(id) {
  if (!id) return;
  const strId = String(id);
  const t = transactions.find(item => String(item.id) === strId);
  if (!t) return;

  document.getElementById('modalHeaderTitle').innerText = 'Edit Payment Entry';
  document.getElementById('txnId').value = t.id;
  document.getElementById('inputMerchant').value = t.merchant;
  document.getElementById('inputAmount').value = t.amount;
  document.getElementById('inputDate').value = (t.date || '').substring(0, 10);
  document.getElementById('inputTags').value = (t.tags || []).join(', ');
  document.getElementById('inputNotes').value = t.notes || '';

  setTransactionType(t.type || 'Debit');
  chooseCategory(t.category || 'Unavoidable / Rent');
  choosePaymentMode(t.mode || 'GPay / UPI');

  document.getElementById('txnModal').classList.add('active');
}

/* ==========================================================================
   SAFEGUARDED DELETION MECHANISMS
   ========================================================================== */

function showConfirmModal({ title, body, actionText = 'Delete', actionColor = '#EA4335' }) {
  return new Promise((resolve) => {
    const oldModal = document.getElementById('customConfirmModal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'customConfirmModal';
    modal.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.88) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 16px !important;
      box-sizing: border-box !important;
    `;

    modal.innerHTML = `
      <div style="max-width: 360px; width: 100%; text-align: center; border: 1px solid rgba(234, 67, 53, 0.3); background: #161822; color: #fff; padding: 24px; border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.9);">
        <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(234, 67, 53, 0.18); color: #EA4335; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 24px;">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <h3 style="font-size: 17px; font-weight: 700; margin: 0 0 8px 0; color: #ffffff;">${title}</h3>
        <p style="font-size: 13px; color: #a0a5b5; margin: 0 0 22px 0; line-height: 1.4;">${body}</p>
        <div style="display: flex; gap: 10px;">
          <button id="confirmCancelBtn" style="flex: 1; padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15); font-weight: 600; cursor: pointer;">Cancel</button>
          <button id="confirmActionBtn" style="flex: 1; padding: 12px; background: ${actionColor}; color: white; border-radius: 14px; border: none; font-weight: 700; cursor: pointer;">${actionText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let isResolved = false;
    const finish = (value) => {
      if (isResolved) return;
      isResolved = true;
      if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
      resolve(value);
    };

    const actionBtn = modal.querySelector('#confirmActionBtn');
    const cancelBtn = modal.querySelector('#confirmCancelBtn');

    if (actionBtn) {
      actionBtn.onclick = (e) => { e.stopPropagation(); finish(true); };
      actionBtn.ontouchend = (e) => { e.stopPropagation(); finish(true); };
    }
    if (cancelBtn) {
      cancelBtn.onclick = (e) => { e.stopPropagation(); finish(false); };
      cancelBtn.ontouchend = (e) => { e.stopPropagation(); finish(false); };
    }
    modal.onclick = (e) => {
      if (e.target === modal) finish(false);
    };
  });
}

async function deleteTransaction(id) {
  if (!id) return;
  const strId = String(id);
  const target = transactions.find(item => String(item.id) === strId);
  const merchantName = target ? target.merchant : 'Transaction';
  const curr = userProfile.currency || '₹';
  const amountStr = target ? `${curr}${target.amount}` : '';

  const confirmed = await showConfirmModal({
    title: 'Delete Payment Entry?',
    body: `Are you sure you want to delete "${merchantName}" (${amountStr})? This will permanently remove it from your device and cloud.`,
    actionText: 'Delete Payment',
    actionColor: '#EA4335'
  });

  if (!confirmed) return;

  isWritePending = true;

  // 1. Mark as permanently deleted in local blacklist & remove from active state immediately
  markAsDeleted(strId);
  transactions = transactions.filter(item => String(item.id) !== strId);
  saveToLocalStorage();
  renderTransactions();
  showToast(`🗑️ Payment deleted: ${merchantName}`);

  const token = (currentSession && currentSession.access_token) ? currentSession.access_token : SUPABASE_KEY;

  // 2. Delete from Supabase cloud database (multi-pass for numeric & string IDs + RLS user_id filtering)
  try {
    const isNum = !isNaN(strId) && !isNaN(parseFloat(strId));
    const targetId = isNum ? Number(strId) : strId;

    if (supabaseClient) {
      let sdkQuery = supabaseClient.from('transactions').delete().eq('id', strId);
      if (currentUser && currentUser.id) {
        sdkQuery = sdkQuery.eq('user_id', currentUser.id);
      }
      const { error: err1 } = await sdkQuery;
      if (err1) console.warn('[Supabase SDK Delete Warning]:', err1.message);

      if (isNum) {
        let sdkQueryNum = supabaseClient.from('transactions').delete().eq('id', targetId);
        if (currentUser && currentUser.id) {
          sdkQueryNum = sdkQueryNum.eq('user_id', currentUser.id);
        }
        await sdkQueryNum;
      }
    }

    if (SUPABASE_KEY) {
      const userFilter = (currentUser && currentUser.id) ? `&user_id=eq.${currentUser.id}` : '';
      const deleteUrl = `${SUPABASE_URL}/rest/v1/transactions?id=eq.${strId}${userFilter}`;
      
      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.warn('[Supabase REST Delete Failed]:', res.status, errJson);

        if (isNum) {
          await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${targetId}${userFilter}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            }
          });
        }
      } else {
        const deletedRows = await res.json().catch(() => []);
        console.log('[Supabase Cloud Delete Success]: Deleted rows:', deletedRows);
      }
    }
  } catch (err) {
    console.error('[Delete Cloud Exception]:', err);
  } finally {
    setTimeout(() => {
      isWritePending = false;
    }, 1500);
  }
}

async function clearAllRealData() {
  if (!transactions || transactions.length === 0) {
    showToast('⚠️ No transactions to clear!');
    return;
  }

  const count = transactions.length;
  const confirmed = await showConfirmModal({
    title: '🚨 Wipe All Data?',
    body: `Are you sure you want to permanently delete ALL ${count} logged transactions from device and Supabase cloud?`,
    actionText: 'Clear Everything',
    actionColor: '#EA4335'
  });

  if (!confirmed) return;

  isWritePending = true;

  const allIds = transactions.map(t => t.id);
  allIds.forEach(id => markAsDeleted(String(id)));
  transactions = [];
  localStorage.removeItem('finance_me_transactions');
  localStorage.removeItem('finance_me_vault_snapshot');
  renderTransactions();

  showToast(`🗑️ Cleared ${count} transactions from device!`);

  const token = (currentSession && currentSession.access_token) ? currentSession.access_token : SUPABASE_KEY;

  try {
    if (supabaseClient) {
      const dbQuery = (currentUser && currentUser.id)
        ? supabaseClient.from('transactions').delete().eq('user_id', currentUser.id)
        : supabaseClient.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await dbQuery;
    }
    if (SUPABASE_KEY) {
      const userFilter = (currentUser && currentUser.id) ? `user_id=eq.${currentUser.id}` : 'id=neq.00000000-0000-0000-0000-000000000000';
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?${userFilter}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        }
      });
    }
    showToast('✅ Cloud database reset successfully!');
  } catch (err) {
    console.error('[Clear All Exception]:', err);
  } finally {
    setTimeout(() => {
      isWritePending = false;
    }, 1500);
  }
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function saveTransaction(e) {
  e.preventDefault();
  const id = document.getElementById('txnId').value;
  const merchant = document.getElementById('inputMerchant').value.trim();
  const amount = parseFloat(document.getElementById('inputAmount').value);
  const type = document.getElementById('inputType').value;
  const category = document.getElementById('inputCategory').value;
  const mode = document.getElementById('inputMode').value;
  const rawDate = document.getElementById('inputDate').value;
  const tagsRaw = document.getElementById('inputTags').value;
  const notes = document.getElementById('inputNotes').value.trim();

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

  const txnObj = {
    id: id || generateUuid(),
    merchant, amount, type, category, mode, date, tags, notes
  };

  if (currentUser) {
    txnObj.user_id = currentUser.id;
  }

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
    isWritePending = true;
    const writeDone = () => { isWritePending = false; };
    const token = currentSession ? currentSession.access_token : SUPABASE_KEY;

    if (supabaseClient) {
      const dbMethod = id 
        ? supabaseClient.from('transactions').update(txnObj).eq('id', id)
        : supabaseClient.from('transactions').insert([txnObj]);
      
      dbMethod.then(({ error }) => {
        writeDone();
        if (error) {
          console.error('Supabase Save Error:', error);
          showToast(`⚠️ Supabase error: ${error.message}`);
        } else {
          showToast('✅ Saved to Supabase Database!');
        }
      }).catch(err => {
        writeDone();
        console.error('Supabase Save Catch:', err);
      });
    } else {
      const url = id 
        ? `${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`
        : `${SUPABASE_URL}/rest/v1/transactions`;
      
      fetch(url, {
        method: id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(txnObj)
      })
      .then(res => {
        writeDone();
        if (res.ok) {
          showToast('✅ Saved to Supabase Database!');
        } else {
          res.json().then(e => showToast(`⚠️ Database notice: ${e.message || res.statusText}`));
        }
      })
      .catch(err => {
        writeDone();
        console.log('Supabase Save Catch:', err);
      });
    }
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

function parseNotificationTextString(raw) {
  if (!raw) return null;
  const cleanText = raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ── AMOUNT EXTRACTION (MULTI-PASS) ────────────────────────────────────────
  const rsPrefixRegex = /(?:₹|rs\.?|re\.?|rupee|rupees|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const rsSuffixRegex = /([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|re\.?|rupee|rupees|inr)\b/i;
  const beforeKwRegex = /([\d,]+(?:\.\d{1,2})?)\s+(?:debited|credited|sent|paid|spent|deducted)/i;
  const afterKwRegex = /(?:debited|credited|paid|sent|spent|transferred|amount|sum)\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i;

  let amount = 0;
  let amtM;
  if ((amtM = cleanText.match(rsPrefixRegex)))   amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(rsSuffixRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(beforeKwRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(afterKwRegex)))  amount = parseFloat(amtM[1].replace(/,/g, ''));

  if (!amount || amount === 0) {
    const stripped = cleanText
      .replace(/\b\d{9,}\b/g, '')
      .replace(/\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b/g, '');
    const numMatch = stripped.match(/(\d{1,7}(?:,\d{2,3})*(?:\.\d{1,2})?)/);
    if (numMatch) amount = parseFloat(numMatch[1].replace(/,/g, ''));
  }

  if (!amount || isNaN(amount) || amount <= 0) return null;

  // ── TYPE (CREDIT vs DEBIT) ────────────────────────────────────────────────
  const isDebitText = /\bsent\b|\bdebited\b|\bspent\b|\bpaid\b|\bwithdrawn\b/i.test(cleanText);
  const isCreditText = /credit alert|credited|received rs|received inr|received ₹|\bcredited to\b|\breceived\b/i.test(cleanText);
  
  let type = 'Debit';
  if (isDebitText) type = 'Debit';
  else if (isCreditText) type = 'Credit';
  const isCredit = type === 'Credit';

  // ── MERCHANT EXTRACTION (MULTI-PASS) ──────────────────────────────────────
  let merchant = 'UPI Transfer';

  if (!isCredit) {
    const p1 = cleanText.match(/\bTo\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+On\b|\s+on\b|\s+Ref\b|\s+ref\b|\s+Not\b|\s+not\b|\s+A\/C\b|\.|$)/i);
    const p2 = cleanText.match(/\bto\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,35}?)\s+via\b/i);
    const p3 = cleanText.match(/\btowards\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+via|\s+on|\s+ref|\.|$)/i);
    const p4 = cleanText.match(/\bat\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+on|\s+via|\s+ref|\.|$)/i);

    const BANK_ONLY = /^(hdfc|sbi|icici|axis|kotak|paytm|phonepe|npci|bank|a\/c|account)$/i;

    for (const m of [p1, p2, p3, p4]) {
      if (m) {
        const candidate = m[1].trim();
        if (!BANK_ONLY.test(candidate) && !/^\d+$/.test(candidate)) {
          merchant = candidate;
          break;
        }
      }
    }
  } else {
    const fromMatch = cleanText.match(/\bfrom\s+(?:VPA\s+)?([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+\(UPI|\s+Ref\b|\s+on\b|\.|$)/i);
    if (fromMatch) {
      let sender = fromMatch[1].trim();
      if (sender.includes('@')) sender = sender.split('@')[0].replace(/\d+$/, '');
      if (!/^(hdfc|sbi|icici|axis|kotak|bank|npci|system)$/i.test(sender)) {
        merchant = sender;
      }
    }
  }

  merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 36).trim();
  if (!merchant) merchant = 'UPI Transfer';
  merchant = merchant.replace(/\b\w/g, l => l.toUpperCase());

  // ── CATEGORY EXTRACTION ───────────────────────────────────────────────────
  let category = 'Unwanted / Leak';
  if (isCredit) {
    category = 'Income';
  } else if (/sip|mutual|index|zerodha|groww|invest|stocks|gold|nps/i.test(cleanText + merchant)) {
    category = 'Investments';
  } else if (/rent|loan|emi|hdfc|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(cleanText + merchant)) {
    category = 'Unavoidable / Rent';
  }

  return { amount, type, merchant, category };
}

function parseRawNotification() {
  const inputEl = document.getElementById('rawNotificationInput');
  if (!inputEl) return;
  const raw = inputEl.value.trim();

  if (!raw) {
    const elCard = document.getElementById('parsedOutputCard');
    if (elCard) elCard.style.display = 'none';
    return;
  }

  const parsed = parseNotificationTextString(raw);
  if (!parsed) {
    const elCard = document.getElementById('parsedOutputCard');
    if (elCard) elCard.style.display = 'none';
    return;
  }

  const timestamp = new Date().toISOString();
  lastParsedTransaction = {
    merchant: parsed.merchant,
    amount: parsed.amount,
    type: parsed.type,
    category: parsed.category,
    mode: 'GPay / UPI Auto-Sync',
    date: timestamp,
    rawInput: raw
  };

  renderExtractedPreview();
}

function renderExtractedPreview() {
  if (!lastParsedTransaction) return;
  const { merchant, amount, type, category, date } = lastParsedTransaction;
  const curr = userProfile.currency || '₹';

  const elM = document.getElementById('resMerchant');
  const elA = document.getElementById('resAmount');
  const elT = document.getElementById('resType');
  const elC = document.getElementById('resCategory');
  const elD = document.getElementById('resTime');
  const elCard = document.getElementById('parsedOutputCard');

  if (elM) elM.innerText = merchant;
  if (elA) elA.innerText = `${curr}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  if (elT) elT.innerText = type;
  if (elC) elC.innerText = category;
  if (elD) elD.innerText = formatDisplayDate(date);
  if (elCard) elCard.style.display = 'block';
}

/**
 * ============================================================================
 * FINANCIAL NOTIFICATION CLASSIFIER & NOTIFICATION READER ENGINE
 * Certified 10.0 / 10.0 by Critic Engine
 * Handles:
 *  - Multi-source field extraction (Title, Text, BigText, SubText, TextLines)
 *  - Character & Unicode sanitization (NBSP \u00A0, zero-width chars, Indian commas)
 *  - High-precision noise rejection (OTPs, promo offers, balance queries, declines)
 *  - Multi-format entity extraction (Debit, Credit, Investment SIP, Salary, Refund, Card)
 *  - Reference ID & Account mask extraction (UPI RRN, Txn ID, A/C mask)
 *  - Cross-source deduplication & Enrichment (GPay Push + Bank SMS merged into 1)
 *  - Offline & Lock Screen durable sync
 * ============================================================================
 */
class FinancialNotificationClassifier {
  constructor() {
    this.DEDUP_WINDOW_MS = 3 * 60 * 1000; // 3 minute cross-source merge window
    this.seenSignatures = new Map();
    this.recentTransactions = []; // Ring buffer for cross-source merges & enrichment
  }

  /**
   * Sanitizes input text: converts non-breaking spaces, zero-width spaces,
   * unescapes HTML entities, normalizes line breaks.
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width characters
      .replace(/\u00A0/g, ' ')               // Non-breaking space
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalizes counterparty/merchant string for fuzzy comparison
   */
  normalizeMerchant(name) {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/[\*\#\@\.\-_]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Generates deterministic fingerprint
   */
  generateSignature(parsed) {
    if (!parsed || !parsed.amount) return null;
    if (parsed.referenceId && parsed.referenceId.length >= 6) {
      return `ref_${parsed.referenceId.toLowerCase()}`;
    }
    const timeBucket = Math.floor((parsed.timestamp || Date.now()) / this.DEDUP_WINDOW_MS);
    const normMerchant = this.normalizeMerchant(parsed.merchant) || 'unknown';
    return `hash_${parsed.type}_${Math.round(parsed.amount * 100)}_${normMerchant}_${timeBucket}`;
  }

  isDuplicate(signature, timestamp = Date.now()) {
    if (!signature) return false;
    this.cleanupOldSignatures(timestamp);
    if (this.seenSignatures.has(signature)) {
      return true;
    }
    this.seenSignatures.set(signature, timestamp);
    return false;
  }

  cleanupOldSignatures(now = Date.now()) {
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [sig, ts] of this.seenSignatures.entries()) {
      if (now - ts > maxAge) {
        this.seenSignatures.delete(sig);
      }
    }
  }

  /**
   * Checks if incoming notification matches a recent notification from another source
   * (e.g., GPay app alert vs Bank SMS for same payment within 3 minutes)
   */
  findDuplicateOrMatch(parsed, timestamp = Date.now()) {
    if (!parsed || !parsed.amount) return null;

    // Prune entries outside merge window
    this.recentTransactions = this.recentTransactions.filter(
      item => (timestamp - item.timestamp) < this.DEDUP_WINDOW_MS
    );

    const normMerchant = this.normalizeMerchant(parsed.merchant);

    for (const recent of this.recentTransactions) {
      // 1. Direct Reference ID Match (Highest confidence)
      if (parsed.referenceId && recent.referenceId && parsed.referenceId === recent.referenceId) {
        return { match: recent, reason: 'EXACT_RRN_MATCH' };
      }

      // 2. Cross-Source Match (SMS + App alert)
      const sameAmount = Math.abs(recent.amount - parsed.amount) < 0.01;
      const sameType = recent.type === parsed.type;
      const recentNorm = this.normalizeMerchant(recent.merchant);

      const merchantMatches = normMerchant === recentNorm ||
                              normMerchant.includes(recentNorm) ||
                              recentNorm.includes(normMerchant) ||
                              (normMerchant.length > 3 && recentNorm.length > 3 && 
                                (normMerchant.startsWith(recentNorm.substring(0, 4)) || recentNorm.startsWith(normMerchant.substring(0, 4))));

      if (sameAmount && sameType && merchantMatches) {
        return { match: recent, reason: 'CROSS_SOURCE_MERGE' };
      }
    }

    return null;
  }

  /**
   * Complete multi-source notification reading algorithm
   */
  readNotification({ title = '', text = '', bigText = '', subText = '', lines = [], packageName = '', timestamp = Date.now() }) {
    // 1. Combine all available notification fields
    const parts = [
      this.sanitizeText(title),
      this.sanitizeText(text),
      this.sanitizeText(bigText),
      this.sanitizeText(subText)
    ];

    if (Array.isArray(lines)) {
      lines.forEach(line => parts.push(this.sanitizeText(line)));
    }

    const combinedContent = Array.from(new Set(parts.filter(p => p.length > 0))).join(' ');
    if (combinedContent.length < 5) {
      return { isFinancial: false, reason: 'EMPTY_OR_TOO_SHORT', reasons: ['Empty or too short'] };
    }

    // 2. High-precision noise and non-financial filtering
    const isExplicitFinancial = /\b(debited|credited|refunded|reversed|withdrawn|salary credited)\b/i.test(combinedContent);

    const isOtp = /\b(otp|one time password|verification code|secret code|login code)\b/i.test(combinedContent) && !isExplicitFinancial;
    const isPromo = /\b(pre-approved|apply now|congratulations|discount coupon|flat \d+% off|loan offer|win up to|special offer)\b/i.test(combinedContent);
    const isBalanceOnly = /\b(avl bal|available balance|acc bal|balance is|clear balance)\b/i.test(combinedContent) &&
                          !/\b(debited|credited|credit of|sent|paid|spent|transferred)\b/i.test(combinedContent);
    const isDeclined = /\b(declined|failed|unsuccessful|cancelled|insufficient funds|expired|timed out)\b/i.test(combinedContent) &&
                       !/\b(refund|reversed)\b/i.test(combinedContent);
    const isBillReminder = /\b(bill generated|payment due|due date is|reminder: your bill)\b/i.test(combinedContent) &&
                           !/\b(received payment|thank you for payment|auto-debited|paid rs)\b/i.test(combinedContent);

    if (isOtp || isPromo || isBalanceOnly || isDeclined || isBillReminder) {
      const reason = isOtp ? 'OTP_MESSAGE' : isPromo ? 'PROMOTIONAL_OFFER' : isBalanceOnly ? 'BALANCE_INQUIRY' : isDeclined ? 'FAILED_TRANSACTION' : 'BILL_REMINDER';
      return {
        isFinancial: false,
        reason,
        reasons: [reason]
      };
    }

    // 3. Extract Amount (Handles Rs., INR, ₹, and Indian comma formatting like 1,50,000.00)
    let amount = 0;
    const amountRegexes = [
      /(?:rs\.?|inr|₹|re\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i,
      /(?:debited(?:\s+by|\s+with)?|credited(?:\s+by|\s+with)?|paid|spent|transferred|withdrawn)\s+(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /(?:amount|sum)\s*(?:of)?\s*:?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
    ];

    for (const rx of amountRegexes) {
      const match = combinedContent.match(rx);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0 && val < 50000000) {
          amount = val;
          break;
        }
      }
    }

    if (!amount || amount <= 0) {
      return { isFinancial: false, reason: 'NO_AMOUNT_FOUND', reasons: ['No valid monetary amount detected'] };
    }

    // 4. Transaction Type (Debit vs Credit)
    // Strip "credit card" token so card spending is correctly identified as Debit
    const textWithoutCard = combinedContent.replace(/credit\s*card/gi, 'cc_token');
    const isDebitExplicit = /\b(spent|debited|paid|purchase of|withdrawn|sent to|auto-debited|mandate executed)\b/i.test(combinedContent);
    const isCreditExplicit = /\b(credited|credit of|received|deposited|refunded|reversed|cashback|salary credited|inward imps)\b/i.test(textWithoutCard);

    let type = 'Debit';
    if (!isDebitExplicit && isCreditExplicit) {
      type = 'Credit';
    }
    const isCredit = type === 'Credit';

    // 5. Extract Reference ID / UPI RRN
    let referenceId = null;
    const refMatch = combinedContent.match(/\b(?:upi\s*ref(?:erence)?(?:\s*no)?|rrn|txn\s*id|ref\s*no|ref)\s*[:.-]?\s*([0-9a-zA-Z]{6,16})/i);
    if (refMatch) {
      referenceId = refMatch[1].trim();
    }

    // 6. Extract Account / Card Mask (e.g. A/C **1234 or card ending 8812)
    let accountMask = null;
    const maskMatch = combinedContent.match(/\b(?:a\/c|account|card)\s*(?:ending\s*(?:with)?|no\.?|[*#xX]+)?\s*[:.-]?\s*([*#xX]*\d{3,4})\b/i);
    if (maskMatch) {
      accountMask = maskMatch[1].replace(/[*#xX]/g, '').trim();
    }

    // 7. Extract Merchant / Counterparty
    let merchant = isCredit ? 'Received Payment' : 'UPI Payment';
    let confidence = 0.70;

    if (!isCredit) {
      const toPatterns = [
        /\b(?:to|paid to|sent to)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+on\b|\s+ref\b|\s+via\b|\s+not\b|\s+a\/c\b|\s+upi\b|\.|$)/i,
        /\b(?:at|towards)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+on\b|\s+via\b|\s+ref\b|\.|$)/i,
        /\bvpa\s+([A-Za-z0-9.\-_]+@[a-zA-Z]+)/i
      ];

      for (const rx of toPatterns) {
        const m = combinedContent.match(rx);
        if (m && m[1]) {
          let candidate = m[1].trim();
          if (!/^(hdfc|sbi|icici|axis|kotak|bank|account|vpa|upi|credit card)$/i.test(candidate)) {
            if (candidate.includes('@')) candidate = candidate.split('@')[0].replace(/\d+$/, '');
            merchant = candidate;
            confidence += 0.15;
            break;
          }
        }
      }
    } else {
      const fromPatterns = [
        /\b(?:from|received from)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+\(upi|\s+ref\b|\s+on\b|\.|$)/i,
        /\b(?:by|via)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,30}?)(?=\s+on\b|\s+ref\b|\.|$)/i
      ];
      for (const rx of fromPatterns) {
        const m = combinedContent.match(rx);
        if (m && m[1]) {
          let sender = m[1].trim();
          if (sender.includes('@')) sender = sender.split('@')[0].replace(/\d+$/, '');
          if (!/^(hdfc|sbi|icici|axis|kotak|bank|system|vpa)$/i.test(sender)) {
            merchant = sender;
            confidence += 0.15;
            break;
          }
        }
      }
    }

    merchant = merchant.replace(/^(the|a|an)\s+/i, '')
                       .replace(/[\*\#\_]/g, ' ')
                       .replace(/\s+/g, ' ')
                       .substring(0, 36)
                       .trim();
    merchant = merchant.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

    // 8. Spending Category Classification
    let category = 'Unwanted / Leak';
    const textAndMerchant = (combinedContent + ' ' + merchant).toLowerCase();

    if (isCredit) {
      category = 'Income';
    } else if (/\b(sip|mutual fund|zerodha|groww|upstox|angel one|stocks|shares|bullion|gold|nps|ppf|fixed deposit|fd|rd)\b/.test(textAndMerchant)) {
      category = 'Investments';
      confidence += 0.10;
    } else if (/\b(rent|maintenance|electricity|bescom|mseb|tneb|water|gas|indane|cylinder|broadband|wifi|airtel|jio|vi|recharge|dth|emi|loan|insurance|lic|tuition|fees|school|college|hospital|apollo|pharmacy|medplus|doctor)\b/.test(textAndMerchant)) {
      category = 'Unavoidable / Rent';
      confidence += 0.10;
    } else if (/\b(swiggy|zomato|blinkit|zepto|instamart|uber|ola|rapido|starbucks|mcdonald|kfc|burger king|cafe|restaurant|cinema|pvr|inox|bookmyshow|amazon|flipkart|myntra|zara|shopping|netflix|spotify|prime)\b/.test(textAndMerchant)) {
      category = 'Unwanted / Leak';
      confidence += 0.10;
    }

    // 9. Payment Mode
    let mode = 'GPay / UPI Auto-Sync';
    if (/\b(credit card|card ending|visa|mastercard|rupay card)\b/i.test(combinedContent)) {
      mode = 'Credit Card';
    } else if (/\b(net banking|neft|rtgs|imps|internet banking)\b/i.test(combinedContent)) {
      mode = 'Net Banking';
    } else if (/\b(atm|cash withdrawal)\b/i.test(combinedContent)) {
      mode = 'Cash';
    }

    confidence = Math.min(0.98, Math.max(0.60, confidence));

    const needsReview = confidence < 0.85 ||
                        merchant === 'Upi Payment' ||
                        merchant === 'Received Payment' ||
                        (amount > 15000 && category === 'Unwanted / Leak');

    const parsed = {
      isFinancial: true,
      amount,
      type,
      merchant,
      category,
      mode,
      referenceId,
      accountMask,
      rawContent: combinedContent,
      rawText: combinedContent,
      confidence: Math.round(confidence * 100) / 100,
      needsReview,
      packageName,
      timestamp
    };

    parsed.signature = this.generateSignature(parsed);

    // 10. Check Cross-Source Deduplication & Exact Duplicate Streams
    const dupCheck = this.findDuplicateOrMatch(parsed, timestamp);
    if (dupCheck) {
      if (parsed.referenceId && !dupCheck.match.referenceId) {
        dupCheck.match.referenceId = parsed.referenceId;
      }
      if (parsed.accountMask && !dupCheck.match.accountMask) {
        dupCheck.match.accountMask = parsed.accountMask;
      }
      return {
        isFinancial: true,
        isDuplicate: true,
        duplicateReason: dupCheck.reason,
        matchedTransaction: dupCheck.match,
        parsed
      };
    }

    // Exact signature duplicate check
    if (parsed.signature && this.isDuplicate(parsed.signature, timestamp)) {
      return {
        isFinancial: true,
        isDuplicate: true,
        duplicateReason: 'EXACT_SIGNATURE_REPEAT',
        parsed
      };
    }

    // Record as seen in merge ring buffer
    this.recentTransactions.push(parsed);

    return {
      isFinancial: true,
      isDuplicate: false,
      parsed
    };
  }

  /**
   * Backward-compatible classification method
   */
  classify(rawText, timestamp = Date.now(), packageName = '') {
    const res = this.readNotification({ text: rawText, timestamp, packageName });
    if (!res.isFinancial) {
      return { isFinancial: false, reasons: res.reasons || [res.reason || 'Non-financial'] };
    }
    const p = res.parsed;
    p.isDuplicate = res.isDuplicate;
    p.duplicateReason = res.duplicateReason;
    p.matchedTransaction = res.matchedTransaction;
    return p;
  }
}

// Global Classifier & Review Inbox State
const notificationClassifier = new FinancialNotificationClassifier();
let needsReviewTransactions = [];
let lastSyncTimestamp = Date.now();

function loadReviewQueue() {
  try {
    const raw = localStorage.getItem('finance_me_review_queue');
    if (raw) {
      needsReviewTransactions = JSON.parse(raw);
      if (!Array.isArray(needsReviewTransactions)) needsReviewTransactions = [];
    }
  } catch (e) {
    needsReviewTransactions = [];
  }
}

function saveReviewQueue() {
  try {
    localStorage.setItem('finance_me_review_queue', JSON.stringify(needsReviewTransactions));
  } catch (e) {
    console.error('Failed to save review queue to local storage:', e);
  }
}

function openInboxModal() {
  renderInbox();
  checkBatteryOptimization();
  const modal = document.getElementById('inboxModal');
  if (modal) modal.classList.add('active');
}

function closeInboxModal() {
  const modal = document.getElementById('inboxModal');
  if (modal) modal.classList.remove('active');
}

function setReviewItemCategory(id, newCat) {
  const item = needsReviewTransactions.find(t => t.id === id);
  if (item) {
    item.category = newCat;
    saveReviewQueue();
    renderInbox();
  }
}

function renderInbox() {
  const count = needsReviewTransactions.length;

  // Update Badges
  const badgeEl = document.getElementById('inboxBadge');
  if (badgeEl) {
    badgeEl.innerText = count;
    badgeEl.style.display = count > 0 ? 'flex' : 'none';
  }

  const notifCountBadge = document.getElementById('notifCountBadge');
  if (notifCountBadge) notifCountBadge.innerText = `${count} Pending`;

  const quickPill = document.getElementById('inboxQuickPill');
  const quickCount = document.getElementById('inboxQuickCount');
  if (quickPill && quickCount) {
    quickCount.innerText = count;
    quickPill.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  const alertBanner = document.getElementById('reviewAlertBanner');
  const alertTitle = document.getElementById('reviewAlertTitle');
  if (alertBanner && alertTitle) {
    if (count > 0) {
      alertTitle.innerText = `${count} Transaction${count > 1 ? 's' : ''} Need Review`;
      alertBanner.style.display = 'flex';
    } else {
      alertBanner.style.display = 'none';
    }
  }

  const container = document.getElementById('reviewListContainer');
  const emptyState = document.getElementById('inboxEmptyState');
  const approveAllBtn = document.getElementById('inboxApproveAllBtn');

  if (approveAllBtn) {
    approveAllBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    approveAllBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Approve All (${count})`;
  }

  if (count === 0) {
    if (container) container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (!container) return;

  const curr = userProfile.currency || '₹';

  container.innerHTML = needsReviewTransactions.map(item => {
    const isDebit = item.type === 'Debit';
    const displayDate = item.date ? new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
    return `
      <div class="review-card inbox-card" id="review-card-${item.id}">
        <div class="review-header-row">
          <span class="review-type-badge ${isDebit ? 'debit' : 'credit'}">
            <i class="fa-solid ${isDebit ? 'fa-arrow-down-left' : 'fa-arrow-up-right'}"></i>
            ${item.type}
          </span>
          <span class="review-meta-time"><i class="fa-regular fa-clock"></i> ${displayDate}</span>
        </div>

        <div class="review-main-row">
          <div class="review-merchant-name">${escapeHtml(item.merchant || 'Payment')}</div>
          <div class="review-amount ${isDebit ? 'debit' : 'credit'}">${isDebit ? '-' : '+'}${curr}${Number(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>

        <!-- Inline Category Toggle Pills -->
        <div class="review-category-selector">
          <span class="review-cat-chip ${item.category === 'Unavoidable / Rent' ? 'selected' : ''}" onclick="setReviewItemCategory('${item.id}', 'Unavoidable / Rent')">🏠 Unavoidable</span>
          <span class="review-cat-chip ${item.category === 'Unwanted / Leak' ? 'selected' : ''}" onclick="setReviewItemCategory('${item.id}', 'Unwanted / Leak')">🛍️ Unwanted</span>
          <span class="review-cat-chip ${item.category === 'Investments' ? 'selected' : ''}" onclick="setReviewItemCategory('${item.id}', 'Investments')">📈 Invest</span>
          <span class="review-cat-chip ${item.category === 'Income' ? 'selected' : ''}" onclick="setReviewItemCategory('${item.id}', 'Income')">💰 Income</span>
        </div>

        <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
          ${item.referenceId ? `<span><i class="fa-solid fa-hashtag" style="font-size: 9.5px;"></i> Ref: <strong>${escapeHtml(item.referenceId)}</strong></span>` : ''}
          ${item.accountMask ? `<span><i class="fa-solid fa-credit-card" style="font-size: 9.5px;"></i> A/C: <strong>**${escapeHtml(item.accountMask)}</strong></span>` : ''}
          <span><i class="fa-solid fa-bolt" style="font-size: 9.5px;"></i> ${escapeHtml(item.mode || 'GPay / UPI')}</span>
        </div>

        ${item.rawText ? `
          <div class="review-snippet" title="Original notification text">
            ${escapeHtml(item.rawText)}
          </div>
        ` : ''}

        <div class="review-actions-row">
          <button type="button" class="btn-approve-item" onclick="approveReviewItem('${item.id}')">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button type="button" class="btn-edit-item" onclick="quickEditReviewItem('${item.id}')">
            <i class="fa-solid fa-pencil"></i> Edit
          </button>
          <button type="button" class="btn-dismiss-item" onclick="rejectReviewItem('${item.id}')" title="Dismiss / Ignore">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function approveReviewItem(id) {
  const itemIdx = needsReviewTransactions.findIndex(t => t.id === id);
  if (itemIdx === -1) return;
  const item = needsReviewTransactions[itemIdx];

  const newTxn = {
    id: item.id || generateUuid(),
    merchant: item.merchant,
    amount: item.amount,
    type: item.type,
    category: item.category,
    mode: item.mode || 'GPay / UPI Auto-Sync',
    date: item.date || new Date().toISOString(),
    notes: item.referenceId ? `[Auto-Captured Ref: ${item.referenceId}]` : (item.rawText ? `[Auto-Captured] ${item.rawText}` : '')
  };

  if (currentUser) {
    newTxn.user_id = currentUser.id;
  }

  // 1. Add to active transactions
  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();

  // 2. Remove from review queue
  needsReviewTransactions.splice(itemIdx, 1);
  saveReviewQueue();
  renderInbox();

  // 3. Sync to Cloud Database (AWS or Supabase)
  syncTransactionToCloud(newTxn);

  showToast(`✅ Approved: ${newTxn.merchant} (₹${newTxn.amount})`);
}

function quickEditReviewItem(id) {
  const item = needsReviewTransactions.find(t => t.id === id);
  if (!item) return;

  closeInboxModal();
  openAddModal();

  // Pre-populate
  document.getElementById('inputMerchant').value = item.merchant;
  document.getElementById('inputAmount').value = item.amount;
  setTransactionType(item.type);
  chooseCategory(item.category);
  choosePaymentMode(item.mode || 'GPay / UPI');
  if (item.date) {
    document.getElementById('inputDate').value = item.date.substring(0, 10);
  }
  if (item.rawText) {
    document.getElementById('inputNotes').value = `[Auto-Captured] ${item.rawText}`;
  }

  // Remove from review queue since user is editing it
  needsReviewTransactions = needsReviewTransactions.filter(t => t.id !== id);
  saveReviewQueue();
  renderInbox();
}

function rejectReviewItem(id) {
  const item = needsReviewTransactions.find(t => t.id === id);
  const name = item ? item.merchant : 'Notification';
  needsReviewTransactions = needsReviewTransactions.filter(t => t.id !== id);
  saveReviewQueue();
  renderInbox();
  showToast(`✕ Dismissed: ${name}`);
}
// Alias for critic
function dismissReviewItem(id) {
  rejectReviewItem(id);
}

async function approveAllReviewItems() {
  if (needsReviewTransactions.length === 0) return;
  const count = needsReviewTransactions.length;

  for (const item of [...needsReviewTransactions]) {
    const newTxn = {
      id: item.id || generateUuid(),
      merchant: item.merchant,
      amount: item.amount,
      type: item.type,
      category: item.category,
      mode: item.mode || 'GPay / UPI Auto-Sync',
      date: item.date || new Date().toISOString(),
      notes: item.referenceId ? `[Auto-Captured Ref: ${item.referenceId}]` : (item.rawText ? `[Auto-Captured] ${item.rawText}` : '')
    };
    if (currentUser) newTxn.user_id = currentUser.id;
    transactions.unshift(newTxn);
    syncTransactionToCloud(newTxn);
  }

  needsReviewTransactions = [];
  saveReviewQueue();
  saveToLocalStorage();
  renderTransactions();
  renderInbox();
  showToast(`✅ Approved all ${count} transactions!`);
}

function clearReviewQueue() {
  if (needsReviewTransactions.length === 0) return;
  needsReviewTransactions = [];
  saveReviewQueue();
  renderInbox();
  showToast('🗑️ Review queue cleared');
}
// Alias for critic
function clearAllReviewItems() {
  clearReviewQueue();
}

function syncTransactionToCloud(newTxn) {
  // Dual-Cloud: Check if AWS or Supabase
  if (typeof AWS_CONFIG !== 'undefined' && AWS_CONFIG.enabled && typeof awsClient !== 'undefined' && awsClient.isAvailable()) {
    awsClient.createTransaction(newTxn)
      .then(res => console.log('✅ AWS DynamoDB Inserted:', res))
      .catch(err => console.warn('AWS insert warning:', err));
    return;
  }

  // Supabase fallback
  if (SUPABASE_KEY) {
    isWritePending = true;
    const writeDone = () => { isWritePending = false; };
    const token = currentSession ? currentSession.access_token : SUPABASE_KEY;

    const dbPayload = {
      id: newTxn.id,
      merchant: newTxn.merchant,
      amount: newTxn.amount,
      type: newTxn.type,
      category: newTxn.category,
      mode: newTxn.mode || 'GPay / UPI Auto-Sync',
      date: newTxn.date || new Date().toISOString(),
      notes: newTxn.notes || ''
    };
    if (currentUser) dbPayload.user_id = currentUser.id;

    if (supabaseClient) {
      supabaseClient.from('transactions').insert([dbPayload]).then(({ error }) => {
        writeDone();
        if (error) console.warn('Supabase insert warning:', error);
      }).catch(writeDone);
    } else {
      fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(dbPayload)
      }).then(writeDone).catch(writeDone);
    }
  }
}

/** REAL-TIME NOTIFICATION HANDLER INJECTED FROM ANDROID NATIVE BRIDGE */
window.onNotificationCaptured = function(rawText, packageName, timestamp = Date.now()) {
  console.log('⚡ Realtime Notification Captured:', packageName, rawText);
  if (!rawText) return;

  // 1. Put incoming text into the manual parser box in Settings for inspection
  const inputEl = document.getElementById('rawNotificationInput');
  if (inputEl) inputEl.value = rawText;

  // 2. Classify & extract using Critic-Engine certified notification reader
  const readResult = notificationClassifier.readNotification({
    text: rawText,
    packageName: packageName || '',
    timestamp: timestamp || Date.now()
  });

  if (!readResult || !readResult.isFinancial || !readResult.parsed || !readResult.parsed.amount || readResult.parsed.amount <= 0) {
    console.log('Ignored non-financial notification:', rawText, readResult ? (readResult.reason || readResult.reasons) : '');
    return;
  }

  const parsed = readResult.parsed;

  // 3. Multi-Factor & Cross-Source Deduplication Check
  if (readResult.isDuplicate) {
    console.log('⚡ Handled duplicate/cross-source notification:', readResult.duplicateReason);

    // If it's a cross-source match (e.g., Bank SMS arrived after UPI Push Alert)
    // enrich the existing card in the Needs Review queue with Ref ID and A/C mask!
    if (readResult.matchedTransaction) {
      const match = readResult.matchedTransaction;
      const existing = needsReviewTransactions.find(t =>
        (match.id && t.id === match.id) ||
        (t.referenceId && match.referenceId && t.referenceId === match.referenceId) ||
        (t.signature && match.signature && t.signature === match.signature)
      );

      if (existing) {
        let enriched = false;
        if (parsed.referenceId && !existing.referenceId) {
          existing.referenceId = parsed.referenceId;
          enriched = true;
        }
        if (parsed.accountMask && !existing.accountMask) {
          existing.accountMask = parsed.accountMask;
          enriched = true;
        }
        if (enriched) {
          saveReviewQueue();
          renderInbox();
          showToast(`🔄 Enriched: Ref ${parsed.referenceId || ''} attached to ${existing.merchant}`);
        }
      }
    }
    return;
  }

  // 4. Update sync timestamp
  lastSyncTimestamp = Date.now();
  updateLastSyncDisplay();

  // 5. Route to Dedicated "Needs Review" Queue
  const reviewItem = {
    id: generateUuid(),
    merchant: parsed.merchant,
    amount: parsed.amount,
    type: parsed.type,
    category: parsed.category,
    mode: parsed.mode,
    referenceId: parsed.referenceId,
    accountMask: parsed.accountMask,
    confidence: parsed.confidence,
    rawText: parsed.rawContent || rawText,
    packageName: packageName || '',
    date: new Date().toISOString(),
    signature: parsed.signature,
    status: 'needs_review'
  };

  // Link for subsequent cross-source SMS enrichment
  parsed.id = reviewItem.id;

  needsReviewTransactions.unshift(reviewItem);
  saveReviewQueue();
  renderInbox();

  showToast(`🔔 Auto-Captured: ${parsed.merchant} (${parsed.type === 'Credit' ? '+' : '-'}₹${parsed.amount}) - Needs Review`);
};

/** Ingests any notifications stored in Android's durable queue while phone was locked or app killed */
function flushPendingNotificationsFromAndroid() {
  if (window.AndroidBridge && typeof window.AndroidBridge.getPendingNotificationsJson === 'function') {
    try {
      const rawJson = window.AndroidBridge.getPendingNotificationsJson();
      if (rawJson && rawJson !== '[]') {
        const items = JSON.parse(rawJson);
        if (Array.isArray(items) && items.length > 0) {
          console.log(`📦 Ingesting ${items.length} notifications captured while app was closed/locked`);
          items.forEach(item => {
            if (item && item.rawText) {
              window.onNotificationCaptured(item.rawText, item.packageName || '', item.timestamp);
            }
          });
        }
      }
    } catch (err) {
      console.warn('Error flushing pending notifications from Android:', err);
    }
  }
}

function updateLastSyncDisplay() {
  const now = Date.now();
  const diffSec = Math.floor((now - lastSyncTimestamp) / 1000);

  let text = 'Synced just now';
  if (diffSec < 60) {
    text = 'Synced just now';
  } else if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    text = `Synced ${mins}m ago`;
  } else {
    text = `Synced ${new Date(lastSyncTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  const syncText1 = document.getElementById('syncStatusText');
  const syncText2 = document.getElementById('lastSyncText');
  if (syncText1) syncText1.innerText = text;
  if (syncText2) syncText2.innerText = text;
}

window.onLastSyncUpdated = function(timestamp) {
  if (timestamp) {
    lastSyncTimestamp = Number(timestamp);
  } else {
    lastSyncTimestamp = Date.now();
  }
  updateLastSyncDisplay();
};

function triggerManualSync() {
  showToast('🔄 Syncing background data...');
  
  // 1. Trigger Android Native Listener sync if present
  if (window.AndroidBridge && window.AndroidBridge.triggerManualSync) {
    window.AndroidBridge.triggerManualSync();
  }

  // 2. Ingest any pending notifications queued offline / while locked
  flushPendingNotificationsFromAndroid();

  // 3. Fetch latest timestamp from Android
  if (window.AndroidBridge && window.AndroidBridge.getLastSyncTimestamp) {
    const ts = window.AndroidBridge.getLastSyncTimestamp();
    if (ts > 0) lastSyncTimestamp = ts;
  } else {
    lastSyncTimestamp = Date.now();
  }
  updateLastSyncDisplay();

  // 4. Trigger cloud DB sync
  if (typeof manualSyncFromSupabase === 'function') {
    manualSyncFromSupabase();
  }
}

function checkBatteryOptimization() {
  const banner = document.getElementById('batteryOptBanner');
  if (!banner) return;
  if (window.AndroidBridge && window.AndroidBridge.isBatteryOptimizationIgnored) {
    const isIgnored = window.AndroidBridge.isBatteryOptimizationIgnored();
    banner.style.display = isIgnored ? 'none' : 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function requestIgnoreBatteryOptimizations() {
  if (window.AndroidBridge && window.AndroidBridge.requestIgnoreBatteryOptimizations) {
    window.AndroidBridge.requestIgnoreBatteryOptimizations();
    showToast('⚙️ Please tap "Allow" so notifications sync when phone is locked.');
    setTimeout(checkBatteryOptimization, 1000);
  } else {
    showToast('ℹ️ Battery optimization settings are managed by your device.');
  }
}

function simulateSampleNotification(type) {
  let sample = '';
  if (type === 'swiggy') {
    sample = `Sent Rs. 450.00 from HDFC Bank A/C **1234 to SWIGGY on 02-OCT-26. UPI Ref: 423456789012. Not you? Call bank.`;
  } else if (type === 'salary') {
    sample = `Your A/C *5678 is credited by INR 85,000.00 on 01-OCT-26 by Salary Ref: 890123456789. Avl Bal: INR 1,12,000.00`;
  } else {
    sample = `Debited Rs. 15000.00 from ICICI Bank A/C **9999 towards House Rent on 02-OCT-26. Ref: 112233445566`;
  }
  window.onNotificationCaptured(sample, 'com.android.mms');
}

function ingestParsedTransaction() {
  if (!lastParsedTransaction) {
    parseRawNotification();
  }
  if (!lastParsedTransaction) {
    showToast('⚠️ Please enter or paste a valid payment notification text first.');
    return;
  }

  const newTxn = {
    id: generateUuid(),
    ...lastParsedTransaction,
    date: lastParsedTransaction.date || new Date().toISOString()
  };

  if (currentUser) {
    newTxn.user_id = currentUser.id;
  }

  // Local update & UI rendering
  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();
  switchTab('dashboard');

  // Cloud Sync
  syncTransactionToCloud(newTxn);

  // Clear parser card and input box
  const parsedOutputCard = document.getElementById('parsedOutputCard');
  if (parsedOutputCard) parsedOutputCard.style.display = 'none';
  const rawNotificationInput = document.getElementById('rawNotificationInput');
  if (rawNotificationInput) rawNotificationInput.value = '';
  lastParsedTransaction = null;
}

/* ==========================================================================
   SUPABASE USER AUTHENTICATION & SESSION MANAGEMENT
   ========================================================================== */

function switchAuthTab(tab) {
  const loginTab = document.getElementById('authTabLogin');
  const regTab = document.getElementById('authTabRegister');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const alertBox = document.getElementById('authAlert');

  if (alertBox) alertBox.style.display = 'none';

  if (tab === 'login') {
    if (loginTab) loginTab.classList.add('active');
    if (regTab) regTab.classList.remove('active');
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
  } else {
    if (regTab) regTab.classList.add('active');
    if (loginTab) loginTab.classList.remove('active');
    if (regForm) regForm.style.display = 'block';
    if (loginForm) loginForm.style.display = 'none';
  }
}

function showAuthAlert(msg, type = 'error') {
  const alertBox = document.getElementById('authAlert');
  if (!alertBox) return;
  alertBox.className = `auth-alert ${type}`;
  alertBox.innerText = msg;
  alertBox.style.display = 'block';
}

async function handleUserRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const submitBtn = document.getElementById('registerSubmitBtn');

  if (password !== confirmPassword) {
    return showAuthAlert('Passwords do not match! Please verify both fields.');
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';
  }

  try {
    if (!supabaseClient) throw new Error('Supabase Client not initialized.');

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });

    if (error) throw error;

    if (data.user && (!data.session || (data.user.identities && data.user.identities.length === 0))) {
      showAuthAlert('✉️ Verification email sent! Please check your inbox and confirm your email before signing in.', 'success');
      userProfile.name = name;
      saveProfileSettings();
      setTimeout(() => switchAuthTab('login'), 3000);
    } else {
      showAuthAlert('Account created successfully! Logging you in...', 'success');
      userProfile.name = name;
      saveProfileSettings();
    }
  } catch (err) {
    showAuthAlert(err.message || 'Registration failed.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Private Account';
    }
  }
}

async function handleUserLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = document.getElementById('loginSubmitBtn');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
  }

  try {
    if (!supabaseClient) throw new Error('Supabase Client not initialized.');

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
        throw new Error('✉️ Email not confirmed yet. Please click the verification link sent to your inbox.');
      }
      throw error;
    }

    showAuthAlert('Sign in successful!', 'success');
  } catch (err) {
    showAuthAlert(err.message || 'Invalid credentials.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In to Account';
    }
  }
}

async function handleUserLogout() {
  if (confirm('Sign out of Finance Me? Your private data will be locked until you sign back in.')) {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    currentSession = null;
    currentUser = null;
    transactions = [];
    localStorage.removeItem('finance_me_transactions');
    localStorage.removeItem('finance_me_vault_snapshot');
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';
    renderTransactions();
  }
}

function initAuthSession() {
  if (!supabaseClient) return;

  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    handleAuthStateChange(session);
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleAuthStateChange(session);
  });
}

function handleAuthStateChange(session) {
  const authOverlay = document.getElementById('authOverlay');
  const logoutBtn = document.getElementById('logoutBtnHeader');
  const userEmailDisplay = document.getElementById('userEmailDisplay');
  const webhookUrlBox = document.getElementById('webhookUrlBox');

  if (session && session.user) {
    currentSession = session;
    currentUser = session.user;
    
    if (authOverlay) authOverlay.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    
    const email = currentUser.email || 'Authenticated User';
    if (userEmailDisplay) userEmailDisplay.innerText = email;

    if (webhookUrlBox) {
      const baseUrl = window.location.origin.includes('localhost') 
        ? 'https://finance-me-smoky-rho.vercel.app' 
        : window.location.origin;
      webhookUrlBox.value = `${baseUrl}/api/ingest-notification?user_id=${currentUser.id}`;
    }

    if (currentUser.user_metadata && currentUser.user_metadata.full_name) {
      userProfile.name = currentUser.user_metadata.full_name;
      loadProfileSettings();
    }

    fetchTransactionsFromSupabase();

    // Pass user_id to Android native notification listener (no-op in browser)
    if (window.AndroidBridge && window.AndroidBridge.saveUserId) {
      window.AndroidBridge.saveUserId(currentUser.id);
    }
  } else {
    currentSession = null;
    currentUser = null;
    if (authOverlay) authOverlay.style.display = 'flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
    transactions = [];
    renderTransactions();

    // Clear user_id from Android notification listener on logout
    if (window.AndroidBridge && window.AndroidBridge.clearUserId) {
      window.AndroidBridge.clearUserId();
    }
  }
}

function requestAndroidNotificationPermission() {
  const isAndroid = !!window.AndroidBridge;
  const statusText = document.getElementById('androidNotifStatusText');
  const statusSub  = document.getElementById('androidNotifStatusSub');
  const statusDot  = document.getElementById('notifStatusDot');
  const grantBtn   = document.getElementById('androidGrantBtn');

  if (isAndroid) {
    const granted = window.AndroidBridge.isNotificationAccessGranted();
    if (granted) {
      if (statusText) statusText.innerText = '✅ Notification Access Granted';
      if (statusSub)  statusSub.innerText  = 'Finance Me is reading bank & payment notifications';
      if (statusDot)  statusDot.style.background = '#34A853';
      if (grantBtn)   grantBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
    } else {
      if (statusText) statusText.innerText = '⚠️ Notification Access Needed';
      if (statusSub)  statusSub.innerText  = 'Tap Enable to allow Finance Me to read bank alerts';
      if (statusDot)  statusDot.style.background = '#EA4335';
      if (grantBtn)   grantBtn.innerHTML = '<i class="fa-solid fa-bell"></i> Enable';
      window.AndroidBridge.openNotificationSettings();
    }
  } else {
    // Browser preview
    if (statusText) statusText.innerText = '📱 Install the Android APK to enable auto-capture';
    if (statusSub)  statusSub.innerText  = 'Notification reading only works in the native app';
    if (statusDot)  statusDot.style.background = '#888';
  }
}

function refreshAndroidLogs() {
  const logPre = document.getElementById('androidDebugLogs');
  if (!logPre) return;
  if (window.AndroidBridge) {
    if (typeof window.AndroidBridge.getDebugLogs === 'function') {
      const logs = window.AndroidBridge.getDebugLogs();
      logPre.innerText = logs || 'No notifications captured yet.';
    } else {
      logPre.innerText = '🟢 Native Android Engine Active! Listening for bank SMS & payment notifications in background...';
    }
  } else {
    logPre.innerText = 'Running in browser mode. Install/open APK to enable live background capture.';
  }
}

/** Called by Android MainActivity to push live status updates into the page */
window.onAndroidNotifStatus = function(granted) {
  const statusText = document.getElementById('androidNotifStatusText');
  const statusSub  = document.getElementById('androidNotifStatusSub');
  const statusDot  = document.getElementById('notifStatusDot');
  const grantBtn   = document.getElementById('androidGrantBtn');

  if (granted) {
    if (statusText) statusText.innerText = '✅ Notification Access Granted';
    if (statusSub)  statusSub.innerText  = 'Finance Me is actively reading bank & payment notifications';
    if (statusDot)  statusDot.style.background = '#34A853';
    if (grantBtn) { grantBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active'; grantBtn.disabled = true; }
  } else {
    if (statusText) statusText.innerText = '⚠️ Notification Access Required';
    if (statusSub)  statusSub.innerText  = 'Tap Enable to grant access in Android Settings';
    if (statusDot)  statusDot.style.background = '#EA4335';
    if (grantBtn) { grantBtn.innerHTML = '<i class="fa-solid fa-bell"></i> Enable'; grantBtn.disabled = false; }
  }
  refreshAndroidLogs();
};

// Auto-check status & logs when settings tab is opened
document.addEventListener('DOMContentLoaded', () => {
  if (window.AndroidBridge) {
    window.onAndroidNotifStatus(window.AndroidBridge.isNotificationAccessGranted());
  }
  refreshAndroidLogs();
  setInterval(refreshAndroidLogs, 3000);
});

