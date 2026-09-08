FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY server/ ./server/
COPY rooms/ ./rooms/
COPY src/ ./src/
EXPOSE 4000
CMD ["node", "server/socket.js"]
