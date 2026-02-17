# 遠端開發主機省錢方案指南

## 需求摘要

- 遠端開發主機，不需要 24/7 運行
- 主流大廠服務
- 有流量 / 有需求時才啟動，閒置時不花錢（或極低成本）
- 希望自動化，不用手動開關機
- 需要保留開發狀態（Stateful）

---

## 方案總覽

| 方案 | 類型 | 閒置費用 | 適合場景 | 自動暫停/恢復 | 狀態保留 |
|---|---|---|---|---|---|
| GitHub Codespaces | 雲端開發環境 | ~$0.07/GB/月 | 日常遠端開發 | ✅ | ✅ |
| GCP Cloud Run | Serverless 容器 | $0 | LINE Bot / API 服務 | ✅ | ❌ |
| Oracle Cloud Free | 永久免費 VPS | $0 | 全能型開發機 | ❌ 需手動 | ✅ |
| GCP e2-micro | 免費 VPS | 磁碟 ~$1.2/月 | 輕量開發 | ❌ 需手動 | ✅ |
| AWS t4g.micro | VPS（首年免費） | 磁碟 ~$2.4/月 | 輕量開發 | ❌ 需手動 | ✅ |
| Heroku Eco | PaaS | 固定 $5/月 | 簡單 Web App | ✅ | ❌ |

---

## 方案一：GitHub Codespaces（遠端開發首選）

### 特點

- 閒置 30 分鐘自動暫停，暫停後只收儲存費
- 重新打開瀏覽器或 VS Code → 幾秒內恢復，檔案和環境全保留
- 本質是一台完整的 Linux 主機，可安裝任何工具（包含 Claude Code）

### 免費額度（個人帳號 / 月）

- **120 核心小時**（2 核機器可跑 60 小時，約每天 2 小時）
- **15GB 儲存**（可放 3-5 個中小型專案）

### 計費

| 狀態 | 2 核 / 8GB | 4 核 / 16GB |
|---|---|---|
| **運行中** | $0.18/hr | $0.36/hr |
| **暫停中** | $0.07/GB/月 | $0.07/GB/月 |

### 多專案使用方式

**方式 A：每個專案一個 Codespace（推薦）**

- 環境完全隔離，互不干擾
- 不用的自動暫停，只收儲存費

**方式 B：一個 Codespace 放多個專案**

```bash
cd /workspaces
git clone https://github.com/you/project-a
git clone https://github.com/you/project-b
```

- 省免費時數，但環境共用

### 安裝 Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

自動化設定（`.devcontainer/devcontainer.json`）：

```json
{
  "name": "My Dev Environment",
  "image": "mcr.microsoft.com/devcontainers/universal:2",
  "postCreateCommand": "npm install -g @anthropic-ai/claude-code",
  "secrets": {
    "ANTHROPIC_API_KEY": {
      "description": "Anthropic API Key for Claude Code"
    }
  }
}
```

> 將 `ANTHROPIC_API_KEY` 加到 GitHub Settings → Codespaces → Secrets，每次啟動自動注入。

### 最佳開發架構

```
你的筆電
  └─ VS Code（只負責顯示 UI）
       └─ Remote 連線到 Codespace
            ├─ 編輯器：VS Code 遠端模式
            ├─ Terminal：Claude Code 跑在這裡
            └─ 檔案：全在這裡
```

---

## 方案二：GCP Cloud Run（LINE Bot / API 服務首選）

### 特點

- 沒有請求時自動縮到 0 個實例，**費用 = $0**
- 有流量進來時幾秒內冷啟動
- 按 CPU 秒 + 記憶體秒 + 請求數計費
- Stateless（無法保留本機檔案）

### 免費額度（每月）

- 200 萬次請求
- 360,000 vCPU 秒（≈ 1 vCPU 跑 100 小時）
- 360,000 GiB 記憶體秒

### 部署方式

```bash
# 最簡單的方式，不需要自己寫 Dockerfile
gcloud run deploy my-service --source .
```

### 適用場景

- LINE Bot Webhook 接收端
- REST API 服務
- 任何可包成 Docker 的 Web 應用

---

## 方案三：Heroku Eco Dyno（最簡單的 PaaS）

### 特點

- 30 分鐘沒流量自動 sleep，有請求時自動喚醒
- 部署極簡：`git push heroku main`
- 不需要 Docker 知識

### 計費

- **固定 $5/月**（無論是否使用都要付）
- 1,000 dyno 小時 / 月，所有 Eco dyno 共享
- Stateless（重啟後本機檔案消失）

### 缺點

- 冷啟動較慢（5-10 秒），LINE webhook 可能 timeout
- 有 $5/月 低消，不如 Cloud Run 真正的 $0
- 無免費方案

---

## 方案四：Oracle Cloud Always Free（免費 VPS 天花板）

### 特點

- **永久免費**，不是試用期
- 4 OCPU ARM（Ampere A1）+ 24GB RAM + 200GB 儲存
- 每月 10TB 流量
- 完整 Linux 主機，安裝什麼都行

### 缺點

- 帳號申請有時被拒（地區限制）
- 熱門區域 ARM 實例常搶不到
- 不會自動暫停/恢復，需手動管理或自行設定排程

---

## 推薦組合：Codespaces + Cloud Run

最符合「省錢 + 自動化 + 有狀態」需求的架構：

```
LINE 傳訊息
  │
  ▼ webhook
GCP Cloud Run（免費，scale to zero，URL 固定）
  │
  ├─ 處理 LINE 訊息
  ├─ 透過 GitHub API 喚醒 Codespace
  └─ SSH 進 Codespace 執行 Claude Code
      │
      └─ 改完後 git commit + push
```

### 喚醒 Codespace API

```bash
# 啟動暫停中的 Codespace
gh api -X POST /user/codespaces/{name}/start

# SSH 進去跑指令
gh codespace ssh -c <name> -- "cd /workspaces/my-project && claude 'fix the bug'"
```

### 費用估算

| 元件 | 月費 |
|---|---|
| Cloud Run | $0（免費額度內） |
| Codespace（每天用 2hr） | $0（免費額度內） |
| Codespace 儲存（15GB 內） | $0（免費額度內） |
| Claude Code API | 依使用量 |
| **合計** | **接近 $0** |

---

## 快速決策指南

```
你需要什麼？
  │
  ├─ 遠端寫 code，檔案要保留 → GitHub Codespaces
  │
  ├─ 跑 LINE Bot / API 服務 → GCP Cloud Run
  │
  ├─ 免費完整 Linux 主機 → Oracle Cloud Free
  │
  └─ 最簡單部署，不想碰 Docker → Heroku Eco（$5/月）
```
