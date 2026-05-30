# 1. Usar una imagen oficial de Node.js ligera
FROM node:20-bullseye-slim

# 2. Instalar Chromium nativo de Linux y sus dependencias gráficas
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Carpeta de trabajo
WORKDIR /app

# 4. Copiar e instalar dependencias
COPY package*.json ./
RUN npm install

# 5. Copiar el resto de tu código
COPY . .

# 6. Variables de entorno CLAVE para decirle a WhatsApp dónde está el navegador
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 7. Exponer el puerto
EXPOSE 3000

# 8. El comando de arranque
CMD ["npx", "tsx", "bot.ts"]