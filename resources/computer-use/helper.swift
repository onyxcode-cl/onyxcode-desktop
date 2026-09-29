// cu-helper: helper nativo de "computer use" para OpenDesk (macOS).
//
// Uso: cu-helper [--instant] [--char-delay ms] <comando> [args…]
//   --instant                     sin animación (teletransporta el cursor, texto por trozos)
//   --char-delay ms               retardo base por carácter al escribir (por defecto 14 ms)
//   (las banderas van ANTES del comando; también CU_INSTANT=1 / CU_CHAR_DELAY_MS en el entorno)
//
//   move x y                      mueve el cursor (trayectoria suave y visible)
//   click x y [left|right] [n]    clic (n = 1 simple, 2 doble, 3 triple)
//   drag x1 y1 x2 y2              arrastra con el botón izquierdo
//   scroll x y dx dy              rueda (líneas; dy>0 = hacia abajo, dx>0 = hacia la derecha)
//   type "texto"                  escribe texto unicode
//   key "cmd+shift+t"             combinación de teclas
//   cursor                        {"x":…,"y":…}
//   screens                       [{"width":…,"height":…,"scale":…,"x":…,"y":…,"main":…}]
//   permissions                   {"accessibility":bool,"screenRecording":bool}
//   request-permissions           lanza los prompts del sistema y devuelve el estado
//   frontmost                     {"name":…,"bundleId":…,"pid":…}
//   open-app "Nombre"             abre/activa una app
//   open-app-bg "Nombre|bundleId" abre la app SIN activarla (queda detrás)
//   activate "bundleId|Nombre"    reactiva la app y se asegura de que tenga una ventana visible
//                                 (≤3s: activa → desminimiza por AX → reabre si hace falta)
//   hide-apps <keepCsv>           oculta las apps normales que no estén en la lista (nunca Finder)
//   unhide-apps <csv>             vuelve a mostrar las apps de la lista
//
//   ax-tree <bundleId> [maxDepth=12] [maxNodes=500]         árbol AX de la app
//   ax-find <bundleId> <jsonQuery>                          busca elementos: {role?,title?,text?,limit?≤50}
//   find-elements --app <bundleId> [--role a,b,…] [--query "texto"]
//                                  localiza elementos CLICABLES por texto/rol para el ratón REAL:
//                                  acotado por nodos (4000) Y por tiempo (800 ms), a diferencia de
//                                  ax-find. Cada resultado trae `screenPoint` (centro, en puntos de
//                                  pantalla) listo para `click`. JSON: array de objetos.
//   ax-frame <bundleId> <ref>                               marco de un elemento
//   ax-press <bundleId> <ref> [expectRole] [expectTitle]    kAXPressAction
//   ax-set-value <bundleId> <ref> <valor…>                  escribe kAXValueAttribute
//   ax-action <bundleId> <ref> <acción>                     acción AX de la lista cerrada
//   window-shot <bundleId> <outPath> [windowIndex=0]        captura una ventana con ScreenCaptureKit
//   record <outDir> [--mic] [--max-seconds N≤900] [--exclude csv]   graba una demostración
//   transcribe <audio> [locale=es-ES]                       transcribe en el dispositivo (SFSpeechRecognizer)
//   mic-permission                 estado del micrófono, sin pedirlo
//   mic-request                    pide el permiso de micrófono (proceso aislado) y devuelve el estado
//
// `ref` (ax-*): ruta de índices, "w<ventana>.<hijo>.<hijo>…" o "m.<i>…" para la barra de menús.
// Códigos de salida nuevos: 6 = voz no autorizada, 7 = app no está en ejecución,
// 8 = el elemento cambió, 9 = campo seguro, 10 = valor no editable, 11 = acción no permitida,
// 12 = recurso no disponible.
//
// Coordenadas: puntos de pantalla, origen arriba-izquierda de la pantalla principal
// (el mismo sistema que usa CGEvent). Salida: JSON en stdout; errores en stderr + exit 1.
//
// Movimiento "humano": move/click/drag/scroll llevan el cursor desde su posición actual hasta el
// destino por una curva de Bézier ligeramente arqueada, con perfil de velocidad de mínimo jerk,
// 250–600 ms según la distancia, a ~120 Hz, publicando mouseMoved/leftMouseDragged para que las
// apps vean el hover. El clic ocurre tras llegar y una pausa corta. Si existe COMPUTER_STOP_FILE,
// la animación/escritura se aborta (exit 3) soltando el botón si estaba pulsado.

import AppKit
import ApplicationServices
import AVFoundation
import Carbon
import CoreGraphics
import Foundation
import ScreenCaptureKit
import Speech

// MARK: - Utilidades

func out(_ obj: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("{}")
    }
}

func fail(_ msg: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

func num(_ args: [String], _ i: Int, _ name: String) -> Double {
    guard i < args.count, let v = Double(args[i]) else { fail("Falta o es inválido el argumento \(name)") }
    return v
}

// `.privateState`, no `.hidSystemState`: aísla nuestros eventos sintéticos del estado real de
// modificadores del teclado físico. La distinción fiable para `watch-esc`, sin embargo, es la
// marca `eventSourceUserData` de abajo: en este SDK, leer el campo `eventSourceStateID` de un
// CGEvent YA POSTEADO no devuelve el enum pequeño esperado (verificado), así que no basta por sí
// sola para diferenciar un Esc sintético de uno real.
let source = CGEventSource(stateID: .privateState)

/// Marca cada evento que posteamos nosotros mismos (campo `eventSourceUserData`, libre para
/// cualquier valor de 32 bits) para poder ignorarlos en `watch-esc` sin depender de
/// `eventSourceStateID`. Valor arbitrario, sin significado especial: "LAPIS" en ASCII truncado.
let ownEventTag: Int64 = 0x4C41_5049

/// Gancho global opcional que el handler de SIGTERM ejecuta antes de `exit` (kill-switch de
/// OpenDesk). Lo usa `record` para cerrar de forma ordenada (parar el tap, el micrófono y escribir
/// `summary.json`) aunque solo queden ~300 ms antes del SIGKILL.
var terminationHook: (() -> Void)?

func post(_ e: CGEvent?) {
    guard let e = e else { fail("No se pudo crear el evento (¿permiso de Accesibilidad?)") }
    e.setIntegerValueField(.eventSourceUserData, value: ownEventTag)
    e.post(tap: .cghidEventTap)
}

func pause(_ ms: UInt32) { usleep(ms * 1000) }

func currentCursor() -> CGPoint {
    return CGEvent(source: nil)?.location ?? .zero
}

func requireAccessibility() {
    if !AXIsProcessTrusted() {
        fail("Sin permiso de Accesibilidad: concédelo en Ajustes del Sistema › Privacidad y seguridad › Accesibilidad", code: 2)
    }
}

// MARK: - Opciones

var instant = ProcessInfo.processInfo.environment["CU_INSTANT"] == "1"
var charDelayMs: Double = Double(ProcessInfo.processInfo.environment["CU_CHAR_DELAY_MS"] ?? "") ?? 14
let stopFile = ProcessInfo.processInfo.environment["COMPUTER_STOP_FILE"] ?? ""
/// Archivo donde `watch-esc` anota el instante (epoch ms) del último keyDown REAL (no nuestro),
/// para que `recent-input` pueda leerlo. Necesario porque una vez posteado a `cghidEventTap` un
/// evento sintético es indistinguible de uno real para las APIs de "tiempo desde el último evento"
/// del sistema (`CGEventSource.secondsSinceLastEventType`, verificado: también las actualiza).
let inputFile = ProcessInfo.processInfo.environment["COMPUTER_INPUT_FILE"] ?? ""
var buttonHeld = false

/// Kill-switch: aborta a mitad de animación/escritura si el usuario pulsó Detener.
func checkStop() {
    if !stopFile.isEmpty && FileManager.default.fileExists(atPath: stopFile) {
        if buttonHeld {
            post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: currentCursor(), mouseButton: .left))
        }
        fail("Control detenido por el usuario", code: 3)
    }
}

// MARK: - Ratón

func moveTo(_ p: CGPoint) {
    post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
}

/// Duración de la animación según la distancia (misma fórmula que el overlay en service/overlay.ts).
func motionDuration(_ dist: Double) -> Double {
    return 0.25 + 0.35 * min(1.0, dist / 1400.0)
}

/// Perfil de velocidad de mínimo jerk (arranque y frenada suaves, como una mano).
func minJerk(_ t: Double) -> Double {
    return t * t * t * (10 - 15 * t + 6 * t * t)
}

/// Lleva el cursor de su posición actual a `b` por una curva suave. `dragging` publica
/// leftMouseDragged (botón izquierdo pulsado) en lugar de mouseMoved.
func glide(to b: CGPoint, dragging: Bool = false) {
    let a = currentCursor()
    let dx = b.x - a.x, dy = b.y - a.y
    let dist = (dx * dx + dy * dy).squareRoot()
    let type: CGEventType = dragging ? .leftMouseDragged : .mouseMoved
    if instant || dist < 3 {
        post(CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: b, mouseButton: .left))
        return
    }
    // Punto de control desplazado en perpendicular: arco leve (4–12 % de la distancia).
    let side: Double = Bool.random() ? 1 : -1
    let bend = min(90.0, dist * Double.random(in: 0.04...0.12)) * side
    let mx = (a.x + b.x) / 2 - dy / dist * bend
    let my = (a.y + b.y) / 2 + dx / dist * bend
    let duration = motionDuration(dist)
    let hz = 120.0
    let frames = max(8, Int(duration * hz))
    let start = DispatchTime.now().uptimeNanoseconds
    for i in 1...frames {
        checkStop()
        let t = minJerk(Double(i) / Double(frames))
        let u = 1 - t
        let p = CGPoint(x: u * u * a.x + 2 * u * t * mx + t * t * b.x,
                        y: u * u * a.y + 2 * u * t * my + t * t * b.y)
        post(CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: i == frames ? b : p, mouseButton: .left))
        // Reloj absoluto: sin deriva acumulada aunque post() tarde.
        let due = start + UInt64(Double(i) * 1e9 / hz)
        let now = DispatchTime.now().uptimeNanoseconds
        if due > now { usleep(UInt32((due - now) / 1000)) }
    }
}

