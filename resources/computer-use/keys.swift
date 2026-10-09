// cu-keys: teclado por TECLAS FÍSICAS para clientes de escritorio remoto (Windows App, AnyDesk, RustDesk, TeamViewer…).
//
// `cu-helper type` escribe con keycode 0 + una cadena Unicode superpuesta: un cliente remoto que lee el código de tecla ve
// siempre «A» o descarta el evento. Aquí cada carácter se traduce a (tecla física + modificadores) con la distribución de
// teclado ACTIVA (UCKeyTranslate), los modificadores se mandan como eventos `flagsChanged` reales (con los bits de «tecla
// izquierda») y todo ocurre en UN solo proceso, rápido (unos 15 ms por carácter).
//
// Uso:
//   cu-keys type [--delay-ms N]     lee el texto de la entrada estándar (UTF-8) y lo escribe
//   cu-keys key "ctrl+alt+supr"     una o varias combinaciones separadas por espacio, con modificadores reales
//   cu-keys map [--layout us]       diagnóstico: tecla y modificadores de cada carácter de la entrada
//   --layout us (type|key|map)      usa teclado inglés de EE. UU. fijo (equipo remoto con esa distribución)
//   cu-keys layout                  {"layout":"…","chars":N}  (diagnóstico)
// Salida: JSON en stdout; errores en stderr + código 1. Código 3 = existe COMPUTER_STOP_FILE (parada del usuario).
// Necesita el permiso de Accesibilidad de la app responsable, igual que `cu-helper`.

import ApplicationServices
import Carbon
import Foundation

func fail(_ msg: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    exit(code)
}

// `.privateState` y la MISMA marca que `cu-helper` (`eventSourceUserData`): sin ella `watch-esc` toma un Escape sintético por el del usuario
// y CORTA el control, y `recent-input` cree que el usuario está tecleando. La marca es lo único fiable para distinguirlos (ver helper.swift).
let source = CGEventSource(stateID: .privateState)
let ownEventTag: Int64 = 0x4C41_5049

func post(_ e: CGEvent?) {
    guard let e = e else { fail("No se pudo crear el evento (¿permiso de Accesibilidad?)") }
    e.setIntegerValueField(.eventSourceUserData, value: ownEventTag)
    e.post(tap: .cghidEventTap)
}
let stopFile = ProcessInfo.processInfo.environment["COMPUTER_STOP_FILE"]
func checkStop() {
    if let f = stopFile, !f.isEmpty, FileManager.default.fileExists(atPath: f) { exit(3) }
}
func pause(_ ms: Double) { usleep(UInt32(max(0, ms) * 1000)) }

// MARK: - Modificadores (códigos físicos y bits «de dispositivo»: los clientes remotos los miran)

struct Mod {
    let name: String
    let code: CGKeyCode
    let flag: CGEventFlags
    let device: UInt64
}
let mods: [String: Mod] = [
    "shift": Mod(name: "shift", code: 0x38, flag: .maskShift, device: 0x2),
    "ctrl": Mod(name: "ctrl", code: 0x3B, flag: .maskControl, device: 0x1),
    "alt": Mod(name: "alt", code: 0x3A, flag: .maskAlternate, device: 0x20),
    "cmd": Mod(name: "cmd", code: 0x37, flag: .maskCommand, device: 0x8),
]
let modAliases: [String: String] = [
    "control": "ctrl", "option": "alt", "opt": "alt", "altgr": "alt", "command": "cmd", "meta": "cmd", "super": "cmd", "win": "cmd",
    "windows": "cmd",
]

func flagsFor(_ held: [Mod]) -> CGEventFlags {
    var raw: UInt64 = 0
    for m in held { raw |= m.flag.rawValue | m.device }
    return CGEventFlags(rawValue: raw)
}

func postModifier(_ m: Mod, down: Bool, held: [Mod]) {
    guard let e = CGEvent(keyboardEventSource: source, virtualKey: m.code, keyDown: true) else { return }
    e.type = .flagsChanged
    e.flags = flagsFor(held)
    _ = down
    post(e)
}

func postKey(_ code: CGKeyCode, held: [Mod], holdMs: Double) {
    let f = flagsFor(held)
    let d = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    d?.flags = f
    post(d)
    pause(holdMs)
    let u = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    u?.flags = f
    post(u)
}

/// Pulsa `code` con los modificadores `use` como eventos reales: baja cada modificador, la tecla, y los suelta en orden inverso.
func press(_ code: CGKeyCode, with use: [Mod], gap: Double) {
    var held: [Mod] = []
    for m in use {
        held.append(m)
        postModifier(m, down: true, held: held)
        pause(gap)
    }
    postKey(code, held: held, holdMs: gap)
    pause(gap)
    for m in use.reversed() {
        held.removeAll { $0.name == m.name }
        postModifier(m, down: false, held: held)
        pause(gap)
    }
}

