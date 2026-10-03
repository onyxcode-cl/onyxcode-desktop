/**
 * Qué acciones del celular pide confirmar el Mac (clase «D» de `main/remote/policy.ts`), para que la pantalla del celular se lo
 * diga a la persona ANTES de pedirlo y no ofrezca lo que la política va a negar. Es un ESPEJO de la política (que es la que
 * manda): `src/main/remote/mac-confirm-parity.test.ts` lo compara con `decide()` para que no se desfasen.
 * Puro: sin Electron, Node ni DOM.
 */
export type MacAction =
  | { kind: 'git.discard'; files: number; all?: boolean }
  | { kind: 'git.removeWorktree' }
  | { kind: 'files.trash'; isDirectory: boolean; count?: number }
  | { kind: 'files.rename'; isDirectory: boolean }
  /** Responder «una vez» a un permiso del agente; `permission` es su tipo (`edit`, `bash`, `external_directory`…). */
  | { kind: 'permission.once'; permission: string }

/** Tope de archivos para descartar sin confirmar en el Mac (`MAX_DISCARD_FILES` de la política). */
export const MAX_DISCARD_WITHOUT_MAC = 20

/** Permisos cuyo «una vez» es una mutación normal (espejo de `ONCE_SAFE_PERMISSIONS`; lo vigila la prueba). */
export const ONCE_SAFE_PERMISSIONS: ReadonlySet<string> = new Set([
  'edit',
  'bash',
  'read',
  'glob',
  'grep',
  'list',
  'webfetch',
  'websearch',
  'codesearch',
  'task',
  'skill',
  'todowrite',
  'todoread',
  'lsp'
])

/** ¿El Mac tiene que confirmar esta acción? (la política «D» del celular; lo desconocido, sí). */
export function needsMacConfirm(a: MacAction): boolean {
  switch (a.kind) {
    case 'git.discard':
      return !!a.all || a.files > MAX_DISCARD_WITHOUT_MAC
    case 'git.removeWorktree':
      return true
    case 'files.trash':
      return a.isDirectory || (a.count ?? 1) > 1
    case 'files.rename':
      return a.isDirectory
    case 'permission.once':
      return !ONCE_SAFE_PERMISSIONS.has(a.permission)
    default:
      return true
  }
}

/** Respuestas de permiso que el celular puede dar: nunca `always`; si el «una vez» pide confirmar en el Mac, solo rechazar. */
export function phoneReplies(permission: string): Array<'once' | 'reject'> {
  return needsMacConfirm({ kind: 'permission.once', permission }) ? ['reject'] : ['once', 'reject']
}
