#!/usr/bin/env bash
set -euo pipefail

# Run ingestion tests using project's venv
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

PYTHONPATH=backend $PY -m pytest backend/tests/test_ingest_state.py -q
