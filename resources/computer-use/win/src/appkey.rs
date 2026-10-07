//! Clave de app en Windows (espejo de `src/main/computer/policy/app-key.ts`):
//!  - `exe:<ruta en minúsculas>|pub:<editor>`; el editor `(sin firma)` si no hay firma válida.
//!  - `aumid:<id en minúsculas>` para las apps de la Store/UWP.
//!
//! La ruta completa y el editor impiden que un `chrome.exe` falso en %TEMP% herede la concesión.

pub const UNSIGNED_PUBLISHER: &str = "(sin firma)";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppKey {
    Exe { path: String, publisher: String },
    Aumid(String),
}

fn is_short_83(seg: &str) -> bool {
    let (name, ext) = match seg.find('.') {
        Some(i) => (&seg[..i], Some(&seg[i + 1..])),
        None => (seg, None),
    };
    if let Some(e) = ext {
        if e.chars().count() > 3 || e.contains('.') {
            return false;
        }
    }
    let Some(t) = name.find('~') else { return false };
    let (head, digits) = (&name[..t], &name[t + 1..]);
    !head.is_empty()
        && head.chars().count() <= 6
        && !head.chars().any(|c| c.is_whitespace() || c == '.')
        && !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit())
}

pub fn normalize_exe_path(raw: &str) -> Result<String, String> {
    let mut p = raw.trim().to_string();
    if p.starts_with("\\\\?\\") && !p.to_lowercase().starts_with("\\\\?\\unc\\") {
        p = p[4..].to_string();
    }
    if p.is_empty() {
        return Err("Ruta del programa vacía".into());
    }
    p = p.replace('/', "\\");
    if p.starts_with("\\\\") {
        return Err("Las rutas de red (UNC) no se pueden conceder".into());
    }
    let b = p.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
        return Err("La ruta del programa debe ser absoluta (unidad:\\…)".into());
    }
    let rest = &p[2..];
    if rest.chars().any(|c| "|<>\"*?".contains(c) || (c as u32) < 0x20) || rest.contains(':') {
        return Err("La ruta del programa contiene caracteres no válidos".into());
    }
    let parts: Vec<&str> = p[3..].split('\\').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("La ruta no apunta a un programa".into());
    }
    if parts.iter().any(|s| *s == "." || *s == "..") {
        return Err("La ruta del programa no puede contener «.» ni «..»".into());
    }
    if parts.iter().any(|s| is_short_83(s)) {
        return Err("Ruta corta 8.3 rechazada: usa la ruta completa".into());
    }
    if parts.iter().any(|s| s.ends_with(' ') || s.ends_with('.')) {
        return Err("La ruta del programa contiene un nombre no válido".into());
    }
    Ok(format!("{}{}", &p[..3], parts.join("\\")).to_lowercase())
}

pub fn normalize_publisher(raw: Option<&str>) -> Result<String, String> {
    let src = raw.unwrap_or("");
    if src.chars().any(|c| c == '|' || (c as u32) < 0x20) {
        return Err("Editor del programa no válido".into());
    }
    let v = src.split_whitespace().collect::<Vec<_>>().join(" ");
    if v.is_empty() {
        return Ok(UNSIGNED_PUBLISHER.into());
    }
    if v.chars().count() > 200 {
        return Err("Editor del programa no válido".into());
    }
    Ok(v)
}

pub fn exe_key(path: &str, publisher: Option<&str>) -> Result<String, String> {
    let p = normalize_exe_path(path)?;
    let pubs = normalize_publisher(publisher)?;
    Ok(format!("exe:{p}|pub:{pubs}"))
}

pub fn aumid_key(aumid: &str) -> Result<String, String> {
    let v = aumid.trim();
    let bad = || Err("AUMID no válido".to_string());
    if v.is_empty() || v.chars().count() > 256 {
        return Err("AUMID vacío o demasiado largo".into());
    }
    let mut chars = v.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '!')) {
        return bad();
    }
    if v.matches('!').count() > 1 || v.ends_with('!') {
        return bad();
    }
    Ok(format!("aumid:{}", v.to_lowercase()))
}

/// UWP (con AUMID) manda sobre la ruta del exe (que sería `ApplicationFrameHost.exe`, común a todas).
pub fn app_key_for(aumid: Option<&str>, exe_path: Option<&str>, publisher: Option<&str>) -> Result<String, String> {
    if let Some(a) = aumid.filter(|a| !a.is_empty()) {
        return aumid_key(a);
    }
    if let Some(p) = exe_path.filter(|p| !p.is_empty()) {
        return exe_key(p, publisher);
    }
    Err("Falta el AUMID o la ruta del programa".into())
}

