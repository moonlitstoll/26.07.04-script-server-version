import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync, readFileSync, readdirSync } from 'fs'
import { precacheList, renderServiceWorker } from './src/utils/swBuild.js'

// 빌드마다 고유 ID. 앱에 주입(__BUILD_ID__)하고 동시에 dist/version.json에도 써서,
// 런타임이 version.json을 주기적으로 fetch해 자기 ID와 다르면 '새 버전' 안내를 띄운다.
const BUILD_ID = String(Date.now())

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      apply: 'build',
      writeBundle() {
        try {
          writeFileSync('dist/version.json', JSON.stringify({ buildId: BUILD_ID }))
        } catch (e) {
          console.warn('[build] version.json 쓰기 실패:', e && e.message)
        }
      },
    },
    {
      // 인터넷 없이 열기: public/sw.js(틀)에 이번 빌드의 파일 목록을 채워 dist/sw.js로 쓴다.
      // 실패하면 빌드를 멈춘다 — 목록이 빈 채 배포되면 '저장된 줄 알았는데 안 열림'이 된다.
      name: 'emit-service-worker',
      apply: 'build',
      closeBundle() {
        const files = readdirSync('dist', { recursive: true, withFileTypes: true })
          .filter(d => d.isFile())
          .map(d => `${d.parentPath ?? d.path}/${d.name}`.replace(/\\/g, '/').replace(/^dist\//, ''))
        const sw = renderServiceWorker(readFileSync('public/sw.js', 'utf8'), {
          buildId: BUILD_ID,
          files: precacheList(files),
        })
        writeFileSync('dist/sw.js', sw)
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  base: '/',
  server: {
    // headers: {
    //   'Cross-Origin-Opener-Policy': 'same-origin',
    //   'Cross-Origin-Embedder-Policy': 'require-corp',
    // },
  },
  // FFmpeg.wasm WASM 파일 최적화 제외
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
