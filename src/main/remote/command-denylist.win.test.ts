/**
 * Lista de denegación con plataforma `win32` INYECTADA (rutas de `node:path/win32`, sin Windows real). Garantía que se prueba: en Windows
 * el celular NO puede aprobar «una vez» más que en macOS; cada negativa de macOS sigue y se AÑADEN las de cmd/PowerShell y las rutas
 * `C:\`/UNC. Lo que no se probó en un Windows real: docs/REMOTO-WINDOWS.md.
 */
import { describe, expect, it } from 'vitest'
import { approvalVerdict, bashVerdict, editVerdict, type ApprovalEnv } from './command-denylist'
import { isSensitivePath } from './path-guard'

const win: ApprovalEnv = { platform: 'win32', sessionDir: 'C:\\Users\\Ana\\proj', home: 'C:\\Users\\Ana' }
const mac: ApprovalEnv = { platform: 'darwin', sessionDir: '/Users/ana/proj', home: '/Users/ana' }

describe('bashVerdict en Windows: lo que pasa (null)', () => {
  it.each([
    'npm test',
    'npm run build -- --watch=false',
    'git status',
    'git diff HEAD~1',
    'git commit -m "arregla el bug"',
    'git log --oneline -5',
    'dir',
    'type package.json',
    'findstr /?'.replace('/?', 'TODO src'),
    'node scripts/build.js',
    'python tool.py --verbose',
    'echo hola > salida.txt',
    'echo hola > .\\build\\salida.txt',
    'mkdir build\\out',
    'copy a.txt build\\out\\',
    'type src\\index.ts',
    'npx vitest run src\\a.test.ts',
    'pnpm install 2>&1',
    'tsc --noEmit -p tsconfig.json',
    'node .\\scripts\\build.js',
    'Get-ChildItem src',
    'Get-Content package.json',
    'git commit -m "fix: texto con dos puntos"',
    'type C:\\Users\\Ana\\proj\\README.md',
    'dir C:/Users/Ana/proj/src'
  ])('%s', (c) => {
    expect(bashVerdict(c, win)).toBeNull()
  })
})

