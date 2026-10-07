// Guardia estatica de los scripts de Control del PC para el PC de pruebas (scripts/win/run-cu.ps1 y clickjack.ps1). No ejecuta
// PowerShell: comprueba las reglas del repo (PowerShell 5.1, ASCII, sin `&&`, sin `$var:` en cadenas) y que el escenario de
// clickjacking no envie entrada ni toque apps ajenas.
//   node --test scripts/win-cu-scripts.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = join(resolve(dirname(fileURLToPath(import.meta.url))), 'win')
const files = ['run-cu.ps1', 'clickjack.ps1']
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]))

/** Quita comentarios de linea (# hasta el final) que no esten dentro de comillas simples o dobles. */
function code(text) {
  return text
    .split('\n')
    .map((l) => {
      let q = ''
      for (let i = 0; i < l.length; i++) {
        const c = l[i]
        if (q) {
          if (c === q) q = ''
        } else if (c === "'" || c === '"') q = c
        else if (c === '#') return l.slice(0, i)
      }
      return l
    })
    .join('\n')
}

for (const f of files) {
  test(`${f}: ASCII, sin && y sin $var: dentro de cadenas`, () => {
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(src[f]), 'caracteres no ASCII')
    assert.ok(!code(src[f]).includes('&&'), 'usa && (PowerShell 5.1 no lo tiene)')
    for (const m of code(src[f]).matchAll(/"([^"\n]*)"/g)) {
      assert.ok(!/\$(?!env:|script:|global:)\w+:/.test(m[1]), `$var: en una cadena entre comillas dobles: ${m[0]}`)
    }
  })
  test(`${f}: sin SendKeys, mouse_event, SendInput ni clics propios`, () => {
    assert.ok(!/SendKeys|mouse_event|SendInput|SetCursorPos|keybd_event|\.PerformClick|\.Click\(\)/i.test(code(src[f])))
  })
}

test('run-cu.ps1: pasos cerrados, se niega a correr elevado y solo cierra procesos propios', () => {
  const s = src['run-cu.ps1']
  assert.match(s, /ValidateSet\('check', 'defender', 'clickjack', 'e2e'\)/)
  assert.match(s, /IsInRole/)
  assert.match(s, /\$Step -eq 'clickjack' -or \$Step -eq 'e2e'/)
  assert.match(s, /taskkill\.exe \/PID \$p\.Id/)
  assert.ok(
    !/taskkill[^\n]*\/IM/i.test(s) && !/Stop-Process/i.test(s) && !/Get-Process[^\n]*\|[^\n]*(Stop|Kill)/i.test(s),
    'no cierra procesos por nombre'
  )
  assert.match(s, /Seconds \* 1000/)
})

test('run-cu.ps1: el paso clickjack solo consulta (app-at) y nunca envia entrada', () => {
  const s = src['run-cu.ps1']
  const block = s.slice(s.indexOf("if ($Step -eq 'clickjack')"), s.indexOf("if ($Step -eq 'e2e')"))
  assert.match(block, /app-at/)
  assert.ok(!/Helper-Json \('(click|type|key|move|drag|scroll)\b/.test(block), 'el paso clickjack no puede llamar a comandos de entrada')
})

test('clickjack.ps1: solo ventanas propias, con limite de tiempo', () => {
  const s = src['clickjack.ps1']
  assert.match(s, /Seconds -gt 300/)
  assert.match(s, /System\.Windows\.Forms\.Form/)
  assert.ok(
    !/Start-Process|Get-Process|Stop-Process|taskkill|FindWindow|SetForegroundWindow/i.test(code(s)),
    'no toca otros procesos ni ventanas'
  )
})

// --- build/installer.nsh: desinstalacion del entorno aislado de Tareas (beta opcional) ---
const nsh = readFileSync(join(dirname(dir), '..', 'build', 'installer.nsh'), 'utf8')
/** Texto del .nsh sin comentarios de linea (`;` al inicio de la linea). */
const nshCode = nsh
  .split('\n')
  .filter((l) => !l.trim().startsWith(';'))
  .join('\n')
const unMacro = nshCode.slice(
  nshCode.indexOf('!macro customUnInstall'),
  nshCode.indexOf('!macroend', nshCode.indexOf('!macro customUnInstall'))
)

test('installer.nsh: customUnInstall solo ejecuta `wsl.exe --unregister Lazunox-Tareas`', () => {
  assert.ok(unMacro.length > 0, 'existe la macro customUnInstall')
  const wslCalls = [...unMacro.matchAll(/wsl\.exe"?\s+(-{1,2}[A-Za-z-]+)/g)].map((m) => m[1])
  assert.deepEqual(wslCalls.sort(), ['--unregister', '-l'], 'solo --unregister y la lectura `-l -q` (dentro de PowerShell)')
  assert.match(unMacro, /--unregister Lazunox-Tareas'/)
  assert.ok(
    !/--shutdown|--terminate|-t\s+Lazunox|docker-desktop|OnyxCode-Tareas|--set-default|--import/i.test(nshCode),
    'sin shutdown, ni otras distros'
  )
  assert.ok(!/--unregister\s+(?!Lazunox-Tareas)/.test(nshCode), 'solo el nombre fijo, sin variables')
})

test('installer.nsh: pregunta (NO por defecto), salta en /S y en actualizaciones, con limite de tiempo', () => {
  assert.match(unMacro, /\$\{IfNot\} \$\{Silent\}/)
  assert.match(unMacro, /\$\{IfNot\} \$\{isUpdated\}/)
  assert.match(unMacro, /MessageBox MB_YESNO\|MB_ICONQUESTION\|MB_DEFBUTTON2/)
  assert.match(unMacro, /\$\{FileExists\} "\$SYSDIR\\wsl\.exe"/, 'sin wsl.exe se salta sin error')
  const execs = [...unMacro.matchAll(/nsExec::\w+([^\n]*)/g)].map((m) => m[1])
  assert.equal(execs.length, 2)
  for (const e of execs) assert.match(e, /\/TIMEOUT=\d+/, 'toda ejecucion con limite de tiempo')
})

test('installer.nsh: comprueba que la distro existe con nombre exacto (UTF-16LE) y borra solo %LOCALAPPDATA%\\Lazunox\\wsl', () => {
  assert.match(unMacro, /-l -q/)
  assert.match(unMacro, /-replace \[char\]0/, 'quita los NUL de la salida UTF-16LE')
  assert.match(unMacro, /-ccontains \\"Lazunox-Tareas\\"/, 'comparacion exacta y sensible a mayusculas')
  const rm = [...unMacro.matchAll(/RMDir[^\n]*/g)].map((m) => m[0])
  assert.deepEqual(rm, ['RMDir /r "$LOCALAPPDATA\\Lazunox\\wsl"'])
  // el borrado solo ocurre tras un --unregister con codigo 0
  assert.ok(unMacro.indexOf('--unregister') < unMacro.indexOf('RMDir'))
  assert.match(unMacro.slice(unMacro.indexOf('--unregister'), unMacro.indexOf('RMDir')), /\$\{If\} \$R0 == "0"/)
})

test('installer.nsh: sigue la macro customInstallMode (instalacion por usuario)', () => {
  assert.match(nshCode, /!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/)
})
