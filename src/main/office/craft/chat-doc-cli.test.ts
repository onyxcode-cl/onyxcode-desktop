import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DocxSpec, XlsxSpec } from '@shared/chat-doc-spec'
import { chunkGroups, chatDocxCommands } from './chat-word'
import { chatGridScript } from './chat-grid'
import { MAX_SPEC_BYTES } from './chat-doc-cli'
import { explainDocx, runChatDocxCli } from './chat-docx-cli'
import { explainXlsx, runChatXlsxCli } from './chat-xlsx-cli'
import { posixOnly } from '../../../test/platform'

const DOCX: DocxSpec = {
  title: 'Informe',
  date: '2026-10-28',
  blocks: [
    { type: 'heading', level: 1, text: 'Resumen' },
    { type: 'paragraph', text: 'Crecimiento de **12,5%**.' },
    { type: 'table', columns: ['Región', 'Ventas'], rows: [['Norte', 1234567]], total_row: false, caption: 'Tabla 1' }
  ]
}
const XLSX: XlsxSpec = {
  sheets: [
    {
      name: 'Ventas',
      rows: [
        ['Producto', 'Total'],
        ['A', 10],
        ['Total', { formula: 'SUM(B2:B2)', value: 10 }]
      ],
      columnFormats: [null, 'currency'],
      charts: [{ type: 'column', range: 'A1:B2', title: 'Ventas' }]
    }
  ]
}

