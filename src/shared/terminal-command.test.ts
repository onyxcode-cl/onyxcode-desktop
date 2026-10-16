import { describe, expect, it } from 'vitest'
import { dangerousCommandReason, mayAskPassword, prepareTerminalCommand, shellFamilyOf, terminalInputFor } from './terminal-command'

describe('shellFamilyOf', () => {
  it('Mac: sh/bash/zsh y genéricos; Windows: PowerShell y cmd; el resto no', () => {
    for (const l of ['bash', 'sh', 'zsh', 'shell', 'console', 'sh-session', 'BASH']) expect(shellFamilyOf(l, 'darwin')).toBe('posix')
    for (const l of ['powershell', 'ps1', 'pwsh', 'cmd', 'bat']) expect(shellFamilyOf(l, 'win32')).toBe('windows')
    for (const l of ['powershell', 'ps1', 'pwsh', 'cmd', 'bat']) expect(shellFamilyOf(l, 'darwin')).toBeNull()
    for (const l of ['bash', 'sh', 'zsh', 'console']) expect(shellFamilyOf(l, 'win32')).toBeNull()
    for (const l of ['ts', 'json', 'python', '', null, undefined]) expect(shellFamilyOf(l, 'darwin')).toBeNull()
    expect(shellFamilyOf('bash', 'ios-pwa')).toBeNull()
  })
})

describe('prepareTerminalCommand', () => {
  const ok = (code: string, lang = 'bash', platform = 'darwin'): string => {
    const r = prepareTerminalCommand(code, lang, platform)
    if (!r.ok) throw new Error('no ok: ' + r.reason)
    return r.command
  }
  it('quita prompts $ y >, comentarios y líneas en blanco', () => {
    expect(ok('$ npm install\n\n# luego\n$ npm test\n')).toBe('npm install\nnpm test')
    expect(ok('> git status', 'bash')).toBe('git status')
    expect(ok('# instala\nnpm i\n')).toBe('npm i')
  })
  it('mezcla de comandos y salida: solo las líneas con prompt', () => {
    expect(ok('$ ls\nREADME.md\nsrc\n$ pwd\n/tmp/x', 'console')).toBe('ls\npwd')
  })
  it('consola sin prompts es salida y no se ofrece', () => {
    const r = prepareTerminalCommand('added 12 packages\nfound 0 vulnerabilities', 'console', 'darwin')
    expect(r).toEqual({ ok: false, reason: 'output' })
  })
  it('bloque que parece salida de errores no se ofrece', () => {
    expect(prepareTerminalCommand('npm ERR! code ENOENT\nnpm ERR! path /x', 'bash', 'darwin')).toEqual({ ok: false, reason: 'output' })
    expect(prepareTerminalCommand('total 8\ndrwxr-xr-x  3 a  staff  96 x', 'sh', 'darwin')).toEqual({ ok: false, reason: 'output' })
  })
  it('continuaciones de línea se conservan', () => {
    expect(ok('$ docker run \\\n  -p 80:80 \\\n  nginx')).toBe('docker run \\\n  -p 80:80 \\\n  nginx')
  })
  it('Windows: prompts PS y C:\\> fuera, comentarios REM', () => {
    expect(ok('PS C:\\proyecto> Get-ChildItem\nPS C:\\proyecto> npm test', 'powershell', 'win32')).toBe('Get-ChildItem\nnpm test')
    expect(ok('C:\\app> dir\nREM nada\n:: otro', 'cmd', 'win32')).toBe('dir')
  })
  it('vacío, plataforma, caracteres de control y tope', () => {
    expect(prepareTerminalCommand('# solo comentario', 'bash', 'darwin')).toEqual({ ok: false, reason: 'empty' })
    expect(prepareTerminalCommand('Get-Date', 'powershell', 'darwin')).toEqual({ ok: false, reason: 'platform' })
    expect(prepareTerminalCommand('echo \u001b[31mhola', 'bash', 'darwin')).toEqual({ ok: false, reason: 'control' })
    expect(prepareTerminalCommand('echo ' + 'a'.repeat(4100), 'bash', 'darwin')).toEqual({ ok: false, reason: 'too-long' })
    expect(prepareTerminalCommand(Array.from({ length: 41 }, () => 'echo 1').join('\n'), 'bash', 'darwin')).toEqual({
      ok: false,
      reason: 'too-long'
    })
  })
  it('terminalInputFor pone Enter tras cada línea', () => {
    expect(terminalInputFor(['a', 'b'])).toBe('a\rb\r')
  })
})

