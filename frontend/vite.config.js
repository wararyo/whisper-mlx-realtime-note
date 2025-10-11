import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
          dest: '.'
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
          dest: '.'
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: '.'
        }
      ]
    })
  ],
  server: {
    port: 5173,
    host: 'localhost'
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
})
