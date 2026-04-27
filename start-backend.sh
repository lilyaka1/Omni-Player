#!/bin/bash
cd "$(dirname "$0")/backend"
python3 -m venv venv 2>/dev/null || true
. venv/bin/activate
pip install -q -r requirements.txt 2>/dev/null || pip install -q fastapi uvicorn python-dotenv psycopg2-binary
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
