'use strict';

const express = require('express');
const { middleware, validateSignature } = require('@line/bot-sdk');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

// Health check endpoint (Cloud Run 需要)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'cloud-claude-line-bot' });
});

// LINE webhook endpoint
// 使用 express.raw() 取得原始 body 以便簽章驗證
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-line-signature'];

  // 驗證 LINE 簽章
  if (!lineConfig.channelSecret) {
    console.error('LINE_CHANNEL_SECRET is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!validateSignature(req.body, lineConfig.channelSecret, signature)) {
    console.warn('Invalid LINE signature, ignoring request');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // 解析 body
  const body = JSON.parse(req.body.toString());

  console.log('Received LINE webhook:');
  console.log(JSON.stringify(body, null, 2));

  // 處理每個 event
  body.events.forEach((event) => {
    logEvent(event);
  });

  // 回傳 200 OK（LINE 要求在 timeout 前必須回應）
  res.status(200).json({ received: body.events.length });
});

function logEvent(event) {
  const { type, source, timestamp } = event;
  const time = new Date(timestamp).toISOString();

  console.log(`[${time}] Event type: ${type}`);
  console.log(`  Source: ${source.type} / userId: ${source.userId || 'N/A'}`);

  if (source.type === 'group') {
    console.log(`  groupId: ${source.groupId}`);
  } else if (source.type === 'room') {
    console.log(`  roomId: ${source.roomId}`);
  }

  if (type === 'message') {
    const { message } = event;
    console.log(`  Message type: ${message.type}`);
    if (message.type === 'text') {
      console.log(`  Text: ${message.text}`);
    }
  } else if (type === 'follow') {
    console.log('  User followed the bot');
  } else if (type === 'unfollow') {
    console.log('  User unfollowed the bot');
  } else if (type === 'join') {
    console.log('  Bot joined a group/room');
  } else if (type === 'leave') {
    console.log('  Bot left a group/room');
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LINE Bot server running on port ${PORT}`);
  console.log(`LINE_CHANNEL_SECRET: ${lineConfig.channelSecret ? 'SET' : 'NOT SET (required)'}`);
});
