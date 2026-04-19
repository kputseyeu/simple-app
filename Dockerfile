FROM node:18 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

FROM node:18-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
