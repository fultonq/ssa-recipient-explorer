#!/usr/bin/env bash
# Idempotently creates the schema and loads N synthetic recipients into PostgreSQL.
# Uses the standard libpq environment (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
#   SSA_RECORDS (default 1000000)  SSA_SEED (default 2026)  SSA_EXPORT (path to ssa_export)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RECORDS="${SSA_RECORDS:-1000000}"
SEED="${SSA_SEED:-2026}"
EXPORT="${SSA_EXPORT:-ssa_export}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

echo "waiting for PostgreSQL at ${PGHOST:-localhost}:${PGPORT:-5432}..."
for i in $(seq 1 60); do pg_isready -q && break; sleep 1; done
pg_isready -q || { echo "PostgreSQL not reachable" >&2; exit 1; }

"${PSQL[@]}" -f "$HERE/01_schema.sql"

have=$("${PSQL[@]}" -tAc "SELECT count(*) FROM recipients")
indexed=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_constraint WHERE conname = 'recipients_pkey'")
if [ "$have" -eq "$RECORDS" ] && [ "$indexed" -eq 1 ]; then
  echo "recipients already holds $have rows with indexes; nothing to do"
  exit 0
fi
if [ "$have" -eq "$RECORDS" ]; then
  echo "rows present but indexes missing (interrupted seed?); building them"
  "${PSQL[@]}" -f "$HERE/02_constraints_indexes.sql"
  exit 0
fi
if [ "$have" -ne 0 ]; then
  echo "recipients holds $have rows but $RECORDS were requested; reloading"
  "${PSQL[@]}" -c "DROP TABLE recipients" -f "$HERE/01_schema.sql"
fi

echo "loading $RECORDS synthetic recipients (seed $SEED)..."
start=$(date +%s)
"$EXPORT" "$RECORDS" "$SEED" | "${PSQL[@]}" -c "\copy recipients FROM STDIN WITH (FORMAT csv, HEADER true)"
echo "building constraints and indexes..."
"${PSQL[@]}" -f "$HERE/02_constraints_indexes.sql"
echo "seeded $RECORDS rows in $(( $(date +%s) - start )) s"