func click(_ p: CGPoint, right: Bool, count: Int) {
    let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = right ? .right : .left
    glide(to: p)
    pause(instant ? 30 : UInt32.random(in: 60...110))
    checkStop()
    for i in 1...max(1, count) {
        let d = CGEvent(mouseEventSource: source, mouseType: down, mouseCursorPosition: p, mouseButton: button)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        post(d)
        pause(instant ? 15 : UInt32.random(in: 35...70))
        let u = CGEvent(mouseEventSource: source, mouseType: up, mouseCursorPosition: p, mouseButton: button)
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        post(u)
        if i < count { pause(instant ? 60 : 80) }
    }
}

func drag(from a: CGPoint, to b: CGPoint) {
    glide(to: a)
    pause(instant ? 40 : 90)
    checkStop()
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
    buttonHeld = true
    pause(instant ? 60 : 120)
    if instant {
        let steps = 20
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
            post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
            pause(12)
        }
    } else {
        glide(to: b, dragging: true)
    }
    pause(instant ? 40 : 110)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
    buttonHeld = false
}

func scroll(at p: CGPoint, dx: Int32, dy: Int32) {
    glide(to: p)
    pause(instant ? 30 : 70)
    // En CGEvent, wheel1 > 0 desplaza hacia arriba; aquí dy > 0 = hacia abajo.
    if instant {
        post(CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0))
        return
    }
    // Línea a línea para que el desplazamiento se vea progresivo.
    let n = max(abs(dx), abs(dy))
    for i in 0..<n {
        checkStop()
        let sy: Int32 = i < abs(dy) ? (dy > 0 ? -1 : 1) : 0
        let sx: Int32 = i < abs(dx) ? (dx > 0 ? -1 : 1) : 0
        post(CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: sy, wheel2: sx, wheel3: 0))
        pause(22)
    }
}

// MARK: - Teclado

let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
    "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
    "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18,
    "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E, "o": 0x1F, "u": 0x20,
    "[": 0x21, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "'": 0x27, "k": 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, "n": 0x2D, "m": 0x2E, ".": 0x2F, "`": 0x32,
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31, "delete": 0x33, "backspace": 0x33,
    "escape": 0x35, "esc": 0x35, "forwarddelete": 0x75, "home": 0x73, "end": 0x77,
    "pageup": 0x74, "pagedown": 0x79, "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61, "f7": 0x62,
    "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
]

let modifierFlags: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand, "super": .maskCommand,
    "shift": .maskShift,
    "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate,
    "ctrl": .maskControl, "control": .maskControl,
    "fn": .maskSecondaryFn,
]

let aliases: [String: String] = [
    "arrowleft": "left", "arrowright": "right", "arrowup": "up", "arrowdown": "down",
    "page_up": "pageup", "page_down": "pagedown", "del": "forwarddelete", "plus": "=", "minus": "-",
]

func pressKey(_ combo: String) {
    let parts = combo.lowercased().split(separator: "+", omittingEmptySubsequences: false).map {
        String($0).trimmingCharacters(in: .whitespaces)
    }
    var flags = CGEventFlags()
    var keyName: String? = nil
    for (i, raw) in parts.enumerated() {
        // "cmd++" → la última parte vacía significa la tecla "+"
        var p = raw.isEmpty && i == parts.count - 1 ? "=" : raw
        if let a = aliases[p] { p = a }
        if let f = modifierFlags[p] { flags.insert(f) } else if !p.isEmpty { keyName = p }
    }
    guard let name = keyName else { fail("Combinación sin tecla principal: \(combo)") }
    guard let code = keyCodes[name] else { fail("Tecla desconocida: \(name)") }
    let d = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    d?.flags = flags
    post(d)
    pause(20)
    let u = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    u?.flags = flags
    post(u)
}

func typeChunk(_ units: [UInt16]) {
    var chunk = units
    let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
    d?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
    post(d)
    let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    u?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
    post(u)
}

func typeText(_ text: String) {
    if instant {
        // Trozos pequeños: algunas apps ignoran cadenas unicode largas en un único evento.
        let utf16 = Array(text.utf16)
        var i = 0
        while i < utf16.count {
            // "\n" y "\t" como teclas reales para que funcionen en formularios/terminales.
            let c = utf16[i]
            if c == 10 || c == 13 { pressKey("return"); i += 1; pause(8); continue }
            if c == 9 { pressKey("tab"); i += 1; pause(8); continue }
            var end = min(i + 16, utf16.count)
            if let nl = utf16[i..<end].firstIndex(where: { $0 == 10 || $0 == 13 || $0 == 9 }) { end = nl }
            // No cortar un par sustituto.
            if end < utf16.count, end > i + 1, UTF16.isLeadSurrogate(utf16[end - 1]) { end -= 1 }
            typeChunk(Array(utf16[i..<end]))
            pause(8)
            i = end
        }
        return
    }
    // Carácter a carácter (grafemas completos: emojis, acentos combinados) con un ritmo ligeramente
    // irregular. Textos largos aceleran para no pasar de ~4 s en total.
    let chars = Array(text)
    let base = max(0, min(charDelayMs, 4000.0 / Double(max(1, chars.count))))
    for ch in chars {
        checkStop()
        if ch == "\n" || ch == "\r\n" || ch == "\r" { pressKey("return") }
        else if ch == "\t" { pressKey("tab") }
        else { typeChunk(Array(String(ch).utf16)) }
        if base > 0 {
            var ms = base * Double.random(in: 0.6...1.4)
            if ch == " " || ch == "," || ch == "." { ms += base * 0.8 }
            usleep(UInt32(ms * 1000))
        }
    }
}

// MARK: - Info

func screensInfo() -> [[String: Any]] {
    let mainH = NSScreen.screens.first?.frame.height ?? 0
    return NSScreen.screens.enumerated().map { (i, s) in
        let f = s.frame
        return [
            "width": Double(f.width), "height": Double(f.height), "scale": Double(s.backingScaleFactor),
            // origen arriba-izquierda relativo a la pantalla principal
            "x": Double(f.origin.x), "y": Double(mainH - f.origin.y - f.height),
            "main": i == 0,
        ]
    }
}

func permissions() -> [String: Any] {
    return ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]
}

// MARK: - Grants por app (identificación de la app en un punto, campos seguros, entrada reciente)

func appInfo(pid: pid_t) -> [String: Any]? {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
    return ["name": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "", "pid": Int(pid)]
}

/// App bajo un punto de pantalla: primero AX (`AXUIElementCopyElementAtPosition`, más preciso con
/// paneles/hojas modales), si falla se usa la ventana on-screen más al frente que contiene el punto
/// (`CGWindowListCopyWindowInfo`, ya viene ordenada de frente hacia atrás).
func appAt(_ p: CGPoint) -> [String: Any] {
    let systemWide = AXUIElementCreateSystemWide()
    var element: AXUIElement?
    if AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &element) == .success, let el = element {
        var pid: pid_t = 0
        if AXUIElementGetPid(el, &pid) == .success, pid > 0, let info = appInfo(pid: pid) {
            return info
        }
    }
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    if let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
        for w in list {
            guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let width = b["Width"], let height = b["Height"],
                  let pidNum = w[kCGWindowOwnerPID as String] as? Int else { continue }
            if CGRect(x: x, y: y, width: width, height: height).contains(p), let info = appInfo(pid: pid_t(pidNum)) {
                return info
            }
        }
    }
    return ["name": "", "bundleId": "", "pid": 0]
}

/// Apps con al menos una ventana visible en pantalla (una entrada por PID). Se usa para decidir qué
/// excluir de una captura (`screenshot-sck`): main pregunta el nivel de cada una y excluye las que
/// no tengan concesión.
func runningApps() -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    var seen = Set<pid_t>()
    var result: [[String: Any]] = []
    for w in list {
        guard let pidNum = w[kCGWindowOwnerPID as String] as? Int else { continue }
        let pid = pid_t(pidNum)
        if seen.contains(pid) { continue }
        seen.insert(pid)
        if let info = appInfo(pid: pid), let b = info["bundleId"] as? String, !b.isEmpty {
            result.append(info)
        }
    }
    return result
}

/// Rectángulos (puntos de pantalla, origen arriba-izquierda) de las ventanas visibles de las apps
/// dadas (por bundle id): usado para enmascarar apps no concedidas si ScreenCaptureKit no está
/// disponible (fallback de `screenshot-sck`).
func windowsOf(bundleIds: Set<String>) -> [[String: Any]] {
    guard !bundleIds.isEmpty else { return [] }
    let pids = Set(NSWorkspace.shared.runningApplications.compactMap { app -> pid_t? in
        guard let b = app.bundleIdentifier, bundleIds.contains(b) else { return nil }
        return app.processIdentifier
    })
    guard !pids.isEmpty else { return [] }
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.compactMap { w -> [String: Any]? in
        guard let pidNum = w[kCGWindowOwnerPID as String] as? Int, pids.contains(pid_t(pidNum)),
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let x = b["X"], let y = b["Y"], let width = b["Width"], let height = b["Height"] else { return nil }
        return ["x": Double(x), "y": Double(y), "width": Double(width), "height": Double(height)]
    }
}

/// true si el foco de teclado es un campo de contraseña: entrada segura del sistema
/// (`IsSecureEventInputEnabled`, la activa el propio campo al enfocarse) o el elemento con foco
/// (AX) es `AXSecureTextField` por rol o subrol.
func focusedIsSecure() -> Bool {
    if IsSecureEventInputEnabled() { return true }
    let systemWide = AXUIElementCreateSystemWide()
    var focused: AnyObject?
    guard AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
          let raw = focused else { return false }
    let element = raw as! AXUIElement
    var role: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    var subrole: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
    let r = (role as? String) ?? ""
    let sr = (subrole as? String) ?? ""
    return r == "AXSecureTextField" || sr == "AXSecureTextField"
}

