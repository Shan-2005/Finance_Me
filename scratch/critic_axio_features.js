/**
 * ============================================================================
 * CRITIC ENGINE: AXIO-BEATING FEATURES EVALUATION SUITE
 * 
 * Target Score: >= 8.5 / 10.0 (Target: 10.0 / 10.0)
 * Evaluates:
 * 1. Historical Past SMS Inbox Scanner & Parser
 * 2. Intelligent Separation & Smart Titling (60+ Indian Brands, POS/ACH/VPA patterns)
 * 3. Running Bank Account Balances (Live Passbook with 'Avl Bal' tracking)
 * 4. Credit Card Bill Due & Statement Extraction
 * 5. Historical Backfill Deduplication & Safe Ingestion
 * ============================================================================
 */

class AxioIntelligenceEngine {
  constructor() {
    this.accounts = new Map(); // Account Mask -> { bankName, balance, lastUpdated, type }
    this.billReminders = [];  // List of upcoming detected bills
  }

  /**
   * Enhanced Merchant Intelligence: Resolves cryptic bank text into
   * clean brand names, categories, brand colors, and FontAwesome icons.
   */
  resolveMerchantDetails(rawText, baseMerchant = '', type = 'Debit') {
    const text = (rawText + ' ' + baseMerchant).toLowerCase();

    const merchantDirectory = [
      // Food & Dining
      { pattern: /\b(swiggy|bundl technologies)\b/, title: 'Swiggy', category: 'Unwanted / Leak', subtitle: 'Food & Dining', icon: 'fa-utensils', color: '#FC8019' },
      { pattern: /\b(zomato)\b/, title: 'Zomato', category: 'Unwanted / Leak', subtitle: 'Food Delivery', icon: 'fa-bowl-food', color: '#E23744' },
      { pattern: /\b(starbucks|tata starbucks)\b/, title: 'Starbucks', category: 'Unwanted / Leak', subtitle: 'Coffee & Cafe', icon: 'fa-mug-hot', color: '#006241' },
      { pattern: /\b(mcdonalds|mcdonald|hardcastle)\b/, title: "McDonald's", category: 'Unwanted / Leak', subtitle: 'Fast Food', icon: 'fa-burger', color: '#DA291C' },
      { pattern: /\b(kfc|yum restaurants)\b/, title: 'KFC', category: 'Unwanted / Leak', subtitle: 'Fast Food', icon: 'fa-drumstick-bite', color: '#A3080C' },
      { pattern: /\b(dominos|jubilant foodworks)\b/, title: "Domino's Pizza", category: 'Unwanted / Leak', subtitle: 'Pizza & Fast Food', icon: 'fa-pizza-slice', color: '#0078AE' },
      
      // Quick Commerce & Groceries
      { pattern: /\b(blinkit|grofers)\b/, title: 'Blinkit', category: 'Unwanted / Leak', subtitle: 'Quick Grocery', icon: 'fa-basket-shopping', color: '#F8CB46' },
      { pattern: /\b(zepto|kiranakart)\b/, title: 'Zepto', category: 'Unwanted / Leak', subtitle: '10-Min Groceries', icon: 'fa-bolt-lightning', color: '#8822FF' },
      { pattern: /\b(instamart)\b/, title: 'Swiggy Instamart', category: 'Unwanted / Leak', subtitle: 'Instant Mart', icon: 'fa-bag-shopping', color: '#FC8019' },
      { pattern: /\b(bigbasket|supermarket grocery)\b/, title: 'BigBasket', category: 'Unwanted / Leak', subtitle: 'Online Groceries', icon: 'fa-apple-whole', color: '#84C225' },

      // Travel & Rides
      { pattern: /\b(uber|uber india)\b/, title: 'Uber', category: 'Unwanted / Leak', subtitle: 'Ride & Cab', icon: 'fa-car', color: '#000000' },
      { pattern: /\b(ola|ani technologies)\b/, title: 'Ola Cabs', category: 'Unwanted / Leak', subtitle: 'Ride & Cab', icon: 'fa-taxi', color: '#00D154' },
      { pattern: /\b(rapido|roppen)\b/, title: 'Rapido Bike Taxi', category: 'Unwanted / Leak', subtitle: 'Bike Taxi', icon: 'fa-motorcycle', color: '#FEDB00' },
      { pattern: /\b(irctc)\b/, title: 'IRCTC Train Ticket', category: 'Unavoidable / Rent', subtitle: 'Train Travel', icon: 'fa-train', color: '#2C3E50' },
      { pattern: /\b(makemytrip|goibibo|cleartrip)\b/, title: 'Travel Booking', category: 'Unwanted / Leak', subtitle: 'Flight / Hotel', icon: 'fa-plane', color: '#EB2026' },

      // E-Commerce Shopping
      { pattern: /\b(amazon|amzn mktp)\b/, title: 'Amazon India', category: 'Unwanted / Leak', subtitle: 'E-Commerce Shopping', icon: 'fa-cart-shopping', color: '#FF9900' },
      { pattern: /\b(flipkart)\b/, title: 'Flipkart', category: 'Unwanted / Leak', subtitle: 'Online Shopping', icon: 'fa-bag-shopping', color: '#2874F0' },
      { pattern: /\b(myntra)\b/, title: 'Myntra', category: 'Unwanted / Leak', subtitle: 'Fashion Shopping', icon: 'fa-shirt', color: '#F13AB1' },
      { pattern: /\b(nykaa)\b/, title: 'Nykaa', category: 'Unwanted / Leak', subtitle: 'Beauty & Wellness', icon: 'fa-spa', color: '#FC2779' },

      // Entertainment & Streaming
      { pattern: /\b(netflix)\b/, title: 'Netflix', category: 'Unwanted / Leak', subtitle: 'OTT Subscription', icon: 'fa-film', color: '#E50914' },
      { pattern: /\b(spotify)\b/, title: 'Spotify', category: 'Unwanted / Leak', subtitle: 'Music Streaming', icon: 'fa-music', color: '#1DB954' },
      { pattern: /\b(bookmyshow|bigtree)\b/, title: 'BookMyShow', category: 'Unwanted / Leak', subtitle: 'Movies & Events', icon: 'fa-ticket', color: '#EC2844' },
      { pattern: /\b(hotstar|disney\+)\b/, title: 'Disney+ Hotstar', category: 'Unwanted / Leak', subtitle: 'OTT Subscription', icon: 'fa-tv', color: '#133682' },

      // Investments & Wealth
      { pattern: /\b(zerodha|broking)\b/, title: 'Zerodha', category: 'Investments', subtitle: 'Stocks & Demat', icon: 'fa-chart-line', color: '#387ED1' },
      { pattern: /\b(groww|nextbillion)\b/, title: 'Groww', category: 'Investments', subtitle: 'Mutual Funds & SIP', icon: 'fa-arrow-trend-up', color: '#00D09C' },
      { pattern: /\b(upstox|rksv)\b/, title: 'Upstox', category: 'Investments', subtitle: 'Trading & Stocks', icon: 'fa-chart-pie', color: '#5B32A8' },
      { pattern: /\b(angel one|angel broking)\b/, title: 'Angel One', category: 'Investments', subtitle: 'Stocks & Wealth', icon: 'fa-coins', color: '#FF5722' },
      { pattern: /\b(indmoney|finwizard)\b/, title: 'INDmoney', category: 'Investments', subtitle: 'Global Investments', icon: 'fa-wallet', color: '#2B64F5' },

      // Utilities & Bills
      { pattern: /\b(bescom|electricity|tneb|mseb|upcl|dhbvn|cesc)\b/, title: 'Electricity Bill', category: 'Unavoidable / Rent', subtitle: 'Utility Power', icon: 'fa-bolt', color: '#F59E0B' },
      { pattern: /\b(airtel)\b/, title: 'Airtel Telecom', category: 'Unavoidable / Rent', subtitle: 'Mobile & Broadband', icon: 'fa-tower-broadcast', color: '#ED1C24' },
      { pattern: /\b(jio|reliance jio)\b/, title: 'Jio Telecom', category: 'Unavoidable / Rent', subtitle: 'Mobile & Fiber', icon: 'fa-signal', color: '#0076CE' },
      { pattern: /\b(vodafone|idea|vi cellular)\b/, title: 'Vi Cellular', category: 'Unavoidable / Rent', subtitle: 'Mobile Recharge', icon: 'fa-sim-card', color: '#E60000' },
      { pattern: /\b(act fibernet|act broadband)\b/, title: 'ACT Fibernet', category: 'Unavoidable / Rent', subtitle: 'High-speed Internet', icon: 'fa-wifi', color: '#00A3E0' },
      { pattern: /\b(indane|bharat gas|hp gas)\b/, title: 'LPG Gas Cylinder', category: 'Unavoidable / Rent', subtitle: 'Kitchen Fuel', icon: 'fa-fire-burner', color: '#EA580C' },

      // Health & Pharmacy
      { pattern: /\b(apollo pharmacy|apollo)\b/, title: 'Apollo Pharmacy', category: 'Unavoidable / Rent', subtitle: 'Pharmacy & Medicine', icon: 'fa-prescription-bottle-medical', color: '#0284C7' },
      { pattern: /\b(1mg|tata 1mg)\b/, title: 'Tata 1mg', category: 'Unavoidable / Rent', subtitle: 'Online Pharmacy', icon: 'fa-pills', color: '#FF6F61' },
      { pattern: /\b(medplus)\b/, title: 'MedPlus', category: 'Unavoidable / Rent', subtitle: 'Medicines & Health', icon: 'fa-hospital', color: '#059669' },

      // Rent, Maintenance & Credit Cards
      { pattern: /\b(house rent|society maintenance|rent payment|nobroker)\b/, title: 'House Rent', category: 'Unavoidable / Rent', subtitle: 'Housing & Shelter', icon: 'fa-house', color: '#4B5563' },
      { pattern: /\b(cred|cred club)\b/, title: 'CRED', category: 'Unavoidable / Rent', subtitle: 'Credit Card Bill', icon: 'fa-credit-card', color: '#111827' },

      // Income & Salary
      { pattern: /\b(salary|payroll|inward imps|stipend)\b/, title: 'Salary / Inward Transfer', category: 'Income', subtitle: 'Primary Income', icon: 'fa-money-bill-wave', color: '#10B981' },
      
      // Cash & ATM
      { pattern: /\b(atm|cash withdrawal)\b/, title: 'ATM Cash Withdrawal', category: 'Unwanted / Leak', subtitle: 'Self Cash Out', icon: 'fa-money-bill-1', color: '#64748B' }
    ];

    for (const item of merchantDirectory) {
      if (item.pattern.test(text)) {
        return {
          title: item.title,
          category: type === 'Credit' ? 'Income' : item.category,
          subtitle: item.subtitle,
          icon: item.icon,
          color: item.color,
          isRecognized: true
        };
      }
    }

    // Default titling fallback with Title Casing
    const cleaned = (baseMerchant || 'UPI Payment')
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/[\*\#\_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const formattedTitle = cleaned.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

    return {
      title: formattedTitle || 'UPI Payment',
      category: type === 'Credit' ? 'Income' : 'Unwanted / Leak',
      subtitle: type === 'Credit' ? 'Inward Payment' : 'Merchant Payment',
      icon: type === 'Credit' ? 'fa-arrow-down-left' : 'fa-receipt',
      color: type === 'Credit' ? '#10B981' : '#3B82F6',
      isRecognized: false
    };
  }

  /**
   * Running Bank Balance Extractor:
   * Parses 'Avl Bal: INR 45,210.50' or 'Avail Bal Rs 1,12,000.00' and links to Bank Account
   */
  extractRunningBalance(rawText, accountMask = null, bankName = null, timestamp = Date.now()) {
    if (!rawText || typeof rawText !== 'string') return null;

    const balRegexes = [
      /(?:(?:av(?:ail(?:able)?)?|avl)(?:\s+acc)?\s*bal(?:ance)?|clear\s*bal(?:ance)?|bal(?:ance)?\s*is)\s*[:.-]?\s*(?:inr|rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /(?:inr|rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:is\s+avl|avl\s*bal|is\s+avail)/i
    ];

    let balance = null;
    for (const rx of balRegexes) {
      const match = rawText.match(rx);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val) && val >= 0 && val < 100000000) {
          balance = val;
          break;
        }
      }
    }

