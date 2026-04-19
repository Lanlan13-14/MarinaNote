FROM node:18-alpine
WORKDIR /app

# 安装依赖（不使用 lock 文件）
COPY server/package.json ./server/
RUN cd server && npm install --production

# 复制服务端与静态文件（镜像内不包含 uploads 内容）
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]