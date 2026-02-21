'use strict';

const express = require('express');
const { spawn } = require('child_process');
const { validateSignature, messagingApi } = require('@line/bot-sdk');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

let botUserId = null;
lineClient.getBotInfo().then(info => {
  botUserId = info.userId;
  console.log(`Bot userId: ${botUserId}`);
}).catch(err => console.error('getBotInfo failed:', err.message));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'cloud-claude-line-bot' });
});

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!lineConfig.channelSecret) {
    console.error('LINE_CHANNEL_SECRET is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!validateSignature(req.body, lineConfig.channelSecret, signature)) {
    console.warn('Invalid LINE signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const body = JSON.parse(req.body.toString());
  console.log('Received webhook:', JSON.stringify(body, null, 2));

  res.status(200).json({ received: body.events.length });

  body.events.forEach((event) => {
    enqueueEvent(event);
  });
});

// 訊息緩衝區：chatId -> { events: [], timer: null }
const messageBuffers = new Map();
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || '3000', 10);

// 已見過的 messageId，防止 LINE 重送時重複處理
const seenMessageIds = new Map(); // messageId -> timestamp
const SEEN_TTL_MS = 5 * 60 * 1000; // 5 分鐘後清除

function enqueueEvent(event) {
  if (event.type !== 'message') return;
  const msgType = event.message.type;
  if (msgType !== 'text' && msgType !== 'image') return;

  const messageId = event.message.id;

  // 忽略已見過的 messageId（防止 LINE 重送重複處理）
  if (seenMessageIds.has(messageId)) {
    console.log(`[debounce] duplicate messageId=${messageId}, ignoring`);
    return;
  }
  seenMessageIds.set(messageId, Date.now());

  // 清除過期的 messageId 紀錄
  const now = Date.now();
  for (const [id, ts] of seenMessageIds) {
    if (now - ts > SEEN_TTL_MS) seenMessageIds.delete(id);
  }

  const src = event.source;
  const chatId = src.groupId || src.roomId || src.userId;

  // where/here 指令：直接回覆 chatId，不進佇列、不呼叫 Claude
  if (msgType === 'text' && ['where', 'here'].includes(event.message.text.trim()) && event.replyToken) {
    lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `Chat ID: ${chatId}` }],
    }).catch(() => {});
    return;
  }

  if (!messageBuffers.has(chatId)) {
    messageBuffers.set(chatId, { events: [], timer: null });
  }

  const buffer = messageBuffers.get(chatId);
  buffer.events.push(event);
  console.log(`[debounce] chatId=${chatId} buffered ${buffer.events.length} event(s)`);

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(() => {
    const events = buffer.events;
    messageBuffers.delete(chatId);
    flushBuffer(chatId, events);
  }, DEBOUNCE_MS);
}

function flushBuffer(chatId, events) {
  if (events.length === 0) return;
  console.log(`[debounce] chatId=${chatId} flushing ${events.length} event(s)`);
  runOnCodespace(events);
}

function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

const allowedIds = new Set(
  (process.env.ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const projectMap = new Map([
  ['Caad35ad92eb67f8f62d3e70f78632a7c', '/workspaces/airport-gogo'],
  ['Uefa877a60cb3ed8e0d28b1b6263f549e', '/workspaces/cloud-claude'],
]);

function isAllowed(event) {
  const src = event.source;
  if (src.groupId && allowedIds.has(src.groupId)) return true;
  if (src.roomId && allowedIds.has(src.roomId)) return true;
  if (src.userId && allowedIds.has(src.userId)) return true;
  return false;
}

function getWorkDir(event) {
  const src = event.source;
  for (const id of [src.groupId, src.roomId, src.userId]) {
    if (id && projectMap.has(id)) return projectMap.get(id);
  }
  return null;
}

function runOnCodespace(events) {
  // 過濾只保留 text 和 image 訊息
  events = events.filter(e => e.type === 'message' && (e.message.type === 'text' || e.message.type === 'image'));
  if (events.length === 0) return;

  const firstEvent = events[0];
  const src = firstEvent.source;
  const userId = src.userId;
  const chatId = src.groupId || src.roomId || src.userId;
  const allowWrite = isAllowed(firstEvent) ? '1' : '0';

  const codespaceName = process.env.CODESPACE_NAME;
  if (!codespaceName) {
    console.error('CODESPACE_NAME not set');
    return;
  }

  console.log(`[codespace] userId=${userId} chatId=${chatId} allowWrite=${allowWrite} events=${events.length}`);

  // 顯示 loading 動畫（僅限 1 對 1 聊天，啟動一次即可）
  if (firstEvent.source.type === 'user') {
    const keepLoading = () => {
      lineClient.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {});
    };
    keepLoading();
    const loadingInterval = setInterval(keepLoading, 55000);
    // 60 秒後自動停止（run-claude.sh 的佇列最長約 30 秒）
    setTimeout(() => clearInterval(loadingInterval), 60000);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const workDir = getWorkDir(firstEvent);
  if (!workDir) {
    const sourceType = firstEvent.source.type;
    if (sourceType === 'user') {
      // 私訊：直接回覆罐頭訊息
      const replyEvent = events.find(e => e.replyToken);
      if (replyEvent) {
        lineClient.replyMessage({
          replyToken: replyEvent.replyToken,
          messages: [{ type: 'text', text: '你目前不在白名單內，無法使用此服務。' }],
        }).catch(() => {});
      }
    } else {
      // 群組：只有 mention bot 才回覆罐頭訊息
      const mentionEvent = events.find(e =>
        e.message.type === 'text' &&
        e.message.mention?.mentionees?.some(m => m.type === 'user' && m.userId === botUserId)
      );
      if (mentionEvent && mentionEvent.replyToken) {
        lineClient.replyMessage({
          replyToken: mentionEvent.replyToken,
          messages: [{ type: 'text', text: '你目前不在白名單內，無法使用此服務。' }],
        }).catch(() => {});
      }
    }
    return;
  }

  // 每個 event 個別呼叫 run-claude.sh
  // run-claude.sh 內建 30 秒 sliding window 佇列，會自動合併所有訊息後統一呼叫 Claude
  // 這樣每張圖片都會被正確下載並加入佇列
  for (const event of events) {
    const msgType = event.message.type;
    const messageId = event.message.id;
    const text = msgType === 'text' ? event.message.text : '';
    const quotedMessageId = event.message.quotedMessageId || '';
    const replyToken = event.replyToken || '';

    console.log(`[codespace] enqueue msgType=${msgType} messageId=${messageId} workDir=${workDir}`);

    const child = spawn('gh', [
      'codespace', 'ssh',
      '-c', codespaceName,
      '--',
      `ANTHROPIC_API_KEY=${apiKey} /workspaces/cloud-claude/run-claude.sh ${shellEscape(userId)} ${shellEscape(messageId)} ${shellEscape(text)} ${shellEscape(quotedMessageId)} ${allowWrite} ${shellEscape(msgType)} ${shellEscape(chatId)} ${shellEscape(replyToken)} ${shellEscape(workDir)}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => console.error('[codespace] spawn error:', err.message));
    child.on('close', (code) => {
      if (code !== 0) console.error(`[codespace] exit ${code} stderr: ${stderr}`);
    });
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LINE Bot server running on port ${PORT}`);
  console.log(`CODESPACE_NAME: ${process.env.CODESPACE_NAME || 'NOT SET'}`);
});
