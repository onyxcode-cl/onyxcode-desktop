//! Combinaciones de teclas: análisis, lista de BLOQUEADAS y tabla de códigos virtuales.
//! Es el espejo en Rust de `src/main/computer/policy/win-keys.ts` (plan C §3): si una cambia, cambia la otra
//! (las pruebas de ambas comparten la misma tabla de casos). Falla cerrado: lo que no se entiende se rechaza.

pub const WIN_STOP_SHORTCUT: &str = "ctrl+alt+shift+escape";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRejection {
    Cmd,
    Blocked,
    Win,
    Stop,
    Foreground,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyReject {
    pub code: KeyRejection,
    pub reason: String,
    pub combo: String,
}

#[derive(Debug, Clone, Default)]
pub struct KeyPolicyContext {
    /// Lazunox es la ventana en primer plano (alt+f4 y ctrl+w cerrarían la app).
    pub lazunox_frontmost: bool,
    /// Atajo de parada vigente (por defecto `WIN_STOP_SHORTCUT`).
    pub stop_shortcut: Option<String>,
}

const MOD_ORDER: [&str; 4] = ["ctrl", "alt", "shift", "win"];
const WIN_ALLOWED_KEYS: [&str; 3] = ["d", "e", "s"];
pub const MAX_COMBOS: usize = 16;

fn mod_alias(t: &str) -> Option<&'static str> {
    Some(match t {
        "ctrl" | "control" => "ctrl",
        "shift" => "shift",
        "alt" | "option" => "alt",
        "win" | "windows" | "lwin" | "rwin" | "meta" | "super" => "win",
        _ => return None,
    })
}

fn key_alias(t: &str) -> &str {
    match t {
        "esc" => "escape",
        "delete" => "del",
        "return" => "enter",
        "spacebar" | " " => "space",
        "pgup" => "pageup",
        "pgdn" | "pagedn" => "pagedown",
        "ins" => "insert",
        o => o,
    }
}

const NAMED_KEYS: [&str; 33] = [
    "escape", "enter", "tab", "space", "backspace", "del", "insert", "home", "end", "pageup", "pagedown", "up", "down", "left",
    "right", "plus", "minus", "comma", "period", "slash", "backslash", "semicolon", "quote", "backquote", "bracketleft",
    "bracketright", "equal", "capslock", "printscreen", "pause", "menu", "numlock", "scrolllock",
];

fn is_function_key(k: &str) -> Option<u32> {
    let n = k.strip_prefix('f')?;
    if n.is_empty() || n.len() > 2 || n.starts_with('0') || !n.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let v: u32 = n.parse().ok()?;
    (1..=24).contains(&v).then_some(v)
}

