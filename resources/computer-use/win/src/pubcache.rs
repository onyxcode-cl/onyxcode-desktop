//! Caché en disco del editor (Authenticode) de cada ejecutable. Verificar una firma obliga a leer TODO el ejecutable
//! (los de Electron pesan ~150 MB), así que sin caché `list-apps` y `screenshot` tardarían segundos. La clave de cada
//! entrada es ruta + tamaño + fecha de modificación: si el archivo cambia, se vuelve a verificar.
//! El archivo vive en el directorio temporal que se le pasa al helper y se analiza con rigor (líneas inválidas se
//! descartan, tope de entradas): es consultivo, no una frontera de seguridad (un atacante con el mismo usuario puede
//! hacer cosas peores; el plan acepta ese riesgo).
//! Formato (una entrada por línea, separada por tabuladores): `v1 <tamaño> <mtime_ns> <editor> <ruta>`.

use crate::appkey::{normalize_exe_path, normalize_publisher};

pub const MAX_ENTRIES: usize = 2048;
pub const FILE_NAME: &str = "cu-publishers-v1.cache";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub mtime_ns: u128,
    pub publisher: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PubCache {
    entries: Vec<Entry>,
    pub dirty: bool,
}

impl PubCache {
    pub fn parse(text: &str) -> PubCache {
        let mut entries = Vec::new();
        for line in text.lines().take(MAX_ENTRIES * 2) {
            let f: Vec<&str> = line.split('\t').collect();
            if f.len() != 5 || f[0] != "v1" {
                continue;
            }
            let (Ok(size), Ok(mtime_ns)) = (f[1].parse::<u64>(), f[2].parse::<u128>()) else { continue };
            let (Ok(publisher), Ok(path)) = (normalize_publisher(Some(f[3])), normalize_exe_path(f[4])) else { continue };
            // Una ruta normalizada ya viene en minúsculas: lo que no es canónico se descarta.
            if path != f[4] {
                continue;
            }
            entries.push(Entry { path, size, mtime_ns, publisher });
            if entries.len() >= MAX_ENTRIES {
                break;
            }
        }
        PubCache { entries, dirty: false }
    }

    pub fn serialize(&self) -> String {
        let mut out = String::new();
        for e in &self.entries {
            out.push_str(&format!("v1\t{}\t{}\t{}\t{}\n", e.size, e.mtime_ns, e.publisher, e.path));
        }
        out
    }

    /// `path` es la ruta NORMALIZADA (`normalize_exe_path`).
    pub fn lookup(&self, path: &str, size: u64, mtime_ns: u128) -> Option<&str> {
        self.entries.iter().find(|e| e.path == path && e.size == size && e.mtime_ns == mtime_ns).map(|e| e.publisher.as_str())
    }

    pub fn insert(&mut self, path: &str, size: u64, mtime_ns: u128, publisher: &str) {
        let Ok(path) = normalize_exe_path(path) else { return };
        let Ok(publisher) = normalize_publisher(Some(publisher)) else { return };
        self.entries.retain(|e| e.path != path);
        self.entries.push(Entry { path, size, mtime_ns, publisher });
        if self.entries.len() > MAX_ENTRIES {
            let extra = self.entries.len() - MAX_ENTRIES;
            self.entries.drain(0..extra);
        }
        self.dirty = true;
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ida_y_vuelta() {
        let mut c = PubCache::default();
        c.insert("C:\\Program Files\\Google\\Chrome\\chrome.exe", 3_000_000, 123_456_789, "Google LLC");
        c.insert("C:\\Windows\\notepad.exe", 200_000, 5, "");
        assert!(c.dirty);
        let text = c.serialize();
        let back = PubCache::parse(&text);
        assert_eq!(back.len(), 2);
        assert_eq!(back.lookup("c:\\program files\\google\\chrome\\chrome.exe", 3_000_000, 123_456_789), Some("Google LLC"));
        assert_eq!(back.lookup("c:\\windows\\notepad.exe", 200_000, 5), Some("(sin firma)"));
        assert!(!back.dirty);
    }

    #[test]
    fn cambia_el_archivo_cambia_la_clave() {
        let mut c = PubCache::default();
        c.insert("c:\\a\\b.exe", 10, 20, "X");
        assert!(c.lookup("c:\\a\\b.exe", 11, 20).is_none());
        assert!(c.lookup("c:\\a\\b.exe", 10, 21).is_none());
        assert!(c.lookup("c:\\a\\c.exe", 10, 20).is_none());
        assert_eq!(c.lookup("c:\\a\\b.exe", 10, 20), Some("X"));
    }

    #[test]
    fn reemplaza_la_entrada_de_la_misma_ruta() {
        let mut c = PubCache::default();
        c.insert("c:\\a\\b.exe", 10, 20, "X");
        c.insert("C:\\A\\B.EXE", 11, 21, "Y");
        assert_eq!(c.len(), 1);
        assert_eq!(c.lookup("c:\\a\\b.exe", 11, 21), Some("Y"));
    }

    #[test]
    fn descarta_lineas_invalidas() {
        let text = [
            "v1\t10\t20\tGoogle LLC\tc:\\a\\b.exe",
            "v2\t10\t20\tX\tc:\\a\\b.exe",
            "v1\tx\t20\tX\tc:\\a\\b.exe",
            "v1\t10\t20\tX\tC:\\A\\B.EXE",
            "v1\t10\t20\tX\tc:\\a\\..\\b.exe",
            "v1\t10\t20\tX\t\\\\srv\\s\\b.exe",
            "v1\t10\t20\ta|b\tc:\\a\\c.exe",
            "v1\t10\t20\tX",
            "basura",
            "",
        ]
        .join("\n");
        let c = PubCache::parse(&text);
        assert_eq!(c.len(), 1);
        assert_eq!(c.lookup("c:\\a\\b.exe", 10, 20), Some("Google LLC"));
    }

    #[test]
    fn tope_de_entradas() {
        let mut c = PubCache::default();
        for i in 0..(MAX_ENTRIES + 50) {
            c.insert(&format!("c:\\a\\p{i}.exe"), 1, 1, "X");
        }
        assert_eq!(c.len(), MAX_ENTRIES);
        assert!(c.lookup("c:\\a\\p0.exe", 1, 1).is_none());
        assert!(c.lookup(&format!("c:\\a\\p{}.exe", MAX_ENTRIES + 49), 1, 1).is_some());
        let big: String = (0..(MAX_ENTRIES * 3)).map(|i| format!("v1\t1\t1\tX\tc:\\a\\q{i}.exe\n")).collect();
        assert_eq!(PubCache::parse(&big).len(), MAX_ENTRIES);
    }
}