describe('bashVerdict en Windows: lo que SIEMPRE va al equipo', () => {
  it.each([
    // Borrado, formato y sistema
    ['del /f /q *.*', 'path-outside'],
    ['del archivo.txt', 'cmd:del'],
    ['erase archivo.txt', 'cmd:erase'],
    ['rd /s /q build', 'path-outside'],
    ['rd build', 'cmd:rd'],
    ['Remove-Item -Recurse -Force build', 'cmd:remove-item'],
    ['ri build', 'cmd:ri'],
    ['format D: /q', 'path-outside'],
    ['format.com X', 'cmd:format'],
    ['diskpart', 'cmd:diskpart'],
    ['reg add HKCU\\Software\\X /v a /d b', 'path-outside'],
    ['reg.exe delete HKLM\\Software\\X', 'cmd:reg'],
    ['reg query x', 'cmd:reg'],
    ['net user', 'cmd:net'],
    ['icacls build', 'cmd:icacls'],
    ['cmdkey', 'cmd:cmdkey'],
    ['regedit', 'cmd:regedit'],
    ['sc stop wuauserv', 'cmd:sc'],
    ['net user admin x /add', 'path-outside'],
    ['netsh advfirewall set allprofiles state off', 'cmd:netsh'],
    ['schtasks /create /tn x /tr y', 'path-outside'],
    ['schtasks.exe', 'cmd:schtasks'],
    ['taskkill /f /im node.exe', 'path-outside'],
    ['shutdown /s /t 0', 'path-outside'],
    ['icacls build /grant Everyone:F', 'path-outside'],
    ['takeown build', 'cmd:takeown'],
    ['certutil -urlcache -f http://x/a.exe a.exe', 'cmd:certutil'],
    ['bitsadmin', 'cmd:bitsadmin'],
    ['wmic process list', 'cmd:wmic'],
    ['cmdkey /list', 'path-outside'],
    ['robocopy a b', 'cmd:robocopy'],
    ['mklink x y', 'cmd:mklink'],
    ['start notepad', 'cmd:start'],
    // Shells e intérpretes
    ['powershell -Command "ls"', 'cmd:powershell'],
    ['powershell.exe -enc AAAA', 'cmd:powershell'],
    ['pwsh -c ls', 'cmd:pwsh'],
    ['cmd /c dir', 'path-outside'],
    ['cmd.exe', 'cmd:cmd'],
    ['wsl ls', 'cmd:wsl'],
    ['bash -c ls', 'shell'],
    ['wscript x.vbs', 'cmd:wscript'],
    ['cscript x.vbs', 'cmd:cscript'],
    ['mshta http://x', 'cmd:mshta'],
    ['rundll32 x,y', 'cmd:rundll32'],
    ['regsvr32 /s x.dll', 'path-outside'],
    ['py -c "print(1)"', 'interpreter-eval'],
    ['python -c "print(1)"', 'interpreter-eval'],
    ['node -e "1"', 'interpreter-eval'],
    // PowerShell: ejecución y red
    ['Invoke-Expression $x', 'expansion'],
    ['iex "ls"', 'cmd:iex'],
    ['Invoke-WebRequest http://x/a.ps1', 'cmd:invoke-webrequest'],
    ['iwr http://x', 'cmd:iwr'],
    ['irm http://x', 'cmd:irm'],
    ['Start-Process calc', 'cmd:start-process'],
    ['Set-ExecutionPolicy Bypass', 'cmd:set-executionpolicy'],
    ['Stop-Computer', 'cmd:stop-computer'],
    ['Add-Type -TypeDefinition x', 'cmd:add-type'],
    ['Register-ScheduledTask -TaskName x', 'cmd:register-scheduledtask'],
    ['Set-ItemProperty HKCU:\\x a b', 'cmd:set-itemproperty'],
    ['Import-Module x', 'cmd:import-module'],
    ['curl http://x', 'cmd:curl'],
    ['curl.exe -d a http://x', 'cmd:curl'],
    ['wget http://x', 'cmd:wget'],
    ['ssh host', 'cmd:ssh'],
    // Rutas fuera, unidad, UNC, dispositivo
    ['type C:\\Windows\\System32\\drivers\\etc\\hosts', 'sensitive-path'],
    ['type D:\\otro\\archivo.txt', 'path-outside'],
    ['type C:\\Users\\Ana\\otro\\a.txt', 'path-outside'],
    ['type \\\\servidor\\compartida\\a.txt', 'path-outside'],
    ['copy a.txt \\\\servidor\\c\\a.txt', 'path-outside'],
    ['type \\\\.\\PhysicalDrive0', 'path-outside'],
    ['echo x > C:\\Users\\Ana\\Desktop\\x.txt', 'redirect-outside'],
    ['echo x > ..\\fuera.txt', 'redirect-outside'],
    ['type ..\\fuera.txt', 'path-outside'],
    ['C:\\Windows\\System32\\whoami.exe', 'sensitive-path'],
    ['"C:\\Program Files\\x\\y.exe"', 'path-outside'],
    // Sensibles
    ['type %USERPROFILE%\\.ssh\\id_rsa', 'win-expansion'],
    ['type .ssh\\id_rsa', 'sensitive-path'],
    ['type C:\\Users\\Ana\\proj\\.env', 'sensitive-file'],
    ['type .env', 'sensitive-file'],
    ['type AppData\\Roaming\\x', 'sensitive-path'],
    ['type NTUSER.DAT', 'sensitive-path'],
    ['type "C:\\Users\\Ana\\proj\\..\\.aws\\credentials"', 'sensitive-path'],
    // Expansión y escapes de cmd
    ['echo %PATH%', 'win-expansion'],
    ['echo ^&calc', 'win-expansion'],
    ['echo %~dp0', 'win-expansion'],
    ['set X=1 & echo !X!', 'win-expansion'],
    ['echo hola > a.txt:oculto', 'win-stream'],
    ['echo $env:USERPROFILE', 'expansion'],
    ['echo `ls`', 'backtick'],
    ['git push', 'git-push'],
    ['git config --global user.name x', 'git-config-global']
  ])('%s', (c, why) => {
    expect(bashVerdict(c, win)).toBe(why)
  })

  it('el nombre del comando no se esquiva con mayúsculas, extensión ni ruta de sistema', () => {
    for (const c of [
      'POWERSHELL -c ls',
      'PowerShell.EXE -c ls',
      'Del.cmd x',
      'REG.EXE query x',
      'Invoke-WebRequest http://x',
      'IWR http://x'
    ]) {
      expect(bashVerdict(c, win), c).not.toBeNull()
    }
  })

  it('un enlace que sale del proyecto cuenta como fuera (realpath inyectado)', () => {
    const realpath = (p: string): string | null => (p.toLowerCase().includes('enlace') ? 'D:\\secretos\\a.txt' : p)
    expect(bashVerdict('type C:\\Users\\Ana\\proj\\enlace\\a.txt', { ...win, realpath })).toBe('path-outside')
    expect(bashVerdict('type C:\\Users\\Ana\\proj\\src\\a.txt', { ...win, realpath })).toBeNull()
  })
})

