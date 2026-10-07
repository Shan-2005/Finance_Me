import os
import sys
import json
import re
from collections import Counter

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
RAW_FILE = os.path.join(DATA_DIR, "raw_sms_dump.json")
BANK_FILE = os.path.join(DATA_DIR, "bank_transactions_dataset.json")
NON_BANK_FILE = os.path.join(DATA_DIR, "non_bank_dataset.json")

# Known Indian Banking, Card, and Fintech Sender Identifier keywords
BANK_SENDER_PATTERNS = [
    r'HDFC', r'SBI', r'ICICI', r'AXIS', r'KOTAK', r'PNB', r'CANBK', r'CANBNK',
    r'BOB', r'BARODA', r'UNIONB', r'UBI', r'INDUSB', r'YESBK', r'YESBNK',
    r'IDBI', r'IDFC', r'RBL', r'FEDERAL', r'IOB', r'PAYTM', r'PHONEPE',
    r'GPAY', r'CRED', r'SLICE', r'JUPITER', r'FI', r'ONEPAY', r'AMEX',
    r'STANCHAR', r'CITI', r'SCBANK', r'EPFO', r'NPCI', r'UPI'
]
BANK_SENDER_REGEX = re.compile('|'.join(BANK_SENDER_PATTERNS), re.IGNORECASE)

# Transactional keywords in body
TXN_BODY_PATTERNS = [
    r'\b(?:debited|credited|spent|sent|paid|withdrawn|received|transferred)\b',
    r'(?:inr|rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?',
    r'\b(?:a/c|acct|account|card)\s*(?:no\.?)?\s*[\*x\d]+',
    r'\b(?:upi\s*ref|rrn|vpa)\b'
]
TXN_BODY_REGEX = re.compile('|'.join(TXN_BODY_PATTERNS), re.IGNORECASE)

# Pure OTP / Non-transactional patterns
OTP_REGEX = re.compile(r'\b(?:is your otp|verification code|one time password|secret otp|do not share your otp|login otp|auth code)\b', re.IGNORECASE)
PROMO_REGEX = re.compile(r'\b(?:apply now|pre-approved|claim now|discount|coupon|offer expires|get up to|cashback offer)\b', re.IGNORECASE)

def analyze_and_filter():
    with open(RAW_FILE, 'r', encoding='utf-8') as f:
        records = json.load(f)
        
    print(f"[*] Loaded {len(records)} raw SMS messages.")
    
    bank_txns = []
    bank_otps = []
    bank_promos = []
    other_msgs = []
    
    sender_counts = Counter()
    
    for item in records:
        sender = item.get('sender', '')
        body = item.get('body', '')
        sender_counts[sender] += 1
        
        is_bank_sender = bool(BANK_SENDER_REGEX.search(sender))
        has_txn_body = bool(TXN_BODY_REGEX.search(body))
        
        # Check if financial message
        if is_bank_sender or (has_txn_body and re.search(r'\b(?:bank|a/c|upi)\b', body, re.IGNORECASE)):
            is_otp = bool(OTP_REGEX.search(body))
            is_promo = bool(PROMO_REGEX.search(body)) and not re.search(r'\b(?:debited|credited|sent|withdrawn)\b', body, re.IGNORECASE)
            
            # Detect Debit / Credit
            is_debit = bool(re.search(r'\b(?:debited|sent|spent|paid|withdrawn|deducted)\b', body, re.IGNORECASE))
            is_credit = bool(re.search(r'\b(?:credited|received|deposited|refund)\b', body, re.IGNORECASE))
            
            # Extract basic candidate amount
            amt_match = re.search(r'(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)', body, re.IGNORECASE)
            amount = float(amt_match.group(1).replace(',', '')) if amt_match else None
            
            entry = {
                "sender": sender,
                "body": body,
                "datetime": item.get('datetime'),
                "timestamp_ms": item.get('timestamp_ms'),
                "amount": amount,
                "type": "Debit" if is_debit and not is_credit else ("Credit" if is_credit else "Other"),
                "is_otp": is_otp,
                "is_promo": is_promo,
                "is_transaction": (is_debit or is_credit) and not is_otp and amount is not None
            }
            
            if entry["is_transaction"]:
                bank_txns.append(entry)
            elif is_otp:
                bank_otps.append(entry)
            elif is_promo:
                bank_promos.append(entry)
            else:
                other_msgs.append(entry)
        else:
            other_msgs.append({
                "sender": sender,
                "body": body,
                "datetime": item.get('datetime'),
                "is_transaction": False
            })

    print(f"\n================ SUMMARY ================")
    print(f"Total SMS analyzed:            {len(records)}")
    print(f"Identified Bank Transactions:  {len(bank_txns)}")
    print(f"Identified Bank OTPs:          {len(bank_otps)}")
    print(f"Identified Bank Promos/Offers: {len(bank_promos)}")
    print(f"Other SMS (Personal/Services): {len(other_msgs)}")
    print(f"=========================================\n")
    
    print("[*] Top Bank Senders:")
    for s, c in sender_counts.most_common(15):
        if BANK_SENDER_REGEX.search(s):
            print(f"    - {s}: {c} messages")
            
    with open(BANK_FILE, 'w', encoding='utf-8') as f:
        json.dump(bank_txns, f, indent=2, ensure_ascii=False)
        
    print(f"\n[OK] Saved {len(bank_txns)} verified bank transactions to: {BANK_FILE}")
    
    # Show 3 real transaction samples
    print("\n[*] Sample Transactions Extracted:")
    for i, txn in enumerate(bank_txns[:3], 1):
        print(f"\n--- Sample {i} ({txn['sender']} | {txn['type']} | Rs.{txn['amount']}) ---")
        print(f"Date: {txn['datetime']}")
        print(f"Text:\n{txn['body']}")

if __name__ == '__main__':
    analyze_and_filter()
