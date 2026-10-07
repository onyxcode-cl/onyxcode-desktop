//! Códigos de salida del helper (contrato: `resources/computer-use/protocol.json`, `exitCodes`).
//! El 2 (Accesibilidad de macOS) y el 4, 5 y 6 (ScreenCaptureKit y voz) no se usan en Windows.

pub const GENERIC: i32 = 1;
pub const STOPPED: i32 = 3;
pub const APP_NOT_RUNNING: i32 = 7;
pub const ELEMENT_CHANGED: i32 = 8;
pub const SECURE_FIELD: i32 = 9;
pub const NOT_EDITABLE: i32 = 10;
pub const NOT_ALLOWED: i32 = 11;
pub const UNAVAILABLE: i32 = 12;

/// Códigos que este helper puede devolver.
pub const USED: [i32; 8] = [1, 3, 7, 8, 9, 10, 11, 12];

/// Error con código de salida; el mensaje va a stderr.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CuError {
    pub code: i32,
    pub msg: String,
}

pub type CuResult<T> = Result<T, CuError>;

impl CuError {
    pub fn new(code: i32, msg: impl Into<String>) -> Self {
        CuError { code, msg: msg.into() }
    }
    pub fn generic(msg: impl Into<String>) -> Self {
        Self::new(GENERIC, msg)
    }
    pub fn unavailable(msg: impl Into<String>) -> Self {
        Self::new(UNAVAILABLE, msg)
    }
    pub fn not_allowed(msg: impl Into<String>) -> Self {
        Self::new(NOT_ALLOWED, msg)
    }
    pub fn stopped() -> Self {
        Self::new(STOPPED, "Control detenido por el usuario")
    }
}