// MARK: - AX genérico (ax-tree/ax-find/ax-frame/ax-press/ax-set-value/ax-action)
//
// `ref` = ruta de índices desde la raíz de la app: "w<ventana>.<hijo>.<hijo>…" (ventanas,
// `kAXWindowsAttribute`) o "m.<i>…" (barra de menús, `kAXMenuBarAttribute`); cada componente
// numérico posterior es un índice en `kAXChildrenAttribute` del elemento anterior. Es estable
// mientras el árbol no cambie de forma; si cambió, `resolveRef` devuelve nil (exit 8 en las
// llamadas que lo usan).

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success else { return nil }
    return ref as? String
}

func axBool(_ el: AXUIElement, _ attr: String) -> Bool? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success else { return nil }
    return (ref as? NSNumber)?.boolValue
}

/// Marco de un elemento AX vía `kAXPositionAttribute`/`kAXSizeAttribute` (cada uno un `AXValue`
/// que envuelve un `CGPoint`/`CGSize`), en puntos de pantalla, origen arriba-izquierda.
func axFrame(_ el: AXUIElement) -> [String: Double]? {
    var posRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let posValue = posRef, let sizeValue = sizeRef else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posValue as! AXValue, .cgPoint, &point),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return ["x": Double(point.x), "y": Double(point.y), "width": Double(size.width), "height": Double(size.height)]
}

func actionNames(_ el: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] else { return [] }
    return arr
}

/// Nodo JSON de un elemento AX para `ax-tree`/`ax-find`. `value` se recorta a 200 caracteres y
/// nunca se incluye en un `AXSecureTextField` (pone `secure:true` en su lugar).
func nodeJSON(_ el: AXUIElement, ref: String) -> [String: Any] {
    var d: [String: Any] = ["ref": ref]
    let role = axString(el, kAXRoleAttribute as String) ?? ""
    d["role"] = role
    let subrole = axString(el, kAXSubroleAttribute as String)
    if let sr = subrole { d["subrole"] = sr }
    if let t = axString(el, kAXTitleAttribute as String) { d["title"] = t }
    if let desc = axString(el, kAXDescriptionAttribute as String) { d["description"] = desc }
    let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
    d["secure"] = secure
    if !secure {
        var valueRef: AnyObject?
        if AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &valueRef) == .success {
            if let s = valueRef as? String {
                d["value"] = String(s.prefix(200))
            } else if let n = valueRef as? NSNumber {
                d["value"] = n.stringValue
            }
        }
    }
    d["enabled"] = axBool(el, kAXEnabledAttribute as String) ?? true
    d["focused"] = axBool(el, kAXFocusedAttribute as String) ?? false
    if let f = axFrame(el) { d["frame"] = f }
    d["actions"] = actionNames(el)
    return d
}

/// Resuelve un `ref` a su `AXUIElement`, o nil si el árbol cambió (índice fuera de rango, etc.).
func resolveRef(_ appEl: AXUIElement, _ ref: String) -> AXUIElement? {
    let parts = ref.split(separator: ".").map(String.init)
    guard let first = parts.first else { return nil }
    var current: AXUIElement
    if first == "m" {
        var menuBarRef: AnyObject?
        guard AXUIElementCopyAttributeValue(appEl, kAXMenuBarAttribute as CFString, &menuBarRef) == .success,
              let menuBar = menuBarRef else { return nil }
        current = menuBar as! AXUIElement
    } else if first.hasPrefix("w"), let widx = Int(first.dropFirst()) {
        var windowsRef: AnyObject?
        guard AXUIElementCopyAttributeValue(appEl, kAXWindowsAttribute as CFString, &windowsRef) == .success,
              let windows = windowsRef as? [AXUIElement], widx >= 0, widx < windows.count else { return nil }
        current = windows[widx]
    } else {
        return nil
    }
    for comp in parts.dropFirst() {
        guard let idx = Int(comp) else { return nil }
        var childrenRef: AnyObject?
        guard AXUIElementCopyAttributeValue(current, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement], idx >= 0, idx < children.count else { return nil }
        current = children[idx]
    }
    return current
}

/// Recorre el árbol AX en profundidad, acumulando nodos JSON hasta `maxDepth`/`maxNodes`.
struct AXWalker {
    var maxDepth: Int
    var maxNodes: Int
    var nodes: [[String: Any]] = []
    var truncated = false

    mutating func walk(_ el: AXUIElement, ref: String, depth: Int) {
        if nodes.count >= maxNodes { truncated = true; return }
        nodes.append(nodeJSON(el, ref: ref))
        if depth >= maxDepth {
            truncated = true
            return
        }
        var childrenRef: AnyObject?
        guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return }
        for (i, c) in children.enumerated() {
            if nodes.count >= maxNodes { truncated = true; return }
            walk(c, ref: "\(ref).\(i)", depth: depth + 1)
        }
    }
}

/// App EN EJECUCIÓN que coincide con el bundle id, o nil (exit 7 en las llamadas que lo usan).
func requireRunningApp(_ bundleId: String) -> NSRunningApplication? {
    return NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId })
}

/// Recorre las ventanas (y, si `includeMenuBar`, la barra de menús) de una app y devuelve el
/// resultado del walker, activando antes `AXManualAccessibility` (best-effort: necesario para que
/// las apps Electron/Chromium expongan su árbol AX).
func axTree(_ appEl: AXUIElement, maxDepth: Int, maxNodes: Int, includeMenuBar: Bool) -> AXWalker {
    AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    var walker = AXWalker(maxDepth: maxDepth, maxNodes: maxNodes)
    var windowsRef: AnyObject?
    if AXUIElementCopyAttributeValue(appEl, kAXWindowsAttribute as CFString, &windowsRef) == .success,
       let windows = windowsRef as? [AXUIElement] {
        for (i, w) in windows.enumerated() {
            if walker.nodes.count >= maxNodes { walker.truncated = true; break }
            walker.walk(w, ref: "w\(i)", depth: 0)
        }
    }
    if includeMenuBar, walker.nodes.count < maxNodes {
        var menuBarRef: AnyObject?
        if AXUIElementCopyAttributeValue(appEl, kAXMenuBarAttribute as CFString, &menuBarRef) == .success,
           let menuBar = menuBarRef {
            walker.walk(menuBar as! AXUIElement, ref: "m", depth: 0)
        }
    }
    return walker
}

struct AXQuery { var role: String?; var title: String?; var text: String?; var limit: Int }

func parseAXQuery(_ json: String) -> AXQuery {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        fail("Consulta JSON inválida para ax-find")
    }
    let limit = min(50, max(1, (obj["limit"] as? Int) ?? 50))
    return AXQuery(role: obj["role"] as? String, title: obj["title"] as? String, text: obj["text"] as? String, limit: limit)
}

func axFindMatches(_ nodes: [[String: Any]], query: AXQuery) -> [[String: Any]] {
    var matches: [[String: Any]] = []
    for node in nodes {
        if let r = query.role, (node["role"] as? String) != r { continue }
        if let t = query.title, !((node["title"] as? String) ?? "").lowercased().contains(t.lowercased()) { continue }
        if let txt = query.text {
            let hay = [node["title"] as? String, node["description"] as? String, node["value"] as? String]
                .compactMap { $0 }.joined(separator: " ").lowercased()
            if !hay.contains(txt.lowercased()) { continue }
        }
        matches.append(node)
        if matches.count >= query.limit { break }
    }
    return matches
}

// MARK: - find-elements (localizar elementos por texto/rol para el ratón REAL)
//
// Implementación independiente de `AXWalker`/`ax-find`: aquélla alimenta las herramientas `app_*` de
// fondo (referencias `ref` estables, sin límite de tiempo, pensada para árboles ya razonables) y
// ésta alimenta el clic con coordenadas de pantalla del modo "Control de la pantalla" — necesita el
// punto central YA calculado (`screenPoint`) y, sobre todo, un tope de TIEMPO además de nodos: hay
// apps (Ajustes del Sistema, algunas Electron) cuyo árbol AX es enorme o lento de recorrer, y aquí no
// hay ninguna `ref` que releer después si el recorrido se corta a medias — mejor devolver lo que haya.

/// Alias en lenguaje llano → rol AX real, para que el llamador no tenga que conocer los nombres
/// `AXFoo` exactos. Si el rol pedido ya empieza por "AX" (o no está en la lista), se usa tal cual
/// (o con la primera letra en mayúscula) como mejor esfuerzo.
let axRoleAliases: [String: String] = [
    "button": "AXButton", "textfield": "AXTextField", "textinput": "AXTextField",
    "searchfield": "AXTextField", "securetextfield": "AXSecureTextField", "textarea": "AXTextArea",
    "checkbox": "AXCheckBox", "switch": "AXCheckBox", "radiobutton": "AXRadioButton", "radio": "AXRadioButton",
    "menu": "AXMenu", "menuitem": "AXMenuItem", "menubutton": "AXMenuButton", "menubar": "AXMenuBar",
    "link": "AXLink", "statictext": "AXStaticText", "text": "AXStaticText", "label": "AXStaticText",
    "image": "AXImage", "slider": "AXSlider", "combobox": "AXComboBox", "popupbutton": "AXPopUpButton",
    "popup": "AXPopUpButton", "table": "AXTable", "outline": "AXOutline", "row": "AXRow", "cell": "AXCell",
    "list": "AXList", "window": "AXWindow", "sheet": "AXSheet", "toolbar": "AXToolbar", "group": "AXGroup",
    "scrollarea": "AXScrollArea", "scrollbar": "AXScrollBar", "tabgroup": "AXTabGroup",
    "disclosuretriangle": "AXDisclosureTriangle", "progressindicator": "AXProgressIndicator",
    "stepper": "AXIncrementor", "incrementor": "AXIncrementor", "colorwell": "AXColorWell",
]

func normalizeAXRole(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("AX") { return trimmed }
    let key = trimmed.lowercased().replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: "")
    if let mapped = axRoleAliases[key] { return mapped }
    guard let first = trimmed.first else { return trimmed }
    return "AX" + String(first).uppercased() + trimmed.dropFirst()
}

/// Minúsculas y sin diacríticos ("Música" ≈ "musica"), para comparar texto en español sin acentos.
func foldText(_ s: String) -> String {
    return s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
}

