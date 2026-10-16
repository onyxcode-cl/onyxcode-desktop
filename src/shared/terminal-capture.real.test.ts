/**
 * Salidas REALES de zsh y bash (capturadas con un pty de verdad, prompt con rama de git, ancho de 40/80/120 columnas, comando largo
 * que se parte, sin salida, con color y con barra de progreso con `\r`): lo que queda es SOLO lo que imprime el comando, sin prompt,
 * sin eco partido, sin la marca `%` de zsh y sin el prompt de regreso.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emulateTerminal } from './terminal-emulate'
import { outputView } from './terminal-capture'

interface Fixture {
  shell: 'zsh' | 'bash'
  cols: number
  key: 'long' | 'silent' | 'color' | 'progress'
  cmd: string
  prompt: string
  raw: string
}
const fixtures = JSON.parse(readFileSync(new URL('./terminal-capture.fixtures.json', import.meta.url), 'utf8')) as Fixture[]

const EXPECTED: Record<Fixture['key'], string> = {
  long: 'Instalando ripgrep...\n[sudo] hecho para demo',
  silent: '',
  color: 'ok listo',
  progress: '100%'
}

describe('salidas reales de zsh y bash', () => {
  it('hay muestras de los dos shells y los tres anchos', () => {
    expect(new Set(fixtures.map((f) => f.shell))).toEqual(new Set(['zsh', 'bash']))
    expect(new Set(fixtures.map((f) => f.cols))).toEqual(new Set([40, 80, 120]))
    expect(fixtures).toHaveLength(24)
  })

  it.each(fixtures.map((f) => [`${f.shell} ${f.cols} cols ${f.key}`, f] as const))('%s: solo la salida del comando', (_name, f) => {
    const v = outputView(f.raw, f.prompt, { command: f.cmd, cols: f.cols })
    expect(v.text).toBe(EXPECTED[f.key])
    expect(v.promptReturned).toBe(true)
    // nada de ruido: ni prompt, ni eco, ni restos de redibujado, ni secuencias de control
    expect(v.text).not.toContain('ben@mac')
    expect(v.text).not.toContain('echo "')
    expect(v.text).not.toContain('printf')
    expect(v.text).not.toMatch(/[\u001b\u0008\r]|\[200~|\[201~|\[\?2004/)
    expect(v.text).not.toMatch(/^[%#]$/m)
  })

  it('con el eco todavía a medias no hay salida ni «terminó»', () => {
    const f = fixtures.find((x) => x.shell === 'zsh' && x.cols === 40 && x.key === 'long')!
    const v = outputView(f.raw.slice(0, 30), f.prompt, { command: f.cmd, cols: f.cols })
    expect(v.lines).toEqual([])
    expect(v.promptReturned).toBe(false)
  })

  it('con el comando a medias de ejecutar (sin prompt de regreso) la salida parcial sí se ve', () => {
    const f = fixtures.find((x) => x.shell === 'bash' && x.cols === 80 && x.key === 'long')!
    const cut = f.raw.slice(0, f.raw.indexOf('hecho para demo\r\n') + 17)
    const v = outputView(cut, f.prompt, { command: f.cmd, cols: f.cols })
    expect(v.text).toBe(EXPECTED.long)
    expect(v.promptReturned).toBe(false)
  })

  it('el pegado entre corchetes no se cuela', () => {
    const v = outputView('\u001b[200~echo hola\u001b[201~\r\nhola\r\nben@mac tienda-web (main) $ ', 'ben@mac tienda-web (main) $ ', {
      command: 'echo hola',
      cols: 80
    })
    expect(v.text).toBe('hola')
  })
})

describe('emulateTerminal', () => {
  it('\\r sobrescribe, ESC[K borra y el texto se parte al llegar al ancho', () => {
    expect(emulateTerminal('10%\r50%\r100%\r\nfin')).toBe('100%\nfin')
    expect(emulateTerminal('abcdef\r\u001b[Kxy')).toBe('xy')
    expect(emulateTerminal('a'.repeat(25), { cols: 10 })).toBe('a'.repeat(25))
    expect(emulateTerminal('x\u001b[31mrojo\u001b[0m')).toBe('xrojo')
  })
})

describe('captura real de la app (terminal recién abierta, sin prompt aprendido)', () => {
  // zsh del equipo del dueño: pinta el prompt DENTRO de la captura, redibuja el eco al partirse (` \r ESC[K .`) y pide contraseña.
  const raw =
    '\u001b[1m\u001b[7m%\u001b[27m\u001b[1m\u001b[0m                                                                   \r \r\r\u001b[0m\u001b[27m\u001b[24m\u001b[Jben@MacBook-Pro-de-Benjamin-2 tienda-web % \u001b[K\u001b[?2004he\becho "Instalando ripgrep. \r\u001b[K.\r..\" && printf "[sudo] contraseña para demo: " && sleep 25\u001b[?2004l\r\r\nInstalando ripgrep...\r\n[sudo] contraseña para demo: '
  const command = 'echo "Instalando ripgrep..." && printf "[sudo] contraseña para demo: " && sleep 25'

  it('quita el prompt y el eco partido y deja solo lo que imprimió el comando (pide contraseña)', () => {
    const v = outputView(raw, '', { command, cols: 68 })
    expect(v.text).toBe('Instalando ripgrep...\n[sudo] contraseña para demo:')
    expect(v.waitKind).toBe('password')
    expect(v.promptKnown).toBe(true) // aprendido de lo que quedó antes del eco
  })
})
