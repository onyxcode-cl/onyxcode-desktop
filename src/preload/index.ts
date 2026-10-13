import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { buildWindowApi } from './window-api'
import { capsFlagsFromArgv } from '@shared/caps-argv'

// `main` pasa las banderas de capacidades como argumento de la ventana (solo la principal): `--lazunox-caps=tasksWin`.
contextBridge.exposeInMainWorld('api', buildWindowApi(ipcRenderer, process.platform, capsFlagsFromArgv(process.argv)))

// Ruta real de un archivo/carpeta arrastrado a la ventana (`File.path` ya no existe en Electron moderno). Solo la ventana principal; la ruta
// se valida en main antes de usarse (`tasks:folders:check`).
contextBridge.exposeInMainWorld('lzxPaths', {
  forFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
})
