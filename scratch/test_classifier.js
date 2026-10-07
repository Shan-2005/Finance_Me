function determineTransactionDirection(text) {
  if (!text || typeof text !== 'string') return 'Debit';
  const clean = text.toLowerCase();

  // Strip 'credit card' or 'debit card' nouns so card spending doesn't falsely trigger credit
  const scrubbed = clean
    .replace(/\bcredit\s*card\b/g, 'card_token')
    .replace(/\bdebit\s*card\b/g, 'card_token');

  // 1. STRONG INWARD / CREDIT INDICATORS (Money entering user's account -> PLUS)
  const strongCreditPatterns = [
    /\bcredited\s*(?:to|in|into)?\s*(?:your|ur)?\s*(?:a\/c|account|vpa|wallet|card|bank)?/i,
    /\b(?:has\s*been|is|was|got)\s*credited\b/i,
    /\bcredited\s*(?:by|with)?\s*(?:rs\.?|inr|₹)/i,
    /\b(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s*(?:credited|received|deposited|refunded)\b/i,
    /\breceived\s*(?:rs\.?|inr|₹|payment|money|amount|cashback)\b/i,
    /\b(?:you(?:'ve|\s*have)?\s*received|payment\s*received)\b/i,
    /\b(?:sent|paid|transferred)\s*(?:you|to\s*you|to\s*your\s*(?:a\/c|account|vpa|wallet))\b/i,
    /\b(?:paid|sent|transferred)\s*by\b/i,
    /\bfrom\s+[a-z0-9\s._-]+\s*(?:sent|paid|transferred)\b/i,
    /\b(?:salary|stipend|bonus|pension)\s*(?:credited|received|deposited)\b/i,
    /\b(?:refund|refunded|reversal|reversed|cashback)\b/i,
    /\binward\s*(?:remittance|imps|neft|rtgs|upi)\b/i,
    /\bdeposited\s*(?:to|in|into)\s*(?:your|ur)?\s*(?:a\/c|account)\b/i,
    /\bmoney\s*added\s*(?:to|into)\b/i
  ];

  // 2. STRONG OUTWARD / DEBIT INDICATORS (Money leaving user's account -> MINUS)
  const strongDebitPatterns = [
    /\bdebited\s*(?:from)?\s*(?:your|ur)?\s*(?:a\/c|account|vpa|wallet|card)?/i,
    /\b(?:has\s*been|is|was|got)\s*debited\b/i,
    /\bdebited\s*(?:by|with)?\s*(?:rs\.?|inr|₹)/i,
    /\b(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s*(?:debited|spent|deducted|withdrawn)\b/i,
    /\bpaid\s*(?:to|towards|at|for)\b/i,
    /\b(?:sent|transferred)\s*(?:to|towards)\s+(?!your|ur\b)[a-z0-9]/i,
    /\b(?:you(?:'ve|\s*have)?\s*(?:paid|sent|spent))\b/i,
    /\b(?:spent|spent\s*at|spent\s*on)\b/i,
    /\b(?:withdrawn|atm\s*withdrawal)\b/i,
    /\b(?:auto-debited|auto\s*debit|mandate\s*executed)\b/i,
    /\bpurchase\s*(?:at|on|of)\b/i
  ];

  const hasStrongCredit = strongCreditPatterns.some(p => p.test(scrubbed));
  const hasStrongDebit = strongDebitPatterns.some(p => p.test(scrubbed));

  if (hasStrongCredit && !hasStrongDebit) return 'Credit';
  if (hasStrongDebit && !hasStrongCredit) return 'Debit';

  // Conflict Resolution:
  if (hasStrongCredit && hasStrongDebit) {
    // If it's a refund, cashback, reversal -> Always Credit
    if (/\b(?:refund|refunded|cashback|reversed|reversal)\b/i.test(scrubbed)) {
      return 'Credit';
    }
    // "credited to your a/c" takes precedence over sender words like "sent" or "paid"
    if (/\bcredited\s*(?:to|in|into)?\s*(?:your|ur)?\s*(?:a\/c|account|wallet|card)\b/i.test(scrubbed)) {
      return 'Credit';
    }
    // "received from ... paid via" -> Credit
    if (/\b(?:received|you've received|you have received|received from)\b/i.test(scrubbed)) {
      return 'Credit';
    }
    // If explicitly debited from user's account -> Debit
    if (/\bdebited\s*from\s*(?:your|ur)?\s*(?:a\/c|account)\b/i.test(scrubbed)) {
      return 'Debit';
    }
    return 'Credit';
  }

  // Fallback scoring
  let creditScore = 0;
  let debitScore = 0;
  if (/\bcredited\b/i.test(scrubbed)) creditScore += 3;
  if (/\breceived\b/i.test(scrubbed)) creditScore += 3;
  if (/\brefund(?:ed)?\b/i.test(scrubbed)) creditScore += 4;
  if (/\bcashback\b/i.test(scrubbed)) creditScore += 4;
  if (/\binward\b/i.test(scrubbed)) creditScore += 3;
  if (/\bdebited\b/i.test(scrubbed)) debitScore += 3;
  if (/\bspent\b/i.test(scrubbed)) debitScore += 3;
  if (/\bwithdrawn\b/i.test(scrubbed)) debitScore += 3;
  if (/\bpaid\b/i.test(scrubbed)) debitScore += 2;
  if (/\bsent\b/i.test(scrubbed)) debitScore += 2;

  return creditScore > debitScore ? 'Credit' : 'Debit';
}

const testCases = [
  // Credits (Must be Credit)
  { text: "Dear Customer, INR 5,000.00 has been credited to your Account **1234 on 05-OCT-26 by UPI: Shansa. Info: Inward Payment.", expected: "Credit" },
  { text: "You have received Rs. 500.00 from John Doe (UPI Ref: 428910283910). Total Bal: Rs. 14,200.00", expected: "Credit" },
  { text: "Refund of Rs 350.00 has been processed to your A/C ending 4321 for order #9821 paid on Swiggy.", expected: "Credit" },
  { text: "Salary of Rs 85,000.00 credited to A/C XX8912 on 30-SEP-26. Avl Bal: Rs 1,12,000.", expected: "Credit" },
  { text: "Cashback of Rs 25 credited into your Google Pay linked account.", expected: "Credit" },
  { text: "Reversal of UPI txn Rs. 1200.00 has been credited back to your account.", expected: "Credit" },
  { text: "A/C XX1234 credited with Rs 3,500.00 transferred by Amit.", expected: "Credit" },
  { text: "Rs 10,000 deposited in your account via CDM / Cash Deposit.", expected: "Credit" },
  { text: "Shansa sent you ₹5,000 on Google Pay", expected: "Credit" },
  { text: "Received ₹1,200 from Rahul paid via PhonePe", expected: "Credit" },
  { text: "Amount of Rs. 450 paid to you by Merchant", expected: "Credit" },

  // Debits (Must be Debit)
  { text: "Sent Rs. 30.00 from HDFC Bank A/C *1009 to BLUEBERRY RESTAURANT on 05/10/26.", expected: "Debit" },
  { text: "Paid Rs. 1,200.00 to Swiggy via GPay UPI Ref 382910.", expected: "Debit" },
  { text: "Rs. 500.00 debited from A/C XX1234 on 05-OCT-26 towards UPI payment to Tea Stall.", expected: "Debit" },
  { text: "Spent Rs. 908.00 on your Credit Card ending 8812 at AMAZON INDIA.", expected: "Debit" },
  { text: "Withdrawn Rs. 2,000.00 from ATM using Card ending 1234.", expected: "Debit" },
  { text: "Auto-debit of Rs. 799.00 executed towards Netflix mandate.", expected: "Debit" },
  { text: "You have paid Rs 160.00 to Uber India via UPI.", expected: "Debit" },
  { text: "Rs. 300 transferred to Ramesh from your SBI A/C 9901.", expected: "Debit" }
];

let failed = 0;
testCases.forEach((tc, idx) => {
  const result = determineTransactionDirection(tc.text);
  const pass = result === tc.expected;
  if (!pass) failed++;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] #${idx + 1}: Expected=${tc.expected}, Got=${result}`);
  if (!pass) console.log(`   Text: "${tc.text}"`);
});

console.log(`\nResults: ${testCases.length - failed}/${testCases.length} Passed`);
process.exit(failed > 0 ? 1 : 0);