/// "Difusa" y barata (sin dependencias): sustring directa, o subsecuencia de los caracteres de
/// `needle` en `haystack` en el mismo orden (no necesariamente seguidos) — tolera pequeñas
/// variaciones de orden/espaciado sin necesitar una librería de distancia de edición.
/// La subsecuencia además debe caber en una ventana ajustada (como mucho el triple de caracteres de
/// `needle`, o 12) para no dar por buena una coincidencia dispersa en un texto largo sin relación
/// real (p. ej. "escritorio" "cabiendo" letra a letra dentro del nombre de un archivo cualquiera):
/// mejor no encontrar nada (y caer a la captura de pantalla) que ofrecer una coordenada falsa.
func fuzzyContains(_ haystack: String, _ needle: String) -> Bool {
    if needle.isEmpty { return true }
    if haystack.contains(needle) { return true }
    guard needle.count >= 3 else { return false }
    let hay = Array(haystack)
    var hIdx = 0
    var start: Int? = nil
    var last = 0
    for ch in needle {
        var found = false
        while hIdx < hay.count {
            if hay[hIdx] == ch {
                if start == nil { start = hIdx }
                last = hIdx
                hIdx += 1
                found = true
                break
            }
            hIdx += 1
        }
        if !found { return false }
    }
    guard let s = start else { return false }
    return (last - s + 1) <= max(needle.count * 3, 12)
}

struct FindElementsQuery { var roles: Set<String>?; var query: String? }

/// Texto combinado (título + descripción + identificador + valor, ya "folded") usado solo para
/// decidir si el elemento coincide con `--query`; nunca se incluye tal cual en la salida.
func findElementHaystack(_ el: AXUIElement, role: String, subrole: String?) -> String {
    let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
    var parts: [String] = []
    if let t = axString(el, kAXTitleAttribute as String) { parts.append(t) }
    if let d = axString(el, kAXDescriptionAttribute as String) { parts.append(d) }
    if let i = axString(el, kAXIdentifierAttribute as String) { parts.append(i) }
    if !secure, let v = axString(el, kAXValueAttribute as String) { parts.append(v) }
    return foldText(parts.joined(separator: " "))
}

/// Nodo de salida de `find-elements`: la forma que consume el MCP (`find_element`/`list_elements`),
/// deliberadamente más simple que `nodeJSON` (sin `ref`/`actions`: este flujo actúa por coordenadas
/// de pantalla reales, no por referencia AX).
func findElementNode(_ el: AXUIElement, role: String, subrole: String?, frame: [String: Double]) -> [String: Any] {
    let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
    var d: [String: Any] = ["role": role]
    if let t = axString(el, kAXTitleAttribute as String), !t.isEmpty { d["title"] = t }
    if let desc = axString(el, kAXDescriptionAttribute as String), !desc.isEmpty { d["description"] = desc }
    if let ident = axString(el, kAXIdentifierAttribute as String), !ident.isEmpty { d["identifier"] = ident }
    if !secure {
        var valueRef: AnyObject?
        if AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &valueRef) == .success {
            if let s = valueRef as? String, !s.isEmpty { d["value"] = String(s.prefix(200)) }
            else if let n = valueRef as? NSNumber { d["value"] = n.stringValue }
        }
    }
    let x = frame["x"] ?? 0, y = frame["y"] ?? 0, w = frame["width"] ?? 0, h = frame["height"] ?? 0
    d["enabled"] = axBool(el, kAXEnabledAttribute as String) ?? true
    d["x"] = x
    d["y"] = y
    d["width"] = w
    d["height"] = h
    d["screenPoint"] = ["x": x + w / 2, "y": y + h / 2]
    return d
}

/// Recorre el árbol AX acotado por NODOS y por TIEMPO (a diferencia de `AXWalker`): se detiene en
/// cuanto se agote cualquiera de los dos límites, o al reunir `maxMatches`, devolviendo lo que ya
/// tenga — nunca cuelga esperando a que una app termine de exponer un árbol gigante.
struct FindElementsWalker {
    let maxNodes: Int
    let maxMatches: Int
    let deadline: DispatchTime
    var matches: [[String: Any]] = []
    var visited = 0
    var truncated = false

    mutating func budgetExceeded() -> Bool {
        if visited >= maxNodes || matches.count >= maxMatches || DispatchTime.now() >= deadline {
            truncated = true
            return true
        }
        return false
    }

    mutating func walk(_ el: AXUIElement, query: FindElementsQuery) {
        if budgetExceeded() { return }
        visited += 1
        let role = axString(el, kAXRoleAttribute as String) ?? ""
        let subrole = axString(el, kAXSubroleAttribute as String)
        let roleOk = query.roles.map { $0.contains(role) } ?? true
        if roleOk, let frame = axFrame(el), (frame["width"] ?? 0) > 0, (frame["height"] ?? 0) > 0 {
            let textOk: Bool
            if let q = query.query, !q.isEmpty {
                textOk = fuzzyContains(findElementHaystack(el, role: role, subrole: subrole), q)
            } else {
                textOk = true
            }
            if textOk { matches.append(findElementNode(el, role: role, subrole: subrole, frame: frame)) }
        }
        var childrenRef: AnyObject?
        guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return }
        for c in children {
            if budgetExceeded() { return }
            walk(c, query: query)
        }
    }
}

/// Solo las ventanas de la app (a diferencia de `axTree`, no incluye la barra de menús: los ítems de
/// un menú cerrado no tienen marco en pantalla útil para un clic real).
func findElements(_ appEl: AXUIElement, maxNodes: Int, maxMatches: Int, budgetSeconds: Double, query: FindElementsQuery) -> (matches: [[String: Any]], truncated: Bool) {
    AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    var walker = FindElementsWalker(maxNodes: maxNodes, maxMatches: maxMatches, deadline: DispatchTime.now() + budgetSeconds)
    var windowsRef: AnyObject?
    if AXUIElementCopyAttributeValue(appEl, kAXWindowsAttribute as CFString, &windowsRef) == .success,
       let windows = windowsRef as? [AXUIElement] {
        for w in windows {
            if walker.budgetExceeded() { break }
            walker.walk(w, query: query)
        }
    }
    return (walker.matches, walker.truncated)
}

/// Resuelve el nombre de una app (el que ve el usuario) a su bundle id: primero entre las apps EN
/// EJECUCIÓN (coincidencia exacta y luego parcial, sin distinguir mayúsculas), y si no está
/// abierta, por Spotlight (`mdfind`) entre las instaladas. Usado por la herramienta `request_access`
/// del MCP para poder identificar la app que el modelo nombra en lenguaje natural.
func resolveApp(_ name: String) -> [String: Any] {
    let lower = name.lowercased()
    let running = NSWorkspace.shared.runningApplications
    if let exact = running.first(where: { ($0.localizedName ?? "").lowercased() == lower }) {
        return ["name": exact.localizedName ?? name, "bundleId": exact.bundleIdentifier ?? "", "found": !(exact.bundleIdentifier ?? "").isEmpty]
    }
    if let partial = running.first(where: { ($0.localizedName ?? "").lowercased().contains(lower) }) {
        return ["name": partial.localizedName ?? name, "bundleId": partial.bundleIdentifier ?? "", "found": !(partial.bundleIdentifier ?? "").isEmpty]
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/mdfind")
    p.arguments = ["kMDItemKind == 'Application' && kMDItemDisplayName ==[cd] '\(name)'"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = Pipe()
    do {
        try p.run()
        p.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let text = String(data: data, encoding: .utf8),
           let firstPath = text.split(separator: "\n").first,
           let bundle = Bundle(path: String(firstPath)) {
            return ["name": name, "bundleId": bundle.bundleIdentifier ?? "", "found": bundle.bundleIdentifier != nil]
        }
    } catch {
        // sin mdfind: seguir a "no encontrada"
    }
    return ["name": name, "bundleId": "", "found": false]
}

// MARK: - Reactivar app + asegurar ventana visible (`activate`, restaura el contexto del agente)

/// Busca una app EN EJECUCIÓN por bundle id exacto, o por nombre (exacto y luego parcial, sin
/// distinguir mayúsculas) — igual criterio que `resolveApp`, para aceptar lo que ya resolvió el MCP.
func findRunningApp(_ idOrName: String) -> NSRunningApplication? {
    let running = NSWorkspace.shared.runningApplications
    if let byBundle = running.first(where: { $0.bundleIdentifier == idOrName }) { return byBundle }
    let lower = idOrName.lowercased()
    if let exact = running.first(where: { ($0.localizedName ?? "").lowercased() == lower }) { return exact }
    return running.first(where: { ($0.localizedName ?? "").lowercased().contains(lower) })
}

/// true si el proceso tiene al menos una ventana normal (capa 0, tamaño no trivial) en pantalla.
func hasVisibleWindow(pid: pid_t) -> Bool {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return false }
    for w in list {
        guard let pidNum = w[kCGWindowOwnerPID as String] as? Int, pid_t(pidNum) == pid else { continue }
        guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
        guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let width = b["Width"], let height = b["Height"], width > 1, height > 1 else { continue }
        return true
    }
    return false
}

/// Desminimiza (AX `kAXMinimizedAttribute` → false) todas las ventanas minimizadas del proceso.
func unminimizeWindows(pid: pid_t) {
    let appEl = AXUIElementCreateApplication(pid)
    var windowsRef: AnyObject?
    guard AXUIElementCopyAttributeValue(appEl, kAXWindowsAttribute as CFString, &windowsRef) == .success,
          let windows = windowsRef as? [AXUIElement] else { return }
    for w in windows {
        var minimizedRef: AnyObject?
        if AXUIElementCopyAttributeValue(w, kAXMinimizedAttribute as CFString, &minimizedRef) == .success,
           let minimizedNum = minimizedRef as? NSNumber, minimizedNum.boolValue {
            AXUIElementSetAttributeValue(w, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }
    }
}

/// Reactiva la app (bundle id o nombre) y se asegura de que quede una ventana visible en pantalla
/// (≤3 s en total): activa → si no hay ventana, desminimiza por AX → si sigue sin ninguna, la
/// reabre (`open -a`/`-b`, NO AppleScript "reopen": ver la política del proyecto). Usado para
/// restaurar el contexto del agente tras una tarjeta `request_access` y por `open_application`.
func activateAndEnsureWindow(_ idOrName: String) -> [String: Any] {
    var app = findRunningApp(idOrName)
    var activated = false
    if let a = app { activated = a.activate(options: [.activateIgnoringOtherApps]) }
    func waitForWindow(_ seconds: Double) -> Bool {
        guard let a = app else { return false }
        let deadline = Date().addingTimeInterval(seconds)
        while true {
            if hasVisibleWindow(pid: a.processIdentifier) { return true }
            if Date() >= deadline { return false }
            usleep(150_000)
        }
    }
    if app == nil || !waitForWindow(1.2) {
        if let a = app {
            unminimizeWindows(pid: a.processIdentifier)
            if waitForWindow(0.6) { return ["ok": true, "activated": activated, "hasWindow": true] }
        }
        // Ni ventana normal ni minimizada: reabrir (relanza o le pide una ventana nueva a la app).
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = idOrName.contains(".") && !idOrName.contains(" ") ? ["-b", idOrName] : ["-a", idOrName]
        try? p.run()
        p.waitUntilExit()
        usleep(400_000)
        app = findRunningApp(idOrName) ?? app
        if let a = app { activated = a.activate(options: [.activateIgnoringOtherApps]) || activated }
        _ = waitForWindow(1.2)
    }
    let finalHasWindow = app.map { hasVisibleWindow(pid: $0.processIdentifier) } ?? false
    return ["ok": app != nil, "activated": activated, "hasWindow": finalHasWindow]
}

// MARK: - Capturas con ScreenCaptureKit (excluye apps no concedidas en el compositor)

func writePNG(_ image: CGImage, to path: String) -> Bool {
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: path))) != nil
}

