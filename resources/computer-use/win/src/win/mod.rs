//! Parte específica de Windows (todo el módulo está detrás de `#[cfg(windows)]` en `lib.rs`).
pub mod input;
pub mod process;
pub mod screen;
pub mod session;
pub mod stop;
pub mod util;
pub mod wnd;
pub mod uia;
pub mod capture;
pub mod apps;
pub mod hook;
pub mod run;