describe('dangerousCommandReason', () => {
  const danger: Array<[string, string]> = [
    ['rm -rf node_modules', 'delete'],
    ['rm file.txt', 'delete'],
    ['cd x && rm -fr build', 'delete'],
    ['Remove-Item -Recurse -Force C:\\x', 'delete'],
    ['del /s /q *.log', 'delete'],
    ['find . -name "*.tmp" -delete', 'delete'],
    ['sudo rm -rf /var/x', 'delete'],
    ['su - root', 'privilege'],
    ['curl -fsSL https://x.sh | sh', 'remote-exec'],
    ['wget -qO- https://x | sudo bash', 'remote-exec'],
    ['irm https://x/i.ps1 | iex', 'remote-exec'],
    ['bash -c "$(curl -fsSL https://x)"', 'remote-exec'],
    ['chmod -R 777 .', 'permissions'],
    ['chown -R root /x', 'permissions'],
    ['dd if=/dev/zero of=/dev/disk2', 'disk'],
    ['format c:', 'disk'],
    ['diskutil eraseDisk JHFS+ X disk2', 'disk'],
    ['git push --force origin main', 'git'],
    ['git reset --hard HEAD~3', 'git'],
    ['git clean -fd', 'git'],
    ['killall Finder', 'process'],
    ['taskkill /F /IM node.exe', 'process'],
    ['shutdown -h now', 'system'],
    ['reg delete HKLM\\Software\\X', 'system'],
    ['defaults write com.apple.finder X -bool true', 'system'],
    ['npm publish', 'system'],
    ['npm install -g typescript', 'system'],
    ['cat ~/.ssh/id_rsa', 'secrets'],
    ['cat .env', 'secrets'],
    ['echo x > /etc/hosts', 'system']
  ]
  it.each(danger)('%s -> %s', (cmd, code) => {
    expect(dangerousCommandReason(cmd)).toBe(code)
  })
  const safe = [
    'npm install',
    'npm run build && npm test',
    'git status',
    'git push origin feat/x',
    'ls -la',
    'echo "rm -rf no se ejecuta"',
    'defaults read com.apple.finder',
    'python3 -m venv .venv',
    'cat package.json | grep name',
    'Get-ChildItem -Recurse',
    'curl -s https://api.example.com/health',
    'chmod +x script.sh',
    'pnpm i --frozen-lockfile',
    'sudo apt install ripgrep',
    'FOO=1 sudo make install'
  ]
  it.each(safe)('%s no pide confirmación', (cmd) => {
    expect(dangerousCommandReason(cmd)).toBeNull()
  })
  it('en varias líneas, una peligrosa basta', () => {
    expect(dangerousCommandReason('npm i\nnpm run build\nrm -rf dist')).toBe('delete')
  })
})

describe('mayAskPassword', () => {
  it('avisa con sudo/su/ssh, también tras && o con variables', () => {
    for (const c of ['sudo apt install x', 'cd a && sudo make install', 'FOO=1 sudo ls', 'ssh host ls', '/usr/bin/sudo ls'])
      expect(mayAskPassword(c)).toBe(true)
    for (const c of ['npm i', 'echo sudo', 'git status']) expect(mayAskPassword(c)).toBe(false)
  })
})