    if (balance === null) return null;

    // Detect Bank Name if not provided
    if (!bankName) {
      if (/hdfc/i.test(rawText)) bankName = 'HDFC Bank';
      else if (/sbi|state bank/i.test(rawText)) bankName = 'State Bank of India';
      else if (/icici/i.test(rawText)) bankName = 'ICICI Bank';
      else if (/axis/i.test(rawText)) bankName = 'Axis Bank';
      else if (/kotak/i.test(rawText)) bankName = 'Kotak Mahindra Bank';
      else if (/paytm/i.test(rawText)) bankName = 'Paytm Payments Bank';
      else if (/indusind/i.test(rawText)) bankName = 'IndusInd Bank';
      else if (/bob|baroda/i.test(rawText)) bankName = 'Bank of Baroda';
      else if (/pnb|punjab national/i.test(rawText)) bankName = 'Punjab National Bank';
      else bankName = 'Bank Account';
    }

    const key = accountMask ? `${bankName}_${accountMask}` : bankName;

    const accountData = {
      bankName,
      accountMask: accountMask || 'Primary',
      balance,
      lastUpdated: timestamp,
      rawBalanceText: `₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    };

    this.accounts.set(key, accountData);
    return accountData;
  }

  /**
   * Credit Card Bill & Due Date Extractor:
   * Extracts bill statements, min dues, and due dates ahead of time
   */
  extractBillReminder(rawText, timestamp = Date.now()) {
    if (!rawText || typeof rawText !== 'string') return null;

    const isBill = /\b(bill of|statement for|total amount due|total due|min(?:imum)? amount due|min due|pay before|due date is)\b/i.test(rawText);
    if (!isBill) return null;

    // Extract Total Bill Amount
    let totalDue = 0;
    const dueMatch = rawText.match(/(?:bill of|total(?: amount)? due|bill amount)\s*[:.-]?\s*(?:is|of)?\s*[:.-]?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (dueMatch && dueMatch[1]) {
      totalDue = parseFloat(dueMatch[1].replace(/,/g, ''));
    }

    // Extract Minimum Due
    let minDue = 0;
    const minMatch = rawText.match(/(?:min(?:imum)?(?: amount)? due|min due)\s*[:.-]?\s*(?:is|of)?\s*[:.-]?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (minMatch && minMatch[1]) {
      minDue = parseFloat(minMatch[1].replace(/,/g, ''));
    }

    // Extract Due Date (e.g. 15-OCT-26, 15/10/2026, 15th Oct, 18-Oct-26)
    let dueDateStr = null;
    const dateMatch = rawText.match(/\b(?:by|on|before|due date:?)\s*([0-3]?[0-9][\s\/-](?:[a-zA-Z]{3,9}|[0-1]?[0-9])(?:[\s\/-][0-9]{2,4})?)/i);
    if (dateMatch && dateMatch[1]) {
      dueDateStr = dateMatch[1].trim();
    }

    // Extract Card Mask
    let cardMask = null;
    const maskMatch = rawText.match(/\b(?:card\s*(?:ending\s*(?:with)?|no\.?)|a\/c)\s*[:.-]?\s*([*#xX]*\d{3,4})\b/i);
    if (maskMatch && maskMatch[1]) {
      cardMask = maskMatch[1].replace(/[*#xX]/g, '').trim();
    }

    if (totalDue <= 0 && minDue <= 0) return null;

    const billObj = {
      id: `bill_${timestamp}_${cardMask || 'card'}`,
      cardMask: cardMask || 'Primary',
      totalDue,
      minDue,
      dueDate: dueDateStr || 'Upcoming',
      rawText,
      timestamp,
      status: 'unpaid'
    };

    this.billReminders.push(billObj);
    return billObj;
  }

  /**
   * Batch Historical SMS Ingestion:
   * Scans a batch of past SMS, deduplicates against existing records,
   * updates running balances, and produces clean transaction objects.
   */
  processHistoricalSmsBatch(smsList = [], existingTxns = [], readerEngine) {
    const results = {
      totalProcessed: smsList.length,
      importedCount: 0,
      skippedCount: 0,
      accountsUpdated: 0,
      billsFound: 0,
      transactions: []
    };

    const existingKeys = new Set();
    existingTxns.forEach(t => {
      if (t.signature) existingKeys.add(t.signature);
      if (t.referenceId) existingKeys.add(`ref_${t.referenceId.toLowerCase()}`);
      const normM = (t.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      existingKeys.add(`${t.type}_${Math.round(t.amount * 100)}_${normM}`);
    });

    for (const sms of smsList) {
      const { body, sender, date } = sms;
      if (!body) continue;

      // Check for Bill Statement first
      const bill = this.extractBillReminder(body, date);
      if (bill) {
        results.billsFound++;
      }

      // Check for Running Bank Balance
      const maskMatch = body.match(/\b(?:a\/c|account|card)\s*(?:ending\s*(?:with)?|no\.?|[*#xX]+)?\s*[:.-]?\s*([*#xX]*\d{3,4})\b/i);
      const accMask = maskMatch ? maskMatch[1].replace(/[*#xX]/g, '') : null;
      const bal = this.extractRunningBalance(body, accMask, null, date);
      if (bal) {
        results.accountsUpdated++;
      }

      // Read transaction
      const read = readerEngine.readNotification({ text: body, packageName: sender || 'sms', timestamp: date });
      if (!read || !read.isFinancial || !read.parsed) {
        results.skippedCount++;
        continue;
      }

      const p = read.parsed;
      const brand = this.resolveMerchantDetails(body, p.merchant, p.type);
      p.merchant = brand.title;
      p.category = brand.category;
      p.subtitle = brand.subtitle;
      p.icon = brand.icon;
      p.brandColor = brand.color;

      const normM = p.merchant.toLowerCase().replace(/[^a-z0-9]/g, '');
      const key1 = p.signature;
      const key2 = `${p.type}_${Math.round(p.amount * 100)}_${normM}`;

      if ((key1 && existingKeys.has(key1)) || existingKeys.has(key2)) {
        results.skippedCount++;
        continue;
      }

      if (key1) existingKeys.add(key1);
      existingKeys.add(key2);

      results.transactions.push(p);
      results.importedCount++;
    }

    return results;
  }
}

// ----------------------------------------------------------------------------
// CRITIC TEST RUNNER FOR AXIO-BEATING ENGINE
// ----------------------------------------------------------------------------

function runAxioEngineCritic() {
  console.log('======================================================================');
  console.log('🔍 EXECUTING CRITIC ENGINE: AXIO-BEATING FEATURES SUITE');
  console.log('======================================================================\n');

  const { NotificationReaderEngine } = require('./critic_notification_reader');
  const reader = new NotificationReaderEngine();
  const axio = new AxioIntelligenceEngine();

  const testCases = [
    {
      name: 'CASE-1: Smart Titling - POS Swiggy -> Clean Title, Icon & Food Category',
      run: () => {
        const text = 'POS 401234 SWIGGY BANGALORE IN on 02-OCT-26. Rs 420.00 debited from A/C **1234.';
        const brand = axio.resolveMerchantDetails(text, 'SWIGGY BANGALORE', 'Debit');
        return brand.title === 'Swiggy' &&
               brand.category === 'Unwanted / Leak' &&
               brand.subtitle === 'Food & Dining' &&
               brand.color === '#FC8019';
      }
    },
    {
      name: 'CASE-2: Smart Titling - ACH Zerodha Broking -> Clean Title & Investment Category',
      run: () => {
        const text = 'ACH D- Zerodha Broking Ltd-129481 towards Demat. Rs 5000.00 debited from A/C **9876.';
        const brand = axio.resolveMerchantDetails(text, 'Zerodha Broking Ltd', 'Debit');
        return brand.title === 'Zerodha' &&
               brand.category === 'Investments' &&
               brand.subtitle === 'Stocks & Demat' &&
               brand.icon === 'fa-chart-line';
      }
    },
    {
      name: 'CASE-3: Smart Titling - Quick Commerce (Blinkit) -> Instant Grocery Badge',
      run: () => {
        const text = 'Debited Rs 385.00 to BLINKIT COMMERCE GURGAON via UPI. Ref: 423984124981.';
        const brand = axio.resolveMerchantDetails(text, 'BLINKIT COMMERCE', 'Debit');
        return brand.title === 'Blinkit' &&
               brand.subtitle === 'Quick Grocery' &&
               brand.color === '#F8CB46';
      }
    },
    {
      name: 'CASE-4: Smart Titling - Utility Electricity Bill (BESCOM) -> Unavoidable Utility',
      run: () => {
        const text = 'Paid Rs 1,450.00 for BESCOM Electricity Bill online on 01-OCT-26.';
        const brand = axio.resolveMerchantDetails(text, 'BESCOM Electricity', 'Debit');
        return brand.title === 'Electricity Bill' &&
               brand.category === 'Unavoidable / Rent' &&
               brand.icon === 'fa-bolt';
      }
    },
    {
      name: 'CASE-5: Smart Titling - Inward Salary Transfer -> Clean Income Title',
      run: () => {
        const text = 'Your A/C **5678 is credited by INR 95,000.00 on 30-SEP-26 by Salary Inward Clg.';
        const brand = axio.resolveMerchantDetails(text, 'Salary Inward Clg', 'Credit');
        return brand.title === 'Salary / Inward Transfer' &&
               brand.category === 'Income' &&
               brand.color === '#10B981';
      }
    },
    {
      name: 'CASE-6: Running Bank Balance - Extract Avl Bal & Multi-Account Card State',
      run: () => {
        const text = 'Rs 450.00 debited from HDFC Bank A/C **1234 on 02-OCT-26. Avl Bal: INR 48,250.75.';
        const res = axio.extractRunningBalance(text, '1234', 'HDFC Bank');
        return res &&
               res.balance === 48250.75 &&
               res.accountMask === '1234' &&
               res.bankName === 'HDFC Bank' &&
               axio.accounts.get('HDFC Bank_1234').balance === 48250.75;
      }
    },
    {
      name: 'CASE-7: Running Bank Balance - Separate Accounts (SBI vs HDFC)',
      run: () => {
        const textSbi = 'Your SBI A/C *5678 credited by INR 25,000.00. Avail Bal Rs 62,400.00.';
        const res = axio.extractRunningBalance(textSbi, '5678', 'State Bank of India');
        return axio.accounts.has('HDFC Bank_1234') &&
               axio.accounts.has('State Bank of India_5678') &&
               axio.accounts.get('State Bank of India_5678').balance === 62400;
      }
    },
    {
      name: 'CASE-8: Credit Card Bill Statement Detection (Total Due + Min Due + Due Date)',
      run: () => {
        const text = 'Statement for your HDFC Bank Card ending 4321. Total amount due: Rs 14,250.00. Min amount due: Rs 1,425.00 by 18-Oct-26.';
        const bill = axio.extractBillReminder(text);
        return bill &&
               bill.totalDue === 14250 &&
               bill.minDue === 1425 &&
               bill.cardMask === '4321' &&
               bill.dueDate.includes('18-Oct-26');
      }
    },
    {
      name: 'CASE-9: Past SMS Inbox Scanning & Safe Batch Ingestion',
      run: () => {
        const pastSmsList = [
          { body: 'Rs 120.00 debited from A/C **1234 to UBER INDIA on 28-SEP-26. Avl Bal: INR 48,700.75.', sender: 'HDFCBK', date: 1727500000000 },
          { body: 'Dear Customer, your OTP is 492102 for netbanking login. Do not share.', sender: 'HDFCBK', date: 1727510000000 },
          { body: 'Paid Rs 850.00 to ZOMATO on 29-SEP-26 from A/C **1234.', sender: 'HDFCBK', date: 1727600000000 },
          { body: 'Bill of Rs 8,500.00 generated for Card ending 9988. Due date is 25-Oct-26.', sender: 'ICICIB', date: 1727700000000 }
        ];

        const batchRes = axio.processHistoricalSmsBatch(pastSmsList, [], reader);
        // OTP must be skipped, 2 financial transactions imported, 1 bill found, accounts updated
        return batchRes.importedCount === 2 &&
               batchRes.skippedCount === 2 && // OTP + Bill statement
               batchRes.billsFound === 1 &&
               batchRes.transactions.some(t => t.merchant === 'Uber') &&
               batchRes.transactions.some(t => t.merchant === 'Zomato');
      }
    },
    {
      name: 'CASE-10: Past SMS Historical Backfill Deduplication',
      run: () => {
        const existing = [
          { amount: 120, type: 'Debit', merchant: 'Uber', signature: 'hash_Debit_12000_uber_1' }
        ];
        const pastSmsList = [
          { body: 'Rs 120.00 debited from A/C **1234 to UBER INDIA on 28-SEP-26.', sender: 'HDFCBK', date: 1727500000000 }
        ];
        const res = axio.processHistoricalSmsBatch(pastSmsList, existing, reader);
        // Should skip duplicate
        return res.importedCount === 0 && res.skippedCount === 1;
      }
    }
  ];

  let passed = 0;
  testCases.forEach((tc, idx) => {
    const ok = tc.run();
    if (ok) {
      passed++;
      console.log(`✅ [PASS] ${tc.name}`);
    } else {
      console.log(`❌ [FAIL] ${tc.name}`);
    }
  });

  const score = Number(((passed / testCases.length) * 10).toFixed(1));
  console.log('\n----------------------------------------------------------------------');
  console.log(`📊 AXIO-BEATING ENGINE CRITIC SCORE: ${score} / 10.0`);
  console.log(`🎯 TARGET THRESHOLD:                 >= 8.5 / 10.0`);
  console.log(`🏁 VERDICT:                          ${score >= 8.5 ? 'EXCELLENT (PASSED)' : 'RETRY NEEDED'}`);
  console.log('======================================================================\n');

  return { score, passed: score >= 8.5 };
}

if (require.main === module) {
  runAxioEngineCritic();
}

module.exports = { AxioIntelligenceEngine, runAxioEngineCritic };
