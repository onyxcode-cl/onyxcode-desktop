---
name: soporte-remoto
description: Úsala cuando el usuario pida conectarse a OTRO computador (AnyDesk, RustDesk, TeamViewer, escritorio remoto) para diagnosticar lentitud, arreglar algo o instalar un driver o impresora usando la terminal del equipo remoto.
---

# Soporte remoto por escritorio remoto (AnyDesk y similares)

Dentro de la ventana de AnyDesk el equipo remoto es solo una imagen: no hay árbol de accesibilidad ni `element: N`.
Trabajas con **capturas, zoom y teclado**. Por eso: poca mano, mucho teclado y comandos cortos.

## 0. Antes de tocar nada
1. El equipo es de OTRA persona. Confirma en el chat que quien lo usa **sabe y autoriza** el acceso (di el ID y a quién pertenece). Sin eso, no sigas.
2. Nunca escribas contraseñas (la de AnyDesk, la de administrador, la del UAC o `sudo`): si aparece una, para y pide a la persona que la ponga. Tampoco desactives antivirus ni firewall.
3. **Avisos de certificado, huella o «equipo no verificado» al conectar: NO los aceptes tú.** Detente, descríbele al usuario qué dice el aviso (nombre y dirección del equipo) y espera su OK en el chat. Aceptarlo es confiar en ese equipo: es decisión suya, aunque el equipo parezca el suyo.
4. Plan primero, con los comandos exactos que vas a ejecutar. Lo de **solo lectura** va antes; lo que **cambia** el equipo, después y listado aparte.

## 1. Conectar
- Abre AnyDesk con `open_application`, escribe el ID en el campo «Dirección remota» y pulsa Enter. La persona remota debe **aceptar** (o hay acceso desatendido: no pidas la contraseña, que la ponga el usuario).
- Espera a que la ventana muestre el escritorio remoto; comprueba con una captura. Si se queda «esperando», dilo y detente.
- Identifica el sistema por la captura: Windows (barra de tareas, menú Inicio) o macOS (barra de menús, Dock).

## 2. Abrir la terminal remota
- **Windows**: `Win+R` (en AnyDesk usa su menú «Acciones → Insertar Win+R» si la tecla no pasa), escribe `powershell`, Enter. Para administrador, `Win+X` → «Terminal (administrador)» y deja que la persona acepte el UAC.
- **macOS**: `Cmd+Espacio`, escribe `Terminal`, Enter.
- Deja la ventana grande y con letra legible. Comprueba con una captura que el cursor está en el prompt.

