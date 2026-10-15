#!/bin/bash
# Load viz/providers.json into the database (lab.load_providers). Safe to run again after editing
# the file: providers are added or updated by id, and on/off + spend caps set in the UI are kept.
set -euo pipefail
FILE="${1:-viz/providers.json}"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$FILE"   # fail early on invalid JSON
{
  printf 'select lab.load_providers($providers$'
  cat "$FILE"
  printf '$providers$::jsonb);\n'
}
