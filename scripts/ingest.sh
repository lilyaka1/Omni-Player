#!/usr/bin/env bash
set -euo pipefail

VENV=.venv
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  echo "Virtualenv not found. Creating..."
  python3 -m venv $VENV
  $VENV/bin/python -m pip install --upgrade pip
  if [ -f backend/requirements-dev.txt ]; then
    $VENV/bin/pip install -r backend/requirements-dev.txt
  else
    $VENV/bin/pip install pytest
  fi
fi

CMD="$@"
if [ -z "$CMD" ]; then
  echo "Usage: ingest.sh once|loop|track <id>"
  exit 1
fi

if [ "$1" = "once" ]; then
  PYTHONPATH=backend $PY -m app.scripts.ingest_cli --once
elif [ "$1" = "loop" ]; then
  INTERVAL=${2:-5}
  PYTHONPATH=backend $PY -m app.scripts.ingest_cli --loop --interval $INTERVAL
elif [ "$1" = "track" ]; then
  if [ -z "${2-}" ]; then
    echo "Usage: ingest.sh track <id>"
    exit 1
  fi
  PYTHONPATH=backend $PY -m app.scripts.ingest_cli --track $2
else
  echo "Unknown command: $1"
  exit 1
fi