## 3. Escribir y leer
- Escribe **una orden por vez**, acotada (`| select -first 10`, `| head -20`) y sigue con Enter.
- `type_text` escribe por **teclas físicas**. En **Windows App** el teclado tiene dos modos (menú *Conexiones › Modo de teclado*): **Scancode** manda la tecla física y el PC remoto la interpreta con SU distribución (por eso `{ } [ ] | @ \` pueden salir cambiados) y **Unicode** manda el carácter ya traducido, sin depender de la distribución del PC remoto. Atajos del propio cliente: `ctrl+cmd+u` = Unicode, `ctrl+cmd+k` = Scancode.
- **Antes de escribir órdenes con símbolos en Windows App**: pulsa `ctrl+cmd+u` (modo Unicode) y escribe. Para atajos del remoto (Ctrl+C, Win+R…) vuelve a `ctrl+cmd+k`. Dile al usuario que cambiaste el modo y déjalo como lo encontraste al terminar.
- **La imagen del equipo remoto llega con retraso** (a veces varios segundos): antes de leer una captura espera 3-4 s con `computer_wait`; si no, verás la línea de ANTES y creerás que falló. Mejor aún: haz una captura, espera, y vuelve a capturar para comparar.
- **El portapapeles remoto es poco fiable** (el cliente lo sincroniza con retraso y a veces entrega el texto anterior): `input: "paste"` es el ÚLTIMO recurso. Si salió el comando viejo, cancela la línea (`ctrl+c`) y vuelve a `input: "keys"`.
- Si no apareció nada: repite con `input: "keys"` (y `layout: "us"` si el equipo remoto tiene teclado inglés); si pegar falla, prueba `paste_key: "ctrl+v"`. Si tras dos intentos sigue mal, **para** y dilo: no reintentes lo mismo.
- Alternativa que evita todo teclado: ordenes sin símbolos raros (`Get-Process`, `hostname`, `ipconfig`) o dividir el trabajo en pasos simples.
- Lee el resultado con `zoom` sobre la región de la terminal: nunca adivines texto borroso. Si no se lee, limpia (`cls` / `clear`) y repite más corto.
- Tras cada orden que cambia algo, **vuelve a consultar** el estado para comprobarlo.

## 4. Diagnóstico de lentitud (solo lectura; ⚠ = sin probar en este equipo)
**Windows (PowerShell)**
- Procesos que más CPU usan: `Get-Process | Sort CPU -desc | select -first 10 Name,CPU,WS`
- Memoria: `Get-CimInstance Win32_OperatingSystem | select @{n='LibreGB';e={[math]::Round($_.FreePhysicalMemory/1MB,1)}},@{n='TotalGB';e={[math]::Round($_.TotalVisibleMemorySize/1MB,1)}}`
- Disco lleno o lento: `Get-PSDrive C` · `Get-PhysicalDisk | select FriendlyName,MediaType,HealthStatus`
- Programas que arrancan con Windows: `Get-CimInstance Win32_StartupCommand | select Name,Command`
- Tiempo encendido: `(Get-Date)-(Get-CimInstance Win32_OperatingSystem).LastBootUpTime`
- Actualizaciones o escaneos en curso ⚠: `Get-Process TiWorker,MsMpEng -ErrorAction SilentlyContinue`
**macOS**
- `top -l 1 -o cpu -n 10 | head -20` · `memory_pressure | head -5` · `df -h /` · `uptime`

Conclusión: nombra la causa más probable con la evidencia (qué proceso, cuánta RAM libre, % de disco) antes de proponer arreglos.

## 5. Arreglos (piden confirmación del usuario; siempre reversibles)
- Antes de instalar o cambiar algo en Windows: punto de restauración `Checkpoint-Computer -Description "antes de soporte" -RestorePointType MODIFY_SETTINGS` (⚠ puede tardar o estar limitado a uno por día).
- Cerrar un proceso colgado: `Stop-Process -Name X` solo si es claramente de usuario; nunca procesos del sistema ni antivirus.
- Quitar un programa del inicio: desactívalo (no lo borres) y dilo.
- Temporales: lista y mide primero (`Get-ChildItem $env:TEMP | measure Length -Sum`); borrar solo con permiso explícito de la persona.

## 6. Driver de impresora ⚠
- Descarga el driver **solo del sitio oficial del fabricante** (verifica el dominio). Comprueba la firma: `Get-AuthenticodeSignature .\driver.exe` debe decir `Valid`.
- Windows: `pnputil /add-driver C:\ruta\*.inf /install` · `Add-PrinterDriver -Name "Nombre exacto del driver"` · red: `Add-PrinterPort -Name IP_10.0.0.5 -PrinterHostAddress 10.0.0.5` · `Add-Printer -Name "Impresora" -DriverName "..." -PortName IP_10.0.0.5`
- Comprueba: `Get-Printer | select Name,DriverName,PortName,PrinterStatus` y pide imprimir una página de prueba.
- macOS: `lpadmin -p NOMBRE -E -v ipp://IP/ipp/print -m everywhere` (impresoras con AirPrint no necesitan driver); instalar un `.pkg` pide contraseña de administrador: la escribe la persona.

## 7. Cierre
- Resume: qué encontraste (con datos), qué cambiaste, cómo deshacerlo y qué queda pendiente.
- Cierra la terminal remota y **desconecta la sesión** de AnyDesk. No dejes nada abierto.
- Guarda el registro de los comandos ejecutados en un archivo `soporte-AAAA-MM-DD.txt` del Escritorio del usuario (no en el equipo remoto).