/// Guarda `image` como JPEG, reducido si su lado más largo excede `maxSide` px. Usado por `record`
/// para las capturas por paso (ligeras: hasta 200 por grabación).
func writeJPEG(_ image: CGImage, to path: String, maxSide: CGFloat = 1280, quality: CGFloat = 0.6) -> Bool {
    let w = CGFloat(image.width), h = CGFloat(image.height)
    let scale = min(1.0, maxSide / max(w, h))
    let newW = max(1, Int(w * scale)), newH = max(1, Int(h * scale))
    var toWrite = image
    if scale < 1.0,
       let ctx = CGContext(data: nil, width: newW, height: newH, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: newW, height: newH))
        if let scaled = ctx.makeImage() { toWrite = scaled }
    }
    let rep = NSBitmapImageRep(cgImage: toWrite)
    guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: path))) != nil
}

@available(macOS 14.0, *)
func sckScreenshotExcluding(bundleIds: Set<String>) throws -> CGImage {
    let sem = DispatchSemaphore(value: 0)
    var resultImage: CGImage?
    var resultError: Error?
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                throw NSError(domain: "cu-helper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Sin pantalla compartible"])
            }
            let excluded = content.applications.filter { bundleIds.contains($0.bundleIdentifier) }
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
            let config = SCStreamConfiguration()
            let scale = NSScreen.screens.first(where: { screen in
                (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID
            })?.backingScaleFactor ?? 2
            config.width = Int(Double(display.width) * scale)
            config.height = Int(Double(display.height) * scale)
            config.showsCursor = true
            resultImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        } catch {
            resultError = error
        }
        sem.signal()
    }
    sem.wait()
    if let err = resultError { throw err }
    guard let img = resultImage else {
        throw NSError(domain: "cu-helper", code: 2, userInfo: [NSLocalizedDescriptionKey: "Sin imagen"])
    }
    return img
}

/// Captura una ventana concreta de `bundleId` con ScreenCaptureKit: `SCContentFilter(desktopIndependentWindow:)`
/// + `SCScreenshotManager` (nunca `CGWindowListCreateImage`, obsoleta/no disponible en este SDK).
/// Elige, entre las ventanas normales (capa 0) no minimizadas de la app, la más grande según
/// `CGWindowListCopyWindowInfo`, o la `windowIndex`-ésima de ese orden (0 = la más grande).
@available(macOS 14.0, *)
func windowShot(bundleId: String, windowIndex: Int) throws -> (CGImage, String) {
    guard let app = requireRunningApp(bundleId) else {
        fail("La app \(bundleId) no está en ejecución", code: 7)
    }
    let pid = app.processIdentifier
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        throw NSError(domain: "cu-helper", code: 12, userInfo: [NSLocalizedDescriptionKey: "No se pudo listar las ventanas"])
    }
    var candidates: [(id: CGWindowID, area: Double, title: String)] = []
    for w in list {
        guard let pidNum = w[kCGWindowOwnerPID as String] as? Int, pid_t(pidNum) == pid,
              let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
              let winId = w[kCGWindowNumber as String] as? Int,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let width = b["Width"], let height = b["Height"], width > 40, height > 40 else { continue }
        let title = (w[kCGWindowName as String] as? String) ?? ""
        candidates.append((id: CGWindowID(winId), area: Double(width * height), title: title))
    }
    candidates.sort { $0.area > $1.area }
    guard windowIndex >= 0, windowIndex < candidates.count else {
        throw NSError(domain: "cu-helper", code: 12, userInfo: [NSLocalizedDescriptionKey: "Sin ventana normal visible para \(bundleId)"])
    }
    let target = candidates[windowIndex]
    let sem = DispatchSemaphore(value: 0)
    var resultImage: CGImage?
    var resultError: Error?
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let scWindow = content.windows.first(where: { $0.windowID == target.id }) else {
                throw NSError(domain: "cu-helper", code: 12, userInfo: [NSLocalizedDescriptionKey: "Ventana no disponible para ScreenCaptureKit (¿permiso de Grabación de pantalla?)"])
            }
            let filter = SCContentFilter(desktopIndependentWindow: scWindow)
            let config = SCStreamConfiguration()
            config.width = max(1, Int(scWindow.frame.width * 2))
            config.height = max(1, Int(scWindow.frame.height * 2))
            config.showsCursor = false
            resultImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        } catch {
            resultError = error
        }
        sem.signal()
    }
    sem.wait()
    if let err = resultError { throw err }
    guard let img = resultImage else {
        throw NSError(domain: "cu-helper", code: 12, userInfo: [NSLocalizedDescriptionKey: "Sin imagen"])
    }
    return (img, target.title)
}

/// Enmascara rectángulos (negro sólido) sobre una imagen; `rects` en coordenadas de PÍXELES de la
/// imagen, origen arriba-izquierda (se voltean internamente al espacio de `CGContext`).
func maskImage(_ cgImg: CGImage, rects: [CGRect]) -> CGImage? {
    let width = cgImg.width, height = cgImg.height
    guard let ctx = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(cgImg, in: CGRect(x: 0, y: 0, width: width, height: height))
    ctx.setFillColor(CGColor(gray: 0.08, alpha: 1))
    for r in rects { ctx.fill(r) }
    return ctx.makeImage()
}

// MARK: - Esc físico (parada mientras el agente controla el Mac)

/// Anota el instante de un keyDown REAL en `inputFile` (lo lee `recent-input`). Se sobrescribe en
/// cada pulsación real; sin `COMPUTER_INPUT_FILE` no hace nada.
func noteRealKeyDown() {
    guard !inputFile.isEmpty else { return }
    let ms = Int64(Date().timeIntervalSince1970 * 1000)
    try? String(ms).write(toFile: inputFile, atomically: true, encoding: .utf8)
}

/// Segundos desde el último keyDown REAL anotado por `watch-esc` en `inputFile`. Un número grande
/// (nunca bloquea) si no hay vigía corriendo (sesión sin actividad reciente) o el archivo es
/// inválido: "no se puede saber" no debe impedir escribir, solo lo hace un dato positivo reciente.
func realKeyDownSeconds() -> Double {
    guard !inputFile.isEmpty,
          let raw = try? String(contentsOfFile: inputFile, encoding: .utf8),
          let ms = Int64(raw.trimmingCharacters(in: .whitespacesAndNewlines)) else { return 999_999 }
    let seconds = Double(Int64(Date().timeIntervalSince1970 * 1000) - ms) / 1000
    return max(0, seconds)
}

/// Escucha el teclado mientras corre (un solo tap para dos cosas, activo solo mientras hay control
/// en curso — lo arranca/para `service.ts`):
/// - Esc SIN modificadores de un Esc real (no nuestro, ver `ownEventTag`) → "STOP\n" en stdout (con
///   flush): el proceso principal lo trata como el botón Detener / ⌘⇧Esc.
/// - Cualquier keyDown real → anota la hora en `inputFile` (`recent-input`/"el usuario está
///   escribiendo ahora" del MCP lee ese archivo en vez de las APIs de idle-time del sistema, que no
///   distinguen un evento sintético nuestro de uno real una vez posteado — verificado).
/// Vive hasta que el proceso padre lo mata (SIGTERM).
func watchEsc() {
    let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: mask,
        callback: { _, type, event, _ in
            if type == .keyDown {
                // Ignora los eventos que nosotros mismos posteamos (marca `eventSourceUserData`
                // en `post()`, ver arriba); un evento real del teclado físico no la lleva.
                let isOurs = event.getIntegerValueField(.eventSourceUserData) == ownEventTag
                if !isOurs {
                    noteRealKeyDown()
                    let keycode = event.getIntegerValueField(.keyboardEventKeycode)
                    if keycode == 0x35 && event.flags.intersection([.maskCommand, .maskShift, .maskAlternate, .maskControl]).isEmpty {
                        print("STOP")
                        fflush(stdout)
                    }
                }
            }
            return Unmanaged.passUnretained(event)
        },
        userInfo: nil
    ) else {
        fail("No se pudo crear el event tap de Esc (¿permiso de Accesibilidad?)", code: 2)
    }
    guard let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
        fail("No se pudo crear la fuente del run loop")
    }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    CFRunLoopRun()
}