// MARK: - Tabla carácter → (tecla, modificadores) según la distribución activa

struct Stroke {
    let code: CGKeyCode
    let use: [Mod]
}

func layoutData() -> (Data, String)? {
    var src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue()
    func data(_ s: TISInputSource?) -> Data? {
        guard let s = s, let p = TISGetInputSourceProperty(s, kTISPropertyUnicodeKeyLayoutData) else { return nil }
        return Unmanaged<CFData>.fromOpaque(p).takeUnretainedValue() as Data
    }
    var d = data(src)
    if d == nil {
        src = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue()
        d = data(src)
    }
    guard let layout = d else { return nil }
    var name = "?"
    if let s = src, let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID) {
        name = Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
    }
    return (layout, name)
}

func buildTable() -> ([Character: Stroke], String) {
    guard let (layout, name) = layoutData() else { fail("No se pudo leer la distribución de teclado activa") }
    var table: [Character: Stroke] = [:]
    // Estados de modificadores de menor a mayor «coste»: ninguno, Shift, Alt, Alt+Shift (bits de Carbon sin desplazar).
    let states: [(UInt32, [Mod])] = [
        (0, []),
        (UInt32(shiftKey >> 8) & 0xFF, [mods["shift"]!]),
        (UInt32(optionKey >> 8) & 0xFF, [mods["alt"]!]),
        (UInt32((optionKey | shiftKey) >> 8) & 0xFF, [mods["alt"]!, mods["shift"]!]),
    ]
    layout.withUnsafeBytes { raw in
        guard let base = raw.baseAddress else { return }
        let ptr = base.assumingMemoryBound(to: UCKeyboardLayout.self)
        for (state, use) in states {
            for code in 0..<128 {
                var dead: UInt32 = 0
                var len = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let r = UCKeyTranslate(
                    ptr, UInt16(code), UInt16(kUCKeyActionDown), state, UInt32(LMGetKbdType()),
                    OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
                guard r == noErr, len == 1, let scalar = Unicode.Scalar(chars[0]), chars[0] >= 0x20, chars[0] != 0x7F else { continue }
                let ch = Character(scalar)
                if table[ch] == nil { table[ch] = Stroke(code: CGKeyCode(code), use: use) }
            }
        }
    }
    return (table, name)
}


/// Tabla US ANSI fija (teclado inglés de EE. UU.): para equipos remotos con esa distribución, sea cual sea la del Mac.
func usTable() -> [Character: Stroke] {
    let base: [(String, CGKeyCode)] = [
        ("a", 0x00), ("s", 0x01), ("d", 0x02), ("f", 0x03), ("h", 0x04), ("g", 0x05), ("z", 0x06), ("x", 0x07), ("c", 0x08),
        ("v", 0x09), ("b", 0x0B), ("q", 0x0C), ("w", 0x0D), ("e", 0x0E), ("r", 0x0F), ("y", 0x10), ("t", 0x11), ("1", 0x12),
        ("2", 0x13), ("3", 0x14), ("4", 0x15), ("6", 0x16), ("5", 0x17), ("=", 0x18), ("9", 0x19), ("7", 0x1A), ("-", 0x1B),
        ("8", 0x1C), ("0", 0x1D), ("]", 0x1E), ("o", 0x1F), ("u", 0x20), ("[", 0x21), ("i", 0x22), ("p", 0x23), ("l", 0x25),
        ("j", 0x26), ("'", 0x27), ("k", 0x28), (";", 0x29), ("\\", 0x2A), (",", 0x2B), ("/", 0x2C), ("n", 0x2D), ("m", 0x2E),
        (".", 0x2F), (" ", 0x31), ("`", 0x32),
    ]
    let shifted: [(String, String)] = [
        ("!", "1"), ("@", "2"), ("#", "3"), ("$", "4"), ("%", "5"), ("^", "6"), ("&", "7"), ("*", "8"), ("(", "9"), (")", "0"),
        ("_", "-"), ("+", "="), ("{", "["), ("}", "]"), ("|", "\\"), (":", ";"), ("\"", "'"), ("<", ","), (">", "."), ("?", "/"),
        ("~", "`"),
    ]
    var t: [Character: Stroke] = [:]
    var codeOf: [String: CGKeyCode] = [:]
    for (c, k) in base {
        codeOf[c] = k
        t[Character(c)] = Stroke(code: k, use: [])
        if c.unicodeScalars.first!.properties.isAlphabetic { t[Character(c.uppercased())] = Stroke(code: k, use: [mods["shift"]!]) }
    }
    for (ch, b) in shifted { if let k = codeOf[b] { t[Character(ch)] = Stroke(code: k, use: [mods["shift"]!]) } }
    return t
}

func tableFor(_ args: [String]) -> ([Character: Stroke], String) {
    if let i = args.firstIndex(of: "--layout"), i + 1 < args.count, args[i + 1].lowercased() == "us" { return (usTable(), "us-ansi") }
    return buildTable()
}

// MARK: - Teclas con nombre

let namedKeys: [String: CGKeyCode] = [
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31, "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
    "forwarddelete": 0x75, "supr": 0x75, "del": 0x75, "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D,
    "f11": 0x67, "f12": 0x6F,
]

// MARK: - Comandos

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("Uso: cu-keys type|key|layout …", 2) }

