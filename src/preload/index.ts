import { contextBridge, ipcRenderer } from 'electron'
import { buildWindowApi } from './window-api'
import { capsFlagsFromArgv } from '@shared/caps-argv'

// `main` pasa las banderas de capacidades como argumento de la ventana (solo la principal): `--lazunox-caps=tasksWin`.
contextBridge.exposeInMainWorld('api', buildWindowApi(ipcRenderer, process.platform, capsFlagsFromArgv(process.argv)))