// MARK: - Micrófono y voz

/// Estado de autorización del micrófono ("authorized"/"denied"/"notDetermined"/"restricted"),
/// sin pedirlo. Atribuido al proceso responsable (la terminal en desarrollo, Lapis empaquetada).
func micStatusString() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
}

// MARK: - Grabar una skill (`record`)
//
// Tap de solo escucha (leftMouseDown/rightMouseDown/keyDown/scrollWheel, ignora los eventos que
// nosotros mismos posteamos, ver `ownEventTag`) + notificación de cambio de app de `NSWorkspace` +
// capturas JPEG con ScreenCaptureKit, todo en un `CFRunLoop` en el hilo principal. Escribe
// `events.jsonl` (una línea JSON por paso, con flush) y `summary.json` al terminar.

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/// Descripción de una combinación de teclas a partir del keycode/flags de un CGEvent REAL
/// (mismo vocabulario que acepta `key`, invirtiendo `keyCodes`).
func comboDescription(keycode: Int64, flags: CGEventFlags) -> String {
    var parts: [String] = []
    if flags.contains(.maskCommand) { parts.append("cmd") }
    if flags.contains(.maskControl) { parts.append("ctrl") }
    if flags.contains(.maskAlternate) { parts.append("alt") }
    if flags.contains(.maskShift) { parts.append("shift") }
    if flags.contains(.maskSecondaryFn) { parts.append("fn") }
    let name = keyCodes.first(where: { $0.value == CGKeyCode(truncatingIfNeeded: keycode) })?.key ?? "code\(keycode)"
    parts.append(name)
    return parts.joined(separator: "+")
}

/// Elemento AX bajo un punto (para el `element` de un paso `click`), o nil si no hay ninguno.
func axElementInfo(at p: CGPoint) -> [String: Any]? {
    let systemWide = AXUIElementCreateSystemWide()
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &element) == .success, let el = element else { return nil }
    var d: [String: Any] = [:]
    if let r = axString(el, kAXRoleAttribute as String) { d["role"] = r }
    if let sr = axString(el, kAXSubroleAttribute as String) { d["subrole"] = sr }
    if let t = axString(el, kAXTitleAttribute as String) { d["title"] = t }
    if let desc = axString(el, kAXDescriptionAttribute as String) { d["description"] = desc }
    return d.isEmpty ? nil : d
}

/// Una grabación en curso. Todo el estado mutable compartido entre el tap (hilo del run loop), el
/// observador de `NSWorkspace` y el hilo de stdin/temporizador pasa por `lock`.
final class Recorder {
    let outDir: String
    let maxSeconds: Double
    let wantsMic: Bool
    let exclude: Set<String>
    let startTime = Date()

    private let lock = NSLock()
    private var eventsHandle: FileHandle?
    private var stepCount = 0
    private var shotCount = 0
    private var lastShotTime = Date.distantPast
    private var textBuffer = ""
    private var scrollDx: Int64 = 0
    private var scrollDy: Int64 = 0
    private var lastScrollTime = Date.distantPast
    private var stopped = false
    private var micState = "off" // off|recording|denied
    private var tap: CFMachPort?
    private var appObserver: NSObjectProtocol?
    private var audioRecorder: AVAudioRecorder?

    init(outDir: String, maxSeconds: Double, mic: Bool, exclude: Set<String>) {
        self.outDir = outDir
        self.maxSeconds = maxSeconds
        self.wantsMic = mic
        self.exclude = exclude
    }

    func start() {
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: outDir + "/shots", withIntermediateDirectories: true)
        let eventsPath = outDir + "/events.jsonl"
        FileManager.default.createFile(atPath: eventsPath, contents: nil)
        eventsHandle = FileHandle(forWritingAtPath: eventsPath)
        if wantsMic { startMic() }
        startAppObserver()
        startTap()
        print("{\"event\":\"started\"}")
        fflush(stdout)
    }

    private func startMic() {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            micState = "denied"
            writeEvent(["t": nowMs(), "type": "warning", "text": "mic-denied"], withShot: false)
            return
        }
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let url = URL(fileURLWithPath: outDir + "/audio.m4a")
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            if rec.record() {
                audioRecorder = rec
                micState = "recording"
            } else {
                micState = "denied"
                writeEvent(["t": nowMs(), "type": "warning", "text": "mic-denied"], withShot: false)
            }
        } catch {
            micState = "denied"
            writeEvent(["t": nowMs(), "type": "warning", "text": "mic-denied"], withShot: false)
        }
    }

    private func startAppObserver() {
        appObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: nil
        ) { [weak self] note in
            guard let self = self,
                  let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self.flushText()
            self.writeEvent(["t": nowMs(), "type": "app",
                              "app": ["name": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? ""]], withShot: true)
        }
    }

    private func startTap() {
        let mask: CGEventMask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue) |
            CGEventMask(1 << CGEventType.rightMouseDown.rawValue) |
            CGEventMask(1 << CGEventType.keyDown.rawValue) |
            CGEventMask(1 << CGEventType.scrollWheel.rawValue)
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, info in
                if let info = info {
                    Unmanaged<Recorder>.fromOpaque(info).takeUnretainedValue().handle(type: type, event: event)
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: selfPtr
        ) else {
            fail("No se pudo crear el event tap de grabación (¿permiso de Accesibilidad?)", code: 2)
        }
        self.tap = tap
        guard let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            fail("No se pudo crear la fuente del run loop")
        }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handle(type: CGEventType, event: CGEvent) {
        // Ignora los eventos sintéticos/propios (marca `eventSourceUserData`, ver `post()`).
        if event.getIntegerValueField(.eventSourceUserData) == ownEventTag { return }
        switch type {
        case .keyDown:
            handleKeyDown(event)
        case .leftMouseDown, .rightMouseDown:
            flushText()
            let p = event.location
            var step: [String: Any] = ["t": nowMs(), "type": "click", "x": Double(p.x), "y": Double(p.y),
                                        "button": type == .rightMouseDown ? "right" : "left"]
            if let el = axElementInfo(at: p) { step["element"] = el }
            writeEvent(step, withShot: true)
        case .scrollWheel:
            handleScroll(event)
        default:
            break
        }
    }

    private func handleKeyDown(_ event: CGEvent) {
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags
        let comboFlags = flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskSecondaryFn])
        if !comboFlags.isEmpty {
            flushText()
            writeEvent(["t": nowMs(), "type": "key", "keys": comboDescription(keycode: keycode, flags: flags)], withShot: false)
            return
        }
        if keycode == 0x24 || keycode == 0x30 || keycode == 0x33 { // return/tab/delete: cierran el tramo de texto
            flushText()
            let name = keycode == 0x24 ? "return" : (keycode == 0x30 ? "tab" : "delete")
            writeEvent(["t": nowMs(), "type": "key", "keys": name], withShot: false)
            return
        }
        // No se guarda texto si el foco es un campo seguro (entrada segura del sistema activa).
        guard !IsSecureEventInputEnabled() else { return }
        var length = 0
        var chars = [UniChar](repeating: 0, count: 4)
        event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
        guard length > 0 else { return }
        lock.lock()
        textBuffer += String(utf16CodeUnits: chars, count: length)
        lock.unlock()
    }

    private func handleScroll(_ event: CGEvent) {
        let dy = event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
        let dx = event.getIntegerValueField(.scrollWheelEventDeltaAxis2)
        lock.lock()
        scrollDx += dx; scrollDy += dy
        let shouldEmit = Date().timeIntervalSince(lastScrollTime) > 0.3 && (scrollDx != 0 || scrollDy != 0)
        if shouldEmit { lastScrollTime = Date(); scrollDx = 0; scrollDy = 0 }
        lock.unlock()
        guard shouldEmit else { return }
        let p = currentCursor()
        writeEvent(["t": nowMs(), "type": "scroll", "x": Double(p.x), "y": Double(p.y)], withShot: false)
    }

    private func flushText() {
        lock.lock()
        let text = textBuffer
        textBuffer = ""
        lock.unlock()
        guard !text.isEmpty else { return }
        writeEvent(["t": nowMs(), "type": "text", "text": text], withShot: false)
    }

    /// Captura JPEG best-effort (≤200 en total, ≤1 cada 700 ms); devuelve la ruta relativa o nil.
    private func maybeCaptureShot() -> String? {
        guard #available(macOS 14.0, *) else { return nil }
        lock.lock()
        guard shotCount < 200, Date().timeIntervalSince(lastShotTime) > 0.7 else { lock.unlock(); return nil }
        shotCount += 1
        let idx = shotCount
        lastShotTime = Date()
        lock.unlock()
        guard let image = try? sckScreenshotExcluding(bundleIds: exclude) else { return nil }
        let name = String(format: "shots/shot-%04d.jpg", idx)
        guard writeJPEG(image, to: outDir + "/" + name) else { return nil }
        return name
    }

    private func writeEvent(_ dict: [String: Any], withShot: Bool) {
        var d = dict
        if withShot, let shot = maybeCaptureShot() { d["shot"] = shot }
        guard let data = try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]) else { return }
        lock.lock()
        eventsHandle?.write(data)
        eventsHandle?.write("\n".data(using: .utf8)!)
        stepCount += 1
        let count = stepCount
        lock.unlock()
        print("{\"event\":\"step\",\"count\":\(count)}")
        fflush(stdout)
    }

    /// Cierre ordenado (SIGINT, "stop" por stdin, `--max-seconds`, o `terminationHook` en SIGTERM):
    /// para el tap/observador/micrófono, escribe `summary.json` y el evento final "done".
    /// Idempotente: solo el primer llamador hace el trabajo.
    func finish(reason: String) {
        lock.lock()
        if stopped { lock.unlock(); return }
        stopped = true
        lock.unlock()
        flushText()
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let obs = appObserver { NSWorkspace.shared.notificationCenter.removeObserver(obs) }
        if let rec = audioRecorder, rec.isRecording { rec.stop() }
        eventsHandle?.closeFile()
        let durationMs = Int(Date().timeIntervalSince(startTime) * 1000)
        let micField = micState == "recording" ? "recorded" : (wantsMic ? "denied" : "off")
        let summary: [String: Any] = [
            "id": (outDir as NSString).lastPathComponent,
            "dir": outDir,
            "startedAt": Int(startTime.timeIntervalSince1970 * 1000),
            "durationMs": durationMs,
            "steps": stepCount,
            "mic": micField,
            "reason": reason,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: outDir + "/summary.json"))
        }
        print("{\"event\":\"done\",\"steps\":\(stepCount),\"durationMs\":\(durationMs),\"mic\":\"\(micField)\"}")
        fflush(stdout)
    }
}

