# Use lightweight alpine Node image
FROM node:20-alpine

# Install git (required for resolving Baileys dependency from GitHub master branch)
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy remaining code files
COPY . .

# Hugging Face Spaces routes traffic through port 7860
EXPOSE 7860
ENV PORT=7860

# Run Express server
CMD ["node", "index.js"]
