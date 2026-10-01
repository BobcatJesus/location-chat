FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY index.html vite.config.js ./
COPY public/ ./public/
COPY server/ ./server/
COPY rooms/ ./rooms/
COPY src/ ./src/
COPY lib/ ./lib/
EXPOSE 4000
CMD ["node", "server/socket.js"]
