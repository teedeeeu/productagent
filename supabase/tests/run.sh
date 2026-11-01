#!/usr/bin/env bash
# Runs the migration + RLS tests against a plain PostgreSQL database.
# Usage: DATABASE_URL=postgres://user@host:port/db supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?Set DATABASE_URL to an EMPTY throwaway PostgreSQL database}"
P=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f auth_stub.sql
"${P[@]}" -f ../migrations/20261101000000_initial_schema.sql
"${P[@]}" -f grants_stub.sql
"${P[@]}" -f rls_test.sql
