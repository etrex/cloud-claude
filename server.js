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

  // 取最後一個 event 作為主事件（使用其 replyToken）
  const lastEvent = events[events.length - 1];

  // 合併所有文字訊息
  const combinedText = events
    .filter(e => e.message.type === 'text')
    .map(e => e.message.text)
    .join('\n');

  // 若有圖片，以第一張圖片為主
  const imageEvent = events.find(e => e.message.type === 'image');
  const primaryMsgType = imageEvent ? 'image' : 'text';
  const primaryMessageId = imageEvent ? imageEvent.message.id : lastEvent.message.id;

  const mergedEvent = {
    ...lastEvent,
    message: {
      ...lastEvent.message,
      type: primaryMsgType,
      id: primaryMessageId,
      text: combinedText,
    },
  };

  runOnCodespace(mergedEvent);
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

function runOnCodespace(event) {
  if (event.type !== 'message') return;
  const msgType = event.message.type;
  if (msgType !== 'text' && msgType !== 'image') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const messageId = event.message.id;
  const text = msgType === 'text' ? event.message.text : '';
  const quotedMessageId = event.message.quotedMessageId || '';
  const codespaceName = process.env.CODESPACE_NAME;

  if (!codespaceName) {
    console.error('CODESPACE_NAME not set');
    return;
  }

  const allowWrite = isAllowed(event) ? '1' : '0';
  const src = event.source;
  const chatId = src.groupId || src.roomId || src.userId;
  console.log(`[codespace] userId=${userId} chatId=${chatId} allowWrite=${allowWrite} text=${text}`);

  // 顯示 loading 動畫並持續更新直到回應完成（僅限 1 對 1 聊天）
  let loadingInterval = null;
  if (event.source.type === 'user') {
    const keepLoading = () => {
      lineClient.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {});
    };
    keepLoading();
    loadingInterval = setInterval(keepLoading, 55000);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const child = spawn('gh', [
    'codespace', 'ssh',
    '-c', codespaceName,
    '--',
    `ANTHROPIC_API_KEY=${apiKey} /workspaces/cloud-claude/run-claude.sh ${shellEscape(userId)} ${shellEscape(messageId)} ${shellEscape(text)} ${shellEscape(quotedMessageId)} ${allowWrite} ${shellEscape(msgType)} ${shellEscape(chatId)} ${shellEscape(replyToken)}`,
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

    try {
      await lineClient.replyMessage({ replyToken, messages });
      console.log('[codespace] replied via reply API');
    } catch (replyErr) {
      console.warn('[codespace] reply failed, fallback to push:', replyErr.message);
      try {
        await lineClient.pushMessage({ to: userId, messages });
        console.log('[codespace] replied via push API');
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
