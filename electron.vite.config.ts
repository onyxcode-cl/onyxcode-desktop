import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Servidor MCP de computer use: utilityProcess de main (HTTP en 127.0.0.1) → out/main/computer-mcp.js
          'computer-mcp': resolve(__dirname, 'src/main/computer/mcp-server.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        // Un preload por tipo de ventana (mínimo privilegio). quick/overlay/pill no importan nada
        // en tiempo de ejecución salvo `electron`: un preload con sandbox no puede cargar chunks.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          quick: resolve(__dirname, 'src/preload/quick.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
          pill: resolve(__dirname, 'src/preload/pill.ts'),
          assist: resolve(__dirname, 'src/preload/assist.ts'),
          // Ventana «Navegador» aparte (Lote D): preload autocontenido, ver browser-host.ts.
          'browser-host': resolve(__dirname, 'src/preload/browser-host.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      // electron-vite no minifica el renderer por defecto.
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          quick: resolve(__dirname, 'src/renderer/quick/index.html'),
          // Overlay de control del Mac (borde/ondas a pantalla completa) y píldora con "Detener"
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          'overlay-pill': resolve(__dirname, 'src/renderer/overlay/pill.html'),
          // Ventana "assist": globo de Teach mode y píldora de grabar una skill
          'overlay-assist': resolve(__dirname, 'src/renderer/overlay/assist.html'),
          // Navegador integrado (Lote D): panel dentro de Code/Tareas y ventana aparte (lo crea D3/D4).
          browser: resolve(__dirname, 'src/renderer/browser/index.html')
        }
      }
    }
  }
})
