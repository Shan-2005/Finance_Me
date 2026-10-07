import os

rules_path = r"C:\Users\areoj\.gemini\antigravity-ide\brain\58b468c5-d207-408c-aac0-c7e2679ee4ae\scratch\aws-starter-rules.md"
with open(rules_path, "r", encoding="utf-8") as f:
    rules_content = f.read().strip()

wrapped_block = f"\n\n<!-- BEGIN AWS Agent Toolkit rules -->\n{rules_content}\n<!-- END AWS Agent Toolkit rules -->\n"

target_files = [
    r"d:\Finace_Me\AGENTS.md",
    r"d:\Finace_Me\GEMINI.md",
    r"d:\Finace_Me\CLAUDE.md"
]

for target in target_files:
    if os.path.exists(target):
        with open(target, "r", encoding="utf-8") as f:
            existing = f.read()
        if "<!-- BEGIN AWS Agent Toolkit rules -->" in existing:
            # Replace existing block
            import re
            pattern = re.compile(r"<!-- BEGIN AWS Agent Toolkit rules -->.*?<!-- END AWS Agent Toolkit rules -->", re.DOTALL)
            new_content = pattern.sub(f"<!-- BEGIN AWS Agent Toolkit rules -->\n{rules_content}\n<!-- END AWS Agent Toolkit rules -->", existing)
            with open(target, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"Updated existing block in {target}")
        else:
            with open(target, "a", encoding="utf-8") as f:
                f.write(wrapped_block)
            print(f"Appended to {target}")
    else:
        with open(target, "w", encoding="utf-8") as f:
            f.write(wrapped_block.lstrip())
        print(f"Created {target}")
