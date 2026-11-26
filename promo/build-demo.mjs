// Rebuild the standalone demo from the app's sample data and UI renderers.
// Run from the repository root: node promo/build-demo.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const promo = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(promo);
const markdownId = path.join(promo, '.actual-markdown.tsx');
const tutorMarkdownId = path.join(promo, '.actual-tutor-markdown.tsx');
const source = await readFile(path.join(root, 'src/components/SampleDemo.tsx'), 'utf8');
const markdownSource = [
  'import type { ReactNode } from "react";',
  'import ReactMarkdown, { type Components } from "react-markdown";',
  'import remarkGfm from "remark-gfm";',
  'import remarkMath from "remark-math";',
  'import rehypeKatex from "rehype-katex";',
  'import { normalizeBoldSpacing, escapeStrayMultiplication, normalizeMathDelimiters } from "../src/common";',
  source.slice(source.indexOf('function nodeText'), source.indexOf('type Tab =')),
  'export { Markdown };',
].join('\n');
const tutorSource = await readFile(path.join(root, 'src/components/AITutorDrawer.tsx'), 'utf8');
const tutorStart = tutorSource.indexOf('const markdownStyles =');
const tutorEnd = tutorSource.indexOf('const formatSessionDate =');
if (tutorStart < 0 || tutorEnd <= tutorStart) throw new Error('Actual tutor renderer boundaries have changed. Update the promo build extraction.');
const tutorMarkdownSource = [
  'import type { CSSProperties } from "react";',
  'import ReactMarkdown, { type Components } from "react-markdown";',
  'import remarkGfm from "remark-gfm";',
  'import remarkMath from "remark-math";',
  'import rehypeKatex from "rehype-katex";',
  'import { normalizeBoldSpacing, normalizeMathDelimiters, escapeStrayMultiplication } from "../src/common";',
  'import { useSourceCitationScope } from "../src/features/sources/citationContext";',
  'import { remarkSourceCitations } from "../src/features/sources/sourceNavigation";',
  'import { SourceCitationAnchor } from "../src/features/sources/SourceCitationAnchor";',
  tutorSource.slice(tutorStart, tutorEnd),
].join('\n');

await build({
  configFile: false,
  root,
  publicDir: false,
  plugins: [
    {
      name: 'tongkk-promo-actual-renderers',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'promo:markdown') return markdownId;
        if (id === 'promo:tutor-markdown') return tutorMarkdownId;
      },
      load(id) {
        if (id === markdownId) return markdownSource;
        if (id === tutorMarkdownId) return tutorMarkdownSource;
      },
      transform(code, id) {
        if (id.replaceAll('\\', '/').endsWith('/katex/dist/katex.min.css')) {
          // Modern browsers use WOFF2; avoid embedding duplicate WOFF/TTF copies.
          return code.replace(/src:(url\([^)]*\.woff2\) format\("woff2"\))[^}]+/g, 'src:$1');
        }
        if (!id.replaceAll('\\', '/').endsWith('/src/components/MindmapView.tsx')) return;
        // An embedded demo must leave normal wheel/touch scrolling to the page.
        // The actual map appearance, layout, toolbar and controls stay intact.
        return code
          .replace('const onWheel = (e: WheelEvent) => {', 'const onWheel = (e: WheelEvent) => {\n      if (!e.ctrlKey && !e.metaKey) return;')
          .replaceAll('touchAction: "none"', 'touchAction: "pan-y"');
      },
      async generateBundle() {
        const packages = new Set(['katex']);
        for (const id of this.getModuleIds()) {
          const match = id.replaceAll('\\', '/').match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          if (match) packages.add(match[1]);
        }
        const notices = [];
        for (const name of [...packages].sort()) {
          const folder = path.join(root, 'node_modules', name);
          for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt']) {
            try {
              const license = await readFile(path.join(folder, filename), 'utf8');
              notices.push(`--- ${name} ---\n${license}`);
              break;
            } catch { /* License filename differs between dependencies. */ }
          }
        }
        this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: notices.join('\n\n') });
      },
    },
    react(),
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: promo,
    emptyOutDir: false,
    copyPublicDir: false,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    minify: true,
    lib: {
      entry: path.join(promo, 'demo-source.tsx'),
      name: 'TongkkPromoDemo',
      formats: ['iife'],
      fileName: () => 'demo.js',
      cssFileName: 'demo',
    },
  },
});
