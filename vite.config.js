import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('node_modules/socket.io-client')) return 'socket-io-client';
          if (id.includes('node_modules/socket.io')) return 'socket-io';
          if (id.includes('node_modules/react-dom')) return 'react-dom';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});


