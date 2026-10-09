/**
 * Conversión .pptx → PDF con LibreOffice, SI está instalado — nunca se empaqueta, nunca se descarga
 * sola (investigado a fondo: empaquetarlo complica la firma/notarización en Mac y rompe los topes de
 * tamaño ya calculados en Windows). Si no está, `convertToPdf` devuelve `null` y quien llama cae con
 * gracia al visor estructural de siempre (`src/viewer/pptx/`) — nunca rompe nada.
 *
 * Por qué vale la pena: el visor estructural es una APROXIMACIÓN hecha a mano del XML de OOXML (sin
 * motor de renderizado de verdad) — por más atributos que se le agreguen, nunca va a igualar a
 * PowerPoint/LibreOffice de verdad. Confirmado empíricamente (no en teoría): el mismo `.pptx` que
 * generamos, convertido con `soffice --convert-to pdf`, sale PIXEL A PIXEL igual a PowerPoint real —
 * círculo, tipografía, espaciado entre letras, todo — en ~2.5s. Mostrando ESE pdf en el visor de PDF
 * que ya existe (`lazunox-viewer://`, pdf.js) en vez del visor estructural, el panel deja de ser una
 * aproximación: es el render real.
 */
import { execFile } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, extname } from 'node:path'

const MAC_CANDIDATES = ['/opt/homebrew/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']
const WIN_CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
]

const CONVERT_TIMEOUT_MS = 20_000

let cachedPath: string | null | undefined // undefined = todavía no se buscó

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function whichSoffice(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['soffice'], (err, stdout) => {
      const first = stdout?.split(/\r?\n/).find((l) => l.trim())
      resolve(err || !first ? null : first.trim())
    })
  })
}

/** Busca `soffice` en las rutas típicas y en el PATH — cacheado (no se vuelve a buscar en cada documento). `null` = no está instalado. */
export async function findSoffice(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath
  const candidates = process.platform === 'win32' ? WIN_CANDIDATES : MAC_CANDIDATES
  for (const c of candidates) {
    if (await exists(c)) {
      cachedPath = c
      return c
    }
  }
  cachedPath = await whichSoffice()
  return cachedPath
}

/** Solo para pruebas: limpia la ruta cacheada de `findSoffice`. */
export function resetSofficeCache(): void {
  cachedPath = undefined
}

/**
 * Convierte `pptxPath` a PDF dentro de `outDir` (mismo nombre, extensión `.pdf`) — `null` si LibreOffice
 * no está instalado, si la conversión tarda más de `CONVERT_TIMEOUT_MS`, o si falla por cualquier otro
 * motivo (nunca lanza: quien llama simplemente cae al visor estructural). Un perfil de usuario propio
 * y temporal por conversión (`-env:UserInstallation`) para poder convertir varias a la vez sin que
 * una instancia de `soffice` bloquee a la otra por compartir perfil.
 */
export async function convertToPdf(pptxPath: string, outDir: string): Promise<string | null> {
  const soffice = await findSoffice()
  if (!soffice) return null
  let profileDir: string
  try {
    profileDir = await mkdtemp(join(tmpdir(), 'lazunox-lo-'))
  } catch {
    return null
  }
  return new Promise((resolve) => {
    const child = execFile(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        pptxPath
      ],
      { timeout: CONVERT_TIMEOUT_MS },
      (err) => {
        if (err) {
          resolve(null)
          return
        }
        const outName = `${basename(pptxPath, extname(pptxPath))}.pdf`
        resolve(join(outDir, outName))
      }
    )
    child.on('error', () => resolve(null))
  })
}
