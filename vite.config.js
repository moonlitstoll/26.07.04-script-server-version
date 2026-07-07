import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'

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
