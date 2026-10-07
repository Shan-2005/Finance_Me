import os
import sys
import json
import re

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
INPUT_FILE = os.path.join(DATA_DIR, "bank_transactions_dataset.json")
OUTPUT_FILE = os.path.join(DATA_DIR, "annotated_finance_dataset.json")

def parse_entities(text, sender=""):
    clean = re.sub(r'[\r\n]+', ' ', text).strip()
    
    # 1. Type
    is_debit = bool(re.search(r'\b(?:debited|sent|spent|paid|withdrawn|deducted)\b', clean, re.IGNORECASE))
    is_credit = bool(re.search(r'\b(?:credited|received|deposited|refund)\b', clean, re.IGNORECASE))
    
    txn_type = "DEBIT" if is_debit and not is_credit else ("CREDIT" if is_credit else "OTHER")
    
    # 2. Amount
    amt_match = re.search(r'(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)', clean, re.IGNORECASE)
    amount = float(amt_match.group(1).replace(',', '')) if amt_match else 0.0
    
    # 3. Account
    acc_match = re.search(r'(?:a/c|acct|card)\s*(?:no\.?)?\s*[\*xX]?\s*(\d{3,6})', clean, re.IGNORECASE)
    account = acc_match.group(1) if acc_match else ""
    
    # 4. Reference Number / UTR / UPI Ref
    ref_match = re.search(r'(?:ref(?:\s*no\.?)?|rrn|upi\s*ref)\s*:?\s*([0-9a-zA-Z]{8,16})', clean, re.IGNORECASE)
    ref_no = ref_match.group(1) if ref_match else ""
    
    # 5. Merchant / Payee / Beneficiary
    merchant = ""
    # Look for "To <Merchant>"
    to_match = re.search(r'\bTo\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+On\b|\s+Ref\b|\s+Not\b|\s+via\b|\.|$)', clean, re.IGNORECASE)
    if to_match:
        cand = to_match.group(1).strip()
        if not re.match(r'^(hdfc|sbi|icici|axis|bank|upi)$', cand, re.IGNORECASE):
            merchant = cand
            
    # Look for "transfer from <Sender>" or "from <Sender>"
    if not merchant and is_credit:
        from_match = re.search(r'\b(?:transfer\s+from|from)\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+Ref\b|\s+on\b|\.|$)', clean, re.IGNORECASE)
        if from_match:
            cand = from_match.group(1).strip()
            if not re.match(r'^(hdfc|sbi|icici|axis|bank|upi)$', cand, re.IGNORECASE):
                merchant = cand
                
    # Look for "at <Merchant>"
    if not merchant:
        at_match = re.search(r'\bat\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+on\b|\s+via\b|\.|$)', clean, re.IGNORECASE)
        if at_match:
            merchant = at_match.group(1).strip()
            
    if not merchant:
        merchant = "UPI Transfer"
        
    # 6. Payment Mode
    mode = "UPI"
    if re.search(r'credit\s*card', clean, re.IGNORECASE):
        mode = "Credit Card"
    elif re.search(r'debit\s*card', clean, re.IGNORECASE):
        mode = "Debit Card"
    elif re.search(r'netbanking|neft|rtgs|imps', clean, re.IGNORECASE):
        mode = "Net Banking"
    elif re.search(r'atm\b', clean, re.IGNORECASE):
        mode = "ATM Withdrawal"
        
    return {
        "type": txn_type,
        "amount": amount,
        "merchant": merchant,
        "account": account,
        "ref_no": ref_no,
        "mode": mode
    }

def build_dataset():
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        items = json.load(f)
        
    annotated = []
    merchants_found = set()
    total_debits = 0
    total_credits = 0
    
    for item in items:
        entities = parse_entities(item['body'], item.get('sender', ''))
        if entities['type'] == 'DEBIT':
            total_debits += 1
        elif entities['type'] == 'CREDIT':
            total_credits += 1
            
        if entities['merchant'] and entities['merchant'] != 'UPI Transfer':
            merchants_found.add(entities['merchant'])
            
        annotated.append({
            "raw_text": item['body'],
            "sender": item.get('sender', ''),
            "datetime": item.get('datetime', ''),
            "label_type": entities['type'],
            "entities": {
                "amount": entities['amount'],
                "merchant": entities['merchant'],
                "account": entities['account'],
                "ref_no": entities['ref_no'],
                "mode": entities['mode']
            }
        })
        
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(annotated, f, indent=2, ensure_ascii=False)
        
    print(f"[OK] Successfully built annotated dataset: {len(annotated)} samples")
    print(f"Total Debits: {total_debits} | Total Credits: {total_credits}")
    print(f"Unique Identified Real Merchants: {len(merchants_found)}")
    print(f"Sample merchants: {list(merchants_found)[:10]}")
    print(f"Saved to: {OUTPUT_FILE}")

if __name__ == '__main__':
    build_dataset()
