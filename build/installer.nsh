; Instalador NSIS de Lazunox: SOLO instalación por usuario (%LOCALAPPDATA%\Programs\Lazunox).
; El actualizador propio (src/main/update/swap-win.ts) cambia esa carpeta sin permisos de administrador; una instalación
; «para todos los usuarios» (Program Files) no se podría actualizar y se quedaría en «Descargar». Esta macro la
; llama electron-builder antes de mostrar la página de modo y la salta: nunca pide UAC.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Desinstalacion: entorno aislado de Tareas en Windows (beta opcional, decision del dueno 2026-10-07).
; Pregunta si quitar la distro propia `Lazunox-Tareas`. Reglas (las vigila scripts/win-cu-scripts.test.mjs):
;  - en silencioso (/S) y en una actualizacion (--updated) la respuesta es NO: no se toca nada;
;  - solo se ejecuta `wsl.exe --unregister Lazunox-Tareas` (nombre fijo); jamas `--shutdown`, ni docker-desktop, ni la
;    distro antigua de nombre ajeno;
;  - antes se comprueba que la distro existe (`wsl.exe -l -q` sale en UTF-16LE: se normaliza con PowerShell quitando los NUL
;    y se compara el nombre EXACTO; ante la duda no se desregistra nada);
;  - todo con limite de tiempo; si no hay wsl.exe se salta sin error.
!include x64.nsh
!macro customUnInstall
  ${IfNot} ${Silent}
  ${IfNot} ${isUpdated}
    ; el desinstalador es de 32 bits: sin esto System32 se redirige a SysWOW64 y no se ve wsl.exe
    ${If} ${RunningX64}
      ${DisableX64FSRedirection}
    ${EndIf}
    ${If} ${FileExists} "$SYSDIR\wsl.exe"
      nsExec::ExecToLog /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$env:WSL_UTF8=1; $$o = (& wsl.exe -l -q 2>$$null | Out-String) -replace [char]0,\"\"; if (($$o -split \"\r?\n\" | ForEach-Object { $$_.Trim() }) -ccontains \"Lazunox-Tareas\") { exit 0 } else { exit 3 }"'
      Pop $R0
      ${If} $R0 == "0"
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Quitar tambien el entorno aislado de Tareas (distro Lazunox-Tareas)? Se borraran sus archivos." IDYES lazunoxUnregister IDNO lazunoxKeepWsl
        lazunoxUnregister:
          nsExec::ExecToLog /TIMEOUT=120000 '"$SYSDIR\wsl.exe" --unregister Lazunox-Tareas'
          Pop $R0
          ; solo se borra la carpeta si la distro se desregistro de verdad
          ${If} $R0 == "0"
            RMDir /r "$LOCALAPPDATA\Lazunox\wsl"
          ${EndIf}
        lazunoxKeepWsl:
      ${EndIf}
    ${EndIf}
    ${If} ${RunningX64}
      ${EnableX64FSRedirection}
    ${EndIf}
  ${EndIf}
  ${EndIf}
!macroend
