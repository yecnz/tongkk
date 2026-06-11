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
