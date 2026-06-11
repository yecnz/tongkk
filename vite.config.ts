import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 배포(빌드)마다 바뀌는 식별자(빌드 시각). 빌드할 때마다 새 값이라 새 배포를 감지할 수 있다.
// __BUILD_ID__(앱 번들에 주입)와 /version.json(빌드 산출물)에 같은 값을 넣어, 런타임에서 비교한다.
const buildId = String(Date.now())

// 빌드 산출물 루트에 version.json을 만든다. 런타임이 주기적으로 받아 현재 번들과 비교한다.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react(), tailwindcss(), emitVersionJson()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
