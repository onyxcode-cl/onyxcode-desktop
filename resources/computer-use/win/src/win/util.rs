//! Utilidades comunes de la parte de Windows.
use windows::Win32::Foundation::{CloseHandle, HANDLE};

/// Cadena UTF-16 terminada en NUL.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// UTF-16 (hasta el primer NUL) a `String` (sustituyendo lo inválido).
pub fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Un HANDLE que se cierra solo.
pub struct OwnedHandle(pub HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn sleep_ms(ms: f64) {
    if ms >= 1.0 {
        std::thread::sleep(std::time::Duration::from_micros((ms * 1000.0) as u64));
    }
}