// MARK: - Main

// Kill-switch desde OpenDesk (SIGTERM → SIGKILL a los ~300 ms): suelta el botón si estaba
// pulsado (arrastre a medias) y sale. Cola global: el hilo principal está ocupado en usleep().
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global(qos: .userInteractive))
termSource.setEventHandler {
    terminationHook?()
    if buttonHeld {
        post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: currentCursor(), mouseButton: .left))
    }
    FileHandle.standardError.write("Control detenido por el usuario\n".data(using: .utf8)!)
    exit(3)
}
termSource.resume()

var args = CommandLine.arguments
args.removeFirst()
// Banderas globales ANTES del comando (así un texto de `type` nunca se interpreta como bandera).
while let f = args.first, f.hasPrefix("--") {
    args.removeFirst()
    if f == "--instant" { instant = true }
    else if f == "--char-delay" { charDelayMs = max(0, num(args, 0, "--char-delay")); args.removeFirst() }
    else if f.hasPrefix("--char-delay=") { charDelayMs = max(0, Double(f.dropFirst(13)) ?? charDelayMs) }
    else { fail("Bandera desconocida: \(f)") }
}
guard let cmd = args.first else {
    fail("Uso: cu-helper move|click|drag|scroll|type|key|cursor|screens|permissions|request-permissions|frontmost|open-app|open-app-bg|resolve-app|activate|hide-apps|unhide-apps|app-at|running-apps|windows-of|focused-secure|recent-input|screenshot-sck|mask-regions|watch-esc|ax-tree|ax-find|ax-frame|ax-press|ax-set-value|ax-action|find-elements|window-shot|record|transcribe|mic-permission|mic-request …")
}

switch cmd {
case "move":
    requireAccessibility()
    glide(to: CGPoint(x: num(args, 1, "x"), y: num(args, 2, "y")))
    out(["ok": true])
case "click":
    requireAccessibility()
    let p = CGPoint(x: num(args, 1, "x"), y: num(args, 2, "y"))
    let right = args.count > 3 && args[3].lowercased() == "right"
    let count = args.count > 4 ? max(1, min(3, Int(args[4]) ?? 1)) : 1
    click(p, right: right, count: count)
    out(["ok": true])
case "drag":
    requireAccessibility()
    drag(from: CGPoint(x: num(args, 1, "x1"), y: num(args, 2, "y1")),
         to: CGPoint(x: num(args, 3, "x2"), y: num(args, 4, "y2")))
    out(["ok": true])
case "scroll":
    requireAccessibility()
    scroll(at: CGPoint(x: num(args, 1, "x"), y: num(args, 2, "y")),
           dx: Int32(num(args, 3, "dx")), dy: Int32(num(args, 4, "dy")))
    out(["ok": true])
case "type":
    requireAccessibility()
    guard args.count > 1 else { fail("Falta el texto") }
    typeText(args[1...].joined(separator: " "))
    out(["ok": true])
case "key":
    requireAccessibility()
    guard args.count > 1 else { fail("Falta la combinación") }
    for combo in args[1].split(separator: " ") { pressKey(String(combo)); pause(30) }
    out(["ok": true])
case "cursor":
    let p = currentCursor()
    out(["x": Double(p.x), "y": Double(p.y)])
case "screens":
    _ = NSApplication.shared
    out(screensInfo())
case "permissions":
    out(permissions())
case "request-permissions":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    out(permissions())
case "frontmost":
    if let app = NSWorkspace.shared.frontmostApplication {
        out(["name": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "", "pid": Int(app.processIdentifier)])
    } else {
        out(["name": ""])
    }
case "app-at":
    out(appAt(CGPoint(x: num(args, 1, "x"), y: num(args, 2, "y"))))
case "running-apps":
    out(runningApps())
case "windows-of":
    guard args.count > 1 else { fail("Falta la lista de bundle ids (separados por coma)") }
    out(windowsOf(bundleIds: Set(args[1].split(separator: ",").map(String.init))))
case "focused-secure":
    out(["secure": focusedIsSecure()])
case "recent-input":
    out(["keyDownSeconds": realKeyDownSeconds()])
case "screenshot-sck":
    guard args.count > 1 else { fail("Uso: screenshot-sck <outPath> [bundleId1,bundleId2,…]") }
    let outPath = args[1]
    let excluded = args.count > 2 ? Set(args[2].split(separator: ",").map(String.init)) : Set<String>()
    if #available(macOS 14.0, *) {
        do {
            let image = try sckScreenshotExcluding(bundleIds: excluded)
            guard writePNG(image, to: outPath) else { fail("No se pudo guardar la captura") }
            out(["ok": true, "width": image.width, "height": image.height])
        } catch {
            fail("ScreenCaptureKit: \(error.localizedDescription)", code: 4)
        }
    } else {
        fail("ScreenCaptureKit no disponible (macOS < 14)", code: 5)
    }
case "mask-regions":
    // mask-regions <inPath> <outPath> <x,y,w,h> ... (px de la imagen, origen arriba-izquierda)
    guard args.count > 3, let nsImg = NSImage(contentsOfFile: args[1]),
          let cgImg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fail("Uso: mask-regions <in> <out> <x,y,w,h> … (no se pudo abrir la imagen de entrada)")
    }
    let rects: [CGRect] = args[3...].compactMap { s in
        let parts = s.split(separator: ",").compactMap { Double($0) }
        guard parts.count == 4 else { return nil }
        return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    }
    guard let masked = maskImage(cgImg, rects: rects), writePNG(masked, to: args[2]) else {
        fail("No se pudo enmascarar/guardar \(args[2])")
    }
    out(["ok": true])
case "watch-esc":
    requireAccessibility()
    watchEsc()
case "open-app":
    guard args.count > 1 else { fail("Falta el nombre de la app") }
    let name = args[1...].joined(separator: " ")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    p.arguments = name.contains(".") && !name.hasSuffix(".app") && !name.contains(" ") ? ["-b", name] : ["-a", name]
    do { try p.run() } catch { fail("No se pudo abrir \(name): \(error.localizedDescription)") }
    p.waitUntilExit()
    if p.terminationStatus != 0 { fail("No se encontró la app \(name)") }
    out(["ok": true])
case "resolve-app":
    guard args.count > 1 else { fail("Falta el nombre de la app") }
    out(resolveApp(args[1...].joined(separator: " ")))
case "activate":
    guard args.count > 1 else { fail("Falta el bundle id o nombre de la app") }
    out(activateAndEnsureWindow(args[1...].joined(separator: " ")))
case "open-app-bg":
    guard args.count > 1 else { fail("Falta el nombre de la app") }
    let name = args[1...].joined(separator: " ")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    let isBundle = name.contains(".") && !name.hasSuffix(".app") && !name.contains(" ")
    p.arguments = ["-g"] + (isBundle ? ["-b", name] : ["-a", name])
    do { try p.run() } catch { fail("No se pudo abrir \(name): \(error.localizedDescription)") }
    p.waitUntilExit()
    if p.terminationStatus != 0 { fail("No se encontró la app \(name)") }
    out(["ok": true])
