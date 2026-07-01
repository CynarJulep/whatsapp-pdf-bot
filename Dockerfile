# Debian slim: Playwright/Chromium no funciona bien en Alpine
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Dependencias del navegador para automatización SAC
RUN npx playwright install-deps chromium \
    && npx playwright install chromium

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "index.js"]
