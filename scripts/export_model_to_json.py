import os
import sys
import pickle
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_PATH = os.path.join(MODELS_DIR, "sms_intent_classifier.pkl")
VEC_PATH = os.path.join(MODELS_DIR, "sms_tfidf_vectorizer.pkl")
EXPORT_PATH = os.path.join(MODELS_DIR, "model_weights.json")

def export_model():
    with open(MODEL_PATH, 'rb') as f:
        clf = pickle.load(f)
    with open(VEC_PATH, 'rb') as f:
        vec = pickle.load(f)
        
    # Logistic Regression coefficients: shape (n_classes, n_features)
    # classes: ['CREDIT', 'DEBIT', 'NOISE']
    classes = list(clf.classes_)
    intercept = clf.intercept_.tolist()
    coef = clf.coef_.tolist()
    
    # Vocabulary & IDF
    # We can prune to top non-zero features or keep full vocabulary
    vocab = vec.vocabulary_
    idf = vec.idf_.tolist()
    
    export_data = {
        "classes": classes,
        "intercept": intercept,
        "coef": coef,
        "vocab": vocab,
        "idf": idf,
        "ngram_range": [1, 2]
    }
    
    with open(EXPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(export_data, f)
        
    size_kb = os.path.getsize(EXPORT_PATH) / 1024
    print(f"[OK] Exported portable JSON model weights to: {EXPORT_PATH} ({size_kb:.1f} KB)")

if __name__ == '__main__':
    export_model()
