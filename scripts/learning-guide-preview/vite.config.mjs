import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../..');
const replaced = new Set([
  'AuthContext', 'services/workflow', 'services/reviews', 'services/learningSessions',
  'services/courses', 'services/preparation', 'services/summaries', 'services/quizSets',
  'services/materials', 'services/summaryChats', 'services/agent',
].map(name => path.join(repo, 'src', name)));

export default defineConfig({
  root,
  publicDir: path.join(repo, 'public'),
  plugins: [{
    name: 'guide-local-data',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return;
      const target = path.resolve(path.dirname(importer.split('?')[0]), source).replace(/\.[cm]?[jt]sx?$/, '');
      if (replaced.has(target)) return path.join(root, 'src/mock-services.mjs');
      if (target === path.join(repo, 'src/pages/ReviewNotes')) return path.join(root, 'src/UnusedReviewNotes.tsx');
    },
  }, react(), tailwindcss()],
  define: { __BUILD_ID__: JSON.stringify('learning-guide') },
  server: { host: '127.0.0.1', port: 5177, strictPort: true, fs: { allow: [repo] } },
});
