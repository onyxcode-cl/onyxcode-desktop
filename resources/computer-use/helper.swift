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
import CoreGraphics
import Foundation

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

let source = CGEventSource(stateID: .hidSystemState)

func post(_ e: CGEvent?) {
    guard let e = e else { fail("No se pudo crear el evento (¿permiso de Accesibilidad?)") }
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

// MARK: - Main

// Kill-switch desde OpenDesk (SIGTERM → SIGKILL a los ~300 ms): suelta el botón si estaba
// pulsado (arrastre a medias) y sale. Cola global: el hilo principal está ocupado en usleep().
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global(qos: .userInteractive))
termSource.setEventHandler {
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
    fail("Uso: cu-helper move|click|drag|scroll|type|key|cursor|screens|permissions|request-permissions|frontmost|open-app …")
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
default:
    fail("Comando desconocido: \(cmd)")
}
