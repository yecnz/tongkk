/// <reference types="vite/client" />

// 빌드 시점에 주입되는 빌드 식별자 (vite.config.ts의 define). 새 배포 감지에 사용.
declare const __BUILD_ID__: string;
