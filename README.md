# CloudClaude

把 Claude Code 帶到通訊軟體上，讓你隨時隨地都能操作程式碼。

## 解決的問題

**切換設備時，對話不中斷。**

使用 Claude Code CLI 時，對話綁定在單一終端機上。當你換一台電腦、或想用手機繼續操作時，就必須重新開始。

CloudClaude 透過通訊軟體作為介面，讓你在任何設備上都能延續同一個對話，持續與 Claude Code 互動。

## 概念

當你在通訊軟體上與 bot 對話時，webhook 會打到雲端 VM，VM 上擁有完整的開發環境和 GitHub repo，讓你可以在通訊軟體上執行程式碼相關指令。

## 功能

- 透過通訊軟體與 Claude Code 對話
- 執行程式碼相關指令（跑測試、lint、build 等）
- 操作 git（commit、push、pull 等）
- 存取雲端 VM 上的完整開發環境
- **切換設備時對話不中斷**

## 架構

```
通訊軟體（LINE、Slack、Discord、Telegram...）
     │
     ▼ webhook
┌─────────────────────────────────┐
│  雲端 VM                         │
│  ├── 完整開發環境                │
│  ├── GitHub repo（已 clone）     │
│  ├── Claude Code                 │
│  └── 可執行測試、lint、build     │
└─────────────────────────────────┘
```

## License

MIT

<!-- updated: 2026-02-20 -->
