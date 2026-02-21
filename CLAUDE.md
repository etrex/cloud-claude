# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案架構

Cloud Claude 的核心概念是把 LINE 訊息橋接到跑在 GitHub Codespace 裡的 Claude Code。完整流程如下：

```
LINE 用戶
  │ 發送訊息
  ▼
LINE Messaging API（Webhook）
  │ POST /webhook
  ▼
Heroku（server.js）
  │ gh codespace ssh
  ▼
GitHub Codespace（run-claude.sh）
  │ claude -p
  ▼
Claude Code CLI
  │ 輸出結果
  ▼
LINE API（Reply 或 Push）
  │
  ▼
LINE 用戶收到回覆
```

### Heroku 端（`server.js`）

- 接收 LINE Webhook，驗證簽章（`x-line-signature`）
- 對同一個 chatId 的訊息做 debounce（預設 3 秒），把短時間內的多則訊息合批後才觸發一次 SSH（注意：Codespace 端另有 30 秒 sliding window 才會實際呼叫 Claude）
- 重複的 messageId 會被過濾掉（LINE 有時會重送 webhook）
- 根據 `projectMap` 決定訊息要路由到 Codespace 的哪個專案目錄
- 未在 `projectMap` 內的 chatId 一律丟棄（除了 `where`/`here` 指令）
- 透過 `gh codespace ssh` 執行 `run-claude.sh`，把所有參數用 shell escape 安全傳入
- Heroku 是 stateless，所有狀態都在 Codespace 端維護

### Codespace 端（`run-claude.sh`）

- 每個 userId 維護一個 30 秒 sliding window 訊息佇列（`/tmp/queue_<userId>`）
- 訊息進來後追加到佇列，啟動一個背景處理程序等候 30 秒內無新訊息
- 30 秒靜默後，把佇列內所有訊息合併成一個 prompt，一次性送給 Claude
- 呼叫 `claude -p` 時帶上 `--resume <sessionId>` 恢復對話，session 存在 `<WORK_DIR>/.sessions.json`
- 若 session 已失效（輸出為空），自動 fallback 開新 session
- 若發生 API 錯誤（`is_error: true`），保留 session 不清除，回傳詳細 debug 訊息給用戶
- 回覆優先使用 LINE Reply API（replyToken queue），全部失敗才用 Push API
- 圖片訊息會先透過 LINE Content API 下載到 `/tmp/img_<messageId>.jpg`，再把路徑帶進 prompt

### 多專案路由（`projectMap`）

`server.js` 內硬寫一個 Map，把 LINE chatId 對應到 Codespace 的工作目錄：

```js
const projectMap = new Map([
  ['Caad35ad92eb67f8f62d3e70f78632a7c', '/workspaces/airport-gogo'],
  ['Uefa877a60cb3ed8e0d28b1b6263f549e', '/workspaces/cloud-claude'],
]);
```

`run-claude.sh` 會以該目錄作為 `cd` 的目標，並在該目錄下讀寫 `.sessions.json`。

### 寫入權限控制（`ALLOWED_IDS`）

Heroku 環境變數 `ALLOWED_IDS` 存放允許對 Codespace 進行寫入操作的 LINE ID（逗號分隔）。符合的 chatId 呼叫 Claude 時會加上 `--dangerously-skip-permissions`。

## 主要檔案

| 檔案 | 說明 |
|------|------|
| `server.js` | Heroku 上跑的 LINE Webhook 伺服器 |
| `run-claude.sh` | Codespace 端的訊息處理腳本，由 Heroku 透過 SSH 呼叫 |
| `scripts/install-gh.js` | Heroku postbuild 腳本，自動下載安裝 `gh` CLI 到 `vendor/bin/` |
| `.profile.d/path.sh` | 把 `vendor/bin` 加入 Heroku dyno 的 PATH |

## 部署方式

```bash
git push origin master
```

GitHub 設有自動部署到 Heroku，push 到 GitHub 後會自動觸發，不需要也不應該直接 `git push heroku master`。

Heroku 的 postbuild 步驟會自動執行 `scripts/install-gh.js` 安裝 `gh` CLI。`gh` 需預先透過 `GITHUB_TOKEN` 環境變數完成認證，才能 SSH 進 Codespace。

## 環境變數

### Heroku 端

| 變數 | 用途 |
|------|------|
| `LINE_CHANNEL_SECRET` | 驗證 LINE Webhook 簽章 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 呼叫 LINE Messaging API 發送訊息 |
| `ANTHROPIC_API_KEY` | 透過 SSH 指令傳入 Codespace，供 Claude CLI 使用 |
| `CODESPACE_NAME` | 要 SSH 進入的 Codespace 名稱 |
| `ALLOWED_IDS` | 允許寫入檔案的 LINE chatId，逗號分隔 |
| `DEBOUNCE_MS` | debounce 視窗大小（預設 3000ms） |

### Codespace 端

Codespace 的 Secrets 存放在 `/workspaces/.codespaces/shared/.env-secrets`，每一行格式為 `KEY=<base64值>`。非 login shell（SSH 直連）不會自動注入，`run-claude.sh` 會手動讀取並解碼。

| 變數 | 用途 |
|------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | `run-claude.sh` 呼叫 LINE API 回覆訊息用 |
| `HEROKU_API_KEY` | Heroku CLI 認證，讓 Claude 可以操作 Heroku |

## Codespace 環境建置

新建 Codespace 時需手動執行：

```bash
# 安裝 Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Clone 額外的專案（需帶上 GH_TOKEN）
GH_TOKEN=<token> gh repo clone <org>/<repo> /workspaces/<repo>
```

Claude CLI 位置：`/home/codespace/nvm/current/bin/claude`

## 新增專案或群組的 SOP

1. 把新的 repo clone 到 Codespace：`/workspaces/<project>`
2. 在 `server.js` 的 `projectMap` 加入對應：
   ```js
   ['<LINE_CHAT_ID>', '/workspaces/<project>'],
   ```
3. 不知道 chatId 時：把 bot 加入目標群組，發送 `where` 或 `here`，bot 會直接回覆該 chatId
4. 部署：`git push heroku master`

## Codespace `/tmp/` 狀態檔案

| 檔案 | 說明 |
|------|------|
| `queue_<userId>` | 以 null byte 分隔的待處理 prompt 佇列 |
| `queue_last_<userId>` | 最後一則訊息的 unix timestamp（sliding window 用） |
| `queue_pid_<userId>` | 背景處理程序的 PID |
| `reply_tokens_<chatId>` | LINE replyToken FIFO 佇列，一行一個，從最舊的開始使用 |

Session ID 存在 `<WORK_DIR>/.sessions.json`，格式為 `{ "<userId>": "<sessionId>" }`。

背景處理程序的 log 輸出在 `<WORK_DIR>/processor.log`。
