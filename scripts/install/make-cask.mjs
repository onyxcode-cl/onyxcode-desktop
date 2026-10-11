#!/usr/bin/env node
// Genera la cask de Homebrew de Lazunox para una release.
// Uso: node scripts/install/make-cask.mjs --version 0.3.0 --sha256 <64 hex> --repo dueño/repo [--out ruta]
// Sin --out escribe en packaging/homebrew-tap/Casks/lazunox.rb. No publica nada ni usa la red.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DEFAULT_OUT = join(ROOT, 'packaging', 'homebrew-tap', 'Casks', 'lazunox.rb')

/** Origen de las releases (el mismo que RELEASES_ORIGIN de src/shared/brand.ts: GitHub). */
export const RELEASES_ORIGIN = 'https://github.com'

export function renderCask({ version, sha256, repo, origin = RELEASES_ORIGIN }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error(`versión inválida: «${version}» (esperado X.Y.Z)`)
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new Error('--sha256 debe ser un SHA-256 de 64 caracteres hexadecimales en minúsculas')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error(`--repo debe tener la forma dueño/repositorio (recibido «${repo}»)`)
  return `cask "lazunox" do
  version "${version}"
  sha256 "${sha256}"

  url "${origin}/${repo}/releases/download/v#{version}/lazunox-#{version}-arm64.dmg"
  name "Lazunox"
  desc "Aplicación de escritorio para trabajar con agentes de código"
  homepage "${origin}/${repo}"

  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Lazunox.app"

  # La app va firmada con un certificado propio y sin notarizar: se quita la marca de cuarentena
  # para que macOS no bloquee la primera apertura. Solo afecta a Lazunox.app.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Lazunox.app"],
                   must_succeed: false
  end

  # Solo con \`brew uninstall --zap\`. Borra cachés y preferencias, NUNCA tus datos
  # (~/Library/Application Support/Lazunox: sesiones, ajustes y claves cifradas).
  zap trash: [
    "~/Library/Caches/cl.bentec.lazunox",
    "~/Library/Preferences/cl.bentec.lazunox.plist",
    "~/Library/Saved Application State/cl.bentec.lazunox.savedState",
  ]

  caveats <<~EOS
    Lazunox va firmada con un certificado propio (autofirmado) y NO está notarizada por Apple,
    porque no hay Developer ID. Por eso no está en el catálogo oficial de Homebrew sino en este tap.
    Esta cask quita la marca de cuarentena al instalar, así que macOS no debería mostrar el aviso.
    Solo funciona en Mac con chip Apple (arm64).

    Comprueba la firma cuando quieras:
      codesign -d -r- /Applications/Lazunox.app
    Debe contener: certificate leaf = H"8446c25f2c710d66701c262f048390d8f6edba31"

    Desinstalar no borra tus datos (~/Library/Application Support/Lazunox).
    \`brew uninstall --zap\` tampoco: solo limpia cachés y preferencias.
  EOS
end
`
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (['--version', '--sha256', '--repo', '--out'].includes(a)) o[a.slice(2)] = argv[++i] ?? ''
    else throw new Error(`opción desconocida: ${a}`)
  }
  return o
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.version) o.version = o.version.replace(/^v/, '')
    const out = o.out || DEFAULT_OUT
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, renderCask(o))
    console.log(`Cask escrita en ${out}`)
  } catch (e) {
    console.error(`Error: ${e.message}`)
    console.error('Uso: node scripts/install/make-cask.mjs --version X.Y.Z --sha256 <64 hex> --repo dueño/repo [--out ruta]')
    process.exit(1)
  }
}