describe.skipIf(!posixOnly)('build_chat_docx / build_chat_xlsx (CLI de las Tareas con el motor del Chat)', () => {
  let dir: string
  let fakeBin: string
  let logFile: string
  let out: string
  let errs: string[]
  let logs: string[]

  /** Programa falso: guarda lo que recibe y escribe la salida (`--save OUT` en Word, `--out OUT` en Excel). */
  const fake = (name: string, body: string): string => {
    const p = join(dir, name)
    writeFileSync(p, `#!/bin/sh\n${body}\n`)
    chmodSync(p, 0o755)
    return p
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lazunox-office-cli-'))
    logFile = join(dir, 'recibido.txt')
    fakeBin = fake(
      'wordcraft-cli',
      `L="${logFile}"; : > "$L"; while [ $# -gt 0 ]; do case "$1" in --cmd) printf '%s\\n' "$2" >> "$L"; shift;; --save) O="$2"; shift;; esac; shift; done; printf FALSO > "$O"`
    )
    out = join(dir, 'salida')
    errs = []
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const spec = (v: unknown): string => {
    const p = join(dir, 'spec.json')
    writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v))
    return p
  }
  const sink = { log: (m: string): void => void logs.push(m), err: (m: string): void => void errs.push(m) }

  describe('Word', () => {
    it('crea el .docx con los MISMOS comandos que el Chat (chatDocxCommands) y dice cuántos bloques', async () => {
      const code = await runChatDocxCli([spec(DOCX), out + '.docx'], { binary: fakeBin, ...sink })
      expect(errs).toEqual([])
      expect(code).toBe(0)
      expect(readFileSync(out + '.docx', 'utf8')).toBe('FALSO')
      expect(readFileSync(logFile, 'utf8').trim().split('\n')).toEqual(chunkGroups(chatDocxCommands(DOCX)).flat())
      expect(logs[0]).toContain('3 bloques')
    })

    it('esquema inválido: código 1, explica el bloque malo y NO ejecuta el programa ni crea nada', async () => {
      const malo = {
        blocks: [
          { type: 'paragraph', text: 'ok' },
          { type: 'image', path: '/etc/passwd' }
        ]
      }
      const code = await runChatDocxCli([spec(malo), out + '.docx'], { binary: fakeBin, ...sink })
      expect(code).toBe(1)
      expect(errs.join('\n')).toContain('blocks[1]')
      expect(existsSync(out + '.docx')).toBe(false)
      expect(existsSync(logFile)).toBe(false)
      expect(explainDocx({ blocks: [] })).toContain('al menos un bloque')
      expect(explainDocx(null)).toContain('objeto')
    })

    it('sin WordCraft (ausente, relativo o no archivo): código 3 y no toca nada', async () => {
      for (const binary of [undefined, '', 'wordcraft-cli', join(dir, 'no-existe'), dir]) {
        errs.length = 0
        expect(await runChatDocxCli([spec(DOCX), out + '.docx'], { binary, ...sink })).toBe(3)
        expect(errs[0]).toContain('WordCraft no está instalado')
        expect(errs[0]).toContain('build_docx.py')
      }
      expect(existsSync(out + '.docx')).toBe(false)
    })

    it('uso incorrecto (extensión o cantidad de argumentos): código 2', async () => {
      expect(await runChatDocxCli([spec(DOCX), out + '.pdf'], { binary: fakeBin, ...sink })).toBe(2)
      expect(await runChatDocxCli([spec(DOCX)], { binary: fakeBin, ...sink })).toBe(2)
    })

    it('nunca sobrescribe: ni un archivo ni un enlace simbólico', async () => {
      writeFileSync(out + '.docx', 'DEL USUARIO')
      expect(await runChatDocxCli([spec(DOCX), out + '.docx'], { binary: fakeBin, ...sink })).toBe(1)
      expect(readFileSync(out + '.docx', 'utf8')).toBe('DEL USUARIO')
      expect(errs.join()).toContain('no se sobrescribe')
      writeFileSync(join(dir, 'blanco'), 'SECRETO')
      symlinkSync(join(dir, 'blanco'), join(dir, 'enlace.docx'))
      errs.length = 0
      expect(await runChatDocxCli([spec(DOCX), join(dir, 'enlace.docx')], { binary: fakeBin, ...sink })).toBe(1)
      expect(readFileSync(join(dir, 'blanco'), 'utf8')).toBe('SECRETO')
    })

    it('si alguien crea la salida mientras el programa trabaja (carrera), no la pisa: O_EXCL', async () => {
      const carrera = fake(
        'carrera',
        `while [ $# -gt 0 ]; do [ "$1" = "--save" ] && O="$2"; shift; done; printf FALSO > "$O"; printf DEL-USUARIO > "${out}.docx"`
      )
      expect(await runChatDocxCli([spec(DOCX), out + '.docx'], { binary: carrera, ...sink })).toBe(1)
      expect(readFileSync(out + '.docx', 'utf8')).toBe('DEL-USUARIO')
      expect(errs.join()).toContain('no se pudo escribir')
    })

    it('el contenido es DATO: un título con comillas, saltos y una ruta solo viaja dentro del JSON de un --cmd', async () => {
      const hostil: DocxSpec = {
        title: '"; touch /tmp/pwned-lazunox; echo "',
        blocks: [{ type: 'paragraph', text: '../../../etc/passwd $(rm -rf ~) `id`\n--save /tmp/otra.docx' }]
      }
      expect(await runChatDocxCli([spec(hostil), out + '.docx'], { binary: fakeBin, ...sink })).toBe(0)
      expect(existsSync('/tmp/pwned-lazunox')).toBe(false)
      expect(existsSync('/tmp/otra.docx')).toBe(false)
      // Cada línea registrada es el valor de UN --cmd: el texto hostil quedó dentro de un JSON, no como argumento propio.
      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      expect(lines.every((l) => /^[a-zA-Z.]+(=\{.*\})?$/.test(l))).toBe(true)
      expect(readFileSync(logFile, 'utf8')).toContain('touch /tmp/pwned-lazunox')
    })

    it('JSON ilegible o demasiado grande: código 1 sin ejecutar nada', async () => {
      expect(await runChatDocxCli([spec('{no es json'), out + '.docx'], { binary: fakeBin, ...sink })).toBe(1)
      expect(errs.join()).toContain('no se pudo leer el JSON')
      errs.length = 0
      const grande = spec(JSON.stringify({ blocks: [{ type: 'paragraph', text: 'x'.repeat(MAX_SPEC_BYTES) }] }))
      expect(await runChatDocxCli([grande, out + '.docx'], { binary: fakeBin, ...sink })).toBe(1)
      expect(existsSync(logFile)).toBe(false)
    })

    it('el programa falla: código 1 con el motivo y sin dejar archivo', async () => {
      const roto = fake('roto', 'echo "boom en el motor" >&2; exit 7')
      expect(await runChatDocxCli([spec(DOCX), out + '.docx'], { binary: roto, ...sink })).toBe(1)
      expect(errs.join()).toContain('WordCraft falló')
      expect(errs.join()).toContain('boom en el motor')
      expect(existsSync(out + '.docx')).toBe(false)
    })
  })

  describe('Excel', () => {
    let gridBin: string
    beforeEach(() => {
      gridBin = fake(
        'gridcraft-cli',
        `while [ $# -gt 0 ]; do case "$1" in --script) cp "$2" "${logFile}";; --out) O="$2";; esac; shift; done; printf FALSO > "$O"`
      )
    })

    it('crea el .xlsx con el MISMO guion que el Chat (chatGridScript) y dice cuántas hojas', async () => {
      const code = await runChatXlsxCli([spec(XLSX), out + '.xlsx'], { binary: gridBin, ...sink })
      expect(errs).toEqual([])
      expect(code).toBe(0)
      expect(readFileSync(out + '.xlsx', 'utf8')).toBe('FALSO')
      expect(readFileSync(logFile, 'utf8')).toBe(chatGridScript(XLSX))
      expect(logs[0]).toContain('1 hojas')
    })

    it('esquema inválido (formato de columna, rango de gráfico, filas): código 1 con la pista y sin ejecutar', async () => {
      for (const malo of [
        { sheets: [{ name: 'a', rows: [[1]], columnFormats: ['moneda'] }] },
        { sheets: [{ name: 'a', rows: [[1]], charts: [{ type: 'column', range: 'A1' }] }] },
        { sheets: [{ name: 'a', rows: [[{ formula: '', value: 1 }]] }] },
        { sheets: [] },
        { hojas: [] }
      ]) {
        errs.length = 0
        expect(await runChatXlsxCli([spec(malo), out + '.xlsx'], { binary: gridBin, ...sink })).toBe(1)
        expect(errs.join()).toContain('esquema del Chat')
      }
      expect(errs.join()).toContain('`sheets`')
      expect(explainXlsx({ sheets: [{ name: 'a', rows: [[1]], columnFormats: ['x'] }] })).toContain('sheets[0]')
      expect(existsSync(logFile)).toBe(false)
      expect(existsSync(out + '.xlsx')).toBe(false)
    })

    it('sin GridCraft: código 3 (la skill sigue con build_xlsx.py)', async () => {
      expect(await runChatXlsxCli([spec(XLSX), out + '.xlsx'], { binary: undefined, ...sink })).toBe(3)
      expect(errs[0]).toContain('GridCraft no está instalado')
      expect(errs[0]).toContain('build_xlsx.py')
    })

    it('un texto que empieza con = viaja como TEXTO (apóstrofe), nunca como fórmula; no sobrescribe', async () => {
      const s: XlsxSpec = { sheets: [{ name: 'a', rows: [['=HYPERLINK("http://x","y")'], [{ formula: 'SUM(A1:A1)', value: 0 }]] }] }
      expect(await runChatXlsxCli([spec(s), out + '.xlsx'], { binary: gridBin, ...sink })).toBe(0)
      const script = readFileSync(logFile, 'utf8')
      expect(script).toContain(`'=HYPERLINK`)
      expect(script).toContain('=SUM(A1:A1)')
      expect(await runChatXlsxCli([spec(s), out + '.xlsx'], { binary: gridBin, ...sink })).toBe(1)
    })
  })
})
