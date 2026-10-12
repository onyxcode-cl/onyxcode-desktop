/**
 * Comprobaciones del «doctor» (ver `@shared/doctor`). Todo lo que toca el sistema entra por `DoctorDeps`, así que las reglas se prueban
 * sin ejecutar nada real. Ninguna comprobación abre ventanas del sistema ni pide permisos: solo MIRA. (Ojo: ejecutar `/usr/bin/git`
 * en un Mac sin las herramientas de Apple abre un instalador; por eso se pregunta a `xcode-select -p`, que no abre nada.)
 */
import type { DoctorItem, DoctorReport } from '@shared/doctor'

export interface DoctorDeps {
  platform: string
  /** `os.release()`: en macOS es la versión de Darwin (22 = macOS 13). */
  osRelease: string
  /** Estado de permisos del control del Mac; `null` si esta plataforma no lo ofrece. */
  computer: () => Promise<{
    helperOk: boolean
    accessibility: boolean
    screenRecording: boolean
    screens: Array<{ width: number; height: number }>
  } | null>
  /** Resultado de ejecutar una herramienta con argumentos (código, salida). Nunca debe lanzar. */
  run: (file: string, args: string[]) => Promise<{ code: number; out: string }>
  exists: (path: string) => boolean
  /** Ruta de `cu-keys` junto al helper, o `null` si no hay helper. */
  keysBin: string | null
  /** Python incluido en la app, o `null`. */
  pythonBin: string | null
  office: () =>
    { state: 'unsupported' } | { state: 'missing'; sizeBytes: number } | { state: 'installed'; source: 'app' | 'system'; version: string }
  /** ¿Están instalados DeckCraft y WordCraft (ArtCraft)? Con ellos la revisión visual de Word/PowerPoint no necesita LibreOffice. */
  artcraft?: () => boolean
  /** Bytes libres en el disco de los datos de la app. */
  freeBytes: () => number
}

const MB = 1024 * 1024
const MIN_FREE_BYTES = 3 * 1024 * MB
/** Darwin 22 = macOS 13 (el helper nativo se compila para macOS 13 o superior). */
const MIN_DARWIN = 22

/** «Distribución: LatinAmerican» a partir de la salida de `cu-keys layout` (`{"layout":"com.apple.keylayout.LatinAmerican",…}`). */
function layoutName(out: string): string | undefined {
  const id = /"layout"\s*:\s*"([^"]+)"/.exec(out)?.[1]
  return id ? `Distribución: ${id.replace(/^com\.apple\.keylayout\./, '')}` : undefined
}

const PY_LIBS = 'import docx, openpyxl, pptx, pypdf, pdfplumber, reportlab, pypdfium2, lxml, PIL'

export async function runDoctor(d: DoctorDeps, now: () => number = Date.now): Promise<DoctorReport> {
  const items: DoctorItem[] = []
  const push = (i: DoctorItem): void => void items.push(i)

  if (d.platform === 'darwin') {
    const darwin = Number.parseInt(d.osRelease, 10)
    push({
      id: 'macos',
      level: Number.isFinite(darwin) && darwin < MIN_DARWIN ? 'fail' : 'ok',
      detail: `Darwin ${d.osRelease}`
    })
  }

  const c = await d.computer().catch(() => null)
  if (c) {
    push({ id: 'controlHelper', level: c.helperOk ? 'ok' : 'fail' })
    push({ id: 'accessibility', level: c.accessibility ? 'ok' : 'fail', fix: c.accessibility ? undefined : 'requestPermissions' })
    push({ id: 'screenRecording', level: c.screenRecording ? 'ok' : 'fail', fix: c.screenRecording ? undefined : 'requestPermissions' })
    push({
      id: 'screens',
      level: 'info',
      detail: c.screens.length ? c.screens.map((s) => `${s.width}×${s.height}`).join(' + ') : undefined
    })
  }

  if (d.keysBin) {
    if (!d.exists(d.keysBin)) {
      push({ id: 'keyboardTool', level: 'warn', detail: 'cu-keys no está' })
    } else {
      const r = await d.run(d.keysBin, ['layout'])
      push({
        id: 'keyboardTool',
        level: r.code === 0 && /"layout"/.test(r.out) ? 'ok' : 'warn',
        detail: r.code === 0 ? layoutName(r.out) : `código ${r.code}`
      })
    }
  }

  if (d.pythonBin && d.exists(d.pythonBin)) {
    const r = await d.run(d.pythonBin, ['-I', '-c', `${PY_LIBS}; print("ok-libs")`])
    push({
      id: 'python',
      level: r.code === 0 && /ok-libs/.test(r.out) ? 'ok' : 'fail',
      detail: r.code === 0 ? undefined : r.out.trim().slice(-120)
    })
  } else {
    // Sin el Python incluido las skills de oficina usan el del sistema (si lo hay): funciona con límites.
    push({ id: 'python', level: 'warn', detail: 'Python incluido no encontrado' })
  }

  const o = d.office()
  if (o.state === 'installed')
    push({ id: 'office', level: 'ok', detail: o.source === 'system' ? 'LibreOffice del sistema' : `LibreOffice ${o.version}` })
  else if (o.state === 'missing' && !d.artcraft?.())
    push({ id: 'office', level: 'warn', fix: 'installOffice', detail: `${Math.round(o.sizeBytes / MB)} MB` })

  if (d.platform === 'darwin') {
    const x = await d.run('/usr/bin/xcode-select', ['-p'])
    push({ id: 'git', level: x.code === 0 ? 'ok' : 'warn', fix: x.code === 0 ? undefined : 'xcodeSelect' })
  }

  const free = d.freeBytes()
  push({ id: 'disk', level: free < MIN_FREE_BYTES ? 'warn' : 'ok', detail: `${Math.round(free / (1024 * MB))} GB libres` })

  const overall = items.some((i) => i.level === 'fail') ? 'fail' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'
  return { items, overall, at: now() }
}
