FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/* && npm install --omit=dev
ENV BROWSER_EXECUTABLE=/usr/bin/chromium
ENV HOST=0.0.0.0 PORT=4317 DATA_DIR=/data ENABLE_DEMO=false NODE_ENV=production
EXPOSE 4317
VOLUME ["/data"]
CMD ["node", "server/index.js"]