fn valid_key_name(k: &str) -> bool {
    let mut it = k.chars();
    if let (Some(c), None) = (it.next(), it.next()) {
        return c.is_ascii_lowercase() || c.is_ascii_digit() || "-=,./;'`\\[]+".contains(c);
    }
    is_function_key(k).is_some() || NAMED_KEYS.contains(&k)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCombo {
    pub mods: Vec<&'static str>,
    pub key: String,
    /// Se pidió un modificador de macOS (`cmd`/`command`).
    pub mac_mod: bool,
}

/// Parte `ctrl+shift+t` en modificadores canónicos (ordenados) y tecla. None si no se entiende.
pub fn parse_combo(raw: &str) -> Option<ParsedCombo> {
    let text = raw.trim().to_lowercase();
    if text.is_empty() || text.chars().count() > 64 {
        return None;
    }
    let mut tokens: Vec<String> = if let Some(head) = text.strip_suffix("++") {
        let mut t: Vec<String> = head.split('+').map(String::from).collect();
        t.push("+".into());
        t
    } else if text == "+" {
        vec!["+".into()]
    } else {
        text.split('+').map(String::from).collect()
    };
    if tokens.iter().any(|t| t.trim().is_empty() && t != "+") {
        return None;
    }
    for t in tokens.iter_mut() {
        if t != "+" {
            *t = t.trim().to_string();
        }
    }
    let mut mods: Vec<&'static str> = Vec::new();
    let mut mac_mod = false;
    let mut key = String::new();
    let mut invalid = false;
    let n = tokens.len();
    for (i, t) in tokens.iter().enumerate() {
        let last = i == n - 1;
        if t == "cmd" || t == "command" {
            mac_mod = true;
        } else if let Some(m) = mod_alias(t) {
            mods.push(m);
        } else if last {
            key = key_alias(t).to_string();
        } else {
            invalid = true;
        }
    }
    if invalid {
        return None;
    }
    if !key.is_empty() && !valid_key_name(&key) {
        return None;
    }
    Some(ParsedCombo { mods: MOD_ORDER.iter().copied().filter(|m| mods.contains(m)).collect(), key, mac_mod })
}

fn fmt(p: &ParsedCombo) -> String {
    let mut parts: Vec<&str> = p.mods.clone();
    if !p.key.is_empty() {
        parts.push(&p.key);
    }
    parts.join("+")
}

fn same(p: &ParsedCombo, mods: &[&str], key: &str) -> bool {
    p.key == key && p.mods.len() == mods.len() && mods.iter().all(|m| p.mods.contains(m))
}

/// Evalúa UNA combinación (sin espacios). Ok(combo canónico) o el motivo del rechazo.
pub fn check_combo(raw: &str, ctx: &KeyPolicyContext) -> Result<String, KeyReject> {
    let p = parse_combo(raw).ok_or_else(|| KeyReject {
        code: KeyRejection::Invalid,
        reason: format!("Combinación de teclas no válida: «{}»", raw.chars().take(40).collect::<String>()),
        combo: String::new(),
    })?;
    let combo = fmt(&p);
    if p.mac_mod {
        return Err(KeyReject { code: KeyRejection::Cmd, reason: "En Windows usa ctrl".into(), combo: raw.trim().to_lowercase() });
    }
    let no = |code: KeyRejection, reason: &str| Err(KeyReject { code, reason: reason.to_string(), combo: combo.clone() });
    let stop = parse_combo(ctx.stop_shortcut.as_deref().unwrap_or(WIN_STOP_SHORTCUT));
    if let Some(s) = &stop {
        if same(&p, &s.mods, &s.key) {
            return no(KeyRejection::Stop, "Ese atajo es el de parada de Lazunox: no se puede pulsar");
        }
    }
    if same(&p, &["ctrl", "alt"], "del") {
        return no(KeyRejection::Blocked, "Ctrl+Alt+Supr está reservado al usuario");
    }
    if same(&p, &["ctrl", "shift"], "escape") {
        return no(KeyRejection::Blocked, "Ctrl+Mayús+Esc abre el Administrador de tareas: lo hace el usuario");
    }
    if p.mods.contains(&"win") {
        if p.mods.len() == 1 && WIN_ALLOWED_KEYS.contains(&p.key.as_str()) {
            return Ok(combo);
        }
        if same(&p, &["win"], "r") {
            return no(KeyRejection::Blocked, "Win+R (Ejecutar) lo abre el usuario");
        }
        if same(&p, &["win"], "x") {
            return no(KeyRejection::Blocked, "Win+X lo abre el usuario");
        }
        if same(&p, &["win"], "l") {
            return no(KeyRejection::Blocked, "Win+L bloquea la sesión: lo hace el usuario");
        }
        return no(KeyRejection::Win, "Solo se permiten Win+D, Win+E y Win+S entre las combinaciones con la tecla Windows");
    }
    if ctx.lazunox_frontmost && (same(&p, &["alt"], "f4") || same(&p, &["ctrl"], "w")) {
        return no(KeyRejection::Foreground, "Con Lazunox en primer plano, ese atajo cerraría la aplicación");
    }
    Ok(combo)
}

/// Evalúa el argumento de `key`: varias combinaciones separadas por espacios (como el helper de macOS).
pub fn check_keys(input: &str, ctx: &KeyPolicyContext) -> Result<Vec<String>, KeyReject> {
    let parts: Vec<&str> = input.split_whitespace().collect();
    let inv = |reason: &str| KeyReject { code: KeyRejection::Invalid, reason: reason.into(), combo: String::new() };
    if parts.is_empty() {
        return Err(inv("Falta la combinación de teclas"));
    }
    if parts.len() > MAX_COMBOS {
        return Err(inv("Demasiadas combinaciones en una llamada"));
    }
    parts.iter().map(|p| check_combo(p, ctx)).collect()
}

/// Ejecutables de Lazunox (y el `electron.exe` del modo desarrollo): con ellos en primer plano, `alt+f4` y `ctrl+w`
/// cerrarían la propia aplicación.
pub fn is_lazunox_exe(base_name: &str) -> bool {
    matches!(base_name.to_lowercase().as_str(), "lazunox.exe" | "electron.exe")
}

// ---- Códigos virtuales de Windows ----

pub const VK_LCONTROL: u16 = 0xA2;
pub const VK_LMENU: u16 = 0xA4;
pub const VK_LSHIFT: u16 = 0xA0;
pub const VK_LWIN: u16 = 0x5B;
pub const VK_RETURN: u16 = 0x0D;
pub const VK_TAB: u16 = 0x09;

/// Código virtual del modificador canónico.
pub fn mod_vk(m: &str) -> Option<u16> {
    Some(match m {
        "ctrl" => VK_LCONTROL,
        "alt" => VK_LMENU,
        "shift" => VK_LSHIFT,
        "win" => VK_LWIN,
        _ => return None,
    })
}

/// (código virtual, tecla extendida) de una tecla ya normalizada por `parse_combo`.
pub fn key_vk(k: &str) -> Option<(u16, bool)> {
    let mut it = k.chars();
    if let (Some(c), None) = (it.next(), it.next()) {
        if c.is_ascii_lowercase() {
            return Some((c as u16 - b'a' as u16 + 0x41, false));
        }
        if c.is_ascii_digit() {
            return Some((c as u16, false));
        }
        return Some((
            match c {
                '+' | '=' => 0xBB,
                '-' => 0xBD,
                ',' => 0xBC,
                '.' => 0xBE,
                '/' => 0xBF,
                '\\' => 0xDC,
                ';' => 0xBA,
                '\'' => 0xDE,
                '`' => 0xC0,
                '[' => 0xDB,
                ']' => 0xDD,
                _ => return None,
            },
            false,
        ));
    }
    if let Some(n) = is_function_key(k) {
        return Some((0x70 + (n as u16 - 1), false));
    }
    Some(match k {
        "escape" => (0x1B, false),
        "enter" => (VK_RETURN, false),
        "tab" => (VK_TAB, false),
        "space" => (0x20, false),
        "backspace" => (0x08, false),
        "del" => (0x2E, true),
        "insert" => (0x2D, true),
        "home" => (0x24, true),
        "end" => (0x23, true),
        "pageup" => (0x21, true),
        "pagedown" => (0x22, true),
        "up" => (0x26, true),
        "down" => (0x28, true),
        "left" => (0x25, true),
        "right" => (0x27, true),
        "plus" | "equal" => (0xBB, false),
        "minus" => (0xBD, false),
        "comma" => (0xBC, false),
        "period" => (0xBE, false),
        "slash" => (0xBF, false),
        "backslash" => (0xDC, false),
        "semicolon" => (0xBA, false),
        "quote" => (0xDE, false),
        "backquote" => (0xC0, false),
        "bracketleft" => (0xDB, false),
        "bracketright" => (0xDD, false),
        "capslock" => (0x14, false),
        "printscreen" => (0x2C, true),
        "pause" => (0x13, false),
        "menu" => (0x5D, true),
        "numlock" => (0x90, true),
        "scrolllock" => (0x91, false),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(front: bool) -> KeyPolicyContext {
        KeyPolicyContext { lazunox_frontmost: front, stop_shortcut: None }
    }
    fn parsed(raw: &str) -> Option<(Vec<&'static str>, String)> {
        parse_combo(raw).map(|p| (p.mods, p.key))
    }

    #[test]
    fn parse_casos_del_contrato_ts() {
        assert_eq!(parsed("Ctrl+Shift+T"), Some((vec!["ctrl", "shift"], "t".into())));
        assert_eq!(parsed("control+ALT+delete"), Some((vec!["ctrl", "alt"], "del".into())));
        assert_eq!(parsed("shift+esc"), Some((vec!["shift"], "escape".into())));
        assert_eq!(parsed("alt+F4"), Some((vec!["alt"], "f4".into())));
        assert_eq!(parsed("win"), Some((vec!["win"], "".into())));
        assert_eq!(parsed("super+e"), Some((vec!["win"], "e".into())));
        assert_eq!(parsed("ctrl++"), Some((vec!["ctrl"], "+".into())));
        assert_eq!(parsed("enter"), Some((vec![], "enter".into())));
    }

    #[test]
    fn parse_no_validas() {
        for raw in ["", "   ", "+ctrl", "ctrl+", "ctrl++a", "ctrl+nopekey", "a+b", &"x".repeat(65), "f0", "f25", "f01"] {
            assert!(parse_combo(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn tabla_de_rechazos() {
        use KeyRejection::*;
        let rows: Vec<(&str, KeyRejection, bool, Option<&str>)> = vec![
            ("win+r", Blocked, false, None),
            ("Win+R", Blocked, false, None),
            ("lwin+r", Blocked, false, None),
            ("win+x", Blocked, false, None),
            ("win+l", Blocked, false, None),
            ("ctrl+shift+esc", Blocked, false, None),
            ("ctrl+shift+escape", Blocked, false, None),
            ("shift+control+esc", Blocked, false, None),
            ("ctrl+alt+del", Blocked, false, None),
            ("ctrl+alt+delete", Blocked, false, None),
            ("alt+f4", Foreground, true, None),
            ("ctrl+w", Foreground, true, None),
            (WIN_STOP_SHORTCUT, Stop, false, None),
            ("ctrl+alt+shift+esc", Stop, false, None),
            ("ctrl+alt+pause", Stop, false, Some("ctrl+alt+pause")),
            ("win+tab", Win, false, None),
            ("win+shift+s", Win, false, None),
            ("win+ctrl+d", Win, false, None),
            ("win+1", Win, false, None),
            ("win", Win, false, None),
            ("cmd+c", Cmd, false, None),
            ("command+shift+t", Cmd, false, None),
            ("ctrl+cmd+v", Cmd, false, None),
            ("fn+f1", Invalid, false, None),
            ("", Invalid, false, None),
        ];
        for (combo, code, front, stop) in rows {
            let c = KeyPolicyContext { lazunox_frontmost: front, stop_shortcut: stop.map(String::from) };
            let r = check_combo(combo, &c);
            assert_eq!(r.as_ref().err().map(|e| e.code), Some(code), "{combo}");
        }
        assert_eq!(check_combo("cmd+c", &ctx(false)).unwrap_err().reason, "En Windows usa ctrl");
    }

    #[test]
    fn tabla_de_aceptadas() {
        for (raw, combo) in [
            ("win+d", "win+d"),
            ("win+e", "win+e"),
            ("WIN+S", "win+s"),
            ("ctrl+c", "ctrl+c"),
            ("shift+ctrl+t", "ctrl+shift+t"),
            ("alt+tab", "alt+tab"),
            ("alt+f4", "alt+f4"),
            ("ctrl+w", "ctrl+w"),
            ("enter", "enter"),
            ("f5", "f5"),
            ("ctrl+alt+shift+t", "ctrl+alt+shift+t"),
        ] {
            assert_eq!(check_combo(raw, &ctx(false)), Ok(combo.to_string()), "{raw}");
        }
        assert!(check_combo("ctrl+w", &ctx(true)).is_err());
        assert!(check_combo("ctrl+shift+w", &ctx(true)).is_ok());
    }

    #[test]
    fn ejecutables_de_lazunox() {
        assert!(is_lazunox_exe("Lazunox.exe") && is_lazunox_exe("electron.exe"));
        assert!(!is_lazunox_exe("chrome.exe") && !is_lazunox_exe("lazunox"));
    }

    #[test]
    fn varias_combinaciones() {
        assert_eq!(check_keys("ctrl+a ctrl+c", &ctx(false)), Ok(vec!["ctrl+a".to_string(), "ctrl+c".to_string()]));
        assert_eq!(check_keys("ctrl+a win+r ctrl+c", &ctx(false)).unwrap_err().combo, "win+r");
        assert!(check_keys("   ", &ctx(false)).is_err());
        assert!(check_keys(&vec!["a"; 17].join(" "), &ctx(false)).is_err());
        assert!(check_keys(&vec!["a"; 16].join(" "), &ctx(false)).is_ok());
    }

    /// Barrido exhaustivo (mismo que el de `win-keys.test.ts`): invariantes sobre todas las combinaciones.
    #[test]
    fn barrido_exhaustivo() {
        let mods = ["ctrl", "alt", "shift", "win", "cmd"];
        let keys = ["a", "c", "d", "e", "l", "r", "s", "w", "x", "f4", "del", "esc", "escape", "tab", "enter", "1"];
        let mut n = 0;
        for m in 0..(1 << mods.len()) {
            let chosen: Vec<&str> = mods.iter().enumerate().filter(|(i, _)| m & (1 << i) != 0).map(|(_, s)| *s).collect();
            for k in keys {
                let mut parts = chosen.clone();
                parts.push(k);
                let combo = parts.join("+");
                n += 1;
                for front in [false, true] {
                    let v = check_combo(&combo, &ctx(front));
                    let p = parse_combo(&combo).unwrap();
                    if chosen.contains(&"cmd") {
                        assert!(v.is_err(), "{combo}");
                        continue;
                    }
                    if p.mods.contains(&"win") {
                        let allowed = p.mods.len() == 1 && ["d", "e", "s"].contains(&p.key.as_str());
                        assert_eq!(v.is_ok(), allowed, "{combo}");
                        continue;
                    }
                    let m = p.mods.join("+");
                    let forbidden = (m == "ctrl+alt" && p.key == "del")
                        || (m == "ctrl+shift" && p.key == "escape")
                        || (m == "ctrl+alt+shift" && p.key == "escape")
                        || (front && ((m == "alt" && p.key == "f4") || (m == "ctrl" && p.key == "w")));
                    assert_eq!(v.is_ok(), !forbidden, "{combo} front={front}");
                }
            }
        }
        assert_eq!(n, 32 * keys.len());
    }

    #[test]
    fn vk_de_todas_las_teclas_aceptadas() {
        for k in NAMED_KEYS {
            assert!(key_vk(k).is_some(), "{k}");
        }
        for c in "abcdefghijklmnopqrstuvwxyz0123456789-=,./;'`\\[]+".chars() {
            assert!(key_vk(&c.to_string()).is_some(), "{c}");
        }
        for n in 1..=24 {
            assert_eq!(key_vk(&format!("f{n}")), Some((0x70 + n - 1, false)));
        }
        assert_eq!(key_vk("a"), Some((0x41, false)));
        assert_eq!(key_vk("9"), Some((0x39, false)));
        assert_eq!(key_vk("del"), Some((0x2E, true)));
        assert_eq!(key_vk("nopekey"), None);
        for m in ["ctrl", "alt", "shift", "win"] {
            assert!(mod_vk(m).is_some());
        }
        assert!(mod_vk("cmd").is_none());
    }

    #[test]
    fn todo_lo_que_parsea_tiene_vk() {
        // Si el análisis acepta una tecla, la tabla debe saber pulsarla (si no, fallaría tarde y a medias).
        for combo in ["a", "ctrl+f24", "alt+backquote", "shift+menu", "ctrl+printscreen", "escape", "ctrl++", "ctrl+="] {
            let p = parse_combo(combo).unwrap();
            if !p.key.is_empty() {
                assert!(key_vk(&p.key).is_some(), "{combo}");
            }
        }
    }
}
