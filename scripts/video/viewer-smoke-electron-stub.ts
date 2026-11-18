/** Solo diagnóstico Node: captura el handler real sin cargar Electron. */
export const app = {}
export const protocol = {}
export const session = {
  fromPartition: () => ({
    protocol: {
      handle: (_scheme: string, handler: unknown) => {
        ;(globalThis as any).__viewerHandler = handler
      }
    },
    webRequest: { onBeforeRequest: () => {} },
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    on: () => {}
  })
}

export const BrowserWindow = class {}
