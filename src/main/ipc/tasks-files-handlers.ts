/**
 * Handlers de archivos entregables: `tasks:zip`, `tasks:quickLook`, `tasks:exportMarkdown`
 * y `tasks:htmlToPdf`.
 *
 * Seguridad: toda ruta que viene del renderer se valida con `CoworkManager.assertInsideApproved`
 * (realpath + carpeta de Cowork autorizada) y los procesos externos se lanzan con `execFile` /
 * `spawn` y argumentos en array (nunca una cadena de shell).
 */
import { app, BrowserWindow, dialog } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { CoworkDeliverable } from '@shared/ipc-tasks'
import { describeDeliverable, writeNewFile } from '../tasks/files'
import { assertSafeToOpen } from '../tasks/open-policy'
import { renderHtmlToPdf } from '../extras/artifact-window'
import type { CoworkIpcContext, CoworkSubmodule } from './tasks-handle'

const ZIP_BIN = '/usr/bin/zip'
const QLMANAGE_BIN = '/usr/bin/qlmanage'
const MAX_HTML_BYTES = 5 * 1024 * 1024

/** Quita del nombre lo que no sea seguro como nombre de archivo (sin separadores ni control). */
function safeFileName(name: string, fallback: string): string {
  const clean = name
    .replace(/[/\\:\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return clean || fallback
}

/** Ancestro común más profundo de una lista de rutas absolutas. */
function commonDir(paths: string[]): string {
  const parts = paths.map((p) => dirname(p).split(sep))
  let common = parts[0]
  for (const p of parts.slice(1)) {
    let i = 0
    while (i < common.length && i < p.length && common[i] === p[i]) i++
    common = common.slice(0, i)
  }
  return common.join(sep) || sep
}

/** Ejecuta `/usr/bin/zip` (sin shell) y rechaza con un mensaje legible si falla. */
function runZip(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ZIP_BIN, args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, _out, stderr) => {
      if (err)
        reject(
          new Error(
            `No se pudo crear el zip. ${String(stderr || err.message)
              .trim()
              .slice(0, 300)}`
          )
        )
      else resolve()
    })
  })
}

/** Crea el zip en `out` (reemplazándolo si existe: zip por sí solo AÑADIRÍA a un archivo previo). */
async function createZip(out: string, files: string[]): Promise<void> {
  // Se escribe en un temporal del mismo directorio y se renombra al final.
  const stage = mkdtempSync(join(dirname(out), '.onyxcode-zip-'))
  const tmp = join(stage, 'salida.zip')
  try {
    const names = files.map((f) => basename(f))
    if (new Set(names).size === names.length) {
      // Caso normal: `-j` guarda solo los nombres de archivo, sin rutas.
      await runZip(['-j', '-X', '-q', tmp, ...files])
    } else {
      // Nombres repetidos en carpetas distintas: se conserva la ruta relativa al ancestro común.
      const base = commonDir(files)
      await runZip(['-X', '-q', tmp, ...files.map((f) => `.${sep}${relative(base, f)}`)], base)
    }
    renameSync(tmp, out)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

export function registerCoworkFilesHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, cowork, getWindow } = ctx
  const windowFor = (event: { sender: Electron.WebContents }): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender) ?? getWindow()

  // ── Descargar todo (zip) ──
  handle('tasks:zip', async ({ paths, suggestedName }, event) => {
    const files: string[] = []
    for (const p of paths) {
      const real = cowork.assertInsideApproved(p)
      let st
      try {
        st = statSync(real)
      } catch {
        continue // el archivo pudo borrarse desde que se listó
      }
      if (st.isFile() && !files.includes(real)) files.push(real)
    }
    if (files.length === 0) throw new Error('No hay archivos que comprimir.')

    const base = safeFileName(suggestedName ?? 'Entregables', 'Entregables')
    const defaultName = /\.zip$/i.test(base) ? base : `${base}.zip`
    const options: Electron.SaveDialogOptions = {
      title: 'Guardar entregables como zip',
      defaultPath: join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    }
    const win = windowFor(event)
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return null
    const out = extname(res.filePath).toLowerCase() === '.zip' ? res.filePath : `${res.filePath}.zip`
    if (files.includes(out)) throw new Error('El zip no puede sobrescribir uno de los archivos que contiene.')
    await createZip(out, files)
    return out
  })

  // ── Vista rápida (QuickLook) ──
  let quickLook: ChildProcess | null = null
  const killQuickLook = (): void => {
    const proc = quickLook
    quickLook = null
    if (proc && proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGTERM')
      } catch {
        // ya terminó
      }
    }
  }
  handle('tasks:quickLook', ({ path }) => {
    const real = cowork.assertInsideApproved(path)
    assertSafeToOpen(real) // misma política que "Abrir": nada de ejecutables/lanzadores
    if (!statSync(real).isFile()) throw new Error('La vista rápida solo funciona con archivos.')
    killQuickLook()
    // `-p` abre el panel de QuickLook; `qlmanage` lo mantiene hasta que se cierra o lo matamos.
    const proc = spawn(QLMANAGE_BIN, ['-p', real], { detached: true, stdio: 'ignore' })
    quickLook = proc
    proc.on('error', () => {
      if (quickLook === proc) quickLook = null
    })
    proc.on('exit', () => {
      if (quickLook === proc) quickLook = null
    })
    proc.unref()
  })

  // ── Exportar transcripción a Markdown ──
  handle('tasks:exportMarkdown', async ({ suggestedName, content }, event) => {
    // El renderer ya envía un nombre acabado en `.md`; solo se completa si viniera sin extensión.
    const name = safeFileName(suggestedName, 'tarea.md')
    const withExt = extname(name) ? name : `${name}.md`
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar la tarea a Markdown',
      defaultPath: join(app.getPath('downloads'), withExt),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const win = windowFor(event)
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return null
    await mkdir(dirname(res.filePath), { recursive: true })
    await writeFile(res.filePath, content, 'utf8')
    return res.filePath
  })

  // ── Guardar HTML como PDF ──
  handle('tasks:htmlToPdf', async ({ path }): Promise<CoworkDeliverable> => {
    const real = cowork.assertInsideApproved(path)
    const ext = extname(real).toLowerCase()
    if (ext !== '.html' && ext !== '.htm') throw new Error('Solo se pueden convertir archivos .html o .htm.')
    const st = statSync(real)
    if (!st.isFile()) throw new Error('No es un archivo.')
    if (st.size > MAX_HTML_BYTES) throw new Error('El HTML supera 5 MB.')
    const html = await readFile(real, 'utf8')
    const stem = basename(real, extname(real))
    // Ventana oculta con la misma sesión aislada que los artifacts: sin red, sin acceso a la app.
    const pdf = await renderHtmlToPdf(html, stem)
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('No se pudo generar el PDF.')
    const dir = dirname(real)
    if (!existsSync(dir)) throw new Error('La carpeta del archivo ya no existe.')
    // `<nombre>.pdf` junto al HTML; si existe, `<nombre>-1.pdf`… (nunca sobrescribe).
    const target = writeNewFile(dir, stem, '.pdf', pdf)
    // relPath respecto a la carpeta de Cowork que lo contiene (la más profunda).
    const root =
      cowork
        .listFolders()
        .map((f) => f.path)
        .filter((p) => target === p || target.startsWith(p + sep))
        .sort((a, b) => b.length - a.length)[0] ?? dir
    return describeDeliverable(target, root)
  })

  return { dispose: killQuickLook }
}
