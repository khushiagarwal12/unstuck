#!/usr/bin/env bash
# Keep Render web service warm before live demos / pitch (ARCHITECTURE.md section 1.3 & 16).
# Usage: ./scripts/warm.sh [BASE_URL]

URL="${1:-http://localhost:8000}"
echo "Warming service at $URL every 45s. Press Ctrl+C to stop."

while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL/health")
  TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
  echo "[$TIMESTAMP] Ping $URL/health -> HTTP $STATUS"
  sleep 45
done
