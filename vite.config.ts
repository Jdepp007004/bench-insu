import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow/')) return 'workflow-graph';
          if (id.includes('node_modules/@supabase/')) return 'supabase-client';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/node_modules.incomplete/**', '**/dist/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'],
  },
});
