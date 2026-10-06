; Instalador NSIS de Lazunox: SOLO instalación por usuario (%LOCALAPPDATA%\Programs\Lazunox).
; El actualizador propio (src/main/update/swap-win.ts) cambia esa carpeta sin permisos de administrador; una instalación
; «para todos los usuarios» (Program Files) no se podría actualizar y se quedaría en «Descargar». Esta macro la
; llama electron-builder antes de mostrar la página de modo y la salta: nunca pide UAC.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
