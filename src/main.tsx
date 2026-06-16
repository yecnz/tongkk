// 구버전 브라우저용 Uint8Array base64/hex 폴리필(메인 스레드). pdfjs가 폰트·이미지·서명에서 호출하므로
// 다른 import보다 먼저 설치한다. 워커 스레드는 pdfWorkerEntry가 별도로 폴리필한다.
import './services/uint8ArrayBase64Hex'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// 요약·튜터 본문의 $...$ 수식(KaTeX) 렌더링용 전역 스타일(폰트 포함)
import 'katex/dist/katex.min.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