switch cmd {
case "layout":
    let (table, name) = buildTable()
    print("{\"layout\":\"\(name)\",\"chars\":\(table.count)}")

case "map":
    let (table, name) = tableFor(args)
    let text = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
    var out: [String] = []
    for ch in text {
        if let st = table[ch] {
            let shown = ch == "\"" ? "\\\"" : (ch == "\\" ? "\\\\" : String(ch))
            out.append("{\"c\":\"\(shown)\",\"code\":\(st.code),\"mods\":\"\(st.use.map { $0.name }.joined(separator: "+"))\"}")
        }
        else { out.append("{\"c\":\"?\",\"missing\":true}") }
    }
    print("{\"layout\":\"\(name)\",\"map\":[\(out.joined(separator: ","))]}")

case "type":
    var delay = 4.0
    if let i = args.firstIndex(of: "--delay-ms"), i + 1 < args.count, let v = Double(args[i + 1]) { delay = max(0, min(100, v)) }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let text = String(data: input, encoding: .utf8), !text.isEmpty else { fail("Sin texto en la entrada estándar", 2) }
    let (table, _) = tableFor(args)
    var typed = 0
    var fallback = 0
    for ch in text {
        checkStop()
        if ch == "\n" || ch == "\r" || ch == "\r\n" {
            press(0x24, with: [], gap: delay)
        } else if ch == "\t" {
            press(0x30, with: [], gap: delay)
        } else if let s = table[ch] {
            press(s.code, with: s.use, gap: delay)
        } else {
            // Carácter que la distribución activa no puede producir (emoji, acentos sueltos…): evento Unicode, como `cu-helper type`.
            var units = Array(String(ch).utf16)
            let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            d?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            post(d)
            let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            u?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            post(u)
            fallback += 1
        }
        typed += 1
        pause(delay)
    }
    print("{\"typed\":\(typed),\"unicodeFallback\":\(fallback)}")

case "key":
    var delay = 8.0
    var combos = Array(args.dropFirst())
    if let i = combos.firstIndex(of: "--layout"), i + 1 < combos.count { combos.removeSubrange(i...(i + 1)) }
    if let i = combos.firstIndex(of: "--delay-ms"), i + 1 < combos.count, let v = Double(combos[i + 1]) {
        delay = max(0, min(100, v))
        combos.removeSubrange(i...(i + 1))
    }
    let parts = combos.joined(separator: " ").split(separator: " ").map(String.init)
    guard !parts.isEmpty else { fail("Uso: cu-keys key \"ctrl+alt+supr\"", 2) }
    let (table, _) = tableFor(args)
    var pressed = 0
    for combo in parts {
        checkStop()
        var use: [Mod] = []
        var main: String? = nil
        let toks = combo.lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        for (i, t0) in toks.enumerated() {
            var t = t0.isEmpty && i == toks.count - 1 ? "+" : t0
            if let a = modAliases[t] { t = a }
            if let m = mods[t] { if !use.contains(where: { $0.name == m.name }) { use.append(m) } } else if !t.isEmpty { main = t }
        }
        guard let name = main else { fail("Combinación sin tecla principal: \(combo)") }
        if let code = namedKeys[name] {
            press(code, with: use, gap: delay)
        } else if name.count == 1, let s = table[Character(name)] {
            // Con modificadores explícitos se usa la tecla física SIN el Shift/Alt propio del carácter.
            let extra = use.isEmpty ? s.use : use
            press(s.code, with: extra, gap: delay)
        } else {
            fail("Tecla desconocida: \(name)")
        }
        pressed += 1
        pause(delay * 3)
    }
    print("{\"pressed\":\(pressed)}")

default:
    fail("Comando desconocido: \(cmd)", 2)
}
