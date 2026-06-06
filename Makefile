# Makefile for Omni Player developer tasks
# Use `make target` to run common dev flows.

PYTHON ?= python3
VENV_DIR := .venv
PY := $(VENV_DIR)/bin/python
PIP := $(VENV_DIR)/bin/pip

.PHONY: help venv install-dev test ingest-once ingest-loop ingest-track clean

help:
	@echo "Available targets: venv, install-dev, test, ingest-once, ingest-loop, ingest-track, clean"

venv:
	@echo "Creating virtualenv in $(VENV_DIR)"
	$(PYTHON) -m venv $(VENV_DIR)
	$(PY) -m pip install --upgrade pip setuptools

install-dev: venv
	@echo "Installing dev dependencies"
	if [ -f backend/requirements-dev.txt ]; then \
		$(PIP) install -r backend/requirements-dev.txt; \
	else \
		$(PIP) install pytest; \
	fi

test: venv
	@echo "Running all backend tests"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/ -v --tb=short

test-coverage: venv
	@echo "Running tests with coverage"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/ -v --tb=short --cov=app --cov-report=term-missing --cov-report=html:coverage_html

test-auth: venv
	@echo "Running auth tests"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/test_auth_service.py backend/tests/test_auth_api.py -v --tb=short

test-api: venv
	@echo "Running API integration tests"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/test_*_api.py -v --tb=short

test-unit: venv
	@echo "Running unit tests"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/test_*_service.py backend/tests/test_*_controller.py backend/tests/test_*_manager.py -v --tb=short

ingest-once: venv
	@echo "Run ingest worker once (recover + process pending)"
	PYTHONPATH=backend $(PY) -m app.scripts.ingest_cli --once

ingest-loop: venv
	@echo "Run ingest worker in loop (Ctrl-C to stop)"
	PYTHONPATH=backend $(PY) -m app.scripts.ingest_cli --loop --interval 5

ingest-track: venv
	@echo "Process single track by id: make ingest-track ID=123"
	if [ -z "$(ID)" ]; then echo "Usage: make ingest-track ID=<track_id>"; exit 1; fi
	PYTHONPATH=backend $(PY) -m app.scripts.ingest_cli --track $(ID)

clean:
	rm -rf $(VENV_DIR)
	@echo "Cleaned venv"
