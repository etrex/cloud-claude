# CloudClaude 技術規格書

## 1. 通訊軟體整合

### 選擇：Telegram

| 項目 | 規格 |
|------|------|
| 平台 | Telegram Bot API |
| Webhook | 使用 setWebhook 方法註冊 |
| Streaming | 透過 editMessageText 實現逐步更新 |
| 檔案傳送 | 使用 sendDocument API |
| 群組支援 | 支援群組與頻道，透過 chat_id 識別 |

### Telegram Bot 設定
- 透過 BotFather 建立 bot
- 啟用 inline mode（可選）
- 設定 bot commands 提供操作提示

---

## 2. 雲端平台

### 選擇：Google Cloud Platform (GCP)

| 項目 | 規格 |
|------|------|
| VM 服務 | Compute Engine |
| 區域 | asia-east1（台灣）|
| VM 規格 | e2-medium（2 vCPU, 4GB RAM）作為預設，可依需求調整 |
| 磁碟 | 50GB SSD persistent disk |
| 作業系統 | Ubuntu 22.04 LTS |

### 資源節省策略
| 項目 | 規格 |
|------|------|
| 策略 | 停止 VM，保留磁碟 |
| 閒置判定 | 無活動超過 30 分鐘 |
| 啟動觸發 | 收到對應群組的訊息時自動啟動 |
| 預估恢復時間 | 30-60 秒 |

---

## 3. Webhook Receiver

### 選擇：Python + FastAPI (Serverless)

| 項目 | 規格 |
|------|------|
| 語言 | Python 3.11+ |
| 框架 | FastAPI |
| 部署位置 | GCP Cloud Run |

### 職責
- 接收 Telegram webhook
- 驗證請求來源
- 將訊息寫入 Message Queue
- 立即回應 200 OK

### API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/webhook/telegram` | POST | 接收 Telegram webhook |
| `/health` | GET | 健康檢查 |

### 部署規格
| 項目 | 規格 |
|------|------|
| 服務 | Cloud Run |
| 記憶體 | 256MB |
| 最小實例 | 0（可冷啟動）|
| 最大實例 | 100 |
| 逾時 | 10 秒（僅需寫入 Queue）|

---

## 3.1 Message Queue

### 選擇：GCP Cloud Pub/Sub

| 項目 | 規格 |
|------|------|
| 服務 | Cloud Pub/Sub |
| Topic | `cloudclaude-messages` |
| 訊息保留 | 7 天 |
| Ack 期限 | 600 秒 |

### 訊息格式
```json
{
  "platform": "telegram",
  "chat_id": "123456789",
  "user_id": "987654321",
  "message_id": "111",
  "text": "用戶訊息內容",
  "timestamp": "2024-01-01T00:00:00Z",
  "is_mention": true,
  "raw_payload": { }
}
```

---

## 3.1.1 群組訊息處理

### 觸發條件
| 情境 | 處理方式 |
|------|----------|
| 私人對話 | 所有訊息都觸發 Claude |
| 群組對話（未被 @） | 只儲存，不觸發 Claude |
| 群組對話（被 @） | 儲存 + 觸發 Claude，附帶近期訊息作為上下文 |

### 群組訊息儲存
| 項目 | 規格 |
|------|------|
| 儲存位置 | Cloud Firestore |
| 時間限制 | 最近 7 天 |
| 數量限制 | 每群組最多 1000 則 |
| 清理規則 | 超過任一條件即刪除舊訊息 |

### Firestore 資料結構
```
chat_messages/
  {chat_id}/
    messages/
      {message_id}/
        - user_id: string
        - user_name: string
        - text: string
        - timestamp: timestamp
```

### 清理邏輯
```
每則新訊息進來時：
1. 儲存新訊息
2. 刪除超過 7 天的訊息
3. 若仍超過 1000 則，刪除最舊的直到剩 1000 則
```

### 被 @ 時的處理流程
```
用戶 @CloudClaude 訊息
        │
        ▼
從 Firestore 取得該群組近期訊息（最多 1000 則）
        │
        ▼
組成上下文，連同用戶請求一起傳給 Claude
```

---

## 3.2 Router / 總機

### 選擇：Python + FastAPI (Serverless)

| 項目 | 規格 |
|------|------|
| 語言 | Python 3.10+ |
| 框架 | FastAPI |
| 部署位置 | GCP Cloud Run |
| 觸發方式 | Pub/Sub Push Subscription |
| Agent SDK | claude-agent-sdk (Python 版) |

### Agent SDK 安裝
```bash
pip install claude-agent-sdk
```

