#!/usr/bin/env node
/** Muestras sintéticas antes/después usando los armadores reales, sin app ni modelo. */
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const argv = process.argv.slice(2)
const arg = (name) => argv[argv.indexOf(name) + 1]
if (!['--source', '--out', '--deckcraft', '--wordcraft'].every((k) => argv.includes(k))) {
  console.error('Uso: node scripts/design-samples.mjs --source árbol --out carpeta-nueva --deckcraft CLI --wordcraft CLI [--explicit]')
  process.exit(2)
}
const source = resolve(arg('--source')),
  out = resolve(arg('--out'))
const deckcraft = resolve(arg('--deckcraft')),
  wordcraft = resolve(arg('--wordcraft'))
await mkdir(out, { recursive: true })
const temp = await mkdtemp(join(tmpdir(), 'lzx-design-samples-'))
const require = createRequire(import.meta.url)
try {
  const entry = `export {renderChatDeck,chatDeckCommands} from ${JSON.stringify(join(source, 'src/main/office/craft/chat-deck.ts'))};\nexport {renderChatDocx,chatDocxCommands} from ${JSON.stringify(join(source, 'src/main/office/craft/chat-word.ts'))};\nexport {renderPreview} from ${JSON.stringify(join(source, 'src/main/documents/preview.ts'))};\nexport {reviewDocument} from ${JSON.stringify(join(source, 'src/main/documents/review.ts'))};`
  await build({
    stdin: { contents: entry, resolveDir: source, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: join(temp, 'sample.cjs'),
    alias: { '@shared': join(source, 'src/shared') },
    nodePaths: [resolve('node_modules')],
    logLevel: 'warning'
  })
  const api = require(join(temp, 'sample.cjs'))
  const cases = [
    [
      'museo-marino',
      'Conservación marina',
      'Un museo que conecta observación y cuidado',
      'Especies observadas',
      'Zonas de estudio',
      'Observación',
      'Conservación',
      'Registrar fauna costera',
      'Proteger áreas de reproducción',
      'Ampliar el recorrido educativo'
    ],
    [
      'comite-financiero',
      'Informe financiero',
      'Decisiones del comité para el próximo trimestre',
      'Ingresos',
      'Proyectos',
      'Situación actual',
      'Plan propuesto',
      'Revisar el gasto operativo',
      'Priorizar proyectos con retorno',
      'Aprobar el presupuesto trimestral'
    ],
    [
      'cafeteria',
      'Cafetería de barrio',
      'Propuesta de apertura y experiencia del cliente',
      'Recetas',
      'Mesas',
      'Oferta actual',
      'Nueva propuesta',
      'Café de origen y preparación lenta',
      'Carta estacional y atención cercana',
      'Validar el menú con una prueba local'
    ],
    [
      'campana-cultural',
      'Encuentro cultural',
      'Una campaña abierta a la comunidad',
      'Talleres',
      'Sedes',
      'Difusión',
      'Participación',
      'Carteles en espacios del barrio',
      'Talleres abiertos con artistas locales',
      'Confirmar las sedes y abrir inscripciones'
    ]
  ]
  const identities = [
    {
      concept: 'Museo marino editorial, documental y sereno',
      palette: { bg: '#F0F6F3', text: '#173C39', accent: '#14665D' },
      fonts: { title: 'Georgia', body: 'Verdana' },
      titles: 'editorial',
      cards: 'outline',
      background: 'plain',
      rhythm: 'calm',
      photos: 'wide'
    },
    {
      concept: 'Comité financiero sobrio y preciso',
      palette: { bg: '#FAFAF7', text: '#24282F', accent: '#37404D' },
      fonts: { title: 'Arial', body: 'Tahoma' },
      titles: 'plain',
      cards: 'square',
      background: 'panel',
      rhythm: 'balanced',
      photos: 'contain'
    },
    {
      concept: 'Cafetería cálida, cercana y artesanal',
      palette: { bg: '#FAF2E5', text: '#3D291D', accent: '#8A4329' },
      fonts: { title: 'Georgia', body: 'Trebuchet MS' },
      titles: 'editorial',
      cards: 'rounded',
      background: 'split',
      rhythm: 'balanced',
      photos: 'portrait'
    },
    {
      concept: 'Campaña cultural expresiva y dinámica',
      palette: { bg: '#F8F0FA', text: '#321E43', accent: '#7C2D8E' },
      fonts: { title: 'Trebuchet MS', body: 'Verdana' },
      titles: 'bold',
      cards: 'square',
      background: 'split',
      rhythm: 'dynamic',
      photos: 'wide'
    }
  ]
  const samples = cases.map(([id, title, sub, label1, label2, col1, col2, item1, item2, closing], i) => ({
    id,
    format: 'pptx',
    spec: {
      ...(argv.includes('--explicit') ? { identity: identities[i] } : {}),
      slides: [
        { layout: 'cover', title, bullets: [sub] },
        {
          layout: 'kpis',
          title: 'Datos para decidir',
          kpis: [
            { label: label1, value: '24' },
            { label: label2, value: '12' },
            { label: 'Participantes', value: '180' }
          ]
        },
        {
          layout: 'two-col',
          title: 'Dos focos de trabajo',
          columns: [
            { heading: col1, bullets: [item1] },
            { heading: col2, bullets: [item2] }
          ]
        },
        { layout: 'stat', title: '80 %', bullets: ['Meta de participación en la primera etapa'] },
        { layout: 'closing', title: 'Próximo paso', bullets: [closing, 'Revisar resultados al terminar la primera etapa'] }
      ]
    }
  }))
  samples.push({
    id: 'manual-tecnico',
    format: 'docx',
    spec: {
      title: 'Manual técnico de mantenimiento',
      subtitle: 'Procedimiento de revisión del equipo',
      header: 'Manual de operación',
      cover: false,
      ...(argv.includes('--explicit')
        ? {
            identity: {
              concept: 'Manual técnico claro y funcional',
              fonts: { title: 'Verdana', body: 'Arial' },
              palette: { bg: '#FFFFFF', text: '#202E32', accent: '#255957', panel: '#EDF4F3' },
              titles: 'bold',
              headers: 'accent',
              cover: 'left'
            }
          }
        : {}),
      blocks: [
        { type: 'heading', level: 1, text: 'Preparación' },
        {
          type: 'paragraph',
          text: 'Este procedimiento organiza la revisión de un equipo de prueba. Registre el estado inicial y compruebe la lista antes de continuar.'
        },
        {
          type: 'numbered',
          items: [
            'Identificar el equipo y la fecha de revisión.',
            'Revisar las conexiones con el equipo apagado.',
            'Registrar observaciones y solicitar revisión si hay daños.'
          ]
        },
        { type: 'heading', level: 1, text: 'Registro de revisión' },
        {
          type: 'table',
          columns: ['Elemento', 'Estado', 'Responsable'],
          rows: [
            ['Carcasa', 'Sin daños', 'Operación'],
            ['Conexiones', 'Revisadas', 'Mantenimiento'],
            ['Registro', 'Completo', 'Supervisión']
          ],
          zebra: true
        },
        { type: 'heading', level: 1, text: 'Cierre' },
        {
          type: 'paragraph',
          text: 'Conserve el registro junto al equipo. Toda incidencia debe incluir una descripción y una fecha de seguimiento.'
        }
      ]
    }
  })
  samples.push({
    id: 'informe-marca',
    format: 'docx',
    spec: {
      title: 'Informe del museo marino',
      subtitle: 'Programa educativo de conservación',
      header: 'Museo · Programa educativo',
      cover: true,
      ...(argv.includes('--explicit') ? { identity: { ...identities[0], cover: 'band', headers: 'accent' } } : {}),
      blocks: [
        { type: 'heading', level: 1, text: 'Conclusión' },
        {
          type: 'paragraph',
          text: 'El programa propone acercar la conservación marina a las familias mediante observación, conversación y actividades prácticas. Se recomienda iniciar una experiencia piloto antes de ampliar el recorrido.'
        },
        { type: 'heading', level: 1, text: 'Plan de actividades' },
        {
          type: 'table',
          columns: ['Actividad', 'Sesiones'],
          rows: [
            ['Observación costera', 4],
            ['Taller de conservación', 6],
            ['Total', 10]
          ],
          total_row: true
        },
        { type: 'heading', level: 1, text: 'Seguimiento' },
        {
          type: 'paragraph',
          text: 'El equipo registrará la asistencia y los comentarios de cada grupo. La revisión final permitirá ajustar la duración y los contenidos del recorrido.'
        }
      ]
    }
  })
  const manifest = {
    source,
    mode: argv.includes('--explicit') ? 'identidad explícita' : 'identidad omitida',
    synthetic: true,
    documents: []
  }
  for (const sample of samples) {
    const { id, format, spec } = sample
    await writeFile(join(out, id + '.json'), JSON.stringify(spec, null, 2) + '\n')
    const bytes = await (format === 'pptx' ? api.renderChatDeck(deckcraft, spec, 60000) : api.renderChatDocx(wordcraft, spec, 60000))
    const file = join(out, id + '.' + format)
    await writeFile(file, bytes)
    const preview = await api.renderPreview(format, bytes, { deckcraft, wordcraft }, { totalMs: 60000 })
    if (!preview || preview.truncated || (preview.status && preview.status !== 'complete'))
      throw new Error(id + ': vista incompleta ' + JSON.stringify(preview && { status: preview.status, pages: preview.pages }))
    for (let i = 0; i < preview.images.length; i++)
      await writeFile(join(out, `${id}-${String(i + 1).padStart(2, '0')}.png`), preview.images[i])
    const review = await api.reviewDocument(format, bytes, spec)
    await writeFile(join(out, id + '-revision.json'), JSON.stringify(review, null, 2) + '\n')
    await writeFile(
      join(out, id + '-commands.json'),
      JSON.stringify(format === 'pptx' ? api.chatDeckCommands(spec) : api.chatDocxCommands(spec), null, 2) + '\n'
    )
    manifest.documents.push({ id, topic: id, format, path: file, pages: preview.pages, review })
    console.log(`${id}: ${preview.pages} páginas; revisión ${review.ok ? 'OK' : 'con hallazgos'}`)
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
} finally {
  await rm(temp, { recursive: true, force: true })
}
