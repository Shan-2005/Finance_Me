import json
import os

files_to_update = [
    r"C:\Users\areoj\.gemini\settings.json",
    r"C:\Users\areoj\.claude.json",
    r"C:\Users\areoj\.gemini\config\mcp_config.json"
]

for file_path in files_to_update:
    if not os.path.exists(file_path):
        print(f"Skipping non-existent: {file_path}")
        continue
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        if "mcpServers" not in data:
            data["mcpServers"] = {}
        
        if "aws-mcp" not in data["mcpServers"]:
            data["mcpServers"]["aws-mcp"] = {
                "command": "uvx",
                "args": [
                    "mcp-proxy-for-aws@latest",
                    "https://aws-mcp.us-east-1.api.aws/mcp",
                    "--metadata",
                    "INSTALL_SOURCE=aws-cli"
                ]
            }
        
        if "env" not in data["mcpServers"]["aws-mcp"]:
            data["mcpServers"]["aws-mcp"]["env"] = {}
        
        data["mcpServers"]["aws-mcp"]["env"]["AWS_MCP_PROXY_PROFILES"] = "joeshan"
        
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"Successfully updated: {file_path}")
    except Exception as e:
        print(f"Error updating {file_path}: {e}")
