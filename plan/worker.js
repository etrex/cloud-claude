'use strict';

const express = require('express');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { messagingApi } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'cloud-claude-worker' });
});

app.post('/task', async (req, res) => {
  const event = req.body;

  // 立刻回應 Heroku，避免 timeout
  res.status(200).json({ received: true });

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text;

  console.log(`[task] userId=${userId} text=${text}`);

  try {
    const responseText = await runClaude(text);
    await lineClient.pushMessage({
      to: userId,
      messages: [{ type: 'text', text: responseText }],
    });
    console.log(`[task] replied to ${userId}`);
  } catch (err) {
    console.error('[task] error:', err.message);
  }
});

async function runClaude(prompt) {
  let result = '';

  for await (const message of query({ prompt })) {
    console.log('[claude] message type:', message.type);

    // 收集 assistant 的文字內容
    if (message.type === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          result += block.text;
        }
      }
    }

    // 有些 SDK 版本用 result 型別
    if (message.type === 'result' && message.result) {
      result = message.result;
    }
  }

  return result || '（無回應）';
}

const PORT = process.env.WORKER_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Worker running on port ${PORT}`);
  console.log(`LINE_CHANNEL_ACCESS_TOKEN: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? 'SET' : 'NOT SET'}`);
});
