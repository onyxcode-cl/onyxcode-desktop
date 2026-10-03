/**
 * Construye `window.api.code`: wrappers tipados sobre los canales de `shared/ipc-code.ts`.
 * Desenvuelve `IpcResult` y lanza `Error` cuando `ok === false`.
 */
import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'
import {
  CODE_EVENTS,
  CODE_INVOKE_CHANNELS,
  type CodeApi,
  type CodeEventChannel,
  type CodeEventContract,
  type CodeInvokeChannel,
  type CodeRequest,
  type CodeResponse
} from '@shared/ipc-code'

export function buildCodeApi(ipcRenderer: IpcRenderer): CodeApi {
  const bridge = makeBridge<CodeInvokeChannel, CodeEventChannel>(ipcRenderer, {
    invoke: CODE_INVOKE_CHANNELS,
    events: Object.values(CODE_EVENTS)
  })
  const call = <C extends CodeInvokeChannel>(channel: C, req?: CodeRequest<C>): Promise<CodeResponse<C>> =>
    bridge.invokeUnwrap(channel, req) as Promise<CodeResponse<C>>
  const subscribe = <C extends CodeEventChannel>(channel: C, cb: (payload: CodeEventContract[C]) => void): (() => void) =>
    bridge.on(channel, cb as (payload: unknown) => void)

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
      log: (cwd, n) => call('git:log', { cwd, n }),
      discard: (cwd, paths, scope) => call('git:discard', { cwd, paths, scope }),
      discardHunk: (cwd, path, index, hunk) => call('git:discardHunk', { cwd, path, index, hunk }),
      discardUndo: (cwd, undoId) => call('git:discardUndo', { cwd, undoId })
    },
    dialog: {
      openFolder: (opts) => call('dialog:openFolder', opts),
      revealInFinder: (path) => call('dialog:revealInFinder', { path }),
      openInEditor: (path) => call('dialog:openInEditor', { path })
    },
    files: {
      watch: (folder, subId) => call('files:watch', { folder, subId }),
      setDirs: (subId, dirs) => call('files:setDirs', { subId, dirs }),
      unwatch: (subId) => call('files:unwatch', { subId }),
      create: (cwd, parent, name, kind) => call('files:create', { cwd, parent, name, kind }),
      rename: (cwd, path, name) => call('files:rename', { cwd, path, name }),
      trash: (cwd, path) => call('files:trash', { cwd, path })
    },
    editors: {
      list: (cwd) => call('editors:list', { cwd }),
      open: (cwd, id) => call('editors:open', { cwd, id })
    },
    onFilesChanged: (cb) => subscribe(CODE_EVENTS.filesChanged, cb),
    onPtyData: (cb) => subscribe(CODE_EVENTS.ptyData, cb),
    onPtyExit: (cb) => subscribe(CODE_EVENTS.ptyExit, cb)
  }
}
