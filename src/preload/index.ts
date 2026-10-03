import { contextBridge, ipcRenderer } from 'electron'
import { buildWindowApi } from './window-api'

contextBridge.exposeInMainWorld('api', buildWindowApi(ipcRenderer, process.platform))
