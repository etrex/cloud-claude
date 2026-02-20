#!/bin/bash

USER_ID="$1"
MESSAGE_ID="$2"
TEXT="$3"
QUOTED_ID="$4"
ALLOW_WRITE="$5"
MSG_TYPE="${6:-text}"

SESSIONS_FILE="/workspaces/cloud-claude/.sessions.json"
CLAUDE="/home/codespace/nvm/current/bin/claude"

# 載入環境變數（SSH 不會自動 source login shell，需手動 source）
source ~/.bash_profile 2>/dev/null || source ~/.profile 2>/dev/null || true

cd /workspaces/cloud-claude

# 若為圖片，先下載到暫存檔
IMAGE_PATH=""
if [ "$MSG_TYPE" = "image" ]; then
  IMAGE_PATH="/tmp/img_${MESSAGE_ID}.jpg"
  curl -s -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
    "https://api-data.line.me/v2/bot/message/${MESSAGE_ID}/content" \
    -o "$IMAGE_PATH"
fi

# 組建 prompt，帶上 messageId 和 quotedMessageId（如果有）
if [ "$MSG_TYPE" = "image" ]; then
  BASE="[messageId: $MESSAGE_ID${QUOTED_ID:+, quotedMessageId: $QUOTED_ID}]
使用者傳送了一張圖片，路徑: $IMAGE_PATH"
  PROMPT="$BASE${TEXT:+
$TEXT}"
elif [ -n "$QUOTED_ID" ]; then
  PROMPT="[messageId: $MESSAGE_ID, quotedMessageId: $QUOTED_ID]
$TEXT"
else
  PROMPT="[messageId: $MESSAGE_ID]
$TEXT"
fi

# 讀取此 userId 的 session ID
SESSION_ID=""
if [ -f "$SESSIONS_FILE" ]; then
  SESSION_ID=$(jq -r --arg uid "$USER_ID" '.[$uid] // empty' "$SESSIONS_FILE" 2>/dev/null)
fi

SYSTEM_PROMPT="你是一個 LINE Bot 助手。請用純文字回覆，不要使用任何 Markdown 語法（不要用 **粗體**、## 標題、\`程式碼\`、--- 分隔線等）。回覆要簡潔易讀。"

# 根據是否在白名單決定是否加上 --dangerously-skip-permissions
EXTRA_FLAGS=""
if [ "$ALLOW_WRITE" = "1" ]; then
  EXTRA_FLAGS="--dangerously-skip-permissions"
fi

# 呼叫 claude，有 session 就 resume，失敗則建新 session
if [ -n "$SESSION_ID" ]; then
  OUTPUT=$("$CLAUDE" -p "$PROMPT" --resume "$SESSION_ID" --output-format json --system-prompt "$SYSTEM_PROMPT" $EXTRA_FLAGS 2>/dev/null)
  # resume 失敗（輸出空）則清掉舊 session，重新開始
  if [ -z "$OUTPUT" ]; then
    SESSION_ID=""
    OUTPUT=$("$CLAUDE" -p "$PROMPT" --output-format json --system-prompt "$SYSTEM_PROMPT" $EXTRA_FLAGS 2>/dev/null)
  fi
else
  OUTPUT=$("$CLAUDE" -p "$PROMPT" --output-format json --system-prompt "$SYSTEM_PROMPT" $EXTRA_FLAGS 2>/dev/null)
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
