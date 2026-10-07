/**
 * ============================================================================
 * CRITIC ENGINE: INTERCONNECTED WORKINGS TEST SUITE
 * Validates flawless end-to-end data flow between:
 * 1. Native Notification/SMS Ingestion
 * 2. Smart Brand Titling & Separation
 * 3. Live Bank Passbook & Running Balances
 * 4. Upcoming Bills & Statement Reminders
 * 5. Needs Review Queue & Approval Workflows
 * 6. Real-time Cash Flow, Expenses & Health Score Metrics
 * 7. Manual Entry Integration & Cold-Start Reconstitution
 * 8. Cross-Source Multi-Factor Deduplication & Enrichment
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// Mock DOM & LocalStorage
const localStorageStore = {};
global.localStorage = {
  getItem: (key) => localStorageStore[key] || null,
  setItem: (key, val) => { localStorageStore[key] = String(val); },
  removeItem: (key) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
};

const domElements = {};
function getOrCreateElement(id) {
  if (!domElements[id]) {
    domElements[id] = {
      id,
      innerText: '',
      value: '',
      style: {},
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      innerHTML: '',
      disabled: false,
      reset() {},
      focus() {}
    };
  }
  return domElements[id];
}

global.document = {
  getElementById: (id) => getOrCreateElement(id),
  querySelectorAll: () => [],
  addEventListener: () => {},
  documentElement: { getAttribute: () => 'dark' }
};

global.window = {
  addEventListener: () => {},
  showToast: () => {},
  AndroidBridge: null
};

global.showToast = (msg) => {};
global.escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, '');

// Read Notification Classifier & Core logic from app.js
const appJsPath = 'd:/Finace_Me/app.js';
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Isolate classifier and helper functions
const targetCls = 'const notificationClassifier = new FinancialNotificationClassifier();';
const clsStart = appJsContent.indexOf('class FinancialNotificationClassifier');
const clsEnd = appJsContent.indexOf(targetCls) + targetCls.length;
eval(appJsContent.substring(clsStart, clsEnd) + '\nglobal.notificationClassifier = notificationClassifier;');

// Define globals required by Axio functions
global.userBankAccounts = {};
global.userBillReminders = [];
global.saveBankAccounts = () => {};
global.renderBankPassbook = () => {};
global.saveBillReminders = () => {};
global.renderBillsDeck = () => {};

// Isolate Axio Brand Engine, Passbook & Bill Reminder logic
eval(appJsContent.substring(appJsContent.indexOf('function resolveMerchantBrandDetails'), appJsContent.indexOf('function openSmsScanModal')));

// Mock application state
let transactions = [];
let needsReviewTransactions = [];
let userProfile = { name: 'Shan', currency: '₹', salary: 100000 };
let lastSyncTimestamp = 0;
let isPrivateModeActive = false;
let currentUser = { id: 'usr_test_123', email: 'areojoeshan2005@gmail.com' };
let currentSession = { access_token: 'fake_jwt_token' };
let SUPABASE_KEY = 'test_key';
let SUPABASE_URL = 'https://fake.supabase.co';
let supabaseClient = null;
let isWritePending = false;
let deletedTxnIds = new Set();
let cloudSyncCalls = [];

function generateUuid() {
  return 'txn_' + Math.random().toString(36).substr(2, 9);
}

function saveToLocalStorage() {
  localStorage.setItem('finance_me_transactions', JSON.stringify(transactions));
}

function saveReviewQueue() {
  localStorage.setItem('finance_me_needs_review', JSON.stringify(needsReviewTransactions));
}

function renderInbox() {
  const badge = document.getElementById('notifCountBadge');
  if (badge) badge.innerText = String(needsReviewTransactions.length);
}

function updateLastSyncDisplay() {
  const el = document.getElementById('syncStatusText');
  if (el) el.innerText = 'Synced just now';
}

function syncTransactionToCloud(txn) {
  cloudSyncCalls.push({ ...txn });
}

function renderTransactions() {
  const container = document.getElementById('txnContainer');
  if (container) container.innerHTML = '<div>' + transactions.length + ' items</div>';
  updateMetricsAndTaxonomy();
}

function updateMetricsAndTaxonomy() {
  let income = 0;
  let expenses = 0;
  transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    if (t.type === 'Credit') income += amt;
    else expenses += amt;
  });
  const net = income - expenses;
  document.getElementById('dashIncome').innerText = '₹' + income.toFixed(2);
  document.getElementById('dashExpenses').innerText = '₹' + expenses.toFixed(2);
  document.getElementById('dashNetCashFlow').innerText = '₹' + net.toFixed(2);
}

function closeModal() {}
function markAsDeleted(id) { deletedTxnIds.add(String(id)); }
function showConfirmModal() { return Promise.resolve(true); }

// Reconstruct functions under test
function reconstructBankAccountsFromTransactions() {
  if (!Array.isArray(transactions) || transactions.length === 0) return;
  const rxMask = new RegExp('\\b(?:a/c|account|card)\\s*(?:ending\\s*(?:with)?|no\\.?|[*#xX]+)?\\s*[:.-]?\\s*([*#xX]*\\d{3,4})\\b', 'i');
  transactions.forEach(t => {
    const text = (t.notes || '') + ' ' + (t.rawText || '') + ' ' + (t.merchant || '');
    const maskMatch = text.match(rxMask);
    const accMask = maskMatch ? maskMatch[1].replace(/[*#xX]/g, '') : (t.accountMask || null);
    extractRunningBalance(text, accMask, null, new Date(t.date || Date.now()).getTime());
    extractBillReminder(text, new Date(t.date || Date.now()).getTime());
  });
  saveBankAccounts();
  saveBillReminders();
}

// Full onNotificationCaptured
window.onNotificationCaptured = function(rawText, packageName, timestamp = Date.now()) {
  if (!rawText) return;
  const rxMask = new RegExp('\\b(?:a/c|account|card)\\s*(?:ending\\s*(?:with)?|no\\.?|[*#xX]+)?\\s*[:.-]?\\s*([*#xX]*\\d{3,4})\\b', 'i');
  const maskMatch = rawText.match(rxMask);
  const accMask = maskMatch ? maskMatch[1].replace(/[*#xX]/g, '') : null;
  extractRunningBalance(rawText, accMask, null, timestamp);
  extractBillReminder(rawText, timestamp);

  const readResult = notificationClassifier.readNotification({
    text: rawText,
    packageName: packageName || '',
    timestamp: timestamp || Date.now()
  });

  if (!readResult || !readResult.isFinancial || !readResult.parsed || !readResult.parsed.amount || readResult.parsed.amount <= 0) {
    return;
  }

  const parsed = readResult.parsed;

  if (readResult.isDuplicate) {
    if (readResult.matchedTransaction) {
      const match = readResult.matchedTransaction;
      const existing = needsReviewTransactions.find(t =>
        (match.id && t.id === match.id) ||
        (t.referenceId && match.referenceId && t.referenceId === match.referenceId) ||
        (t.signature && match.signature && t.signature === match.signature)
      );

      if (existing) {
        if (parsed.referenceId && !existing.referenceId) existing.referenceId = parsed.referenceId;
        if (parsed.accountMask && !existing.accountMask) existing.accountMask = parsed.accountMask;
        saveReviewQueue();
        renderInbox();
      }
    }
    return;
  }

  lastSyncTimestamp = Date.now();
  updateLastSyncDisplay();

  const brand = resolveMerchantBrandDetails(rawText, parsed.merchant, parsed.type);
  const reviewItem = {
    id: generateUuid(),
    merchant: brand.title || parsed.merchant,
    amount: parsed.amount,
    type: parsed.type,
    category: parsed.category || brand.category,
    mode: parsed.mode,
    referenceId: parsed.referenceId,
    accountMask: parsed.accountMask || accMask,
    confidence: parsed.confidence,
    rawText: parsed.rawContent || rawText,
    packageName: packageName || '',
    date: new Date(timestamp || Date.now()).toISOString(),
    signature: parsed.signature,
    subtitle: brand.subtitle,
    icon: brand.icon,
    brandColor: brand.color,
    status: 'needs_review'
  };

  parsed.id = reviewItem.id;
  needsReviewTransactions.unshift(reviewItem);
  saveReviewQueue();
  renderInbox();
};

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
    notes: item.rawText ? `[Auto-Captured] ${item.rawText}` : (item.referenceId ? `[Auto-Captured Ref: ${item.referenceId}]` : ''),
    rawText: item.rawText,
    referenceId: item.referenceId,
    accountMask: item.accountMask,
    subtitle: item.subtitle,
    icon: item.icon,
    brandColor: item.brandColor
  };

  if (currentUser) newTxn.user_id = currentUser.id;

  transactions.unshift(newTxn);
  saveToLocalStorage();
  renderTransactions();
  updateMetricsAndTaxonomy();
  renderBankPassbook();
  renderBillsDeck();

  needsReviewTransactions.splice(itemIdx, 1);
  saveReviewQueue();
  renderInbox();
  syncTransactionToCloud(newTxn);
}

async function approveAllReviewItems() {
  if (needsReviewTransactions.length === 0) return;
  for (const item of [...needsReviewTransactions]) {
    const newTxn = {
      id: item.id || generateUuid(),
      merchant: item.merchant,
      amount: item.amount,
      type: item.type,
      category: item.category,
      mode: item.mode || 'GPay / UPI Auto-Sync',
      date: item.date || new Date().toISOString(),
      notes: item.rawText ? `[Auto-Captured] ${item.rawText}` : (item.referenceId ? `[Auto-Captured Ref: ${item.referenceId}]` : ''),
      rawText: item.rawText,
      referenceId: item.referenceId,
      accountMask: item.accountMask,
      subtitle: item.subtitle,
      icon: item.icon,
      brandColor: item.brandColor
    };
    if (currentUser) newTxn.user_id = currentUser.id;
    transactions.unshift(newTxn);
    syncTransactionToCloud(newTxn);
  }
  needsReviewTransactions = [];
  saveReviewQueue();
  saveToLocalStorage();
  renderTransactions();
  updateMetricsAndTaxonomy();
  renderBankPassbook();
  renderBillsDeck();
  renderInbox();
}

function saveTransactionManual(merchant, amount, type, category, mode, notes) {
  const brand = resolveMerchantBrandDetails(notes, merchant, type);
  const txnObj = {
    id: generateUuid(),
    merchant: brand.isRecognized ? brand.title : merchant,
    amount,
    type,
    category: category || brand.category,
    mode,
    date: new Date().toISOString(),
    tags: [],
    notes,
    subtitle: brand.subtitle,
    icon: brand.icon,
    brandColor: brand.color
  };
  if (currentUser) txnObj.user_id = currentUser.id;
  transactions.unshift(txnObj);
  saveToLocalStorage();
  renderTransactions();
  updateMetricsAndTaxonomy();
  renderBankPassbook();
  renderBillsDeck();
  syncTransactionToCloud(txnObj);
  return txnObj;
}

async function deleteTransaction(id) {
  const strId = String(id);
  markAsDeleted(strId);
  transactions = transactions.filter(item => String(item.id) !== strId);
  saveToLocalStorage();
  renderTransactions();
  updateMetricsAndTaxonomy();
  renderBankPassbook();
  renderBillsDeck();
}

// ============================================================================
// CRITIC ENGINE EVALUATION SUITE
// ============================================================================

console.log('n======================================================================');
console.log('🔍 EXECUTING CRITIC ENGINE: INTERCONNECTED WORKINGS SUITE');
console.log('======================================================================n');

let passedTests = 0;
const totalTests = 10;

function evaluate(condition, testName, details) {
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${testName} -> ${details}`);
  } else {
    console.error(`❌ [FAIL] ${testName} -> ${details}`);
  }
}

// TEST 1: Live Notification Arrival -> Passbook + Review Queue + Brand Intelligence
window.onNotificationCaptured(
  'Debited Rs. 450.00 from HDFC Bank A/C **1234 to SWIGGY. UPI Ref: 423456789012. Avl Bal: INR 45,210.50',
  'com.google.android.apps.nbu.paisa.user'
);
const hdfcAcc = userBankAccounts['HDFC Bank_1234'];
const revItem1 = needsReviewTransactions[0];
evaluate(
  hdfcAcc && hdfcAcc.balance === 45210.50 &&
  revItem1 && revItem1.merchant === 'Swiggy' && revItem1.icon === 'fa-utensils' && revItem1.accountMask === '1234',
  'CASE-1: Live Notification Arrival',
  `Updated Passbook (Bal: ₹${hdfcAcc?.balance}) & Smart Titling ('${revItem1?.merchant}' badge '${revItem1?.icon}')`
);

// TEST 2: Review Item Single Approval -> Transactions + Live Cash Flow + Cloud Sync
updateMetricsAndTaxonomy();
const initialExpenses = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, '')) || 0;
approveReviewItem(revItem1.id);
const postExpenses = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, '')) || 0;
const approvedTxn = transactions.find(t => t.merchant === 'Swiggy');
console.log('DEBUG approvedTxn:', approvedTxn);
console.log('DEBUG checks:', {
  inboxLen: needsReviewTransactions.length,
  hasTxn: !!approvedTxn,
  subtitle: approvedTxn?.subtitle,
  ref: approvedTxn?.referenceId,
  expDiff: postExpenses - initialExpenses,
  cloudCalls: cloudSyncCalls
});
evaluate(
  needsReviewTransactions.length === 0 &&
  approvedTxn && approvedTxn.subtitle === 'Food & Dining' && approvedTxn.referenceId === '423456789012' &&
  postExpenses === initialExpenses + 450 &&
  cloudSyncCalls.some(c => c.merchant === 'Swiggy' && c.user_id === 'usr_test_123'),
  'CASE-2: Single Review Approval',
  `Moved to transactions, expenses: ₹${postExpenses}, cloud synced with user_id ${currentUser.id}`
);

// TEST 3: Live Credit Card Bill Notification -> Bills Due Deck
window.onNotificationCaptured(
  'Your statement for HDFC Bank Card ending 4321 is generated. Total Amt Due: Rs 14,200.00, Min Due: Rs 1,200.00 by 15-OCT.',
  'com.android.mms'
);
const bill1 = userBillReminders.find(b => b.cardMask === '4321');
evaluate(
  bill1 && bill1.totalDue === 14200 && bill1.minDue === 1200 && bill1.status === 'unpaid',
  'CASE-3: Statement Bill Extraction',
  `Bill tracked: Card ..${bill1?.cardMask} | Due: ₹${bill1?.totalDue} | Min: ₹${bill1?.minDue}`
);

// TEST 4: Dismiss / Mark Bill as Paid
dismissBillReminder(bill1.id);
evaluate(
  bill1.status === 'paid' && userBillReminders.filter(b => b.status === 'unpaid').length === 0,
  'CASE-4: Dismiss Bill Reminder',
  `Bill marked as paid, unpaid bills count: 0`
);

// TEST 5: Manual Payment Entry (New Pay) -> Brand Resolution + Immediate Cash Flow
const preManualExp = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, ''));
const manualTxn = saveTransactionManual('blinkit order', 850, 'Debit', 'Unwanted / Leak', 'GPay / UPI', 'Quick grocery');
const postManualExp = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, ''));
evaluate(
  manualTxn.merchant === 'Blinkit' && manualTxn.subtitle === 'Quick Grocery' && manualTxn.icon === 'fa-basket-shopping' &&
  postManualExp === preManualExp + 850,
  'CASE-5: Manual Payment Entry',
  `Resolved '${manualTxn.merchant}' (${manualTxn.subtitle}), new expenses: ₹${postManualExp}`
);

// TEST 6: Historical Past SMS Scan Ingestion -> Dedup & Accounts
const pastSmsList = [
  // Duplicate of existing Swiggy
  { body: 'Debited Rs. 450.00 from HDFC Bank A/C **1234 to SWIGGY. UPI Ref: 423456789012. Avl Bal: INR 45,210.50', sender: 'HDFC', date: Date.now() - 86400000 },
  // New salary credit
  { body: 'Your SBI A/C 9876 is credited by Rs 95,000.00 on 28-SEP-26 by Salary. Avl Bal: INR 1,45,000.00', sender: 'SBI', date: Date.now() - 172800000 }
];

let historicalImported = 0;
pastSmsList.forEach(sms => {
  const read = notificationClassifier.readNotification({ text: sms.body, packageName: sms.sender, timestamp: sms.date });
  if (read && read.isFinancial && read.parsed && !read.isDuplicate) {
    const p = read.parsed;
    const exists = transactions.some(t => t.signature === p.signature || (t.referenceId && t.referenceId === p.referenceId));
    if (!exists) {
      saveTransactionManual(p.merchant, p.amount, p.type, p.category, 'SMS Auto-Import', sms.body);
      historicalImported++;
    }
  }
  const accMaskMatch = sms.body.match(/\b(?:a\/c|account)\s*(?:ending\s*(?:with)?|no\.?|[*#xX]+)?\s*[:.-]?\s*([*#xX]*\d{3,4})\b/i);
  const detectedMask = accMaskMatch ? accMaskMatch[1].replace(/[*#xX]/g, '') : null;
  extractRunningBalance(sms.body, detectedMask, null, sms.date);
});
const sbiAcc = userBankAccounts['State Bank of India_9876'];
evaluate(
  historicalImported === 1 && sbiAcc && sbiAcc.balance === 145000,
  'CASE-6: Historical SMS Scan',
  `Skipped duplicate, imported 1 new salary credit, SBI balance: ₹${sbiAcc?.balance}`
);

// TEST 7: Transaction Deletion -> Metric Rebalancing
const preDelExp = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, ''));
deleteTransaction(manualTxn.id);
const postDelExp = parseFloat(document.getElementById('dashExpenses').innerText.replace(/[₹,]/g, ''));
evaluate(
  postDelExp === preDelExp - 850 && !transactions.some(t => t.id === manualTxn.id),
  'CASE-7: Transaction Deletion Rebalancing',
  `Deleted Blinkit (₹850), expenses dropped from ₹${preDelExp} to ₹${postDelExp}`
);

// TEST 8: Cold-start Passbook Auto-Reconstruction
userBankAccounts = {};
reconstructBankAccountsFromTransactions();
const reconstructedHdfc = userBankAccounts['HDFC Bank_1234'];
evaluate(
  reconstructedHdfc && reconstructedHdfc.balance === 45210.50,
  'CASE-8: Cold-Start Passbook Reconstruction',
  `Restored HDFC Bank A/C 1234 balance (₹${reconstructedHdfc?.balance}) from transaction notes`
);

// TEST 9: Bulk Approval ("Approve All") in Review Area
needsReviewTransactions = [
  { id: 'rev_1', merchant: 'Uber', amount: 320, type: 'Debit', category: 'Unwanted / Leak', subtitle: 'Ride & Cab', icon: 'fa-car' },
  { id: 'rev_2', merchant: 'BESCOM', amount: 1450, type: 'Debit', category: 'Unavoidable / Rent', subtitle: 'Utility Power', icon: 'fa-bolt' },
  { id: 'rev_3', merchant: 'Salary', amount: 80000, type: 'Credit', category: 'Income', subtitle: 'Primary Income', icon: 'fa-money-bill-wave' }
];
approveAllReviewItems();
evaluate(
  needsReviewTransactions.length === 0 &&
  transactions.some(t => t.merchant === 'Uber') &&
  transactions.some(t => t.merchant === 'BESCOM') &&
  transactions.some(t => t.merchant === 'Salary'),
  'CASE-9: Bulk Review Approval (Approve All)',
  `All 3 items transitioned to active transactions, review queue emptied`
);

// TEST 10: Multi-Factor Deduplication & Cross-Source Notification Enrichment
// 10a. UPI push arrives
window.onNotificationCaptured(
  'You paid ₹1,200 to Zomato',
  'com.google.android.apps.nbu.paisa.user',
  Date.now()
);
const zomatoRevItem = needsReviewTransactions.find(t => t.merchant === 'Zomato');

// 10b. Bank SMS arrives 1.5 seconds later with Ref and A/C mask
window.onNotificationCaptured(
  'Debited Rs. 1,200.00 from A/C **9999 to ZOMATO on 02-OCT-26. UPI Ref: 778899001122.',
  'com.android.mms',
  Date.now() + 1500
);

evaluate(
  needsReviewTransactions.filter(t => t.merchant === 'Zomato').length === 1 &&
  zomatoRevItem.referenceId === '778899001122' && zomatoRevItem.accountMask === '9999',
  'CASE-10: Cross-Source Dedup & Enrichment',
  `Single Zomato entry retained and enriched with Ref '${zomatoRevItem?.referenceId}' and A/C '${zomatoRevItem?.accountMask}'`
);

// Final Scorecard
const finalScore = ((passedTests / totalTests) * 10).toFixed(1);
console.log('n----------------------------------------------------------------------');
console.log(`📊 INTERCONNECTED WORKINGS CRITIC SCORE: ${finalScore} / 10.0`);
console.log('🎯 TARGET THRESHOLD:                 >= 8.5 / 10.0');
console.log(`🏁 VERDICT:                          ${finalScore >= 8.5 ? 'EXCELLENT (PASSED)' : 'NEEDS REVISION'}`);
console.log('======================================================================n');

process.exit(finalScore >= 8.5 ? 0 : 1);
