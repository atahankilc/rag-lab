#!/bin/bash
# Add a UI user, or set a new password for one (that also logs them out everywhere).
# There is no sign-up in the UI: this is the only way in. Usage: make user NAME=atahan
set -euo pipefail
NAME="${1:?usage: make user NAME=<username>}"
read -r -s -p "Password for $NAME (8+ characters): " PW; echo >&2
read -r -s -p "Again: " PW2; echo >&2
[ "$PW" = "$PW2" ] || { echo "The passwords differ." >&2; exit 1; }
# psql variables (:'name', :'pw') quote the values, so nothing typed here can break the SQL.
printf '%s\n' "select 'saved user ' || lab.set_web_user(:'name', :'pw');" \
  | docker compose --env-file .env -f viz/db/compose.yaml exec -T db \
      psql -v ON_ERROR_STOP=1 -q -t -U lab -d lab -v name="$NAME" -v pw="$PW"
