/**
 * Servicio de «Importar» (Ajustes): vista previa sin secretos + aplicación de lo marcado. La ruta la elige la persona en el diálogo
 * nativo (inyectado: `pickPath`); el renderer nunca manda una ruta. Una sola vista previa viva (la última) con ficha de un solo
 * uso que caduca a los 10 minutos. Nada se ejecuta: solo se lee un archivo y se escribe `AGENTS.md` o el archivo MCP de la app.
 */
import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { t } from '@shared/i18n'
import type {
  AppMcpConfig,
  ImportApplyRequest,
  ImportApplyResult,
  ImportItem,
  ImportPreview,
  ImportSource,
  McpEntry
} from '@shared/ipc-extras'
import {
  composeInstructions,
  ImportError,
  IMPORT_MAX_INSTRUCTION_CHARS,
  readImportFile,
  scanMcpText,
  scanProjectFolder,
  sha256,
  type ImportPayload,
  type ScannedItem
} from './import-sources'
import { mcpEntry } from '../ipc/schemas'

export const IMPORT_TTL_MS = 10 * 60_000

export interface ImportDeps {
  /** Diálogo nativo (carpeta o archivo). `null` = cancelado. */
  pickPath: (source: ImportSource) => Promise<string | null>
  /** Valida la carpeta de un proyecto (existente; ni raíz, ni home, ni userData) y devuelve su ruta real. */
  validateFolder: (folder: string) => string
  existingMcpNames: () => ReadonlySet<string>
  readAgents: (folder: string) => { content: string; exists: boolean }
  saveAgents: (folder: string, content: string) => void
  saveMcp: (name: string, entry: McpEntry) => void
  /** Configuración MCP vigente, enmascarada. */
  maskedMcp: () => AppMcpConfig
  /** Recarga el motor y devuelve la configuración MCP enmascarada. */
  afterMcpChange: () => Promise<AppMcpConfig>
  now?: () => number
}

interface Pending {
  token: string
  expires: number
  payloads: Map<string, ImportPayload>
}

function describeError(err: unknown): string {
  if (err instanceof ImportError) {
    const key = (
      {
        'not-file': 'merr.import.notFile',
        'too-big': 'merr.import.tooBig',
        outside: 'merr.import.outside',
        'bad-json': 'merr.import.badJson',
        unsupported: 'merr.import.unsupported',
        unreadable: 'merr.import.unreadable'
      } as const
    )[err.code]
    return t(key)
  }
  return err instanceof Error ? err.message : String(err)
}

export function createImportService(deps: ImportDeps): {
  pick: (req: { source: ImportSource }) => Promise<ImportPreview | null>
  apply: (req: ImportApplyRequest) => Promise<ImportApplyResult>
} {
  const now = deps.now ?? Date.now
  let pending: Pending | null = null

  const pick = async ({ source }: { source: ImportSource }): Promise<ImportPreview | null> => {
    const chosen = await deps.pickPath(source)
    pending = null
    if (!chosen) return null
    let scanned: ScannedItem[]
    let label: string
    if (source === 'project-folder') {
      const folder = deps.validateFolder(chosen)
      label = basename(folder)
      const scan = scanProjectFolder(folder, deps.existingMcpNames())
      scanned = scan.items
      for (const u of scan.unreadable) {
        scanned.push({
          item: {
            id: `u${scanned.length}`,
            kind: u.file.endsWith('.md') ? 'instructions' : 'mcp',
            name: u.file,
            origin: u.file,
            summary: '',
            status: 'discarded',
            reasons: [{ code: u.code === 'too-big' ? 'too-big' : 'invalid-entry' }],
            envRefs: []
          },
          payload: null
        })
      }
    } else {
      if (!statSync(chosen).isFile()) throw new ImportError('not-file', 'not-file')
      label = basename(chosen)
      const file = readImportFile(chosen)
      scanned = scanMcpText(file.text, label, deps.existingMcpNames())
    }
    const token = randomBytes(16).toString('hex')
    const payloads = new Map<string, ImportPayload>()
    const items: ImportItem[] = []
    for (const s of scanned) {
      items.push(s.item)
      if (s.payload && s.item.status === 'ok') payloads.set(s.item.id, s.payload)
    }
    pending = { token, expires: now() + IMPORT_TTL_MS, payloads }
    return { token, label, items }
  }

  const apply = async ({ token, ids }: ImportApplyRequest): Promise<ImportApplyResult> => {
    const cur = pending
    if (!cur || cur.token !== token || cur.expires < now()) {
      pending = null
      throw new Error(t('merr.import.expired'))
    }
    pending = null // ficha de un solo uso
    const results: ImportApplyResult['results'] = []
    let mcpTouched = false
    for (const id of [...new Set(ids)]) {
      const p = cur.payloads.get(id)
      if (!p) {
        results.push({ id, ok: false, error: t('merr.import.notImportable') })
        continue
      }
      try {
        if (p.kind === 'mcp') {
          if (deps.existingMcpNames().has(p.name)) throw new Error(t('merr.mcp.exists', { name: p.name }))
          // Se revalida con el esquema del alta manual y se fuerza DESACTIVADO.
          const entry = mcpEntry({ ...p.entry, enabled: false }) as McpEntry
          deps.saveMcp(p.name, { ...entry, enabled: false })
          mcpTouched = true
        } else {
          const folder = deps.validateFolder(p.folder)
          // El archivo pudo cambiar entre la vista previa y la confirmación: se vuelve a leer y debe ser idéntico.
          const again = readImportFile(p.sourcePath, folder)
          if (sha256(again.text) !== p.sha256) throw new Error(t('merr.import.changed'))
          const current = deps.readAgents(folder)
          if (p.mode === 'create' && current.exists) throw new Error(t('merr.import.agentsAppeared'))
          const text = composeInstructions(p.mode, current.content, again.text)
          if (text.length > IMPORT_MAX_INSTRUCTION_CHARS) throw new ImportError('too-big', 'too-big')
          deps.saveAgents(folder, text)
        }
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: describeError(err) })
      }
    }
    return { results, mcp: mcpTouched ? await deps.afterMcpChange() : deps.maskedMcp() }
  }

  return { pick, apply }
}
