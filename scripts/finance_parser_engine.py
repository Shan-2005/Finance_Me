import os
import sys
import pickle
import re
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_PATH = os.path.join(MODELS_DIR, "sms_intent_classifier.pkl")
VEC_PATH = os.path.join(MODELS_DIR, "sms_tfidf_vectorizer.pkl")

class FinanceParserEngine:
    def __init__(self):
        with open(MODEL_PATH, 'rb') as f:
            self.model = pickle.load(f)
        with open(VEC_PATH, 'rb') as f:
            self.vectorizer = pickle.load(f)
            
    def predict_intent(self, text):
        clean = re.sub(r'[\r\n]+', ' ', text).strip()
        vec = self.vectorizer.transform([clean])
        probs = self.model.predict_proba(vec)[0]
        classes = self.model.classes_
        
        best_idx = probs.argmax()
        label = classes[best_idx]
        confidence = float(probs[best_idx])
        
        prob_dict = {classes[i]: float(probs[i]) for i in range(len(classes))}
        return label, confidence, prob_dict

    def extract_entities(self, text, intent):
        clean = re.sub(r'[\r\n]+', ' ', text).strip()
        
        # 1. Amount
        # Handles "Rs.80.00", "Rs 80", "INR 1,250.50", "₹500"
        amt_match = re.search(r'(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)', clean, re.IGNORECASE)
        amount = 0.0
        if amt_match:
            try:
                amount = float(amt_match.group(1).replace(',', ''))
            except ValueError:
                amount = 0.0
                
        # 2. Account / Card
        acc_match = re.search(r'(?:a/c|acct|account|card)\s*(?:no\.?)?\s*[\*xX]?\s*(\d{3,6})', clean, re.IGNORECASE)
        account = acc_match.group(1) if acc_match else ""
        
        # 3. Reference ID / UTR / UPI Ref
        ref_match = re.search(r'(?:ref(?:\s*no\.?)?|rrn|upi\s*ref)\s*:?\s*([0-9a-zA-Z]{8,18})', clean, re.IGNORECASE)
        ref_no = ref_match.group(1) if ref_match else ""
        
        # 4. Merchant Extraction
        merchant = ""
        # P1: "To <Merchant>"
        m1 = re.search(r'\bTo\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+On\b|\s+Ref\b|\s+Not\b|\s+via\b|\.|$)', clean, re.IGNORECASE)
        if m1 and not re.match(r'^(hdfc|sbi|icici|axis|bank|upi)$', m1.group(1).strip(), re.IGNORECASE):
            merchant = m1.group(1).strip()
            
        # P2: "at <Merchant>"
        if not merchant:
            m2 = re.search(r'\bat\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+on\b|\s+via\b|\.|$)', clean, re.IGNORECASE)
            if m2:
                merchant = m2.group(1).strip()
                
        # P3: "from <Sender>" (for Credits)
        if not merchant and intent == 'CREDIT':
            m3 = re.search(r'\b(?:transfer\s+from|from)\s+([A-Za-z0-9\s&.\-@]{2,40}?)(?=\s+Ref\b|\s+on\b|\.|$)', clean, re.IGNORECASE)
            if m3 and not re.match(r'^(hdfc|sbi|icici|axis|bank|upi)$', m3.group(1).strip(), re.IGNORECASE):
                merchant = m3.group(1).strip()
                
        if not merchant:
            merchant = "UPI Transfer" if intent == 'DEBIT' else "Received Transfer"
            
        # Strip trailing punctuation
        merchant = re.sub(r'[\.,\-]+$', '', merchant).strip()
        
        # 5. Payment Mode
        mode = "UPI"
        if re.search(r'credit\s*card', clean, re.IGNORECASE):
            mode = "Credit Card"
        elif re.search(r'debit\s*card', clean, re.IGNORECASE):
            mode = "Debit Card"
        elif re.search(r'netbanking|neft|rtgs|imps', clean, re.IGNORECASE):
            mode = "Net Banking"
        elif re.search(r'atm\b', clean, re.IGNORECASE):
            mode = "ATM Cash"
            
        # 6. Smart Category Classification
        category = self.classify_category(merchant, clean, intent)
        
        return {
            "amount": amount,
            "merchant": merchant,
            "account_last4": account,
            "ref_no": ref_no,
            "payment_mode": mode,
            "category": category
        }
        
    def classify_category(self, merchant, text, intent):
        if intent == 'CREDIT':
            if re.search(r'salary', text, re.IGNORECASE):
                return "Salary"
            return "Income / Transfer"
            
        m_lower = (merchant + " " + text).lower()
        
        if re.search(r'super\s*market|mart|grocery|kirana|vegetable|milk|dairy|ridvey', m_lower):
            return "Groceries"
        if re.search(r'hospitality|restaurant|cafe|tea|coffee|swiggy|zomato|kfc|subway|food|hotel|bakes|bakery', m_lower):
            return "Food & Dining"
        if re.search(r'pharmacy|medical|hospital|clinic|apollo|medplus|doctor', m_lower):
            return "Health & Medical"
        if re.search(r'fuel|petrol|diesel|hpcl|bpcl|iocl|shell', m_lower):
            return "Fuel & Transport"
        if re.search(r'recharge|jio|airtel|vi\b|broadband|electricity|water|bill|gas', m_lower):
            return "Bills & Utilities"
        if re.search(r'zerodha|groww|mutual|sip|invest|stocks', m_lower):
            return "Investments"
        if re.search(r'rent|landlord|maintenance', m_lower):
            return "Rent"
            
        return "Daily Spend"

    def parse(self, raw_text):
        intent, conf, prob_dict = self.predict_intent(raw_text)
        
        if intent == 'NOISE' or conf < 0.65:
            return {
                "is_transaction": False,
                "intent": "NOISE",
                "confidence": conf,
                "message": "Filtered out non-transactional message (OTP/Promo/Chat)"
            }
            
        entities = self.extract_entities(raw_text, intent)
        
        return {
            "is_transaction": True,
            "intent": intent,  # DEBIT or CREDIT
            "confidence": conf,
            "amount": entities["amount"],
            "merchant": entities["merchant"],
            "account_last4": entities["account_last4"],
            "ref_no": entities["ref_no"],
            "payment_mode": entities["payment_mode"],
            "category": entities["category"]
        }

