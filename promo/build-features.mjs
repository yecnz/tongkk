// Bundle real application screens against isolated, in-memory sample services.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { learningAliases, learningPlugins } from './feature-demo/learning-aliases.mjs';
import { planningAliases, planningPlugins } from './feature-demo/planning-aliases.mjs';
import { integrationAliases, integrationPlugins } from './feature-demo/integrations-aliases.mjs';
const promo = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(promo);
const normalize = value => value.replaceAll('\\', '/');
const aliases = new Map(Object.entries({
  ...Object.fromEntries([
    ...['AuthContext.tsx', 'AuthGateContext.tsx', 'TutorialContext.tsx', 'SampleDemoContext.tsx'].map(name => [name, 'shared-context.tsx']),
    ['services/courses.ts', 'shared-courses.ts'], ['services/materials.ts', 'shared-materials.ts'],
    ['services/profile.ts', 'shared-profile.ts'], ['services/quizSets.ts', 'shared-content.ts'],
    ['services/summaries.ts', 'shared-content.ts'], ['services/workflow.ts', 'shared-workflow.ts'],
    ...['backend.ts', 'supabase.ts', 'documentPreview.ts'].map(name => [`services/${name}`, 'shared-network.ts']),
  ].map(([source, replacement]) => [path.join(root, 'src', source), path.join(promo, 'feature-demo', replacement)])),
  ...learningAliases, ...planningAliases, ...integrationAliases,
}).map(([key, value]) => [normalize(key), value]));

await build({
  configFile: false, root, publicDir: false,
  plugins: [
    { name: 'promo-feature-service-isolation', enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.startsWith('.')) return;
        const resolved = normalize(path.resolve(path.dirname(importer), source));
        for (const candidate of [resolved, resolved + '.ts', resolved + '.tsx']) if (aliases.has(candidate)) return aliases.get(candidate);
      },
      transform(code, id) {
        if (normalize(id).endsWith('/src/features/sources/SourcePage.tsx')) {
          // Sample source material is text; do not package or fetch a PDF worker.
          return code.replace("import { PdfViewer } from '../../components/PdfViewer';", 'const PdfViewer = () => null;');
        }
        if (normalize(id).endsWith('/katex/dist/katex.min.css')) return code.replace(/src:(url\([^)]*\.woff2\) format\("woff2"\))[^}]+/g, 'src:$1');
      },
      generateBundle: { order: 'post', async handler(_options, bundle) {
        // Library builds inline assets by default. Share fonts/images between the
        // nine frames instead of repeating large data URLs in every document.
        const assets = new Map();
        for (const output of Object.values(bundle)) {
          const source = output.type === 'chunk' ? output.code : output.fileName.endsWith('.css') ? Buffer.from(output.source).toString('utf8') : null;
          if (!source) continue;
          let result = source.replace(/data:((?:image|font|application)\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g, (url, mime, base64) => {
            const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'font/woff2': 'woff2', 'font/woff': 'woff', 'application/font-woff': 'woff', 'application/font-woff2': 'woff2' })[mime];
            if (!extension) return url;
            const bytes = Buffer.from(base64, 'base64');
            const name = `assets/features/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`;
            assets.set(name, bytes);
            return './' + name;
          });
          if (output.fileName.endsWith('.css')) {
            const faces = new Set();
            result = result.replace(/@font-face\{[^}]+\}/g, rule => { if (faces.has(rule)) return ''; faces.add(rule); return rule; });
          }
          if (output.type === 'chunk') output.code = result; else output.source = result;
        }
        for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
        const packages = new Set();
        for (const id of this.getModuleIds()) { const match = normalize(id).match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/); if (match) packages.add(match[1]); }
        const notices = [];
        for (const name of [...packages].sort()) for (const filename of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','license.txt']) {
          try { notices.push(`--- ${name} ---\n${await readFile(path.join(root, 'node_modules', name, filename), 'utf8')}`); break; } catch { /* Package license filename differs. */ }
        }
        this.emitFile({ type: 'asset', fileName: 'features-third-party-notices.txt', source: notices.join('\n\n') });
      } },
    },
    ...learningPlugins, ...planningPlugins, ...integrationPlugins, react(), tailwind(),
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir: promo, emptyOutDir: false, copyPublicDir: false, assetsInlineLimit: Infinity, cssCodeSplit: false, minify: true,
    lib: { entry: path.join(promo, 'features-source.tsx'), name: 'TongkkFeatureExamples', formats: ['iife'], fileName: () => 'features.js', cssFileName: 'features' },
  },
});
