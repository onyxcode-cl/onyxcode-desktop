cask "lazunox" do
  version "0.3.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/PENDIENTE/lazunox/releases/download/v#{version}/lazunox-#{version}-arm64.dmg"
  name "Lazunox"
  desc "Aplicación de escritorio para trabajar con agentes de código"
  homepage "https://github.com/PENDIENTE/lazunox"

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

  # Solo con `brew uninstall --zap`. Borra cachés y preferencias, NUNCA tus datos
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
    Debe contener: certificate leaf = H"c778a9630c6a627449b1a39e1e62b7a2a2565eb2"

    Desinstalar no borra tus datos (~/Library/Application Support/Lazunox).
    `brew uninstall --zap` tampoco: solo limpia cachés y preferencias.
  EOS
end
