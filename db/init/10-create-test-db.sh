#!/bin/sh
set -eu
if [ -n "${POSTGRES_TEST_DB:-}" ] && [ "$POSTGRES_TEST_DB" != "$POSTGRES_DB" ]; then
  createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_TEST_DB"
fi