case "hide-apps":
    // `NSRunningApplication.hide()` es asíncrono y su valor de retorno no es fiable (puede dar
    // `false` aunque la app SÍ termine oculta poco después — verificado). Además, `isHidden` NO
    // se refresca si el proceso solo hace `usleep` mientras espera: hace falta darle vueltas al
    // run loop (el aviso de cambio de estado llega por ahí) — verificado con y sin
    // `RunLoop.current.run(mode:before:)`. Se dispara `hide()` en TODAS las candidatas primero y
    // se confirma después con un sondeo COMPARTIDO de `isHidden` bombeando el run loop.
    guard args.count > 1 else { fail("Uso: cu-helper hide-apps <keepCsv>") }
    let keep = Set(args[1].split(separator: ",").map(String.init))
    let hideCandidates = NSWorkspace.shared.runningApplications.filter { app in
        guard app.activationPolicy == .regular, let bid = app.bundleIdentifier, !bid.isEmpty else { return false }
        return bid != "com.apple.finder" && !keep.contains(bid) && !app.isHidden
    }
    for app in hideCandidates { _ = app.hide() }
    var hidden: [String] = []
    var pending = hideCandidates
    let hideDeadline = Date().addingTimeInterval(3.0)
    while !pending.isEmpty && Date() < hideDeadline {
        pending.removeAll { app in
            guard app.isHidden, let bid = app.bundleIdentifier else { return false }
            hidden.append(bid)
            return true
        }
        if !pending.isEmpty { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
    }
    out(["hidden": hidden])
case "unhide-apps":
    guard args.count > 1 else { fail("Uso: cu-helper unhide-apps <csv>") }
    let list = Set(args[1].split(separator: ",").map(String.init))
    let unhideCandidates = NSWorkspace.shared.runningApplications.filter { app in
        guard let bid = app.bundleIdentifier else { return false }
        return list.contains(bid) && app.isHidden
    }
    for app in unhideCandidates { _ = app.unhide() }
    var unhidden: [String] = []
    var pendingU = unhideCandidates
    let unhideDeadline = Date().addingTimeInterval(3.0)
    while !pendingU.isEmpty && Date() < unhideDeadline {
        pendingU.removeAll { app in
            guard !app.isHidden, let bid = app.bundleIdentifier else { return false }
            unhidden.append(bid)
            return true
        }
        if !pendingU.isEmpty { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
    }
    out(["unhidden": unhidden])
case "ax-tree":
    requireAccessibility()
    guard args.count > 1 else { fail("Uso: cu-helper ax-tree <bundleId> [maxDepth=12] [maxNodes=500]") }
    let bundleId = args[1]
    let maxDepth = args.count > 2 ? (Int(args[2]) ?? 12) : 12
    let maxNodes = args.count > 3 ? (Int(args[3]) ?? 500) : 500
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let walker = axTree(appEl, maxDepth: maxDepth, maxNodes: maxNodes, includeMenuBar: true)
    out(["app": ["name": app.localizedName ?? "", "bundleId": bundleId, "pid": Int(app.processIdentifier)],
         "nodes": walker.nodes, "truncated": walker.truncated])
case "ax-find":
    requireAccessibility()
    guard args.count > 2 else { fail("Uso: cu-helper ax-find <bundleId> <jsonQuery>") }
    let bundleId = args[1]
    let query = parseAXQuery(args[2])
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let walker = axTree(appEl, maxDepth: 30, maxNodes: 4000, includeMenuBar: true)
    out(["matches": axFindMatches(walker.nodes, query: query)])
case "ax-frame":
    requireAccessibility()
    guard args.count > 2 else { fail("Uso: cu-helper ax-frame <bundleId> <ref>") }
    let bundleId = args[1]; let ref = args[2]
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    guard let el = resolveRef(appEl, ref) else { fail("El elemento cambió o no existe: \(ref)", code: 8) }
    guard let frame = axFrame(el) else { fail("Sin marco para \(ref)", code: 8) }
    out(["frame": frame])
case "ax-press":
    requireAccessibility()
    guard args.count > 2 else { fail("Uso: cu-helper ax-press <bundleId> <ref> [expectRole] [expectTitle]") }
    let bundleId = args[1]; let ref = args[2]
    let expectRole = args.count > 3 ? args[3] : nil
    let expectTitle = args.count > 4 ? args[4...].joined(separator: " ") : nil
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    guard let el = resolveRef(appEl, ref) else { fail("El elemento cambió o no existe: \(ref)", code: 8) }
    if let er = expectRole, !er.isEmpty, (axString(el, kAXRoleAttribute as String) ?? "") != er {
        fail("El elemento cambió (rol distinto)", code: 8)
    }
    if let et = expectTitle, !et.isEmpty, (axString(el, kAXTitleAttribute as String) ?? "") != et {
        fail("El elemento cambió (título distinto)", code: 8)
    }
    guard AXUIElementPerformAction(el, kAXPressAction as CFString) == .success else {
        fail("El elemento cambió (no se pudo pulsar)", code: 8)
    }
    out(["ok": true])
case "ax-set-value":
    requireAccessibility()
    guard args.count > 3 else { fail("Uso: cu-helper ax-set-value <bundleId> <ref> <valor…>") }
    let bundleId = args[1]; let ref = args[2]
    let value = args[3...].joined(separator: " ")
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    guard let el = resolveRef(appEl, ref) else { fail("El elemento cambió o no existe: \(ref)", code: 8) }
    let role = axString(el, kAXRoleAttribute as String) ?? ""
    let subrole = axString(el, kAXSubroleAttribute as String) ?? ""
    if role == "AXSecureTextField" || subrole == "AXSecureTextField" {
        fail("Campo seguro: no se puede escribir por AX", code: 9)
    }
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue else { fail("El valor no se puede editar", code: 10) }
    guard AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value as CFString) == .success else {
        fail("No se pudo escribir el valor", code: 10)
    }
    out(["ok": true])
case "ax-action":
    requireAccessibility()
    guard args.count > 3 else { fail("Uso: cu-helper ax-action <bundleId> <ref> <acción>") }
    let bundleId = args[1]; let ref = args[2]; let action = args[3]
    let allowedAXActions: Set<String> = ["AXShowMenu", "AXIncrement", "AXDecrement", "AXConfirm", "AXCancel", "AXRaise", "AXPick"]
    guard allowedAXActions.contains(action) else { fail("Acción no permitida: \(action)", code: 11) }
    guard let app = requireRunningApp(bundleId) else { fail("La app \(bundleId) no está en ejecución", code: 7) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    guard let el = resolveRef(appEl, ref) else { fail("El elemento cambió o no existe: \(ref)", code: 8) }
    guard AXUIElementPerformAction(el, action as CFString) == .success else {
        fail("El elemento cambió (no se pudo realizar la acción)", code: 8)
    }
    out(["ok": true])
case "find-elements":
    requireAccessibility()
    var feApp: String? = nil
    var feRole: String? = nil
    var feQuery: String? = nil
    var fi = 1
    while fi < args.count {
        switch args[fi] {
        case "--app":
            fi += 1
            guard fi < args.count else { fail("Falta el valor de --app") }
            feApp = args[fi]; fi += 1
        case "--role":
            fi += 1
            guard fi < args.count else { fail("Falta el valor de --role") }
            feRole = args[fi]; fi += 1
        case "--query":
            fi += 1
            guard fi < args.count else { fail("Falta el valor de --query") }
            feQuery = args[fi]; fi += 1
        default:
            fail("Bandera desconocida para find-elements: \(args[fi])")
        }
    }
    guard let feBundleId = feApp, !feBundleId.isEmpty else {
        fail("Uso: cu-helper find-elements --app <bundleId> [--role button,textfield,…] [--query \"texto\"]")
    }
    guard let feRunningApp = requireRunningApp(feBundleId) else { fail("La app \(feBundleId) no está en ejecución", code: 7) }
    let feRoles: Set<String>? = feRole.map { Set($0.split(separator: ",").map { normalizeAXRole(String($0)) }) }
    let feQueryNorm = feQuery.map { foldText($0) }
    let feAppEl = AXUIElementCreateApplication(feRunningApp.processIdentifier)
    let (feMatches, feTruncated) = findElements(
        feAppEl, maxNodes: 4000, maxMatches: 300, budgetSeconds: 0.8,
        query: FindElementsQuery(roles: feRoles, query: feQueryNorm)
    )
    if feTruncated {
        FileHandle.standardError.write("find-elements: límite de nodos/tiempo alcanzado (resultados parciales)\n".data(using: .utf8)!)
    }
    out(feMatches)
case "window-shot":
    guard args.count > 2 else { fail("Uso: cu-helper window-shot <bundleId> <outPath> [windowIndex=0]") }
    let bundleId = args[1]; let outPath = args[2]
    let windowIndex = args.count > 3 ? (Int(args[3]) ?? 0) : 0
    if #available(macOS 14.0, *) {
        do {
            let (image, title) = try windowShot(bundleId: bundleId, windowIndex: windowIndex)
            guard writePNG(image, to: outPath) else { fail("No se pudo guardar la captura") }
            out(["ok": true, "width": image.width, "height": image.height, "title": title])
        } catch {
            fail("window-shot: \(error.localizedDescription)", code: 12)
        }
    } else {
        fail("ScreenCaptureKit no disponible (macOS < 14)", code: 5)
    }
case "record":
    requireAccessibility()
    guard args.count > 1 else { fail("Uso: cu-helper record <outDir> [--mic] [--max-seconds N≤900] [--exclude csv]") }
    let outDir = args[1]
    var mic = false
    var maxSeconds: Double = 900
    var exclude = Set<String>()
    var ri = 2
    while ri < args.count {
        switch args[ri] {
        case "--mic": mic = true; ri += 1
        case "--max-seconds":
            ri += 1
            guard ri < args.count, let v = Double(args[ri]) else { fail("Falta el valor de --max-seconds") }
            maxSeconds = min(900, max(1, v)); ri += 1
        case "--exclude":
            ri += 1
            guard ri < args.count else { fail("Falta la lista de --exclude") }
            exclude = Set(args[ri].split(separator: ",").map(String.init)); ri += 1
        default:
            fail("Bandera desconocida: \(args[ri])")
        }
    }
    _ = NSApplication.shared
    let recorder = Recorder(outDir: outDir, maxSeconds: maxSeconds, mic: mic, exclude: exclude)
    recorder.start()
    terminationHook = { recorder.finish(reason: "sigterm") }
    signal(SIGINT, SIG_IGN)
    let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global(qos: .userInteractive))
    sigintSource.setEventHandler {
        recorder.finish(reason: "sigint")
        exit(0)
    }
    sigintSource.resume()
    DispatchQueue.global(qos: .utility).async {
        while let line = readLine(strippingNewline: true) {
            if line.trimmingCharacters(in: .whitespaces) == "stop" {
                recorder.finish(reason: "stop")
                exit(0)
            }
        }
    }
    let recordTimer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    recordTimer.schedule(deadline: .now() + maxSeconds)
    recordTimer.setEventHandler {
        recorder.finish(reason: "max-seconds")
        exit(0)
    }
    recordTimer.resume()
    CFRunLoopRun()
case "transcribe":
    guard args.count > 1 else { fail("Uso: cu-helper transcribe <audio> [locale=es-ES]") }
    let audioPath = args[1]
    let locale = args.count > 2 ? args[2] : "es-ES"
    guard FileManager.default.fileExists(atPath: audioPath) else {
        fail("No existe el archivo de audio: \(audioPath)")
    }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
        fail("Reconocimiento de voz no autorizado", code: 6)
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
        fail("Reconocimiento de voz no disponible para \(locale)", code: 12)
    }
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: audioPath))
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    let transcribeSem = DispatchSemaphore(value: 0)
    var transcribedText = ""
    var transcribeError: Error?
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error = error { transcribeError = error; transcribeSem.signal(); return }
        if let result = result, result.isFinal {
            transcribedText = result.bestTranscription.formattedString
            transcribeSem.signal()
        }
    }
    _ = task
    if transcribeSem.wait(timeout: .now() + 115) == .timedOut {
        fail("Tiempo de espera agotado al transcribir", code: 12)
    }
    if let err = transcribeError {
        fail("Error al transcribir: \(err.localizedDescription)", code: 12)
    }
    out(["text": transcribedText, "onDevice": true])
case "mic-permission":
    out(["status": micStatusString()])
case "mic-request":
    let micSem = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in micSem.signal() }
    micSem.wait()
    out(["status": micStatusString()])
default:
    fail("Comando desconocido: \(cmd)")
}
