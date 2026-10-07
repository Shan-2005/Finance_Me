import os
import sys
import subprocess
import json
import re
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ADB_PATH = r"C:\Users\areoj\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "raw_sms_dump.json")

def extract_all_sms():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"[*] Calling ADB to query content://sms...")
    
    cmd = [
        ADB_PATH, "shell",
        "content query --uri content://sms --projection address:body:date:type"
    ]
    
    # Run ADB process with UTF-8 encoding
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    
    if result.returncode != 0:
        print(f"[!] ADB query failed: {result.stderr}")
        return []
    
    raw_output = result.stdout
    print(f"[*] Raw data received ({len(raw_output)} characters). Parsing records...")

    # Pattern matches 'Row: <num> address=<addr>, body=<body>, date=<timestamp>, type=<type>'
    # Note that body can span multiple lines!
    # Android content query prints:
    # Row: 0 address=..., body=..., date=..., type=...
    # Row: 1 ...
    
    records = []
    # Split by Row: <digits> 
    row_chunks = re.split(r'(?m)^Row:\s*\d+\s+', raw_output)
    
    for chunk in row_chunks:
        if not chunk.strip():
            continue
        
        # Regex to extract address, body, date, type
        # Typically formatted as:
        # address=..., body=..., date=..., type=...
        m = re.search(r'address=(?P<addr>.*?), body=(?P<body>.*?), date=(?P<date>\d+)(?:, type=(?P<type>\d+))?', chunk, re.DOTALL)
        if m:
            addr = m.group('addr').strip()
            body = m.group('body').strip()
            date_ms = m.group('date').strip()
            sms_type = m.group('type') or '1'
            
            try:
                date_dt = datetime.fromtimestamp(int(date_ms) / 1000.0).strftime('%Y-%m-%d %H:%M:%S')
            except Exception:
                date_dt = ""
                
            records.append({
                "sender": addr,
                "body": body,
                "timestamp_ms": int(date_ms) if date_ms.isdigit() else 0,
                "datetime": date_dt,
                "type": int(sms_type) if sms_type and sms_type.isdigit() else 1
            })
    
    print(f"[OK] Successfully parsed {len(records)} SMS messages.")
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        
    print(f"[OK] Saved raw dump to: {OUTPUT_FILE}")
    return records

if __name__ == '__main__':
    extract_all_sms()
