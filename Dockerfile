# Playwright needs a Debian-based image (Alpine is not supported).
FROM node:20-bookworm-slim

WORKDIR /app

# System deps required by Chromium + Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Install app deps (production) then install Chromium for Playwright
RUN npm install --omit=dev \
    && npx playwright install chromium \
    && npx playwright install-deps chromium

COPY . .

# Render / HF inject PORT; bind to all interfaces in index.js
EXPOSE 7860
ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "index.js"]
