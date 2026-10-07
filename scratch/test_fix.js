const { AxioIntelligenceEngine } = require('./critic_axio_features');
const { NotificationReaderEngine } = require('./critic_notification_reader');
const axio = new AxioIntelligenceEngine();
const reader = new NotificationReaderEngine();

const existing = [
  { amount: 120, type: 'Debit', merchant: 'Uber', signature: 'hash_Debit_12000_uber_1' }
];
const pastSmsList = [
  { body: 'Rs 120.00 debited from A/C **1234 to UBER INDIA on 28-SEP-26.', sender: 'HDFCBK', date: 1727500000000 }
];

const existingKeys = new Set();
existing.forEach(t => {
  if (t.signature) existingKeys.add(t.signature);
  if (t.referenceId) existingKeys.add(`ref_${t.referenceId.toLowerCase()}`);
  const normM = (t.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  existingKeys.add(`${t.type}_${Math.round(t.amount * 100)}_${normM}`);
});

console.log('existingKeys:', existingKeys);
const p = reader.readNotification({ text: pastSmsList[0].body, packageName: 'HDFCBK', timestamp: pastSmsList[0].date }).parsed;
const brand = axio.resolveMerchantDetails(pastSmsList[0].body, p.merchant, p.type);
const normM = brand.title.toLowerCase().replace(/[^a-z0-9]/g, '');
const key = `${p.type}_${Math.round(p.amount * 100)}_${normM}`;
console.log('incoming key:', key);
console.log('has key?', existingKeys.has(key));
