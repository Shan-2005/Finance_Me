// Pure Local Finance Parser Engine (Zero Cloud APIs, Zero Dependencies)
// Runs mathematically identical inference to the trained Scikit-Learn / PyTorch model.

const fs = require('fs');
const path = require('path');

let modelData = null;

function loadModel() {
  if (modelData) return modelData;
  const modelPath = path.join(__dirname, '..', 'models', 'model_weights.json');
  if (fs.existsSync(modelPath)) {
    modelData = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  }
  return modelData;
}

function tokenize(text) {
  const clean = text.toLowerCase().replace(/[\r\n]+/g, ' ');
  // Token pattern matching Python (?u)\b\w+\b|[₹*]
  const words = clean.match(/\b\w+\b|[₹*]/g) || [];
  const ngrams = [...words];
  
  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(words[i] + ' ' + words[i + 1]);
  }
  return ngrams;
}

function predictIntent(text) {
  const model = loadModel();
  if (!model) {
    throw new Error('Model weights not found. Train model first.');
  }

  const tokens = tokenize(text);
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }

  // Sublinear TF-IDF vectorization: (1 + ln(tf)) * idf
  const vector = {};
  let normSq = 0;
  for (const [term, count] of Object.entries(tf)) {
    if (term in model.vocab) {
      const idx = model.vocab[term];
      const val = (1 + Math.log(count)) * model.idf[idx];
      vector[idx] = val;
      normSq += val * val;
    }
  }

  // L2 normalize
  const norm = Math.sqrt(normSq) || 1.0;
  for (const idx in vector) {
    vector[idx] /= norm;
  }

  // Multinomial Logistic Regression dot products
  const scores = [];
  for (let c = 0; c < model.classes.length; c++) {
    let score = model.intercept[c];
    const coefRow = model.coef[c];
    for (const [idx, val] of Object.entries(vector)) {
      score += val * coefRow[idx];
    }
    scores.push(score);
  }

  // Softmax
  const maxScore = Math.max(...scores);
  const expScores = scores.map(s => Math.exp(s - maxScore));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const probs = expScores.map(s => s / sumExp);

  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[bestIdx]) bestIdx = i;
  }

  return {
    label: model.classes[bestIdx],
    confidence: probs[bestIdx],
    probabilities: {
      CREDIT: probs[model.classes.indexOf('CREDIT')],
      DEBIT: probs[model.classes.indexOf('DEBIT')],
      NOISE: probs[model.classes.indexOf('NOISE')]
    }
  };
}

function extractEntities(text, intent) {
  const clean = text.replace(/[\r\n]+/g, ' ').trim();

  // 1. Amount
  const amtMatch = clean.match(/(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  let amount = 0.0;
  if (amtMatch) {
    amount = parseFloat(amtMatch[1].replace(/,/g, '')) || 0.0;
  }

  // 2. Account
  const accMatch = clean.match(/(?:a\/c|acct|account|card)\s*(?:no\.?)?\s*[\*xX]?\s*(\d{3,6})/i);
  const accountLast4 = accMatch ? accMatch[1] : '';

  // 3. Reference ID
  const refMatch = clean.match(/(?:ref(?:\s*no\.?)?|rrn|upi\s*ref)\s*:?\s*([0-9a-zA-Z]{8,18})/i);
  const refNo = refMatch ? refMatch[1] : '';

  // 4. Merchant
  let merchant = '';
  const m1 = clean.match(/\bTo\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+On\b|\s+Ref\b|\s+Not\b|\s+via\b|\.|$)/i);
  if (m1 && !/^(hdfc|sbi|icici|axis|bank|upi)$/i.test(m1[1].trim())) {
    merchant = m1[1].trim();
  }

  if (!merchant) {
    const m2 = clean.match(/\bat\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+on\b|\s+via\b|\.|$)/i);
    if (m2) merchant = m2[1].trim();
  }

  if (!merchant && intent === 'CREDIT') {
    const m3 = clean.match(/\b(?:transfer\s+from|from)\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+Ref\b|\s+on\b|\.|$)/i);
    if (m3 && !/^(hdfc|sbi|icici|axis|bank|upi)$/i.test(m3[1].trim())) {
      merchant = m3[1].trim();
    }
  }

  if (!merchant) {
    merchant = intent === 'DEBIT' ? 'UPI Transfer' : 'Received Transfer';
  }

  merchant = merchant.replace(/[\.,\-]+$/, '').trim();

  // 5. Payment Mode
  let mode = 'UPI';
  if (/credit\s*card/i.test(clean)) mode = 'Credit Card';
  else if (/debit\s*card/i.test(clean)) mode = 'Debit Card';
  else if (/netbanking|neft|rtgs|imps/i.test(clean)) mode = 'Net Banking';
  else if (/\batm\b/i.test(clean)) mode = 'ATM Cash';

  // 6. Category
  const category = classifyCategory(merchant, clean, intent);

  return {
    amount,
    merchant,
    account_last4: accountLast4,
    ref_no: refNo,
    payment_mode: mode,
    category
  };
}

function classifyCategory(merchant, text, intent) {
  if (intent === 'CREDIT') {
    if (/salary/i.test(text)) return 'Salary';
    return 'Income / Transfer';
  }

  const combined = (merchant + ' ' + text).toLowerCase();
  if (/super\s*market|mart|grocery|kirana|vegetable|milk|dairy|ridvey/i.test(combined)) return 'Groceries';
  if (/hospitality|restaurant|cafe|tea|coffee|swiggy|zomato|kfc|subway|food|hotel|bakes|bakery/i.test(combined)) return 'Food & Dining';
  if (/pharmacy|medical|hospital|clinic|apollo|medplus|doctor/i.test(combined)) return 'Health & Medical';
  if (/fuel|petrol|diesel|hpcl|bpcl|iocl|shell/i.test(combined)) return 'Fuel & Transport';
  if (/recharge|jio|airtel|vi\b|broadband|electricity|water|bill|gas/i.test(combined)) return 'Bills & Utilities';
  if (/zerodha|groww|mutual|sip|invest|stocks/i.test(combined)) return 'Investments';
  if (/rent|landlord|maintenance/i.test(combined)) return 'Rent';

  return 'Daily Spend';
}

function parseNotification(rawText) {
  if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 5) {
    return { is_transaction: false, reason: 'EMPTY_TEXT' };
  }

  const { label, confidence } = predictIntent(rawText);

  if (label === 'NOISE' || confidence < 0.65) {
    return {
      is_transaction: false,
      intent: 'NOISE',
      confidence,
      reason: 'REJECTED_BY_LOCAL_MODEL (OTP/Promo/Chat)'
    };
  }

  const entities = extractEntities(rawText, label);

  return {
    is_transaction: true,
    intent: label,
    confidence,
    ...entities
  };
}

module.exports = {
  predictIntent,
  extractEntities,
  parseNotification
};