### 職責
- 從 Queue 接收訊息
- 查詢 channel ↔ VM 對應關係
- 無對應 VM：由總機 Claude 處理
- 有對應 VM：轉發訊息至 VM
- 處理 streaming 回應

### 總機 Claude 功能
| 功能 | 說明 |
|------|------|
| 建立新專案 | 協助用戶建立專案結構、Dockerfile |
| 建立開發環境 | 觸發 Build Service 和 VM Manager |
| 環境管理 | 列出、切換、停止、刪除環境 |
| 一般問答 | 非開發相關問題直接回答 |

### 部署規格
| 項目 | 規格 |
|------|------|
| 服務 | Cloud Run |
| 記憶體 | 1GB |
| 最小實例 | 0 |
| 最大實例 | 50 |
| 逾時 | 540 秒（最大）|

---

## 3.3 Build Service

### 選擇：GCP Cloud Build

| 項目 | 規格 |
|------|------|
| 服務 | Cloud Build |
| 觸發方式 | 由 Router 透過 API 觸發 |
| Image Registry | GCP Artifact Registry |

### Docker Image 內容（僅開發環境）
```
Docker image 包含：
├── 作業系統（Ubuntu）
├── 語言執行環境（Node.js、Python 等）
├── 系統工具（git、curl 等）
└── Claude Code

不包含：
└── 程式碼（由 Claude Code 負責 git clone）
```

### 建置流程
```
Router 收到建立環境請求
        │
        ▼
透過 GitHub API 讀取 repo 的 Dockerfile
        │
        ▼
計算 Dockerfile hash
        │
        ▼
查詢 Artifact Registry 是否有對應 image
        │
        ├─── 已存在 → 跳過建置，直接回傳 image URL
        │
        └─── 不存在 → 呼叫 Cloud Build
                        1. 建置 Docker image
                        2. Push 到 Artifact Registry
                        3. 回傳 image URL
```

### Image 命名規則
```
{region}-docker.pkg.dev/{project}/cloudclaude/env:{dockerfile_hash}
```

### 共用 Image
- 相同 Dockerfile 的專案共用同一個 image
- 減少重複建置，節省時間與儲存空間

---

## 4. VM Manager

### 實作位置
整合於 Webhook Gateway 服務內

### 資料儲存
| 項目 | 規格 |
|------|------|
| 資料庫 | Cloud Firestore |
| 用途 | 儲存用戶、群組、VM 對應關係 |

### 資料結構

```
users/
  {user_id}/
    - telegram_id: string
    - claude_oauth_token: string (加密)  # Claude Code OAuth Token (sk-ant-oat01-...)
    - github_access_token: string (加密)
    - github_authorized_repos: [repo_ids]
    - created_at: timestamp

vms/
  {vm_id}/
    - gcp_instance_name: string
    - zone: string
    - status: "running" | "stopped"
    - owner_user_id: string
    - last_active_at: timestamp

chat_vm_mappings/
  {chat_id}/
    - vm_id: string
    - session_id: string

sessions/
  {session_id}/
    - vm_id: string
    - chat_id: string
    - working_directory: string
    - created_at: timestamp
```

### VM 操作
| 操作 | 實作 |
|------|------|
| 建立 VM | GCP Compute Engine API - instances.insert |
| 啟動 VM | GCP Compute Engine API - instances.start |
| 停止 VM | GCP Compute Engine API - instances.stop |
| 刪除 VM | GCP Compute Engine API - instances.delete |

---

## 5. Claude Code 整合

### 運行模式
| 項目 | 規格 |
|------|------|
| 模式 | CLI 互動模式 |
| 介面 | 透過 pseudo-terminal (pty) 執行 |
| 安裝 | 預裝於 VM 映像中 |

### 對話管理
| 項目 | 規格 |
|------|------|
| 對話儲存 | 使用 Claude Code 原生對話儲存 |
| 對話位置 | VM 內 `~/.claude/` 目錄 |
| 多對話隔離 | 每個 session 使用獨立的 `--session-id` |

### VM 內通訊代理
| 項目 | 規格 |
|------|------|
| 名稱 | claude-agent |
| 語言 | Python |
| 功能 | 接收 Gateway 請求、執行 Claude Code、回傳結果 |
| 通訊方式 | HTTP（VM 內部 port）|
| Port | 8080 |

---

## 6. 開發環境

### 建立流程

