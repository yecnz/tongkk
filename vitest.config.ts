import { defineConfig } from 'vitest/config'

// 순수 로직(서비스/유틸) 특성화 테스트 전용 설정. 앱 빌드 설정(vite.config.ts)과 분리해
// react·tailwind 플러그인 없이 node 환경에서 가볍게 돈다. vitest.config가 있으면
// vitest는 vite.config 대신 이 파일을 쓰므로 앱 플러그인이 테스트에 끼어들지 않는다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
