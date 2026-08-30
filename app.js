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
  if (!id) return;
  const strId = String(id);
  const t = transactions.find(item => String(item.id) === strId);
  if (!t) return;

  document.getElementById('modalHeaderTitle').innerText = 'Edit Payment Entry';
  document.getElementById('txnId').value = t.id;
  document.getElementById('inputMerchant').value = t.merchant;
  document.getElementById('inputAmount').value = t.amount;
  document.getElementById('inputType').value = t.type;
  document.getElementById('inputCategory').value = t.category;
  document.getElementById('inputMode').value = t.mode;
  document.getElementById('inputDate').value = (t.date || '').substring(0, 10);
  document.getElementById('inputTags').value = (t.tags || []).join(', ');
  document.getElementById('inputNotes').value = t.notes || '';

  document.getElementById('txnModal').classList.add('active');
}

/* ==========================================================================
   SAFEGUARDED DELETION MECHANISMS
   ========================================================================== */

function showConfirmModal({ title, body, actionText = 'Delete', actionColor = '#EA4335' }) {
  return new Promise((resolve) => {
    let modal = document.getElementById('customConfirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'customConfirmModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width: 360px; width: 90%; text-align: center; border: 1px solid rgba(234, 67, 53, 0.3); margin: auto; background: #161822; color: #fff; padding: 22px; border-radius: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(234, 67, 53, 0.18); color: #EA4335; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 22px;">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <h3 id="confirmModalTitle" style="font-size: 17px; font-weight: 700; margin-bottom: 8px; color: #ffffff;">Confirm Deletion</h3>
          <p id="confirmModalBody" style="font-size: 13px; color: #a0a5b5; margin-bottom: 22px; line-height: 1.4;"></p>
          <div style="display: flex; gap: 10px;">
            <button id="confirmCancelBtn" class="btn btn-secondary" style="flex: 1; padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15); font-weight: 600;">Cancel</button>
            <button id="confirmActionBtn" class="btn" style="flex: 1; padding: 12px; background: #EA4335; color: white; border-radius: 14px; border: none; font-weight: 700;">Delete</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const titleEl = document.getElementById('confirmModalTitle');
    const bodyEl = document.getElementById('confirmModalBody');
    const actionBtn = document.getElementById('confirmActionBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    if (titleEl) titleEl.innerText = title;
    if (bodyEl) bodyEl.innerText = body;
    if (actionBtn) {
      actionBtn.innerText = actionText;
      actionBtn.style.background = actionColor;
    }

    // Force display & visibility reset every time modal is triggered
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.right = '0';
    modal.style.bottom = '0';
    modal.style.background = 'rgba(0, 0, 0, 0.88)';
    modal.style.backdropFilter = 'blur(16px)';
    modal.style.webkitBackdropFilter = 'blur(16px)';
    modal.style.zIndex = '999999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';

    modal.classList.add('active');

    let resolved = false;

    const handleConfirm = (e) => {
      if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    };

    const handleCancel = (e) => {
      if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
      modal.classList.remove('active');
      if (actionBtn) {
        actionBtn.onclick = null;
        actionBtn.ontouchend = null;
      }
      if (cancelBtn) {
        cancelBtn.onclick = null;
        cancelBtn.ontouchend = null;
      }
    };

    if (actionBtn) {
      actionBtn.onclick = handleConfirm;
      actionBtn.ontouchend = handleConfirm;
    }
    if (cancelBtn) {
      cancelBtn.onclick = handleCancel;
      cancelBtn.ontouchend = handleCancel;
    }
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

  // 2. Delete from Supabase cloud database (Execute BOTH client SDK and direct REST fetch to guarantee deletion)
  try {
    if (supabaseClient) {
      await supabaseClient.from('transactions').delete().eq('id', strId);
    }
    if (SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${strId}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        }
      });
    }
  } catch (err) {
    console.error('[Delete Exception]:', err);
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
      await supabaseClient.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }
    if (SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=neq.00000000-0000-0000-0000-000000000000`, {
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

/** REAL-TIME NOTIFICATION HANDLER INJECTED FROM ANDROID NATIVE BRIDGE */
window.onNotificationCaptured = function(rawText, packageName) {
  console.log('⚡ Realtime Notification Captured:', packageName, rawText);
  if (!rawText) return;

  // 1. Put incoming text into the manual parser box in Settings
  const inputEl = document.getElementById('rawNotificationInput');
  if (inputEl) inputEl.value = rawText;

  // 2. Parse using the exact manual notification parser logic
  const parsed = parseNotificationTextString(rawText);
  if (!parsed || !parsed.amount || parsed.amount <= 0) {
    console.log('Ignored non-financial notification:', rawText);
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
    rawInput: rawText
  };

  // 3. Trigger the EXACT manual ingest function that saves & renders to dashboard!
  ingestParsedTransaction();

  showToast(`⚡ Auto-Captured: ${parsed.type === 'Credit' ? '+' : '-'}₹${parsed.amount} (${parsed.merchant})`);
};

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

  // 1. Local update & UI rendering
  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();
  switchTab('dashboard');

  // 2. Direct Supabase Client Insertion with Guaranteed Toast Feedback
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
      date: new Date().toISOString(),
      notes: newTxn.rawInput ? `[Auto-Captured] ${newTxn.rawInput}` : (newTxn.notes || '')
    };

    if (currentUser) {
      dbPayload.user_id = currentUser.id;
    }

    if (supabaseClient) {
      supabaseClient
        .from('transactions')
        .insert([dbPayload])
        .then(({ data, error }) => {
          writeDone();
          if (error) {
            console.error('Supabase Insert Error:', error);
            showToast(`⚠️ Database alert: ${error.message || 'Insert failed'}`);
          } else {
            console.log('⚡ Supabase Direct Insert Successful!');
            showToast('✅ Saved to Supabase Database!');
          }
        })
        .catch(err => {
          writeDone();
          console.log('Supabase Direct Insert Catch:', err);
        });
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
      })
      .then(res => res.json())
      .then(resData => {
        writeDone();
        if (Array.isArray(resData) && resData.length > 0) {
          showToast('✅ Saved to Supabase Database!');
        } else if (resData && resData.message) {
          showToast(`⚠️ Database notice: ${resData.message}`);
        }
      })
      .catch(err => {
        writeDone();
        console.log('Supabase REST Insert Catch:', err);
      });
    }
  }

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

    showAuthAlert('Account created successfully! Logging you in...', 'success');
    userProfile.name = name;
    saveProfileSettings();
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

    if (error) throw error;

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

