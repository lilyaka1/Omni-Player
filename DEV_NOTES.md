Developer tooling (ingestion)

Run API locally:

```
python -m uvicorn app.main:app --reload --factory
```

Makefile targets:

```
make venv          # create virtualenv
make install-dev   # install dev deps (pytest etc)
make test          # run ingestion unit tests
make ingest-once   # run ingestion worker once (recover + process)
make ingest-loop   # run ingestion worker in loop (dev)
make ingest-track ID=123  # process specific track id
```

Scripts:

```
./scripts/run_tests.sh
./scripts/ingest.sh once
./scripts/ingest.sh loop 5
./scripts/ingest.sh track 123
```

Notes:
- Scripts create a `.venv` automatically if missing and install dev deps from `backend/requirements-dev.txt` when present.
- CLI tooling is meant for local dev/debug only and does not change production architecture.
