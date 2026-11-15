import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerOfflineShell, requestPersistentStorage } from './utils/offline'

// 인터넷 없이 열기: 화면 파일을 기기에 저장(운영 빌드만) + 저장된 영상·대본을 크롬이 지우지 않게 요청
registerOfflineShell()
requestPersistentStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
