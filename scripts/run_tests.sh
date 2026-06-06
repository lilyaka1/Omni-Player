#!/usr/bin/env bash
set -euo pipefail

# Run all backend tests using project's venv
VENV=.venv
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  echo "Virtualenv not found. Creating..."
  python3 -m venv $VENV
  $VENV/bin/python -m pip install --upgrade pip
  if [ -f backend/requirements-dev.txt ]; then
    $VENV/bin/pip install -r backend/requirements-dev.txt
  else
    $VENV/bin/pip install pytest httpx
  fi
fi

echo "Running all backend tests..."
PYTHONPATH=backend $PY -m pytest backend/tests/ -v --tb=short

echo ""
echo "Running tests with coverage..."
PYTHONPATH=backend $PY -m pytest backend/tests/ -v --tb=short --cov=app --cov-report=term-missing --cov-report=html:coverage_html 2>/dev/null || echo "Coverage report generated (if pytest-cov installed)"