```
用戶：「幫我開發 github.com/user/repo」
        │
        ▼
總機 Claude 透過 GitHub API 讀取 repo 的 Dockerfile
        │
        ▼
計算 Dockerfile hash，檢查 image 是否存在
        │
        ├─── 存在 → 直接建立 VM
        │
        └─── 不存在 → Cloud Build 建置 → 建立 VM
                │
                ▼
        VM 啟動，執行 Docker container
                │
                ▼
        綁定 channel ↔ VM
                │
                ▼
        VM 內 Claude Code 接手：
          - git clone repo
          - 執行專案初始化（npm install 等）
          - 回報用戶環境已就緒
```

### 職責分離

| 項目 | 負責者 |
|------|--------|
| 讀取 Dockerfile | 總機 Claude（透過 GitHub API） |
| 建置 Docker image | Build Service |
| 建立/管理 VM | VM Manager |
| Git clone/pull/push | VM 內 Claude Code |
| 專案初始化 | VM 內 Claude Code |
| 程式碼開發 | VM 內 Claude Code |

### Dockerfile 設定檔

檔案名稱：`Dockerfile`（放置於 repo 根目錄）

```dockerfile
# Dockerfile 範例
FROM ubuntu:22.04

# 系統工具
RUN apt-get update && apt-get install -y \
    git curl wget vim tmux \
    build-essential

# Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Python
RUN apt-get install -y python3.11 python3-pip

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# 工作目錄
WORKDIR /workspace
```

### 無 Dockerfile 時的處理
| 情況 | 處理方式 |
|------|----------|
| repo 無 Dockerfile | 使用預設基礎 image |
| Dockerfile 格式錯誤 | 回報錯誤，由 Claude Code 協助修正 |

### 預設基礎 Image
| 項目 | 規格 |
|------|------|
| 基礎 | Ubuntu 22.04 LTS |
| 預裝工具 | git, curl, wget, vim, tmux |
| Node.js | 20 LTS |
| Python | 3.11 |
| Claude Code | 最新版本 |

### Git 操作（由 Claude Code 處理）
| 操作 | 說明 |
|------|------|
| Clone | `git clone` 到 `/workspace` |
| 認證 | 透過用戶提供的 GitHub token 或 SSH key |
| 所有 git 操作 | commit, push, pull, branch, PR 等皆由 Claude Code 執行 |

---

## 6.1 Web UI（設定頁面）

### 用途
- 用戶登入 Anthropic 帳號（使用訂閱額度）
- 用戶授權 GitHub（OAuth flow）
- 查看/管理開發環境列表

### 技術選擇
| 項目 | 規格 |
|------|------|
| 框架 | Next.js 或 純前端 SPA |
| 部署 | GCP Cloud Run 或 Firebase Hosting |
| 認證 | Telegram Login Widget |

### 頁面
| 頁面 | 功能 |
|------|------|
| `/login` | Telegram 登入 |
| `/anthropic/auth` | Anthropic 帳號 OAuth 登入 |
| `/github/auth` | GitHub OAuth 授權 |
| `/environments` | 查看/管理開發環境 |

### 計費方式
| 項目 | 規格 |
|------|------|
| 方式 | 使用用戶的 Anthropic 訂閱額度（Claude Pro/Team） |
| 認證 | 用戶透過 Claude Code CLI 取得 OAuth Token |
| 環境變數 | `CLAUDE_CODE_OAUTH_TOKEN` |
| Token 格式 | `sk-ant-oat01-...` |
| 儲存 | Token 加密後存入 Firestore |

### 用戶取得 Token 步驟

```
1. 用戶在自己的電腦安裝 Claude Code
   $ npm install -g @anthropic-ai/claude-code

2. 登入 Claude Code（若尚未登入）
   $ claude /login
   → 開啟瀏覽器完成 Anthropic 帳號登入

3. 取得 OAuth Token
   $ claude setup-token
   → 顯示 Token（格式：sk-ant-oat01-...）

4. 複製 Token，貼到 CloudClaude 設定頁面
```

### 設定流程
```
用戶首次使用 CloudClaude
        │
        ▼
總機提示需要設定，提供設定頁面連結
        │
        ▼
用戶點擊連結 → 開啟 Web UI
        │
        ▼
用戶透過 Telegram Login 登入（識別身份）
        │
        ▼
用戶貼上 Claude Code OAuth Token
（頁面顯示取得 Token 的步驟說明）
        │
        ▼
用戶點擊「授權 GitHub」→ OAuth 授權
        │
        ▼
設定完成，返回 Telegram 繼續對話
```

### Token 使用方式（系統內部）

每個用戶使用獨立的 Container，確保 Token 隔離：

