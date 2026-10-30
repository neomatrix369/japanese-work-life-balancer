#!/usr/bin/env bash
# scripts/check-tts.sh — verify the ElevenLabs API key has text_to_speech permission.
# Usage: bash scripts/check-tts.sh
set -euo pipefail

ENV_FILE="$(dirname "$0")/../ui/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: ui/.env.local not found"
  exit 1
fi

API_KEY=$(grep -E '^ELEVENLABS_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
VOICE_ID=$(grep -E '^ELEVENLABS_VOICE_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "$API_KEY" ]]; then
  echo "ERROR: ELEVENLABS_API_KEY not set in ui/.env.local"
  exit 1
fi

echo "Key  : ${API_KEY:0:10}…${API_KEY: -4}"
echo "Voice: $VOICE_ID"
echo "Testing text_to_speech permission…"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
  -H "xi-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: audio/mpeg" \
  -d '{"text":"OK","model_id":"eleven_multilingual_v2"}' \
  -o /tmp/tts-check.bin 2>&1)

HTTP_CODE=$(tail -1 <<< "$RESPONSE")

if [[ "$HTTP_CODE" == "200" ]]; then
  SIZE=$(wc -c < /tmp/tts-check.bin)
  echo "✓ SUCCESS — got audio ($SIZE bytes, HTTP 200)"
  echo "  Run: afplay /tmp/tts-check.bin   (macOS)"
else
  BODY=$(cat /tmp/tts-check.bin 2>/dev/null || true)
  CODE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('detail',{}).get('code','?'))" 2>/dev/null || echo "?")
  MSG=$(echo "$BODY"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('detail',{}).get('message','?'))" 2>/dev/null || echo "$BODY")
  echo "✗ FAILED (HTTP $HTTP_CODE) — $CODE"
  echo "  $MSG"
fi
