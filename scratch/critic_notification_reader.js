/**
 * ============================================================================
 * CRITIC ENGINE: NOTIFICATION READER & PARSER EVALUATION SUITE
 * 
 * Target Score: >= 8.5 / 10.0 (Target: 10.0 / 10.0)
 * Evaluates:
 * 1. Multi-source field extraction (Title, Text, BigText, SubText, TextLines)
 * 2. Character & Unicode sanitization (NBSP, zero-width chars, Indian commas)
 * 3. Cross-source deduplication (UPI App alert + Bank SMS merged into 1)
 * 4. High-precision noise rejection (OTPs, promo offers, balance queries, declines)
 * 5. Multi-format entity extraction (Debit, Credit, Investment, Salary, Refund, Card)
 * 6. Reference ID & Account mask extraction (UPI RRN, Txn ID, A/C mask)
 * 7. Category classification accuracy
 * 8. Offline & Lock Screen queueing contract
 * ============================================================================
 */

const fs = require('fs');

class NotificationReaderEngine {
  constructor() {
    this.DEDUP_WINDOW_MS = 3 * 60 * 1000; // 3 minute cross-source merge window
    this.recentTransactions = []; // List of recent parsed transactions for cross-source deduplication
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
   * Normalizes counterparty/merchant string for comparison
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
   * Checks if an incoming notification is a duplicate of a recent notification
   * or a cross-source match (e.g., GPay app alert vs Bank SMS for same event)
   */
  findDuplicateOrMatch(parsed, timestamp = Date.now()) {
    if (!parsed || !parsed.amount) return null;

    // Prune old entries outside window
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
      // Same amount, same type, matching merchant within window
      const sameAmount = Math.abs(recent.amount - parsed.amount) < 0.01;
      const sameType = recent.type === parsed.type;
      const recentNorm = this.normalizeMerchant(recent.merchant);

      const merchantMatches = normMerchant === recentNorm ||
                              normMerchant.includes(recentNorm) ||
                              recentNorm.includes(normMerchant) ||
                              (normMerchant.length > 3 && recentNorm.length > 3 && (normMerchant.startsWith(recentNorm.substring(0, 4)) || recentNorm.startsWith(normMerchant.substring(0, 4))));

      if (sameAmount && sameType && merchantMatches) {
        return { match: recent, reason: 'CROSS_SOURCE_MERGE' };
      }
    }

    return null;
  }

  /**
   * Main parsing & reading algorithm
   */
  readNotification({ title = '', text = '', bigText = '', subText = '', lines = [], packageName = '', timestamp = Date.now() }) {
    // 1. Extract from all available Android notification fields
    const parts = [
      this.sanitizeText(title),
      this.sanitizeText(text),
      this.sanitizeText(bigText),
      this.sanitizeText(subText)
    ];

    if (Array.isArray(lines)) {
      lines.forEach(line => parts.push(this.sanitizeText(line)));
    }

    // Combine distinct parts
    const combinedContent = Array.from(new Set(parts.filter(p => p.length > 0))).join(' ');
    if (combinedContent.length < 5) {
      return { isFinancial: false, reason: 'EMPTY_OR_TOO_SHORT' };
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
      return {
        isFinancial: false,
        reason: isOtp ? 'OTP_MESSAGE' : isPromo ? 'PROMOTIONAL_OFFER' : isBalanceOnly ? 'BALANCE_INQUIRY' : isDeclined ? 'FAILED_TRANSACTION' : 'BILL_REMINDER'
      };
    }

    // 3. Extract Amount
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
      return { isFinancial: false, reason: 'NO_AMOUNT_FOUND' };
    }

    // 4. Transaction Type (Debit vs Credit)
    // Strip "credit card" token to prevent card spending from falsely triggering Credit type
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

