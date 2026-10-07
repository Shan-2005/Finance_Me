import subprocess
import json
import sys

env = dict(**subprocess.os.environ)
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONUTF8"] = "1"
env["PATH"] = r"C:\Users\areoj\.local\bin;C:\Users\areoj\AppData\Local\Programs\Amazon\AWSCLIV2;" + env.get("PATH", "")

cmd = [r"C:\Users\areoj\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe", "agent-toolkit", "list-available-skills", "--region", "us-east-1", "--profile", "joeshan"]
res = subprocess.run(cmd, capture_output=True, env=env)
print("Return code:", res.returncode)
if res.returncode == 0:
    try:
        skills = json.loads(res.stdout.decode("utf-8", errors="replace"))
        print(f"Successfully retrieved {len(skills)} skills!")
        print("First 5 skills:", [s.get("name") for s in skills[:5]])
    except Exception as e:
        print("Parse error:", e)
else:
    print("Stderr:", res.stderr.decode("utf-8", errors="replace"))
