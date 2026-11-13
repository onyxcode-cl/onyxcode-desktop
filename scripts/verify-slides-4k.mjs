#!/usr/bin/env node
/** Ejecutar fuera del entorno restringido. Usa Electron real, con userData temporal. */
import { build } from 'esbuild'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import electron from 'electron'

const args = process.argv.slice(2)
const value = (flag) => {
  const i = args.indexOf(flag)
  return i < 0 ? undefined : args[i + 1]
}
if (!value('--html') || !value('--out'))
  throw new Error('Uso: node scripts/verify-slides-4k.mjs --html archivo.html --out carpeta [--expected-slides 5]')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(value('--html'))
const output = resolve(value('--out'))
const expected = value('--expected-slides') ? Number(value('--expected-slides')) : null
if (expected !== null && (!Number.isInteger(expected) || expected < 1 || expected > 40))
  throw new Error('--expected-slides debe estar entre 1 y 40')
await mkdir(output, { recursive: true })
const temporary = await mkdtemp(join(tmpdir(), 'lazunox-check-4k-'))
try {
  const entry = `
import { app, protocol } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { exportSlidesToPptxFile } from ${JSON.stringify(join(root, 'src/main/extras/slides-deck-export.ts'))};
import { assertSlidePng } from ${JSON.stringify(join(root, 'src/main/extras/slides-deck-pptx.ts'))};
app.setPath('userData', ${JSON.stringify(join(temporary, 'userData'))});
protocol.registerSchemesAsPrivileged([{scheme:'lazunox-artifact', privileges:{standard:true, secure:true, supportFetchAPI:true}}]);
await app.whenReady();
try {
  const html = await readFile(${JSON.stringify(source)}, 'utf8');
  const path = ${JSON.stringify(join(output, 'presentation.pptx'))};
  const hashes = [];
  const count = await exportSlidesToPptxFile(html, 'Comprobación 4K', path, (png, index) => { hashes[index] = createHash('sha256').update(png).digest('hex'); });
  const expected = ${JSON.stringify(expected)};
  if (expected !== null && count !== expected) throw new Error('Conteo inesperado: '+count+' frente a '+expected);
  const zip = await JSZip.loadAsync(await readFile(path));
  const media = Object.keys(zip.files).filter(n => /^ppt\\/media\\/.+\\.png$/.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const slides = Object.keys(zip.files).filter(n => /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n));
  if (media.length !== count || slides.length !== count) throw new Error('Número de láminas o imágenes incorrecto en el ZIP');
  for (const [i,name] of media.entries()) {
    const png = await zip.file(name).async('nodebuffer');
    assertSlidePng(png,i);
    if(createHash('sha256').update(png).digest('hex') !== hashes[i]) throw new Error('El ZIP cambió los bytes PNG de la lámina '+(i+1));
    await writeFile(${JSON.stringify(output)}+'/slide-'+(i+1)+'.png',png);
  }
  const photos = (html.match(/data:image\\/(?:jpeg|png|webp);base64,/g)||[]).length;
  const credits = (html.match(/(?:class=["'][^"']*(?:credit|credito)|data-(?:lzx-)?(?:image|photo)-credit)/gi)||[]).length;
  if (!photos || !credits) throw new Error('La muestra debe incluir fotos incrustadas y créditos identificables; revisar HTML');
  const result={slides:count, identicalPngBytes:true, hashes, png:{width:3840,height:2160}, photos, credits, screenshotReview:'Revisar los PNG y abrir PowerPoint: visibilidad, contraste y ausencia de recortes requieren comprobación visual.'};
  await writeFile(${JSON.stringify(join(output, 'verification.json'))},JSON.stringify(result,null,2)+'\\n');
  console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(error); process.exitCode=1; }
finally { app.exit(process.exitCode || 0); }
`
  const bundle = join(temporary, 'verify.cjs')
  // CJS no admite await de nivel superior: wrapper explícito para Electron.
  const wrapped = entry.replace('await app.whenReady();', 'void (async () => { await app.whenReady();') + '\n})();\n'
  await build({
    stdin: { contents: wrapped, resolveDir: root, sourcefile: 'verify-slides-4k.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: bundle,
    tsconfig: join(root, 'tsconfig.node.json')
  })
  if (!args.includes('--bundle-only')) {
    await new Promise((ok, fail) => {
      // Sin llavero simulado, macOS deja a Electron esperando el acceso al llavero y nunca llega a «ready».
      const child = spawn(electron, ['--use-mock-keychain', `--user-data-dir=${join(temporary, 'userData')}`, bundle], {
        stdio: 'inherit',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LAZUNOX_E2E_HEADLESS: '1' }
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        fail(new Error('La comprobación superó 90 segundos'))
      }, 90_000)
      child.on('error', (error) => {
        clearTimeout(timer)
        fail(error)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        code === 0 ? ok() : fail(new Error('Electron terminó con código ' + code))
      })
    })
    // El archivo es también una señal inequívoca de que la validación dentro de Electron terminó.
    JSON.parse(await readFile(join(output, 'verification.json'), 'utf8'))
  } else console.log('Bundle de comprobación válido; Electron no se ejecutó.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