describe('editVerdict en Windows', () => {
  it('rutas dentro del proyecto (con \\ o /) pasan', () => {
    expect(editVerdict(['C:\\Users\\Ana\\proj\\src\\a.ts', 'C:/Users/Ana/proj/b.md', 'src\\c.ts'], win)).toBeNull()
  })
  it.each([
    [['C:\\Users\\Ana\\proj'], 'path-outside'],
    [['C:\\Users\\Ana\\otro\\a.ts'], 'path-outside'],
    [['D:\\x\\a.ts'], 'path-outside'],
    [['\\\\srv\\c\\a.ts'], 'path-outside'],
    [['..\\a.ts'], 'path-outside'],
    [['C:\\Users\\Ana\\proj\\.env'], 'sensitive-file'],
    [['C:\\Users\\Ana\\proj\\.ssh\\config'], 'sensitive-file'],
    [['C:\\Users\\Ana\\proj\\AppData\\Roaming\\x.txt'], 'sensitive-file'],
    [['C:\\Users\\Ana\\proj\\a.txt:oculto'], 'win-path-syntax'],
    [['C:\\Users\\Ana\\proj\\%TEMP%\\a'], 'win-path-syntax'],
    [['C:\\Users\\Ana\\proj\\PROGRA~1\\a'], 'win-path-syntax'],
    [['C:\\Users\\Ana\\proj\\*.ts'], 'glob-or-expansion']
  ])('%j → %s', (paths, why) => {
    expect(editVerdict(paths, win)).toBe(why)
  })
})

describe('Windows nunca aprueba más que macOS (misma lista de negativas)', () => {
  const MAC_DENIED = [
    'sudo ls',
    'ssh host',
    'scp a b:c',
    'rm -rf /',
    'rm -rf ../x',
    'curl -d a http://x',
    'cat ~/.ssh/id_rsa',
    'git push',
    'bash -c ls',
    'python3 -c "print(1)"',
    'echo x > ../a',
    'cat .env',
    'kill $PID',
    'eval ls',
    'find . -delete',
    'chmod -R 777 .'
  ]
  it.each(MAC_DENIED)('%s: si macOS lo deniega, Windows también', (c) => {
    expect(bashVerdict(c, mac)).not.toBeNull()
    expect(bashVerdict(c, win)).not.toBeNull()
  })
  it('macOS no cambia por existir la rama de Windows: lo de Windows no se interpreta allí', () => {
    // `del` o `Invoke-WebRequest` no son comandos de macOS; el veredicto de macOS es el de siempre.
    expect(bashVerdict('del archivo.txt', mac)).toBeNull()
    expect(bashVerdict('echo %PATH%', mac)).toBeNull()
    expect(bashVerdict('echo hola > a.txt:oculto', mac)).toBeNull()
  })
  it('sin plataforma explícita usa la del proceso (aquí no es win32 salvo en Windows real)', () => {
    const noPlat: ApprovalEnv = { sessionDir: '/Users/ana/proj', home: '/Users/ana' }
    expect(bashVerdict('npm test', noPlat)).toBeNull()
  })
  it('approvalVerdict con win32: solo bash/edit y el texto malo gana', () => {
    expect(approvalVerdict('bash', ['npm test'], win)).toBeNull()
    expect(approvalVerdict('bash', ['npm test', 'del x'], win)).toBe('cmd:del')
    expect(approvalVerdict('edit', ['src\\a.ts'], win)).toBeNull()
    expect(approvalVerdict('webfetch', ['x'], win)).toBe('kind')
  })
})

describe('isSensitivePath: ubicaciones de Windows', () => {
  it.each([
    'C:\\Users\\Ana\\AppData\\Roaming\\Microsoft\\Credentials\\ABC',
    'C:\\Users\\Ana\\AppData\\Roaming\\Microsoft\\Protect\\S-1-5-21\\key',
    'C:\\Users\\Ana\\AppData\\Local\\Microsoft\\Vault\\x',
    'C:\\Users\\Ana\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data',
    'C:\\Users\\Ana\\AppData\\Roaming\\gcloud\\credentials.db',
    'C:\\Users\\Ana\\AppData\\Roaming\\GitHub CLI\\hosts.yml',
    'C:\\Users\\Ana\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\x.default\\logins.json',
    'C:\\Users\\Ana\\NTUSER.DAT',
    'C:\\Users\\Ana\\ntuser.dat.LOG1',
    'C:\\Users\\Ana\\.ssh\\id_ed25519',
    'C:\\Users\\Ana\\proj\\.env'
  ])('%s', (p) => {
    expect(isSensitivePath(p)).toBe(true)
  })
  it('no marca lo corriente', () => {
    expect(isSensitivePath('C:\\Users\\Ana\\proj\\src\\index.ts')).toBe(false)
    expect(isSensitivePath('C:\\Users\\Ana\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe')).toBe(false)
  })
})
