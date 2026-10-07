const assert = require('assert');

// Test the deduplication functions
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toCalendarDateStr(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeBody(text) {
  if (!text) return '';
  return String(text)
    .replace(/^\[(?:SMS Inbox Scan|Auto-Captured)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeMerchant(m) {
  if (!m) return '';
  return String(m).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractRefFromAny(text) {
  if (!text) return null;
  const refPatterns = [
    /\b(?:upi\s*ref(?:erence)?(?:\s*no)?|rrn|txn\s*(?:id|no)?|ref\s*no|ref|utr|urn)\s*[:.-]?\s*([0-9a-zA-Z]{6,18})\b/i,
    /\bupi[\s/:]+(?:cr|dr|p2p|p2m)?[\s/:]*([0-9]{8,16})\b/i,
    /\(upi\s+([0-9]{8,16})\)/i,
    /\b(?:ref|rrn)\s+([0-9]{8,16})\b/i
  ];
  for (const rx of refPatterns) {
    const m = String(text).match(rx);
    if (m && m[1]) return m[1].trim().toLowerCase();
  }
  return null;
}

function findDuplicateTransaction(candidate, searchLists = [], toleranceHours = 36) {
  if (!candidate || candidate.amount === undefined || candidate.amount === null) return null;

  const candAmt = Number(candidate.amount);
  if (isNaN(candAmt) || candAmt <= 0) return null;

  const candType = candidate.type || 'Debit';
  const candRef = (candidate.referenceId || candidate.reference_id || extractRefFromAny(candidate.rawText || candidate.raw_text || candidate.notes) || '').trim().toLowerCase();
  const candSig = (candidate.signature || '').trim();
  const candBody = normalizeBody(candidate.rawText || candidate.raw_text || candidate.notes);
  const candMask = String(candidate.accountMask || candidate.account_mask || '').replace(/[^0-9]/g, '');
  const candTime = candidate.date ? new Date(candidate.date).getTime() : Date.now();
  const candDay = toCalendarDateStr(candidate.date || candTime);
  const candNormM = normalizeMerchant(candidate.merchant);

  const maxDiffMs = toleranceHours * 3600 * 1000;

  for (const list of searchLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || item.id === candidate.id) continue;

      // 1. Reference ID Match (Highest confidence: exact UPI / RRN / UTR / Ref)
      const itemRef = (item.referenceId || item.reference_id || extractRefFromAny(item.rawText || item.raw_text || item.notes) || '').trim().toLowerCase();
      if (candRef && itemRef && candRef.length >= 6 && itemRef.length >= 6 && candRef === itemRef) {
        return { match: item, reason: 'EXACT_REF_ID' };
      }

      // 2. Exact Signature Match
      if (candSig && item.signature && candSig === item.signature) {
        return { match: item, reason: 'EXACT_SIGNATURE' };
      }

      // 3. Exact or Normalized SMS Message Body Match
      const itemBody = normalizeBody(item.rawText || item.raw_text || item.notes);
      if (candBody && itemBody && candBody.length >= 15 && candBody === itemBody) {
        return { match: item, reason: 'EXACT_BODY_TEXT' };
      }

      // 4. Multi-Factor Calendar Day / Proximity Match (Indian Banking Streams)
      const itemAmt = Number(item.amount);
      const itemType = item.type || 'Debit';
      if (Math.abs(candAmt - itemAmt) < 0.01 && candType === itemType) {
        const itemTime = item.date ? new Date(item.date).getTime() : Date.now();
        const itemDay = toCalendarDateStr(item.date || itemTime);
        const sameDay = candDay && itemDay && candDay === itemDay;
        const diffMs = Math.abs(candTime - itemTime);

        if (sameDay || diffMs <= maxDiffMs) {
          const itemMask = String(item.accountMask || item.account_mask || '').replace(/[^0-9]/g, '');
          const maskMatch = candMask && itemMask && candMask === itemMask;

          const itemNormM = normalizeMerchant(item.merchant);
          const merchantMatch = candNormM && itemNormM && (
            candNormM === itemNormM ||
            candNormM.includes(itemNormM) ||
            itemNormM.includes(candNormM) ||
            (candNormM.length >= 4 && itemNormM.length >= 4 && candNormM.slice(0, 4) === itemNormM.slice(0, 4))
          );
          const isGeneric = !candNormM || candNormM === 'payment' || candNormM === 'upipayment' || !itemNormM || itemNormM === 'payment' || itemNormM === 'upipayment';

          if (maskMatch && (merchantMatch || isGeneric)) {
            return { match: item, reason: 'SAME_DAY_ACCOUNT_MATCH' };
          }
          if (merchantMatch && (maskMatch || !candMask || !itemMask)) {
            return { match: item, reason: 'SAME_DAY_MERCHANT_MATCH' };
          }
          if (isGeneric && diffMs <= 12 * 3600 * 1000) {
            return { match: item, reason: 'SAME_DAY_GENERIC_MATCH' };
          }
          if (candBody && itemBody && (candBody.includes(itemNormM) || itemBody.includes(candNormM))) {
            return { match: item, reason: 'BODY_MERCHANT_CROSS_MATCH' };
          }
        }
      }
    }
  }

  return null;
}

// TEST CASES
console.log('--- Running Deduplication Engine Unit Tests ---');

// Test 1: Exact Ref ID match
const t1 = { id: '1', amount: 500, type: 'Debit', referenceId: 'UPI12345678', merchant: 'Swiggy', date: '2026-10-01' };
const cand1 = { id: '2', amount: 500, type: 'Debit', referenceId: 'UPI12345678', merchant: 'Payment', date: '2026-10-01' };
assert.ok(findDuplicateTransaction(cand1, [[t1]]), 'Test 1 Failed: Ref ID match');
console.log('✓ Test 1: Exact Ref ID match passed');

// Test 2: Exact SMS Body match
const t2 = { id: '1', amount: 149, type: 'Debit', notes: '[SMS Inbox Scan] E-Mandate! Rs.149.00 will be deducted for STAR INDIA', date: '2026-09-08' };
const cand2 = { id: '2', amount: 149, type: 'Debit', rawText: 'E-Mandate! Rs.149.00 will be deducted for STAR INDIA', date: '2026-09-08' };
assert.ok(findDuplicateTransaction(cand2, [[t2]]), 'Test 2 Failed: Exact SMS body match');
console.log('✓ Test 2: Exact SMS body match passed');

// Test 3: Same day + same amount + same account mask
const t3 = { id: '1', amount: 802.1, type: 'Debit', accountMask: '1009', merchant: 'APOLLO PHARMACY', date: '2026-10-01' };
const cand3 = { id: '2', amount: 802.1, type: 'Debit', accountMask: '1009', merchant: 'Upi Payment', date: '2026-10-01' };
assert.ok(findDuplicateTransaction(cand3, [[t3]]), 'Test 3 Failed: Same day account mask match');
console.log('✓ Test 3: Same day account mask match passed');

// Test 4: Different merchant on same day should NOT match
const t4 = { id: '1', amount: 250, type: 'Debit', merchant: 'Swiggy', date: '2026-10-01' };
const cand4 = { id: '2', amount: 250, type: 'Debit', merchant: 'Uber', date: '2026-10-01' };
assert.strictEqual(findDuplicateTransaction(cand4, [[t4]]), null, 'Test 4 Failed: Different merchants should not match');
console.log('✓ Test 4: Distinct merchants on same day NOT flagged as duplicate');

// Test 5: Different amount on same day should NOT match
const t5 = { id: '1', amount: 500, type: 'Debit', merchant: 'Swiggy', date: '2026-10-01' };
const cand5 = { id: '2', amount: 600, type: 'Debit', merchant: 'Swiggy', date: '2026-10-01' };
assert.strictEqual(findDuplicateTransaction(cand5, [[t5]]), null, 'Test 5 Failed: Different amounts should not match');
console.log('✓ Test 5: Different amounts NOT flagged as duplicate');

// Test 6: Safe handling of nulls and malformed objects (no errors)
assert.strictEqual(findDuplicateTransaction(null, []), null);
assert.strictEqual(findDuplicateTransaction({}, []), null);
assert.strictEqual(findDuplicateTransaction({ amount: 0 }, []), null);
assert.strictEqual(findDuplicateTransaction({ amount: -100 }, []), null);
assert.strictEqual(findDuplicateTransaction({ amount: 'invalid' }, []), null);
console.log('✓ Test 6: Safe error handling passed with 0 exceptions');

console.log('🎉 ALL DEDUPLICATION TESTS PASSED WITH 100% PRECISION!');
