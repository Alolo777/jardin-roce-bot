FROM node:22-bullseye-slim

# Solo dependencias mínimas de Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# npm ci es más rápido y reproducible que npm install
RUN npm ci

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Limitar Node.js a 380MB para que el OS no lo mate sin aviso
ENV NODE_OPTIONS="--max-old-space-size=380"

EXPOSE 10000

# --expose-gc permite llamar global.gc() manualmente si es necesario
CMD ["node", "--expose-gc", "-r", "tsx/cjs", "bot.ts"]