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
    runOnCodespace(event);
  });
});

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
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const messageId = event.message.id;
  const text = event.message.text;
  const quotedMessageId = event.message.quotedMessageId || '';
  const codespaceName = process.env.CODESPACE_NAME;

  if (!codespaceName) {
    console.error('CODESPACE_NAME not set');
    return;
  }

  const allowWrite = isAllowed(event) ? '1' : '0';
  console.log(`[codespace] userId=${userId} allowWrite=${allowWrite} text=${text}`);

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
    `ANTHROPIC_API_KEY=${apiKey} /workspaces/cloud-claude/run-claude.sh ${shellEscape(userId)} ${shellEscape(messageId)} ${shellEscape(text)} ${shellEscape(quotedMessageId)} ${allowWrite}`,
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
    console.log(`[codespace] response length: ${response.length}`);

    const messages = [{ type: 'text', text: response || '（無回應）' }];

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
