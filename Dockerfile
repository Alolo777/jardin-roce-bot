# 1. Usar la imagen oficial que ya trae Linux y Chrome instalados
FROM ghcr.io/puppeteer/puppeteer:latest

# 2. Permisos de administrador
USER root

# 3. Carpeta de trabajo
WORKDIR /app

# 4. Copiar e instalar dependencias
COPY package*.json ./
RUN npm install

# 5. Copiar el resto del código del bot
COPY . .

# 6. Exponer el puerto para que Render sepa que estamos vivos
EXPOSE 3000

# 7. El comando de arranque
CMD ["npx", "tsx", "bot.ts"]