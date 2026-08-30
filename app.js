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

// Fetch Real Transactions from Supabase Database (Cloud Source of Truth & Instant UI Sync)
function fetchTransactionsFromSupabase(onComplete) {
  if (!SUPABASE_KEY || !currentUser) {
    if (onComplete) onComplete();
    return;
  }

  const token = currentSession ? currentSession.access_token : SUPABASE_KEY;
  const userFilter = currentUser ? `&user_id=eq.${currentUser.id}` : '';

  fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*${userFilter}&order=id.desc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`
    }
  })
  .then(res => res.json())
  .then(data => {
    if (Array.isArray(data)) {
      // Sort by full ISO timestamp so newest SMS auto-sync always shows at top
      data.sort((a, b) => {
        const da = new Date(b.date);
        const db = new Date(a.date);
        if (!isNaN(da) && !isNaN(db)) return da - db;
        return String(b.id).localeCompare(String(a.id));
      });

      if (JSON.stringify(data) !== JSON.stringify(transactions)) {
        transactions = data;
        localStorage.setItem('finance_me_transactions', JSON.stringify(transactions));
        if (transactions.length === 0) {
          localStorage.removeItem('finance_me_vault_snapshot');
        } else {
          saveToLocalStorage();
        }
        renderTransactions();
        console.log('[Supabase Auto-Sync]: Synced', transactions.length, 'transactions for user', currentUser.email);
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
            <button class="icon-btn txn-edit-btn" data-id="${safeId}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete txn-delete-btn" data-id="${safeId}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Delegated event listeners (attached once after render)
  container.querySelectorAll('.txn-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editTransaction(btn.dataset.id))
  );
  container.querySelectorAll('.txn-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteTransaction(btn.dataset.id))
  );

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

  document.getElementById('dashIncome').innerText = `${curr}${income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('dashExpenses').innerText = `${curr}${expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // BUG-05: show actual cashflow — colour red when negative
  const cashFlowEl = document.getElementById('dashNetCashFlow');
  cashFlowEl.innerText = `${netCashFlow < 0 ? '-' : ''}${curr}${Math.abs(netCashFlow).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  cashFlowEl.style.color = netCashFlow < 0 ? 'var(--gpay-red-light)' : 'var(--gpay-green-light)';

  const savedEl = document.getElementById('strategyTotalSaved');
  savedEl.innerText = `${netSaved < 0 ? '-' : ''}${curr}${Math.abs(netSaved).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  savedEl.style.color = netSaved < 0 ? 'var(--gpay-red-light)' : '';
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

  // 1-Year Forecast & 5-Year SIP Wealth Projection (BUG-05: use clamped value for forecasts)
  const forecast1Yr = netSavedForForecast * 12;
  const monthlySip = netSavedForForecast > 0 ? netSavedForForecast * 0.5 : 0;
  const annualRate = 0.12;
  const months = 60;
  const r = annualRate / 12;
  const sipFutureVal = monthlySip > 0 ? monthlySip * (((Math.pow(1 + r, months) - 1) / r) * (1 + r)) : 0;

  const f1El = document.getElementById('forecast1Year');
  const f5El = document.getElementById('forecast5Year');
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

  // BUG-05: savings gauge uses clamped value so bar never goes negative
  document.getElementById('taxSavingsVal').innerText = `${curr}${netSavedForForecast.toLocaleString('en-IN')} / ${curr}${savingsTarget.toLocaleString('en-IN')}`;
  document.getElementById('taxSavingsBar').style.width = `${Math.min(100, (netSavedForForecast / savingsTarget) * 100)}%`;
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
  // BUG-08: ISO timestamps like "2026-08-27T10:14:00.000Z" must be sliced to YYYY-MM-DD
  document.getElementById('inputDate').value = (t.date || '').substring(0, 10);
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
  const message = `⚠️ CONFIRM DELETION:\n\nAre you sure you want to delete payment:\n• Payee: ${target.merchant}\n• Amount: ${curr}${target.amount}\n\nThis will remove the transaction permanently.`;

  if (confirm(message)) {
    transactions = transactions.filter(item => item.id !== id);
    saveToLocalStorage();
    renderTransactions();

    if (SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        }
      })
      .then(res => {
        if (!res.ok) console.warn('[Supabase Delete]: HTTP', res.status);
      })
      .catch(err => console.log('Supabase Delete error:', err));
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
      const allIds = transactions.map(t => t.id);
      transactions = [];
      localStorage.removeItem('finance_me_transactions');
      localStorage.removeItem('finance_me_vault_snapshot');
      renderTransactions();

      if (SUPABASE_KEY && allIds.length > 0) {
        // BUG-15: PostgREST in() for text columns needs unquoted CSV values
        const idList = allIds.join(',');
        fetch(`${SUPABASE_URL}/rest/v1/transactions?id=in.(${idList})`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          }
        }).then(() => {
          alert('✅ All transactions deleted from cloud and device!');
        }).catch(err => {
          console.log('Supabase Clear error:', err);
          alert('✅ Cleared locally. Cloud sync may take a moment.');
        });
      } else {
        alert('✅ All transactions cleared successfully.');
      }
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
    isWritePending = true; // BUG-04: block sync polling while write is in-flight
    const writeDone = () => { isWritePending = false; };
    const token = currentSession ? currentSession.access_token : SUPABASE_KEY;

    if (id) {
      // EDIT: PATCH the existing row by its text id
      fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(txnObj)
      }).then(writeDone).catch(err => { console.log('Supabase Update error:', err); writeDone(); });
    } else {
      // NEW: INSERT a fresh row
      fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(txnObj)
      }).then(writeDone).catch(err => { console.log('Supabase Insert error:', err); writeDone(); });
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

function parseRawNotification() {
  const raw = document.getElementById('rawNotificationInput').value.trim();
  if (!raw) return;

  // ── AMOUNT EXTRACTION (multi-pass, order matters) ──────────────────────────
  // Pass 1: ₹ / Rs. prefix directly before number (most reliable)
  const rsPrefixRegex = /(?:₹|rs\.?|re\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
  // Pass 2: number that appears BEFORE a debit/credit keyword on the same line
  const beforeKeywordRegex = /([\d,]+(?:\.\d{1,2})?)\s+(?:debited|credited|sent|paid|spent|deducted)/i;
  // Pass 3: number AFTER a keyword (e.g. "paid Rs 500" — already covered by pass 1, but fallback)
  const afterKeywordRegex = /(?:debited|credited|paid|sent|spent|transferred|amount|sum)\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i;

  let amount = 0;
  let m;
  if ((m = raw.match(rsPrefixRegex)))    amount = parseFloat(m[1].replace(/,/g, ''));
  if (!amount && (m = raw.match(beforeKeywordRegex))) amount = parseFloat(m[1].replace(/,/g, ''));
  if (!amount && (m = raw.match(afterKeywordRegex)))  amount = parseFloat(m[1].replace(/,/g, ''));

  // Pass 4: smart fallback — skip long ref/account/phone numbers (≥9 digits) then grab first decimal
  if (!amount || amount === 0) {
    const stripped = raw.replace(/\b\d{9,}\b/g, '').replace(/\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b/g, '');
    const anyNum = stripped.match(/(\d{1,7}(?:,\d{2,3})*(?:\.\d{1,2})?)/);
    if (anyNum) amount = parseFloat(anyNum[1].replace(/,/g, ''));
  }

  if (!amount || isNaN(amount)) amount = 0;

  // ── TYPE: CREDIT vs DEBIT ──────────────────────────────────────────────────
  const typeRegex = /(debited|credited|sent|received|paid|spent|deposited)/i;
  const typeMatch = raw.match(typeRegex);
  const isCredit = typeMatch && /credited|received|deposited/i.test(typeMatch[1]);
  const type = isCredit ? 'Credit' : 'Debit';

  // ── MERCHANT EXTRACTION ───────────────────────────────────────────────────
  const merchantRegex = /(?:to|at|vpa|paid to|credited from|credited with|sent to|spent at|transferred to|towards)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i;
  const merchantMatch = raw.match(merchantRegex);
  let merchant = merchantMatch ? merchantMatch[1].trim() : 'GPay Merchant';
  merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 32).trim();

  // ── CATEGORY ──────────────────────────────────────────────────────────────
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
    notes: `Real Notification: "${raw.substring(0, 50)}..."`,
    rawInput: raw   // BUG-13: preserve full original SMS for API re-parsing
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

  if (currentUser) {
    newTxn.user_id = currentUser.id;
  }

  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();
  switchTab('dashboard');

  const headers = { 'Content-Type': 'application/json' };
  if (currentUser) headers['X-USER-ID'] = currentUser.id;
  if (currentSession) headers['Authorization'] = `Bearer ${currentSession.access_token}`;

  fetch('/api/ingest-notification', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      rawText: lastParsedTransaction.rawInput || lastParsedTransaction.notes,
      sender: lastParsedTransaction.merchant,
      timestamp: lastParsedTransaction.date,
      user_id: currentUser ? currentUser.id : undefined
    })
  }).catch(err => console.log('Offline mode active:', err));
  
  document.getElementById('parsedOutputCard').style.display = 'none';
  document.getElementById('rawNotificationInput').value = '';
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
};

// Auto-check status when settings tab is opened
document.addEventListener('DOMContentLoaded', () => {
  if (window.AndroidBridge) {
    window.onAndroidNotifStatus(window.AndroidBridge.isNotificationAccessGranted());
  }
});

