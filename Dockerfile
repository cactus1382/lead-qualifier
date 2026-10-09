FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 3010
CMD ["node", "src/index.js"]