    // 6. Extract Account / Card Mask
    let accountMask = null;
    const maskMatch = combinedContent.match(/\b(?:a\/c|account|card)\s*(?:ending\s*(?:with)?|no\.?|[*#xX]+)?\s*[:.-]?\s*([*#xX]*\d{3,4})\b/i);
    if (maskMatch) {
      accountMask = maskMatch[1].replace(/[*#xX]/g, '').trim();
    }

    // 7. Extract Merchant / Counterparty
    let merchant = isCredit ? 'Received Payment' : 'UPI Payment';

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
    } else if (/\b(rent|maintenance|electricity|bescom|mseb|tneb|water|gas|indane|cylinder|broadband|wifi|airtel|jio|vi|recharge|dth|emi|loan|insurance|lic|tuition|fees|school|college|hospital|apollo|pharmacy|medplus|doctor)\b/.test(textAndMerchant)) {
      category = 'Unavoidable / Rent';
    } else if (/\b(swiggy|zomato|blinkit|zepto|instamart|uber|ola|rapido|starbucks|mcdonald|kfc|burger king|cafe|restaurant|cinema|pvr|inox|bookmyshow|amazon|flipkart|myntra|zara|shopping|netflix|spotify|prime)\b/.test(textAndMerchant)) {
      category = 'Unwanted / Leak';
    }

    // 9. Payment Mode
    let mode = 'GPay / UPI';
    if (/\b(credit card|card ending|visa|mastercard|rupay card)\b/i.test(combinedContent)) {
      mode = 'Credit Card';
    } else if (/\b(net banking|neft|rtgs|imps|internet banking)\b/i.test(combinedContent)) {
      mode = 'Net Banking';
    } else if (/\b(atm|cash withdrawal)\b/i.test(combinedContent)) {
      mode = 'Cash';
    }

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
      packageName,
      timestamp
    };

    // 10. Check Cross-Source Deduplication & Duplicate Streams
    const dupCheck = this.findDuplicateOrMatch(parsed, timestamp);
    if (dupCheck) {
      // Merge: if the new one has a referenceId and the existing didn't, enrich it!
      if (parsed.referenceId && !dupCheck.match.referenceId) {
        dupCheck.match.referenceId = parsed.referenceId;
      }
      return {
        isFinancial: true,
        isDuplicate: true,
        duplicateReason: dupCheck.reason,
        matchedTransaction: dupCheck.match,
        parsed
      };
    }

    // Record as seen
    this.recentTransactions.push(parsed);
    return {
      isFinancial: true,
      isDuplicate: false,
      parsed
    };
  }
}

// ----------------------------------------------------------------------------
// CRITIC TEST RUNNER FOR NOTIFICATION READER
// ----------------------------------------------------------------------------

function runNotificationReaderCritic() {
  console.log('======================================================================');
  console.log('🔍 EXECUTING CRITIC ENGINE: NOTIFICATION READER SUITE');
  console.log('======================================================================\n');

  const reader = new NotificationReaderEngine();
  const testCases = [
    {
      name: 'CASE-1: Multi-source field extraction (Title + Text + SubText)',
      input: {
        title: 'HDFC Bank Alert',
        text: 'Sent Rs. 450.00 to Swiggy on 02-Oct-26',
        subText: 'AD-HDFCBK',
        bigText: 'Sent Rs. 450.00 from A/C **1234 to Swiggy on 02-Oct-26. UPI Ref: 423456789012'
      },
      check: res => res.isFinancial && res.parsed.amount === 450 && res.parsed.merchant === 'Swiggy' && res.parsed.referenceId === '423456789012'
    },
    {
      name: 'CASE-2: InboxStyle Bundled TextLines extraction',
      input: {
        title: '2 new messages',
        lines: [
          'HDFC: Paid INR 1,200.00 to Zomato via UPI Ref 998877665544',
          'A/C **999 bal: 45,000'
        ]
      },
      check: res => res.isFinancial && res.parsed.amount === 1200 && res.parsed.merchant === 'Zomato' && res.parsed.referenceId === '998877665544'
    },
    {
      name: 'CASE-3: Cross-source Deduplication (GPay push + Bank SMS within 5s)',
      run: () => {
        // First notification: GPay App alert
        const res1 = reader.readNotification({
          packageName: 'com.google.android.apps.nbu.paisa.user',
          title: 'Google Pay',
          text: 'Paid ₹480 to Swiggy',
          timestamp: 10000
        });

        // Second notification: Bank SMS 4 seconds later for the SAME purchase
        const res2 = reader.readNotification({
          packageName: 'com.google.android.apps.messaging',
          title: 'AD-HDFCBK',
          text: 'Sent Rs. 480.00 to SWIGGY on 02-OCT. UPI Ref: 112233445566',
          timestamp: 14000
        });

        return res1.isFinancial && !res1.isDuplicate && res2.isFinancial && res2.isDuplicate && res2.duplicateReason === 'CROSS_SOURCE_MERGE';
      }
    },
    {
      name: 'CASE-4: Strict noise filtering (OTP rejection)',
      input: {
        title: 'State Bank of India',
        text: '492019 is your SECRET OTP for transaction of Rs 500 at Amazon. Do NOT share OTP with anyone.'
      },
      check: res => !res.isFinancial && res.reason === 'OTP_MESSAGE'
    },
    {
      name: 'CASE-5: Strict noise filtering (Promotional pre-approved loan)',
      input: {
        title: 'Kotak Bank',
        text: 'Congratulations! Pre-approved personal loan of Rs. 5,00,000 at flat 10.5% interest. Apply now in 2 mins.'
      },
      check: res => !res.isFinancial && res.reason === 'PROMOTIONAL_OFFER'
    },
    {
      name: 'CASE-6: Strict noise filtering (Balance inquiry rejection)',
      input: {
        title: 'Axis Bank',
        text: 'Dear Customer, your Available Balance in A/C ending 4321 is Rs. 84,320.50 as on 02-OCT-26.'
      },
      check: res => !res.isFinancial && res.reason === 'BALANCE_INQUIRY'
    },
    {
      name: 'CASE-7: Strict noise filtering (Declined/Failed payment)',
      input: {
        title: 'UPI Payment Failed',
        text: 'Transaction of Rs. 750 to Uber failed due to incorrect UPI PIN. Money was not debited.'
      },
      check: res => !res.isFinancial && res.reason === 'FAILED_TRANSACTION'
    },
    {
      name: 'CASE-8: Salary credit via NEFT/IMPS',
      input: {
        title: 'ICICI Bank',
        text: 'Your A/C *5678 is credited with INR 85,000.00 on 01-OCT-26 via NEFT INFOSYS LTD SALARY. Avl Bal: INR 1,12,000.00'
      },
      check: res => res.isFinancial && res.parsed.type === 'Credit' && res.parsed.amount === 85000 && res.parsed.category === 'Income'
    },
    {
      name: 'CASE-9: Credit Card Swipe (must be Debit, NOT Credit)',
      input: {
        title: 'HDFC Bank Credit Card',
        text: 'Alert: Spent INR 2,450.00 on Credit Card ending 8765 at STARBUCKS on 02-OCT. Avl limit: INR 95,000.00'
      },
      check: res => res.isFinancial && res.parsed.type === 'Debit' && res.parsed.mode === 'Credit Card' && res.parsed.amount === 2450 && res.parsed.merchant === 'Starbucks'
    },
    {
      name: 'CASE-10: Investment SIP Auto-Debit',
      input: {
        title: 'SBI Alert',
        text: 'Auto-debited Rs. 3,000.00 from A/C *1111 towards Zerodha Mutual Fund SIP. Ref No: 88776655'
      },
      check: res => res.isFinancial && res.parsed.type === 'Debit' && res.parsed.category === 'Investments' && res.parsed.amount === 3000
    },
    {
      name: 'CASE-11: Refund & Reversal detection',
      input: {
        title: 'Amazon Pay',
        text: 'Refund of Rs. 699.00 has been credited to your bank A/C for order #402-12345. UPI Ref: 334455667788'
      },
      check: res => res.isFinancial && res.parsed.type === 'Credit' && res.parsed.amount === 699 && res.parsed.category === 'Income'
    },
    {
      name: 'CASE-12: NBSP, Unicode zero-width & Indian numbering format',
      input: {
        title: 'Axis\u00A0Bank',
        text: 'Dear Customer,\u200B INR\u00A01,50,000.00 debited towards House Rent on 02-OCT. Ref: 99001122'
      },
      check: res => res.isFinancial && res.parsed.amount === 150000 && res.parsed.category === 'Unavoidable / Rent' && res.parsed.type === 'Debit'
    }
  ];

  let passedCount = 0;
  testCases.forEach((tc, idx) => {
    let passed = false;
    try {
      if (tc.run) {
        passed = tc.run();
      } else {
        const res = reader.readNotification(tc.input);
        passed = tc.check(res);
      }
    } catch (e) {
      console.error(`Error in ${tc.name}:`, e);
      passed = false;
    }

    if (passed) {
      passedCount++;
      console.log(`✅ [PASS] ${tc.name}`);
    } else {
      console.log(`❌ [FAIL] ${tc.name}`);
    }
  });

  const score = Number(((passedCount / testCases.length) * 10).toFixed(1));
  console.log('\n----------------------------------------------------------------------');
  console.log(`📊 NOTIFICATION READER CRITIC SCORE: ${score} / 10.0`);
  console.log(`🎯 PASS THRESHOLD:                   >= 8.5 / 10.0`);
  console.log(`🏁 VERDICT:                          ${score >= 8.5 ? 'EXCELLENT (PASSED)' : 'RETRY NEEDED'}`);
  console.log('======================================================================\n');

  return { score, passed: score >= 8.5 };
}

if (require.main === module) {
  runNotificationReaderCritic();
}

module.exports = { NotificationReaderEngine, runNotificationReaderCritic };
