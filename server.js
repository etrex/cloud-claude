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

function runOnCodespace(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text;
  const codespaceName = process.env.CODESPACE_NAME;

  if (!codespaceName) {
    console.error('CODESPACE_NAME not set');
    return;
  }

  console.log(`[codespace] userId=${userId} text=${text}`);

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const child = spawn('gh', [
    'codespace', 'ssh',
    '-c', codespaceName,
    '--',
    `ANTHROPIC_API_KEY=${apiKey} /home/codespace/nvm/current/bin/claude -p ${shellEscape(text)}`,
  ]);

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  child.on('close', async (code) => {
    console.log(`[codespace] exit code: ${code}`);
    if (stderr) console.log(`[codespace] stderr: ${stderr}`);

    if (code !== 0) return;

    const response = stdout.trim();
    console.log(`[codespace] response length: ${response.length}`);

    try {
      await lineClient.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: response || '（無回應）' }],
      });
    } catch (err) {
      console.error('[codespace] push failed:', err.message);
    }
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LINE Bot server running on port ${PORT}`);
  console.log(`CODESPACE_NAME: ${process.env.CODESPACE_NAME || 'NOT SET'}`);
});
