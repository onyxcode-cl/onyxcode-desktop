//! Plegado de texto (sin mayúsculas ni diacríticos) y coincidencia difusa acotada para `find-elements`.
//! Espejo de `foldText`/`fuzzyContains` del helper de macOS.

const FOLD: &[(&str, char)] = &[
    ("àáâãäåāăąǎ", 'a'),
    ("çćĉċč", 'c'),
    ("ďđ", 'd'),
    ("èéêëēĕėęě", 'e'),
    ("ĝğġģ", 'g'),
    ("ĥħ", 'h'),
    ("ìíîïĩīĭįı", 'i'),
    ("ĵ", 'j'),
    ("ķ", 'k'),
    ("ĺļľŀł", 'l'),
    ("ñńņňŉ", 'n'),
    ("òóôõöøōŏőǒ", 'o'),
    ("ŕŗř", 'r'),
    ("śŝşš", 's'),
    ("ţťŧ", 't'),
    ("ùúûüũūŭůűųǔ", 'u'),
    ("ŵ", 'w'),
    ("ýÿŷ", 'y'),
    ("źżž", 'z'),
];

/// Minúsculas y sin diacríticos latinos ("Música" ≈ "musica"); quita también marcas combinantes (NFD).
pub fn fold_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(|c| c.to_lowercase()) {
        if ('\u{0300}'..='\u{036f}').contains(&c) {
            continue;
        }
        match FOLD.iter().find(|(set, _)| set.contains(c)) {
            Some((_, base)) => out.push(*base),
            None => out.push(c),
        }
    }
    out
}

/// Subcadena directa, o subsecuencia de `needle` en `haystack` dentro de una ventana ajustada
/// (como mucho el triple de caracteres de `needle`, o 12): mejor no encontrar nada que ofrecer una coordenada falsa.
pub fn fuzzy_contains(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() || haystack.contains(needle) {
        return true;
    }
    let n: Vec<char> = needle.chars().collect();
    if n.len() < 3 {
        return false;
    }
    let hay: Vec<char> = haystack.chars().collect();
    let mut h = 0usize;
    let mut start: Option<usize> = None;
    let mut last = 0usize;
    for ch in &n {
        let mut found = false;
        while h < hay.len() {
            if hay[h] == *ch {
                if start.is_none() {
                    start = Some(h);
                }
                last = h;
                h += 1;
                found = true;
                break;
            }
            h += 1;
        }
        if !found {
            return false;
        }
    }
    match start {
        Some(s) => last - s < std::cmp::max(n.len() * 3, 12),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pliega_acentos_y_mayusculas() {
        assert_eq!(fold_text("Música ÑANDÚ Çedilla Ångström"), "musica nandu cedilla angstrom");
        assert_eq!(fold_text("cafe\u{0301}"), "cafe");
        assert_eq!(fold_text("Hello 😀 日本"), "hello 😀 日本");
    }
    #[test]
    fn coincidencia_difusa() {
        assert!(fuzzy_contains("guardar archivo", "guardar"));
        assert!(fuzzy_contains("abrir archivo reciente", "abrarch"));
        assert!(!fuzzy_contains("a very long unrelated text with scattered letters", "escritorio"));
        assert!(!fuzzy_contains("abc", "xy"));
        assert!(fuzzy_contains("anything", ""));
        assert!(!fuzzy_contains("ab", "ba"));
    }
}
