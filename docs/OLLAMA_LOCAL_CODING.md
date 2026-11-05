# Local coding assistant (Ollama)

This is an opt-in development tool. It does not modify the production CRM, upload candidate documents, or expose Ollama to the public internet.

## Requirements
- Windows machine with Ollama installed and running
- Python 3.10+
- A local coding model (start with `ollama pull qwen2.5-coder:7b`)

## Quick start (PowerShell)
```powershell
ollama list
ollama ps
ollama pull qwen2.5-coder:7b
python tools/ollama_code_review.py --model qwen2.5-coder:7b --file README.md
```

The script sends the specified **source file** to the Ollama API on localhost and prints a review. It never edits files. Do not pass secrets, real candidate documents, or personal data. Run on a separate development branch and review any suggestions before applying them.

This is **not** automatic cloud Codex ↔ Ollama orchestration. That would require an explicit coordinator, permissions, and test harness. First verify local performance and output quality.