/// Analiza una clave recibida por la línea de comandos; solo acepta claves YA canónicas (idénticas a las que
/// produciría `exe_key`/`aumid_key`): lo que no es exactamente canónico se rechaza.
pub fn parse_app_key(key: &str) -> Result<AppKey, String> {
    if key.chars().count() > 1024 {
        return Err("Clave de app demasiado larga".into());
    }
    if let Some(rest) = key.strip_prefix("aumid:") {
        let k = aumid_key(rest)?;
        return if k == key { Ok(AppKey::Aumid(rest.to_string())) } else { Err("Clave de app no canónica".into()) };
    }
    let Some(body) = key.strip_prefix("exe:") else { return Err("Clave de app no válida (exe:<ruta>|pub:<editor> o aumid:<id>)".into()) };
    let Some(i) = body.find("|pub:") else { return Err("Clave de app sin editor".into()) };
    let (path, publisher) = (&body[..i], &body[i + 5..]);
    let k = exe_key(path, if publisher == UNSIGNED_PUBLISHER { None } else { Some(publisher) })?;
    if k == key {
        Ok(AppKey::Exe { path: path.to_string(), publisher: publisher.to_string() })
    } else {
        Err("Clave de app no canónica".into())
    }
}

impl AppKey {
    /// Clave canónica (la misma que produce `exe_key`/`aumid_key`).
    pub fn to_key_string(&self) -> String {
        match self {
            AppKey::Aumid(id) => format!("aumid:{id}"),
            AppKey::Exe { path, publisher } => format!("exe:{path}|pub:{publisher}"),
        }
    }
}

/// Nombre del ejecutable de una ruta normalizada (`c:\x\chrome.exe` → `chrome.exe`).
pub fn exe_base_name(path: &str) -> &str {
    path.rsplit('\\').next().unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_y_aumid() {
        assert_eq!(
            exe_key("C:/Program Files/Google/Chrome/Application/chrome.exe", Some("Google  LLC")).unwrap(),
            "exe:c:\\program files\\google\\chrome\\application\\chrome.exe|pub:Google LLC"
        );
        assert_eq!(exe_key("c:\\a\\b.exe", None).unwrap(), "exe:c:\\a\\b.exe|pub:(sin firma)");
        assert_eq!(aumid_key("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").unwrap(), "aumid:microsoft.windowscalculator_8wekyb3d8bbwe!app");
        assert_eq!(app_key_for(Some("A.B!C"), Some("c:\\x\\frame.exe"), None).unwrap(), "aumid:a.b!c");
        assert!(app_key_for(None, None, None).is_err());
    }

    #[test]
    fn rutas_rechazadas() {
        for p in [
            "",
            "chrome.exe",
            "\\\\srv\\share\\a.exe",
            "C:\\a\\..\\b.exe",
            "C:\\a\\.\\b.exe",
            "C:\\PROGRA~1\\a.exe",
            "C:\\a\\ARCHIV~1.EXE",
            "C:\\a|b\\c.exe",
            "C:\\a\\b.exe:zone",
            "C:\\a \\b.exe",
            "C:\\",
            "D:\\a\u{1}.exe",
        ] {
            assert!(normalize_exe_path(p).is_err(), "{p:?}");
        }
        assert_eq!(normalize_exe_path("\\\\?\\C:\\A\\B.EXE").unwrap(), "c:\\a\\b.exe");
        assert!(normalize_exe_path("\\\\?\\UNC\\srv\\x\\a.exe").is_err());
    }

    #[test]
    fn editor_y_aumid_invalidos() {
        assert!(normalize_publisher(Some("a|b")).is_err());
        assert!(normalize_publisher(Some(&"x".repeat(201))).is_err());
        assert_eq!(normalize_publisher(Some("   ")).unwrap(), UNSIGNED_PUBLISHER);
        for a in ["", "!a", "a!b!c", "a!", "a b", "a/b", &"a".repeat(257)] {
            assert!(aumid_key(a).is_err(), "{a:?}");
        }
    }

    #[test]
    fn analiza_claves_solo_canonicas() {
        let k = exe_key("C:\\Windows\\notepad.exe", Some("Microsoft Windows")).unwrap();
        assert_eq!(parse_app_key(&k), Ok(AppKey::Exe { path: "c:\\windows\\notepad.exe".into(), publisher: "Microsoft Windows".into() }));
        assert_eq!(
            parse_app_key("exe:c:\\a\\b.exe|pub:(sin firma)"),
            Ok(AppKey::Exe { path: "c:\\a\\b.exe".into(), publisher: UNSIGNED_PUBLISHER.into() })
        );
        assert_eq!(parse_app_key("aumid:a.b!c"), Ok(AppKey::Aumid("a.b!c".into())));
        for bad in ["", "aumid:A.B", "exe:C:\\A\\B.exe|pub:X", "exe:c:\\a\\b.exe", "exe:c:\\a\\..\\b.exe|pub:X", "com.apple.Safari", "exe:c:\\a\\b.exe|pub:a  b"] {
            assert!(parse_app_key(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn ida_y_vuelta_de_claves() {
        for k in ["exe:c:\\a\\b.exe|pub:(sin firma)", "exe:c:\\a b\\c.exe|pub:Google LLC", "aumid:a.b!c"] {
            assert_eq!(parse_app_key(k).unwrap().to_key_string(), k);
        }
    }

    #[test]
    fn nombre_del_ejecutable() {
        assert_eq!(exe_base_name("c:\\a\\chrome.exe"), "chrome.exe");
    }
}
