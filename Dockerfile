# 1. Usar la imagen base
FROM ghcr.io/puppeteer/puppeteer:latest

# 2. Permisos de administrador
USER root

# 3. Carpeta de trabajo
WORKDIR /app

# 4. Copiar e instalar dependencias
COPY package*.json ./
RUN npm install

# 5. EL PARCHE MÁGICO: Forzar la descarga de Chrome en la carpeta exacta que pide WhatsApp
RUN npx puppeteer browsers install chrome

# 6. Copiar el resto del código del bot
COPY . .

# 7. Exponer el puerto
EXPOSE 3000

# 8. El comando de arranque
CMD ["npx", "tsx", "bot.ts"]