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
	@echo "Running ingestion unit tests"
	PYTHONPATH=backend $(PY) -m pytest backend/tests/test_ingest_state.py -q

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
