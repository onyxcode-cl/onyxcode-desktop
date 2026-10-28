//! cu-helper para Windows: helper nativo de Control del PC de Lazunox.
//!
//! Estructura:
//!  - PURO (se prueba con `cargo test` nativo en cualquier sistema): `json`, `commands` (análisis de la línea de
//!    comandos), `keys` (combinaciones y lista de bloqueadas), `motion` (trayectoria y tecleo), `paths`, `appkey`,
//!    `roles`, `mask`, `fuzzy`, `limits`, `exitcode`, `protocol_tests`.
//!  - ESPECÍFICO de Windows, detrás de `#[cfg(windows)]` (verificado con `cargo check/build --target
//!    x86_64-pc-windows-gnu`; NO probado en un Windows real): `win`.
//!
//! Sin red, sin telemetría, sin ejecutar procesos, y solo escribe dentro del directorio temporal que se le pasa.

pub mod appkey;
pub mod cli;
pub mod blocklist;
pub mod commands;
pub mod exitcode;
pub mod fuzzy;
pub mod json;
pub mod keys;
pub mod limits;
pub mod mask;
pub mod motion;
pub mod occlusion;
pub mod paths;
pub mod pubcache;
pub mod roles;

#[cfg(test)]
mod protocol_tests;

#[cfg(windows)]
pub mod win;
