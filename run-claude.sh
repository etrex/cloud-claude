#!/bin/bash

USER_ID="$1"
PROMPT="$2"
SESSIONS_FILE="/workspaces/cloud-claude/.sessions.json"
CLAUDE="/home/codespace/nvm/current/bin/claude"

# 讀取此 userId 的 session ID
SESSION_ID=""
if [ -f "$SESSIONS_FILE" ]; then
  SESSION_ID=$(jq -r --arg uid "$USER_ID" '.[$uid] // empty' "$SESSIONS_FILE" 2>/dev/null)
fi

# 呼叫 claude，有 session 就 resume
if [ -n "$SESSION_ID" ]; then
  OUTPUT=$("$CLAUDE" -p "$PROMPT" --resume "$SESSION_ID" --output-format json 2>/dev/null)
else
  OUTPUT=$("$CLAUDE" -p "$PROMPT" --output-format json 2>/dev/null)
fi

# 儲存新的 session ID
NEW_SESSION_ID=$(echo "$OUTPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$NEW_SESSION_ID" ]; then
  EXISTING="{}"
  if [ -f "$SESSIONS_FILE" ]; then
    EXISTING=$(cat "$SESSIONS_FILE")
  fi
  echo "$EXISTING" | jq --arg uid "$USER_ID" --arg sid "$NEW_SESSION_ID" '.[$uid] = $sid' > "$SESSIONS_FILE"
fi

# 輸出回應文字
echo "$OUTPUT" | jq -r '.result // "（無回應）"'
