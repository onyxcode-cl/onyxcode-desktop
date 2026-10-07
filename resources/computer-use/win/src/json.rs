//! JSON mínimo y sin dependencias: serializa en UNA línea con las claves ordenadas (como
//! `JSONSerialization` con `.sortedKeys` del helper de macOS) y analiza la consulta de `ax-find`.
//! El analizador falla cerrado: profundidad ≤ 32, entrada ≤ 64 KiB, sin comentarios ni comas finales.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

pub const MAX_PARSE_BYTES: usize = 64 * 1024;
const MAX_PARSE_DEPTH: usize = 32;

impl Json {
    pub fn obj<const N: usize>(pairs: [(&str, Json); N]) -> Json {
        Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    pub fn str(s: impl Into<String>) -> Json {
        Json::Str(s.into())
    }
    pub fn num(n: impl Into<f64>) -> Json {
        Json::Num(n.into())
    }
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(m) => m.get(key),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Arr(a) => Some(a),
            _ => None,
        }
    }
    pub fn as_object(&self) -> Option<&BTreeMap<String, Json>> {
        match self {
            Json::Obj(m) => Some(m),
            _ => None,
        }
    }

    /// Una sola línea, claves ordenadas, sin espacios.
    pub fn to_line(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Json::Num(n) => write_num(*n, out),
            Json::Str(s) => write_str(s, out),
            Json::Arr(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write(out);
                }
                out.push(']');
            }
            Json::Obj(m) => {
                out.push('{');
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_str(k, out);
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_num(n: f64, out: &mut String) {
    if !n.is_finite() {
        out.push_str("null");
    } else if n.fract() == 0.0 && n.abs() < 1e15 {
        out.push_str(&format!("{}", n as i64));
    } else {
        out.push_str(&format!("{}", n));
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{7f}' || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Recorta a `max` caracteres (no bytes), como `String.prefix` de Swift.
pub fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

pub fn parse(input: &str) -> Result<Json, String> {
    if input.len() > MAX_PARSE_BYTES {
        return Err("JSON demasiado grande".into());
    }
    let mut p = Parser { s: input.as_bytes(), i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i != p.s.len() {
        return Err("Texto sobrante tras el JSON".into());
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("Se esperaba «{}»", c as char))
        }
    }
    fn lit(&mut self, word: &str, v: Json) -> Result<Json, String> {
        if self.s[self.i..].starts_with(word.as_bytes()) {
            self.i += word.len();
            Ok(v)
        } else {
            Err("Literal no válido".into())
        }
    }
    fn value(&mut self, depth: usize) -> Result<Json, String> {
        if depth > MAX_PARSE_DEPTH {
            return Err("JSON demasiado anidado".into());
        }
        match self.peek() {
            None => Err("JSON incompleto".into()),
            Some(b'{') => {
                self.i += 1;
                let mut m = BTreeMap::new();
                self.ws();
                if self.peek() == Some(b'}') {
                    self.i += 1;
                    return Ok(Json::Obj(m));
                }
                loop {
                    self.ws();
                    let k = self.string()?;
                    self.ws();
                    self.eat(b':')?;
                    self.ws();
                    let v = self.value(depth + 1)?;
                    m.insert(k, v);
                    self.ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Json::Obj(m));
                        }
                        _ => return Err("Objeto JSON mal formado".into()),
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.peek() == Some(b']') {
                    self.i += 1;
                    return Ok(Json::Arr(a));
                }
                loop {
                    self.ws();
                    a.push(self.value(depth + 1)?);
                    self.ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Json::Arr(a));
                        }
                        _ => return Err("Lista JSON mal formada".into()),
                    }
                }
            }
            Some(b'"') => Ok(Json::Str(self.string()?)),
            Some(b't') => self.lit("true", Json::Bool(true)),
            Some(b'f') => self.lit("false", Json::Bool(false)),
            Some(b'n') => self.lit("null", Json::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
            Some(_) => Err("Carácter inesperado en el JSON".into()),
        }
    }
    fn number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        let digits = |p: &mut Self| {
            let s = p.i;
            while p.peek().is_some_and(|c| c.is_ascii_digit()) {
                p.i += 1;
            }
            p.i > s
        };
        if !digits(self) {
            return Err("Número no válido".into());
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            if !digits(self) {
                return Err("Número no válido".into());
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if !digits(self) {
                return Err("Número no válido".into());
            }
        }
        let t = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| "Número no válido")?;
        t.parse::<f64>().map(Json::Num).map_err(|_| "Número no válido".to_string())
    }
    fn hex4(&mut self) -> Result<u32, String> {
        if self.i + 4 > self.s.len() {
            return Err("Escape \\u incompleto".into());
        }
        let t = std::str::from_utf8(&self.s[self.i..self.i + 4]).map_err(|_| "Escape \\u no válido")?;
        let v = u32::from_str_radix(t, 16).map_err(|_| "Escape \\u no válido".to_string())?;
        self.i += 4;
        Ok(v)
    }
    fn string(&mut self) -> Result<String, String> {
        self.eat(b'"')?;
        let mut buf: Vec<u8> = Vec::new();
        loop {
            let c = self.peek().ok_or("Cadena sin cerrar")?;
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.peek().ok_or("Escape incompleto")?;
                    self.i += 1;
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let hi = self.hex4()?;
                            if (0xD800..0xDC00).contains(&hi) {
                                if self.s[self.i..].starts_with(b"\\u") {
                                    self.i += 2;
                                    let lo = self.hex4()?;
                                    if !(0xDC00..0xE000).contains(&lo) {
                                        return Err("Par sustituto no válido".into());
                                    }
                                    char::from_u32(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)).ok_or("Carácter no válido")?
                                } else {
                                    return Err("Par sustituto incompleto".into());
                                }
                            } else if (0xDC00..0xE000).contains(&hi) {
                                return Err("Par sustituto no válido".into());
                            } else {
                                char::from_u32(hi).ok_or("Carácter no válido")?
                            }
                        }
                        _ => return Err("Escape no válido".into()),
                    };
                    let mut tmp = [0u8; 4];
                    buf.extend_from_slice(ch.encode_utf8(&mut tmp).as_bytes());
                }
                c if c < 0x20 => return Err("Carácter de control sin escapar".into()),
                c => buf.push(c),
            }
        }
        String::from_utf8(buf).map_err(|_| "UTF-8 no válido".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializa_ordenado_en_una_linea() {
        let v = Json::obj([("b", Json::Bool(true)), ("a", Json::num(1.0)), ("c", Json::Arr(vec![Json::Null, Json::str("x")]))]);
        assert_eq!(v.to_line(), r#"{"a":1,"b":true,"c":[null,"x"]}"#);
    }
    #[test]
    fn numeros() {
        assert_eq!(Json::num(1.5).to_line(), "1.5");
        assert_eq!(Json::num(-3.0).to_line(), "-3");
        assert_eq!(Json::num(f64::NAN).to_line(), "null");
        assert_eq!(Json::num(1366.0).to_line(), "1366");
    }
    #[test]
    fn escapes() {
        assert_eq!(Json::str("a\"b\\c\n\t\u{1}ñ😀").to_line(), "\"a\\\"b\\\\c\\n\\t\\u0001ñ😀\"");
    }
    #[test]
    fn ida_y_vuelta() {
        let t = r#"{"role":"Button","limit":5,"neg":-2.5e1,"x":[true,false,null,{"a":"\u00e1\ud83d\ude00"}]}"#;
        let v = parse(t).unwrap();
        assert_eq!(v.get("role").unwrap().as_str(), Some("Button"));
        assert_eq!(v.get("neg").unwrap().as_f64(), Some(-25.0));
        assert_eq!(parse(&v.to_line()).unwrap(), v);
        assert_eq!(v.get("x").unwrap().as_array().unwrap()[3].get("a").unwrap().as_str(), Some("á😀"));
    }
    #[test]
    fn rechaza_mal_formados() {
        for bad in ["", "{", "[1,]", "{\"a\":1,}", "{'a':1}", "nul", "01x", "\"\\ud800\"", "\"\\x\"", "1 2", "{\"a\"}", "\"a\nb\"", "-"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn limites() {
        let deep = "[".repeat(40) + &"]".repeat(40);
        assert!(parse(&deep).is_err());
        let ok = "[".repeat(30) + &"]".repeat(30);
        assert!(parse(&ok).is_ok());
        assert!(parse(&format!("\"{}\"", "a".repeat(MAX_PARSE_BYTES))).is_err());
    }
    #[test]
    fn clip_por_caracteres() {
        assert_eq!(clip("añb😀c", 4), "añb😀");
    }
}