```
用戶訊息進入
        │
        ▼
Router 檢查用戶是否有專屬 Container
        │
        ├─ 無 Container
        │       │
        │       ▼
        │   從 Firestore 取得用戶的 OAuth Token
        │       │
        │       ▼
        │   建立用戶專屬 Container
        │   （注入 CLAUDE_CODE_OAUTH_TOKEN 環境變數）
        │       │
        │       ▼
        │   註冊 Container 到用戶對應表
        │
        └─ 有 Container
                │
                ▼
        轉發訊息到用戶的 Container
                │
                ▼
        Container 內 Agent SDK 處理請求
```

### 用戶 Container 管理

| 項目 | 規格 |
|------|------|
| 啟動時機 | 用戶首次發送訊息時 |
| Token 注入 | 建立 Container 時透過環境變數注入 |
| 閒置銷毀 | 無活動超過 30 分鐘後銷毀 |
| 重新建立 | 下次請求時自動重建 |

### Container vs VM

| 層級 | 用途 | Token |
|------|------|-------|
| 用戶 Container（總機） | 處理一般對話、環境管理 | 用戶的 OAuth Token |
| 開發環境 VM | 處理開發任務 | 用戶的 OAuth Token |

### 用戶 Container 規格

| 項目 | 規格 |
|------|------|
| 基礎 Image | python:3.11-slim |
| Agent SDK | claude-agent-sdk (Python 版) |
| 記憶體限制 | 512MB |
| 預估每台 VM 可跑 | 15-20 個 Container |

### Agent SDK 使用範例
```python
from claude_agent_sdk import query
import os

# Token 透過環境變數注入
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

async for message in query(prompt="用戶的訊息"):
    if message.type == "assistant":
        # 回傳給用戶
        send_to_telegram(message.content)
```

### 用戶需求
- 用戶需有 Anthropic 訂閱（Claude Pro $20/月 或 Team 方案）
- 用戶需安裝 Claude Code CLI 以取得 Token
- 用戶需有 GitHub 帳號

---

## 7. 安全性

### 認證機制
| 項目 | 規格 |
|------|------|
| 用戶識別 | Telegram user_id |
| VM 存取控制 | 僅 owner 可操作 VM |
| API 認證 | Telegram webhook secret token 驗證 |

### 網路安全
| 項目 | 規格 |
|------|------|
| VM 防火牆 | 僅開放 SSH (22) 及 claude-agent port (8080) |
| 來源限制 | 8080 port 僅允許 Cloud Run 服務 IP |
| SSH 存取 | 僅限 GCP IAP tunnel |

---

## 8. 使用者指令

### 開發環境指令
| 指令 | 說明 |
|------|------|
| `/newenv [repo_url]` | 根據 repo 建立新的開發環境（VM） |
| `/listenv` | 列出所有開發環境 |
| `/switchenv [name]` | 切換到指定開發環境 |
| `/stopenv` | 停止當前開發環境 |
| `/deleteenv [name]` | 刪除指定開發環境 |

### 對話管理指令
| 指令 | 說明 |
|------|------|
| `/newsession` | 在當前環境建立新對話 |
| `/clearsession` | 清除當前對話記錄 |

### 專案管理指令
| 指令 | 說明 |
|------|------|
| `/addrepo [repo_url]` | 在當前 VM 新增 clone 另一個 repo |
| `/project [path]` | 切換工作目錄到指定專案 |

---

## 9. 訊息格式

### 輸入處理
- 純文字：直接傳送給 Claude Code
- 指令（以 `/` 開頭）：由 Gateway 處理
- 檔案：上傳至 VM 工作目錄

### 輸出格式
| 類型 | 處理方式 |
|------|----------|
| 文字回應 | 直接傳送，超過 4096 字元分段 |
| 程式碼 | 使用 Markdown code block 格式 |
| 檔案產出 | 以 document 形式傳送 |
| PR 連結 | 嵌入 GitHub PR URL |

### Streaming 實作
| 項目 | 規格 |
|------|------|
| 更新頻率 | 每 500ms 或每 100 字元 |
| 方式 | editMessageText API |
| 完成標記 | 訊息結尾加上 ✓ |

---

## 10. 錯誤處理

| 錯誤情境 | 處理方式 |
|----------|----------|
| VM 啟動中 | 回覆「VM 正在啟動，請稍候...」並顯示進度 |
| VM 啟動失敗 | 回覆錯誤訊息，提供重試指令 |
| Claude Code 逾時 | 回覆部分結果並提示繼續 |
| 網路錯誤 | 自動重試 3 次，失敗後回報 |
| 無對應 VM | 提示使用者建立或選擇 VM |
