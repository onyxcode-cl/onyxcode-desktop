// Proceso principal de Electron para el set dorado: HTML → PDF con las MISMAS opciones y la MISMA lógica que renderHtmlToPdf
// (A4, fondos, @page del CSS, PDF etiquetado y con marcadores, y escala suave si así se evita una última página casi vacía).
// Variables: GOLDEN_HTML (entrada), GOLDEN_OUT (salida), GOLDEN_UD (perfil temporal).
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
app.commandLine.appendSwitch('user-data-dir', process.env.GOLDEN_UD)
app.disableHardwareAcceleration()
const count = (b) => { const m = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(b.toString('latin1')); return m ? +m[1] : 0 }
const fontMin = (html) => {
  const out = []
  for (const m of html.matchAll(/font-size\s*:\s*([0-9]*\.?[0-9]+)\s*(px|pt|rem|em)\b/gi)) { const n = +m[1], u = m[2].toLowerCase(); out.push(u === 'pt' ? n : u === 'px' ? n * 0.75 : n * 12) }
  return out.length ? Math.min(...out) : null
}
app.whenReady().then(async () => {
  let code = 0
  try {
    const html = fs.readFileSync(process.env.GOLDEN_HTML, 'utf8')
    const win = new BrowserWindow({ width: 1024, height: 768, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => true)
    await new Promise((r) => setTimeout(r, 400))
    const print = (scale) => win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, generateTaggedPDF: true, generateDocumentOutline: true, ...(scale === 1 ? {} : { scale }) })
    let pdf = await print(1)
    const pages = count(pdf), min = fontMin(html)
    if (pages === 2) {
      for (const sc of [0.95, 0.92, 0.9]) {
        if (min !== null && min * sc < 6.75) break
        const smaller = await print(sc)
        const n = count(smaller)
        if (n > 0 && n < pages) { pdf = smaller; console.log('escala', sc, pages, '->', n); break }
      }
    }
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('PDF inválido')
    fs.writeFileSync(process.env.GOLDEN_OUT, pdf)
    win.destroy()
  } catch (e) { console.error('ERR', e && e.message); code = 1 }
  app.exit(code)
})
