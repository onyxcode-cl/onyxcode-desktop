// cu-helper: helper nativo de "computer use" para OpenDesk (macOS).
//
// Uso: cu-helper <comando> [args…]
//   move x y                      mueve el cursor
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

// MARK: - Ratón

func moveTo(_ p: CGPoint) {
    post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
}

func click(_ p: CGPoint, right: Bool, count: Int) {
    let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = right ? .right : .left
    moveTo(p)
    pause(30)
    for i in 1...max(1, count) {
        let d = CGEvent(mouseEventSource: source, mouseType: down, mouseCursorPosition: p, mouseButton: button)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        post(d)
        pause(15)
        let u = CGEvent(mouseEventSource: source, mouseType: up, mouseCursorPosition: p, mouseButton: button)
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        post(u)
        if i < count { pause(60) }
    }
}

func drag(from a: CGPoint, to b: CGPoint) {
    moveTo(a)
    pause(40)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
    pause(60)
    let steps = 20
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        pause(12)
    }
    pause(40)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
}

func scroll(at p: CGPoint, dx: Int32, dy: Int32) {
    moveTo(p)
    pause(30)
    // En CGEvent, wheel1 > 0 desplaza hacia arriba; aquí dy > 0 = hacia abajo.
    post(CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0))
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

func typeText(_ text: String) {
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
        var chunk = Array(utf16[i..<end])
        let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        d?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
        post(d)
        let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        u?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
        post(u)
        pause(8)
        i = end
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

var args = CommandLine.arguments
args.removeFirst()
guard let cmd = args.first else {
    fail("Uso: cu-helper move|click|drag|scroll|type|key|cursor|screens|permissions|request-permissions|frontmost|open-app …")
}

switch cmd {
case "move":
    requireAccessibility()
    moveTo(CGPoint(x: num(args, 1, "x"), y: num(args, 2, "y")))
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
