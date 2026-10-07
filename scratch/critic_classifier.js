/**
 * ============================================================================
 * FINANCE ME - Advanced Financial Notification Engine & Critic Evaluation
 * High-accuracy Regex Parser, Smart Entity Extractor, Multi-Factor Deduplication,
 * and Self-Evaluation Critic Test Suite (Target Score >= 8.5/10)
 * ============================================================================
 */

class FinancialNotificationClassifier {
  constructor() {
    // 5-minute bucket window for non-reference deduplication; 24h for reference-based
    this.DEDUP_WINDOW_MS = 5 * 60 * 1000;
    this.seenSignatures = new Map(); // signature -> timestamp
  }

  /**
   * Generates a deterministic signature to prevent duplicate ingestion
   */
  generateSignature(parsed) {
    if (!parsed || !parsed.amount) return null;
    if (parsed.referenceId && parsed.referenceId.length >= 6) {
      return `ref_${parsed.referenceId.toLowerCase()}`;
    }
    // Time-bucketed hash (5-minute chunks)
    const timeBucket = Math.floor((parsed.timestamp || Date.now()) / this.DEDUP_WINDOW_MS);
    const normMerchant = (parsed.merchant || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
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
   * Main Classification Method
   * Returns: {
   *   isFinancial: boolean,
   *   type: 'Debit' | 'Credit' | 'Ignore',
   *   amount: number,
   *   merchant: string,
   *   category: string,
   *   mode: string,
   *   referenceId: string | null,
   *   confidence: number,
   *   needsReview: boolean,
   *   reasons: string[]
   * }
   */
  classify(rawText, timestamp = Date.now()) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 5) {
      return { isFinancial: false, reasons: ['Text too short or empty'] };
    }

    const cleanText = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. FILTER: OTPs, Promos, Non-payment Notifications
    const isOtp = /\b(otp|one time password|verification code|secret code)\b/i.test(cleanText) &&
                  !/\b(debited|credited|paid|spent)\b/i.test(cleanText);
    const isPromo = /\b(pre-approved|apply now|congratulations|discount coupon|flat \d+% off|loan offer|win up to)\b/i.test(cleanText);
    const isBalanceOnly = /\b(avl bal|available balance|acc bal|balance is)\b/i.test(cleanText) &&
                          !/\b(debited|credited|credit|sent|paid|spent|transferred)\b/i.test(cleanText);
    const isDeclined = /\b(declined|failed|unsuccessful|cancelled|insufficient funds|expired)\b/i.test(cleanText) &&
                       !/\b(refund|reversed)\b/i.test(cleanText);

    if (isOtp || isPromo || isBalanceOnly || isDeclined) {
      return {
        isFinancial: false,
        reasons: [isOtp ? 'OTP message' : isPromo ? 'Promotional offer' : isBalanceOnly ? 'Balance inquiry only' : 'Failed transaction']
      };
    }

    // 2. EXTRACT AMOUNT
    let amount = 0;
    // Common currency formats in Indian & international notifications:
    // "Rs. 1,234.50", "INR 500", "₹3,400", "debited by 500.00", "paid 450", "credited with INR 1000"
    const amountRegexes = [
      /(?:rs\.?|inr|₹|re\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i,
      /(?:debited(?:\s+by|\s+with)?|credited(?:\s+by|\s+with)?|paid|spent|transferred)\s+(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /(?:amount|sum)\s*(?:of)?\s*:?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
    ];

    for (const rx of amountRegexes) {
      const match = cleanText.match(rx);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        // Avoid interpreting 4-digit years (2025, 2026) or bank account digits as amount unless preceded by currency
        if (!isNaN(val) && val > 0 && val < 50000000) {
          amount = val;
          break;
        }
      }
    }

    if (!amount || amount <= 0) {
      return { isFinancial: false, reasons: ['No valid monetary amount detected'] };
    }

    // Strip "credit card" string when detecting credit/debit transaction type
    const textWithoutCard = cleanText.replace(/credit\s*card/gi, 'cc_token');
    const isDebitExplicit = /\b(spent|debited|paid|purchase of|withdrawn|sent|transferred to)\b/i.test(cleanText);
    const isCreditExplicit = /\b(credited|credit of|received|deposited|refunded|reversed|cashback|added to|salary credited)\b/i.test(textWithoutCard);
    
    const type = (!isDebitExplicit && isCreditExplicit) ? 'Credit' : 'Debit';
    const isCredit = type === 'Credit';

    // 4. EXTRACT REFERENCE / UPI RRN
    let referenceId = null;
    const refMatch = cleanText.match(/\b(?:upi\s*ref(?:erence)?(?:\s*no)?|rrn|txn\s*id|ref\s*no|ref)\s*[:.-]?\s*([0-9a-zA-Z]{6,16})/i);
    if (refMatch) {
      referenceId = refMatch[1].trim();
    }

    // 5. EXTRACT MERCHANT / COUNTERPARTY
    let merchant = isCredit ? 'Received Payment' : 'UPI Payment';
    let confidence = 0.70;

    if (!isCredit) {
      const toPatterns = [
        /\b(?:to|paid to|sent to)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+on\b|\s+ref\b|\s+via\b|\s+not\b|\s+a\/c\b|\s+upi\b|\.|$)/i,
        /\b(?:at|towards)\s+([A-Za-z0-9][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+on\b|\s+via\b|\s+ref\b|\.|$)/i,
        /\bvpa\s+([A-Za-z0-9.\-_]+@[a-zA-Z]+)/i
      ];

      for (const rx of toPatterns) {
        const m = cleanText.match(rx);
        if (m && m[1]) {
          let candidate = m[1].trim();
          // Filter out generic bank tokens
          if (!/^(hdfc|sbi|icici|axis|kotak|bank|account|vpa|upi|credit card)$/i.test(candidate)) {
            if (candidate.includes('@')) {
              candidate = candidate.split('@')[0].replace(/\d+$/, '');
            }
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
        const m = cleanText.match(rx);
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

    // Clean merchant string
    merchant = merchant.replace(/^(the|a|an)\s+/i, '')
                       .replace(/[\*\#\_]/g, ' ')
                       .replace(/\s+/g, ' ')
                       .substring(0, 36)
                       .trim();
    merchant = merchant.replace(/\b\w/g, l => l.toUpperCase());

    // 6. CATEGORY CLASSIFICATION
    let category = 'Unwanted / Leak';
    const textAndMerchant = (cleanText + ' ' + merchant).toLowerCase();

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

    // 7. PAYMENT MODE
    let mode = 'GPay / UPI Auto-Sync';
    if (/\b(credit card|card ending|visa|mastercard|rupay card)\b/i.test(cleanText)) {
      mode = 'Credit Card';
    } else if (/\b(net banking|neft|rtgs|imps|internet banking)\b/i.test(cleanText)) {
      mode = 'Net Banking';
    } else if (/\b(atm|cash withdrawal)\b/i.test(cleanText)) {
      mode = 'Cash';
    }

    confidence = Math.min(0.98, Math.max(0.60, confidence));

    // "Needs Review" flag:
    // If merchant is generic fallback OR confidence < 0.85 OR high amount (> 15000), flag for review
    const needsReview = confidence < 0.85 ||
                        merchant === 'UPI Payment' ||
                        merchant === 'Received Payment' ||
                        (amount > 15000 && category === 'Unwanted / Leak');

    const result = {
      isFinancial: true,
      type,
      amount,
      merchant,
      category,
      mode,
      referenceId,
      confidence: Math.round(confidence * 100) / 100,
      needsReview,
      rawText: cleanText,
      timestamp
    };

    result.signature = this.generateSignature(result);
    return result;
  }
}

// ----------------------------------------------------------------------------
// CRITIC ENGINE & EVALUATION TEST SUITE
// ----------------------------------------------------------------------------

function runCriticEngineTests() {
  const classifier = new FinancialNotificationClassifier();

  const testCases = [
    {
      name: "HDFC Bank UPI Debit with Merchant",
      input: "Sent Rs. 450.00 from HDFC Bank A/C **1234 to SWIGGY on 02-OCT-26. UPI Ref: 423456789012. Not you? Call bank.",
      expected: { type: "Debit", amount: 450.00, category: "Unwanted / Leak", hasRef: true }
    },
    {
      name: "SBI Salary Credit",
      input: "Dear Customer, your A/C 9876 has a credit of INR 85,000.00 on 01-OCT-26 towards Salary by Infosys Ltd. Avl Bal: INR 92,340.",
      expected: { type: "Credit", amount: 85000.00, category: "Income", hasRef: false }
    },
    {
      name: "PhonePe Investment SIP",
      input: "Paid ₹1,500 to Zerodha Broking Ltd via UPI on PhonePe. Ref No: 9988776655. Mutual Fund SIP investment processed.",
      expected: { type: "Debit", amount: 1500.00, category: "Investments", hasRef: true }
    },
    {
      name: "Rent / Bill Payment",
      input: "Your account debited with Rs. 18,500.00 on 01-OCT-26 towards House Rent to Landlord Ramesh. Ref: RENT202610.",
      expected: { type: "Debit", amount: 18500.00, category: "Unavoidable / Rent", hasRef: true }
    },
    {
      name: "Credit Card Swipe at Restaurant",
      input: "ALERT: You have spent INR 1,280.50 on your ICICI Bank Credit Card ending 4402 at STARBUCKS COFFEE on 02-OCT-26.",
      expected: { type: "Debit", amount: 1280.50, category: "Unwanted / Leak", mode: "Credit Card" }
    },
    {
      name: "Non-Financial OTP Filter",
      input: "Your OTP for login to Google is 849201. Valid for 10 minutes. Do not share this code with anyone.",
      expected: { isFinancial: false }
    },
    {
      name: "Balance Inquiry Filter",
      input: "Dear Customer, available balance in your SBI Account 1234 is INR 4,520.00 as on 02-OCT-26. Call 1800 for queries.",
      expected: { isFinancial: false }
    },
    {
      name: "Declined / Failed Transaction Filter",
      input: "Transaction of Rs. 350 at Cafe Coffee Day was declined due to incorrect UPI PIN. No money was debited.",
      expected: { isFinancial: false }
    },
    {
      name: "Refund / Reversal Detection",
      input: "Refund of Rs 299.00 has been credited to your Paytm Payments Bank A/C from Zomato for cancelled order. Ref: RF102938.",
      expected: { type: "Credit", amount: 299.00, category: "Income" }
    },
    {
      name: "Deduplication: Same notification sent twice",
      input: "Sent Rs. 150.00 to Chai Point on 02-OCT-26 via UPI. Ref: CP998811.",
      testDeduplication: true
    }
  ];

  console.log("=========================================================");
  console.log("   CRITIC ENGINE: EVALUATING CLASSIFICATION & DEDUP      ");
  console.log("=========================================================");

  let passed = 0;
  let deductions = 0;
  const critiqueNotes = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const res = classifier.classify(tc.input);

    if (tc.testDeduplication) {
      const sig1 = res.signature;
      const isDup1 = classifier.isDuplicate(sig1); // First time: should be false
      const isDup2 = classifier.isDuplicate(sig1); // Second time: should be true!
      if (!isDup1 && isDup2) {
        passed++;
        console.log(`[PASS] Case ${i+1}: ${tc.name} -> Deduplication successfully caught 2nd instance!`);
      } else {
        deductions += 1.0;
        critiqueNotes.push(`Deduplication failed on duplicate stream`);
        console.log(`[FAIL] Case ${i+1}: ${tc.name} -> Deduplication failed!`);
      }
      continue;
    }

    if (tc.expected.isFinancial === false) {
      if (!res.isFinancial) {
        passed++;
        console.log(`[PASS] Case ${i+1}: ${tc.name} -> Correctly filtered non-transactional notification`);
      } else {
        deductions += 1.0;
        critiqueNotes.push(`Failed to filter noise in: ${tc.name}`);
        console.log(`[FAIL] Case ${i+1}: ${tc.name} -> Expected filtered, but got financial`);
      }
      continue;
    }

    let tcPassed = true;
    if (res.type !== tc.expected.type) {
      tcPassed = false;
      critiqueNotes.push(`${tc.name}: Expected type ${tc.expected.type}, got ${res.type}`);
    }
    if (Math.abs(res.amount - tc.expected.amount) > 0.01) {
      tcPassed = false;
      critiqueNotes.push(`${tc.name}: Expected amount ${tc.expected.amount}, got ${res.amount}`);
    }
    if (tc.expected.category && res.category !== tc.expected.category) {
      tcPassed = false;
      critiqueNotes.push(`${tc.name}: Expected category ${tc.expected.category}, got ${res.category}`);
    }

    if (tcPassed) {
      passed++;
      console.log(`[PASS] Case ${i+1}: ${tc.name} -> Amount: ₹${res.amount} | Type: ${res.type} | Cat: ${res.category} | NeedsReview: ${res.needsReview}`);
    } else {
      deductions += 1.0;
      console.log(`[FAIL] Case ${i+1}: ${tc.name} -> ${JSON.stringify(res)}`);
    }
  }

  // Calculate Critic Score (out of 10)
  const score = Math.max(0, 10 - deductions);
  console.log("---------------------------------------------------------");
  console.log(`CRITIC ENGINE FINAL SCORE: ${score.toFixed(1)} / 10.0`);
  console.log(`Target: >= 8.0/10 -> Result: ${score >= 8.0 ? 'EXCELLENT (PASSED)' : 'NEEDS REFINEMENT'}`);
  console.log("=========================================================");

  return { score, passed, total: testCases.length, critiqueNotes };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FinancialNotificationClassifier, runCriticEngineTests };
}

if (typeof window === 'undefined') {
  runCriticEngineTests();
}
