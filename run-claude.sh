#!/bin/bash

USER_ID="$1"
MESSAGE_ID="$2"
TEXT="$3"
QUOTED_ID="$4"

SESSIONS_FILE="/workspaces/cloud-claude/.sessions.json"
HISTORY_FILE="/workspaces/cloud-claude/.message-history.json"
CLAUDE="/home/codespace/nvm/current/bin/claude"

# 儲存當前訊息到歷史記錄
HISTORY="{}"
if [ -f "$HISTORY_FILE" ]; then
  HISTORY=$(cat "$HISTORY_FILE")
fi
echo "$HISTORY" | jq --arg mid "$MESSAGE_ID" --arg txt "$TEXT" '.[$mid] = $txt' > "$HISTORY_FILE"

# 組建完整 prompt（有引用時加上被引用的訊息）
PROMPT="$TEXT"
if [ -n "$QUOTED_ID" ]; then
  QUOTED_TEXT=$(jq -r --arg mid "$QUOTED_ID" '.[$mid] // empty' "$HISTORY_FILE" 2>/dev/null)
  if [ -n "$QUOTED_TEXT" ]; then
    PROMPT="[引用訊息: \"$QUOTED_TEXT\"]
$TEXT"
  fi
fi

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
