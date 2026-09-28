/**
 * Construye `window.api.code`: wrappers tipados sobre los canales de `shared/ipc-code.ts`.
 * Desenvuelve `IpcResult` y lanza `Error` cuando `ok === false`.
 */
import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'
import {
  CODE_EVENTS,
  type CodeApi,
  type CodeEventChannel,
  type CodeEventContract,
  type CodeInvokeChannel,
  type CodeRequest,
  type CodeResponse
} from '@shared/ipc-code'

export function buildCodeApi(ipcRenderer: IpcRenderer): CodeApi {
  async function call<C extends CodeInvokeChannel>(channel: C, req?: CodeRequest<C>): Promise<CodeResponse<C>> {
    const result = (await ipcRenderer.invoke(channel, req)) as IpcResult<CodeResponse<C>>
    if (result.ok) return result.data
    throw new Error(result.error)
  }

  function subscribe<C extends CodeEventChannel>(channel: C, cb: (payload: CodeEventContract[C]) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: CodeEventContract[C]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }

  return {
    pty: {
      available: () => call('pty:available'),
      create: (req) => call('pty:create', req),
      write: (id, data) => call('pty:write', { id, data }),
      resize: (id, cols, rows) => call('pty:resize', { id, cols, rows }),
      kill: (id) => call('pty:kill', { id }),
      list: () => call('pty:list')
    },
    git: {
      isRepo: (cwd) => call('git:isRepo', { cwd }),
      status: (cwd) => call('git:status', { cwd }),
      diff: (req) => call('git:diff', req),
      branches: (cwd) => call('git:branches', { cwd }),
      currentBranch: (cwd) => call('git:currentBranch', { cwd }),
      worktrees: (cwd) => call('git:worktrees', { cwd }),
      createWorktree: (cwd, branch, base) => call('git:createWorktree', { cwd, branch, base }),
      removeWorktree: (cwd, path, force) => call('git:removeWorktree', { cwd, path, force }),
      commit: (cwd, message, stageAll) => call('git:commit', { cwd, message, stageAll }),
      log: (cwd, n) => call('git:log', { cwd, n })
    },
    dialog: {
      openFolder: (opts) => call('dialog:openFolder', opts),
      revealInFinder: (path) => call('dialog:revealInFinder', { path }),
      openInEditor: (path) => call('dialog:openInEditor', { path })
    },
    onPtyData: (cb) => subscribe(CODE_EVENTS.ptyData, cb),
    onPtyExit: (cb) => subscribe(CODE_EVENTS.ptyExit, cb)
  }
}