if __name__ == '__main__':
    engine = FinanceParserEngine()
    
    test_samples = [
        # Real debit
        "Sent Rs.80.00 From HDFC Bank A/C *1009 To RIDVEY SUPER MARKET On 07/10/26 Ref 130883949181",
        # Real restaurant debit
        "Sent Rs.127.00 From HDFC Bank A/C *1009 To MRUDULAS HOSPITALITY SERV On 07/10/26 Ref 130863669642",
        # Real credit
        "Dear SBI User, your A/c X1009-credited by Rs.1000 on 01Oct26 transfer from Rose Isabel Dhilbhar Ref No 664030036641 -SBI",
        # OTP Noise (Should be rejected)
        "Your OTP for login to JioPay is 482901. Valid for 10 mins. Do not share with anyone.",
        # Promo Offer Noise (Should be rejected)
        "Congratulations! You are pre-approved for Lifetime Free Credit Card with limit Rs. 2,00,000. Apply now at https://hdfc.me/cc",
        # Personal Chat Noise (Should be rejected)
        "Bro let me know once you reach office, will catch up for lunch."
    ]
    
    print("\n========== TESTING IN-HOUSE PARSER ENGINE ==========\n")
    for i, sample in enumerate(test_samples, 1):
        res = engine.parse(sample)
        print(f"--- Test Sample {i} ---")
        print(f"Input: {sample[:70]}...")
        if res["is_transaction"]:
            print(f"[TXN] Type: {res['intent']} (Conf: {res['confidence']*100:.1f}%) | Rs.{res['amount']}")
            print(f"      Merchant: {res['merchant']} | Category: {res['category']} | Mode: {res['payment_mode']}")
            print(f"      A/C: *{res['account_last4']} | Ref: {res['ref_no']}")
        else:
            print(f"[NOISE] Discarded (Conf: {res['confidence']*100:.1f}%) | {res['message']}")
        print()
