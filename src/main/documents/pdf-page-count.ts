/** Cuenta el árbol de páginas real, sin ejecutar scripts ni cargar recursos del PDF. */
export async function countPdfPages(bytes: Buffer): Promise<number | null> {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let task: { promise: Promise<{ numPages: number }>; destroy: () => Promise<void> } | undefined
  try {
    const work = (async () => {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (expired) return null
      task = getDocument({
        data: new Uint8Array(bytes),
        enableXfa: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0
      })
      const doc = await task.promise
      return Number.isSafeInteger(doc.numPages) && doc.numPages > 0 ? doc.numPages : null
    })()
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          expired = true
          resolve(null)
        }, 10_000)
      })
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    await task?.destroy().catch(() => undefined)
  }
}

export function pageTarget(input: unknown): { lo: number; hi: number } | null {
  if (typeof input !== 'number' && typeof input !== 'string') return null
  const range = /^\s*(\d+)(?:\s*[-–a]\s*(\d+))?\s*$/.exec(String(input))
  const lo = Number(range?.[1]),
    hi = Number(range?.[2] ?? range?.[1])
  return range && Number.isSafeInteger(lo) && Number.isSafeInteger(hi) && lo > 0 && hi >= lo ? { lo, hi } : null
}
