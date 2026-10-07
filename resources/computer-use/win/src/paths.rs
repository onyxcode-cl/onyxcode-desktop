//! Validación PURA de rutas de salida. El helper solo escribe dentro del directorio temporal que se le pasa
//! (`CU_TEMP_DIR`, o `TEMP`/`TMP`) y solo archivos de imagen (`.jpg`, `.jpeg`, `.png`) o el archivo de entrada reciente.
//! Falla cerrado: relativas, `..`, UNC, rutas de dispositivo (`\\?\`, `\\.\`), flujos alternos (`:`), nombres
//! reservados (CON, NUL…), 8.3 y segmentos con punto o espacio final se rechazan.
//! La comprobación léxica no basta contra enlaces/uniones: en Windows, además, se canonicaliza el directorio padre.

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Minúsculas, `/` → `\`, sin separadores repetidos ni final. None si no es una ruta absoluta con unidad.
fn normalize(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.chars().any(|c| (c as u32) < 0x20) {
        return Err("Ruta vacía o con caracteres de control".into());
    }
    let p = raw.replace('/', "\\");
    if p.starts_with("\\\\") {
        return Err("Rutas de red o de dispositivo (\\\\…) no permitidas".into());
    }
    let b = p.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
        return Err("La ruta debe ser absoluta (unidad:\\…)".into());
    }
    let mut segs: Vec<&str> = Vec::new();
    for s in p[3..].split('\\') {
        if s.is_empty() {
            continue;
        }
        segs.push(s);
    }
    let mut out = String::new();
    out.push_str(&p[..3].to_lowercase());
    out.push_str(&segs.join("\\").to_lowercase());
    Ok(out)
}

fn segments(norm: &str) -> Vec<&str> {
    norm[3..].split('\\').filter(|s| !s.is_empty()).collect()
}

fn is_short_83(seg: &str) -> bool {
    let (name, ext) = match seg.find('.') {
        Some(i) => (&seg[..i], Some(&seg[i + 1..])),
        None => (seg, None),
    };
    if let Some(e) = ext {
        if e.len() > 3 || e.contains('.') {
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

fn check_segment(seg: &str) -> Result<(), String> {
    if seg == "." || seg == ".." {
        return Err("La ruta no puede contener «.» ni «..»".into());
    }
    if seg.contains(':') || seg.chars().any(|c| "|<>\"*?".contains(c)) {
        return Err("La ruta contiene caracteres no válidos (incluye flujos alternos «:»)".into());
    }
    if seg.ends_with(' ') || seg.ends_with('.') {
        return Err("La ruta contiene un nombre no válido".into());
    }
    let stem = seg.split('.').next().unwrap_or("");
    if RESERVED.contains(&stem) {
        return Err("La ruta usa un nombre reservado de Windows".into());
    }
    if is_short_83(seg) {
        return Err("Ruta corta 8.3 rechazada".into());
    }
    Ok(())
}

/// Normaliza y valida `root` (el directorio temporal): absoluta, sin trucos y no la raíz de una unidad.
pub fn validate_root(root: &str) -> Result<String, String> {
    let n = normalize(root)?;
    let segs = segments(&n);
    if segs.is_empty() {
        return Err("El directorio temporal no puede ser la raíz de una unidad".into());
    }
    // Los directorios de usuario con `~` (8.3) son habituales en %TEMP% corto: se exige la ruta larga también aquí.
    for s in &segs {
        check_segment(s)?;
    }
    Ok(n)
}

/// ¿`path` queda estrictamente DENTRO de `root` (ya validada)? Devuelve la ruta normalizada.
fn inside(path: &str, root_norm: &str) -> Result<String, String> {
    let n = normalize(path)?;
    let prefix = format!("{root_norm}\\");
    if !n.starts_with(&prefix) || n.len() == prefix.len() {
        return Err("La ruta de salida debe estar dentro del directorio temporal".into());
    }
    for s in segments(&n) {
        check_segment(s)?;
    }
    Ok(n)
}

/// Ruta de una imagen de salida: dentro de `root` y con extensión jpg/jpeg/png.
pub fn validate_image_out(path: &str, root: &str) -> Result<String, String> {
    let r = validate_root(root)?;
    let n = inside(path, &r)?;
    let name = n.rsplit('\\').next().unwrap_or("");
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && matches!(ext, "jpg" | "jpeg" | "png") => Ok(n),
        _ => Err("La salida debe ser un archivo .jpg, .jpeg o .png".into()),
    }
}

/// Ruta de un archivo de datos auxiliar (p. ej. `COMPUTER_INPUT_FILE`): dentro de `root`, cualquier nombre válido.
pub fn validate_data_file(path: &str, root: &str) -> Result<String, String> {
    let r = validate_root(root)?;
    inside(path, &r)
}

/// Formato de imagen por la extensión de una ruta ya validada.
pub fn image_format(path: &str) -> ImageFormat {
    if path.to_lowercase().ends_with(".png") {
        ImageFormat::Png
    } else {
        ImageFormat::Jpeg
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Jpeg,
    Png,
}

#[cfg(test)]
mod tests {
    use super::*;
    const ROOT: &str = "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer";

    #[test]
    fn acepta_dentro_del_temporal() {
        for p in [
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot-1.jpg",
            "c:/users/ana/appdata/local/temp/lazunox-computer/sub/a.PNG",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\\\x.jpeg",
        ] {
            assert!(validate_image_out(p, ROOT).is_ok(), "{p}");
        }
        assert_eq!(
            validate_image_out("C:/Users/Ana/AppData/Local/Temp/lazunox-computer/Shot.JPG", ROOT).unwrap(),
            "c:\\users\\ana\\appdata\\local\\temp\\lazunox-computer\\shot.jpg"
        );
    }

    #[test]
    fn rechaza_fuera_o_con_trucos() {
        let bad = [
            "shot.jpg",
            "\\shot.jpg",
            "C:shot.jpg",
            "C:\\Users\\Ana\\Desktop\\shot.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer-evil\\shot.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\..\\shot.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\..\\..\\Desktop\\shot.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\",
            "\\\\server\\share\\shot.jpg",
            "\\\\?\\C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot.jpg",
            "\\\\.\\C:\\x.jpg",
            "//server/share/x.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot.jpg:stream",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot.jpg.",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\nul.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\COM1",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\SHOT~1.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot.exe",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\shot",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\a*b.jpg",
            "C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\a\u{0}.jpg",
            "",
        ];
        for p in bad {
            assert!(validate_image_out(p, ROOT).is_err(), "{p:?}");
        }
    }

    #[test]
    fn la_raiz_tambien_se_valida() {
        for r in ["", "C:\\", "C:", "relative\\tmp", "\\\\server\\tmp", "C:\\a\\..\\b", "C:\\PROGRA~1\\x"] {
            assert!(validate_image_out("C:\\a\\x.jpg", r).is_err(), "{r:?}");
        }
        assert!(validate_root("C:\\Temp").is_ok());
    }

    #[test]
    fn archivo_de_datos() {
        assert!(validate_data_file("C:\\Users\\Ana\\AppData\\Local\\Temp\\lazunox-computer\\input.txt", ROOT).is_ok());
        assert!(validate_data_file("C:\\Users\\Ana\\AppData\\Local\\Temp\\other\\input.txt", ROOT).is_err());
    }

    #[test]
    fn formato_por_extension() {
        assert_eq!(image_format("c:\\t\\a.png"), ImageFormat::Png);
        assert_eq!(image_format("c:\\t\\a.JPG"), ImageFormat::Jpeg);
    }

    #[test]
    fn ocho_punto_tres() {
        for s in ["progra~1", "docume~2.txt", "archiv~1.exe", "a~1"] {
            assert!(is_short_83(s), "{s}");
        }
        for s in ["program files", "a~b", "abcdefg~1", "x.tar.gz", "~1", "ab~"] {
            assert!(!is_short_83(s), "{s}");
        }
    }
}
