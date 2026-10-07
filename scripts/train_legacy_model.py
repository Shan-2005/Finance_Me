import os
import sys
import json
import re
import pickle
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
RAW_FILE = os.path.join(DATA_DIR, "raw_sms_dump.json")
ANNOTATED_FILE = os.path.join(DATA_DIR, "annotated_finance_dataset.json")

def prepare_dataset():
    """
    Builds a robust, balanced dataset:
    - DEBIT samples (from annotated dataset)
    - CREDIT samples (from annotated dataset)
    - NOISE samples (OTPs, promo SMS, delivery updates, chats from raw dump)
    """
    with open(ANNOTATED_FILE, 'r', encoding='utf-8') as f:
        annotated = json.load(f)
        
    with open(RAW_FILE, 'r', encoding='utf-8') as f:
        raw_msgs = json.load(f)
        
    txn_texts = {item['raw_text'].strip() for item in annotated}
    
    X = []
    y = []
    metadata = []
    
    # Positive samples: DEBIT & CREDIT
    for item in annotated:
        text = item['raw_text'].strip()
        label = item['label_type']  # DEBIT or CREDIT
        if label in ('DEBIT', 'CREDIT'):
            X.append(text)
            y.append(label)
            metadata.append(item['entities'])
            
    # Negative samples: Non-transactions (OTPs, offers, personal, service alerts)
    noise_count = 0
    max_noise = int(len(X) * 0.9)  # Balanced ratio
    
    for item in raw_msgs:
        body = item['body'].strip()
        if body and body not in txn_texts:
            X.append(body)
            y.append('NOISE')
            metadata.append({})
            noise_count += 1
            if noise_count >= max_noise:
                break
                
    print(f"[*] Total dataset prepared: {len(X)} samples")
    print(f"    - DEBIT: {y.count('DEBIT')}")
    print(f"    - CREDIT: {y.count('CREDIT')}")
    print(f"    - NOISE (Non-transactions): {y.count('NOISE')}")
    
    return X, y, metadata

def train_classifier(X, y):
    print("\n[*] Splitting dataset: 80% Train, 20% Test (Stratified)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    
    print(f"[*] Training samples: {len(X_train)} | Test samples: {len(X_test)}")
    
    # TF-IDF Vectorizer with word and character n-grams to catch subtle punctuation, numbers & keywords
    print("[*] Vectorizing with TF-IDF (1-2 word n-grams + sublinear scaling)...")
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=2,
        sublinear_tf=True,
        lowercase=True,
        token_pattern=r'(?u)\b\w+\b|[₹*]'
    )
    
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)
    
    print(f"[*] Vocabulary size: {len(vectorizer.vocabulary_)} features")
    
    # Train Logistic Regression with L2 regularization
    print("[*] Training Calibrated Logistic Regression Classifier...")
    clf = LogisticRegression(
        C=5.0,
        max_iter=1000,
        class_weight='balanced',
        random_state=42
    )
    clf.fit(X_train_vec, y_train)
    
    # Evaluate
    y_pred = clf.predict(X_test_vec)
    acc = accuracy_score(y_test, y_pred)
    
    print("\n================== EVALUATION REPORT ==================")
    print(f"Overall Accuracy: {acc * 100:.2f}%\n")
    print(classification_report(y_test, y_pred, digits=4))
    print("Confusion Matrix:")
    labels = sorted(list(set(y)))
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    header = f"{'Actual \\ Pred':<15}" + "".join(f"{lbl:<12}" for lbl in labels)
    print(header)
    for i, row in enumerate(cm):
        row_str = f"{labels[i]:<15}" + "".join(f"{val:<12}" for val in row)
        print(row_str)
    print("=======================================================\n")
    
    # Save model and vectorizer
    os.makedirs(MODELS_DIR, exist_ok=True)
    model_path = os.path.join(MODELS_DIR, "sms_intent_classifier.pkl")
    vectorizer_path = os.path.join(MODELS_DIR, "sms_tfidf_vectorizer.pkl")
    
    with open(model_path, 'wb') as f:
        pickle.dump(clf, f)
    with open(vectorizer_path, 'wb') as f:
        pickle.dump(vectorizer, f)
        
    print(f"[OK] Saved Classifier Model to: {model_path}")
    print(f"[OK] Saved TF-IDF Vectorizer to: {vectorizer_path}")
    
    return clf, vectorizer

if __name__ == '__main__':
    X, y, metadata = prepare_dataset()
    clf, vec = train_classifier(X, y)
