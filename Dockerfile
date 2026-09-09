FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY index.html vite.config.js ./
COPY public/ ./public/
COPY server/ ./server/
COPY rooms/ ./rooms/
COPY src/ ./src/
RUN npm run build
EXPOSE 4000
CMD ["node", "server/socket.js"]
