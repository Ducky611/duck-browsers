#!/usr/bin/env bash
set -eu
# GitHub authenticates the default private forwarded port. Keep the app on loopback.
if ! curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then
  HOST=127.0.0.1 PORT=8080 nohup node server.mjs > /tmp/duck-server.log 2>&1 </dev/null &
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
curl -fsS http://127.0.0.1:8080/health
printf '\nOpen Duck: https://%s-8080.%s\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
