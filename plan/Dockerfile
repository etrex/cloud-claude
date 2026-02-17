FROM node:20-slim

WORKDIR /app

# 先複製 package.json 利用 Docker layer cache
COPY package*.json ./
RUN npm ci --only=production

# 複製原始碼
COPY server.js ./

# Cloud Run 使用 PORT 環境變數（預設 8080）
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
