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

function enqueueEvent(event) {
  if (event.type !== 'message') return;
  const msgType = event.message.type;
  if (msgType !== 'text' && msgType !== 'image') return;

  const src = event.source;
  const chatId = src.groupId || src.roomId || src.userId;

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

function isAllowed(event) {
  const src = event.source;
  if (src.groupId && allowedIds.has(src.groupId)) return true;
  if (src.roomId && allowedIds.has(src.roomId)) return true;
  if (src.userId && allowedIds.has(src.userId)) return true;
  return false;
}

function runOnCodespace(events) {
  // 過濾只保留 text 和 image 訊息
  events = events.filter(e => e.type === 'message' && (e.message.type === 'text' || e.message.type === 'image'));
  if (events.length === 0) return;

  // 從第一個 event 取得 source 資訊（同一 chatId 的 events source 相同）
  const firstEvent = events[0];
  const userId = firstEvent.source.userId;
  const src = firstEvent.source;
  const chatId = src.groupId || src.roomId || src.userId;
  const allowWrite = isAllowed(firstEvent) ? '1' : '0';

  // 按順序收集所有 reply tokens（第一個最早過期，優先使用）
  const allReplyTokens = events.map(e => e.replyToken).filter(Boolean);

  // 完整合併所有文字訊息（按傳送順序）
  const combinedText = events
    .filter(e => e.message.type === 'text')
    .map(e => e.message.text)
    .join('\n');

  // 圖片：依傳送順序取第一張
  const imageEvent = events.find(e => e.message.type === 'image');
  const msgType = imageEvent ? 'image' : 'text';
  const messageId = imageEvent ? imageEvent.message.id : firstEvent.message.id;
  const quotedMessageId = firstEvent.message.quotedMessageId || '';

  const codespaceName = process.env.CODESPACE_NAME;
  if (!codespaceName) {
    console.error('CODESPACE_NAME not set');
    return;
  }

  console.log(`[codespace] userId=${userId} chatId=${chatId} allowWrite=${allowWrite} events=${events.length} text=${combinedText.slice(0, 50)}`);

  // 顯示 loading 動畫並持續更新直到回應完成（僅限 1 對 1 聊天）
  let loadingInterval = null;
  if (firstEvent.source.type === 'user') {
    const keepLoading = () => {
      lineClient.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {});
    };
    keepLoading();
    loadingInterval = setInterval(keepLoading, 55000);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const firstReplyToken = allReplyTokens[0] || '';
  const child = spawn('gh', [
    'codespace', 'ssh',
    '-c', codespaceName,
    '--',
    `ANTHROPIC_API_KEY=${apiKey} /workspaces/cloud-claude/run-claude.sh ${shellEscape(userId)} ${shellEscape(messageId)} ${shellEscape(combinedText)} ${shellEscape(quotedMessageId)} ${allowWrite} ${shellEscape(msgType)} ${shellEscape(chatId)} ${shellEscape(firstReplyToken)}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  child.on('error', (err) => {
    console.error('[codespace] spawn error:', err.message);
  });

  child.on('close', async (code) => {
    if (loadingInterval) clearInterval(loadingInterval);
    console.log(`[codespace] exit code: ${code}`);
    if (stderr) console.log(`[codespace] stderr: ${stderr}`);

    if (code !== 0) return;

    const response = stdout.trim();
    console.log(`[codespace] response: ${response.slice(0, 80)}`);

    if (response === '__QUEUED__') {
      console.log('[codespace] message queued, no reply sent');
      return;
    }

    const chunks = [];
    const CHUNK_SIZE = 2000;
    const MAX_CHUNKS = 5;
    for (let i = 0; i < response.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
      chunks.push(response.slice(i, i + CHUNK_SIZE));
    }
    const messages = (chunks.length > 0 ? chunks : ['（無回應）']).map(t => ({ type: 'text', text: t }));

    // 按順序嘗試所有 reply tokens（第一個最早過期，優先使用）
    let replied = false;
    for (const token of allReplyTokens) {
      try {
        await lineClient.replyMessage({ replyToken: token, messages });
        console.log(`[codespace] replied via reply API (token: ${token.slice(0, 8)}...)`);
        replied = true;
        break;
      } catch (err) {
        console.warn(`[codespace] reply token failed: ${err.message}, trying next...`);
      }
    }
    if (!replied) {
      try {
        await lineClient.pushMessage({ to: userId, messages });
        console.log('[codespace] replied via push API (all reply tokens exhausted)');
      } catch (pushErr) {
        console.error('[codespace] push failed:', pushErr.message);
      }
    }
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LINE Bot server running on port ${PORT}`);
  console.log(`CODESPACE_NAME: ${process.env.CODESPACE_NAME || 'NOT SET'}`);
});
