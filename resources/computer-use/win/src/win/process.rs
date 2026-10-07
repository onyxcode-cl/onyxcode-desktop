//! Información de procesos: ruta del ejecutable, nivel de integridad, AUMID y editor (Authenticode).
//! Todo falla CERRADO: si no se puede consultar un proceso, su integridad es `Unknown` y se trata como bloqueado.

use super::util::{from_wide, wide, OwnedHandle};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE, HWND};
use windows::Win32::Security::Cryptography::{
    CertFindCertificateInStore, CertFreeCertificateContext, CertGetNameStringW, CryptMsgClose, CryptMsgGetParam, CryptQueryObject,
    CERT_FIND_SUBJECT_CERT, CERT_INFO, CERT_NAME_SIMPLE_DISPLAY_TYPE, CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
    CERT_QUERY_FORMAT_FLAG_BINARY, CERT_QUERY_OBJECT_FILE, CMSG_SIGNER_INFO_PARAM, HCERTSTORE, PKCS_7_ASN_ENCODING, X509_ASN_ENCODING,
};
use windows::Win32::Security::WinTrust::{
    WinVerifyTrust, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE,
    WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenElevation, TokenIntegrityLevel, TOKEN_ELEVATION,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::Storage::FileSystem::GetLongPathNameW;
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Integrity {
    Low,
    Medium,
    High,
    System,
    /// No se pudo consultar: se trata como no controlable.
    Unknown,
}

impl Integrity {
    /// ¿Se puede (y debe) controlar un proceso con esta integridad? Solo Low y Medium.
    pub fn controllable(self) -> bool {
        matches!(self, Integrity::Low | Integrity::Medium)
    }
}

const SECURITY_MANDATORY_MEDIUM_RID: u32 = 0x2000;
const SECURITY_MANDATORY_HIGH_RID: u32 = 0x3000;
const SECURITY_MANDATORY_SYSTEM_RID: u32 = 0x4000;

pub fn pid_of(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

fn open_limited(pid: u32) -> Option<OwnedHandle> {
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().map(OwnedHandle) }
}

/// Ruta completa (larga) del ejecutable, tal cual (sin normalizar).
pub fn exe_path(pid: u32) -> Option<String> {
    let h = open_limited(pid)?;
    let mut buf = vec![0u16; 1024];
    let mut len = buf.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(h.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).ok()?;
    }
    let p = String::from_utf16_lossy(&buf[..len as usize]);
    Some(long_path(&p).unwrap_or(p))
}

/// Ruta larga (expande 8.3).
pub fn long_path(p: &str) -> Option<String> {
    let w = wide(p);
    unsafe {
        let n = GetLongPathNameW(PCWSTR(w.as_ptr()), None);
        if n == 0 {
            return None;
        }
        let mut out = vec![0u16; n as usize + 1];
        let m = GetLongPathNameW(PCWSTR(w.as_ptr()), Some(&mut out));
        if m == 0 || m as usize > out.len() {
            return None;
        }
        Some(String::from_utf16_lossy(&out[..m as usize]))
    }
}

fn token_of(h: HANDLE) -> Option<OwnedHandle> {
    let mut t = HANDLE::default();
    unsafe {
        OpenProcessToken(h, TOKEN_QUERY, &mut t).ok()?;
    }
    Some(OwnedHandle(t))
}

fn integrity_of_token(t: &OwnedHandle) -> Integrity {
    unsafe {
        let mut need = 0u32;
        let _ = GetTokenInformation(t.0, TokenIntegrityLevel, None, 0, &mut need);
        if need == 0 || need > 4096 {
            return Integrity::Unknown;
        }
        let mut buf = vec![0u8; need as usize];
        if GetTokenInformation(t.0, TokenIntegrityLevel, Some(buf.as_mut_ptr() as *mut _), need, &mut need).is_err() {
            return Integrity::Unknown;
        }
        let label = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 {
            return Integrity::Unknown;
        }
        let rid = *GetSidSubAuthority(sid, (count - 1) as u32);
        classify_rid(rid)
    }
}

/// RID de integridad obligatoria → nivel (pura en la práctica, se deja aquí junto a las constantes).
pub fn classify_rid(rid: u32) -> Integrity {
    if rid >= SECURITY_MANDATORY_SYSTEM_RID {
        Integrity::System
    } else if rid >= SECURITY_MANDATORY_HIGH_RID {
        Integrity::High
    } else if rid >= SECURITY_MANDATORY_MEDIUM_RID {
        Integrity::Medium
    } else {
        Integrity::Low
    }
}

pub fn integrity(pid: u32) -> Integrity {
    let Some(h) = open_limited(pid) else { return Integrity::Unknown };
    let Some(t) = token_of(h.0) else { return Integrity::Unknown };
    integrity_of_token(&t)
}

/// ¿Corre ESTE proceso elevado (administrador)? Ante la duda, sí (falla cerrado).
pub fn self_elevated() -> bool {
    unsafe {
        let Some(t) = token_of(GetCurrentProcess()) else { return true };
        let mut el = TOKEN_ELEVATION::default();
        let mut need = 0u32;
        if GetTokenInformation(t.0, TokenElevation, Some(&mut el as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut need).is_err() {
            return true;
        }
        el.TokenIsElevated != 0 || !integrity_of_token(&t).controllable()
    }
}

/// AUMID del proceso (apps empaquetadas/UWP); None si no es una app empaquetada.
pub fn aumid(pid: u32) -> Option<String> {
    let h = open_limited(pid)?;
    unsafe {
        let mut len = 0u32;
        let _ = GetApplicationUserModelId(h.0, &mut len, None);
        if len == 0 || len > 1024 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        if GetApplicationUserModelId(h.0, &mut len, Some(PWSTR(buf.as_mut_ptr()))) != ERROR_SUCCESS {
            return None;
        }
        let s = from_wide(&buf);
        (!s.is_empty()).then_some(s)
    }
}

/// Editor (sujeto del certificado) de una firma Authenticode VÁLIDA e incrustada. None si no hay firma, no es válida
/// o no se puede leer. Sin red: sin comprobación de revocación y solo con la caché local. Los archivos firmados solo por
/// catálogo (muchos del sistema) salen como «(sin firma)»: no es una frontera de seguridad, sirve para que un ejecutable
/// del mismo nombre y ruta pero de otro editor no herede una concesión.
pub fn publisher(path: &str) -> Option<String> {
    let wpath = wide(path);
    unsafe {
        let mut file = WINTRUST_FILE_INFO {
            cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: PCWSTR(wpath.as_ptr()),
            ..Default::default()
        };
        let mut data = WINTRUST_DATA {
            cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
            dwStateAction: WTD_STATEACTION_VERIFY,
            dwProvFlags: WTD_REVOCATION_CHECK_NONE | WTD_CACHE_ONLY_URL_RETRIEVAL,
            ..Default::default()
        };
        // WINTRUST_ACTION_GENERIC_VERIFY_V2 = {00AAC56B-CD44-11d0-8CC2-00C04FC295EE}
        let mut action = windows::core::GUID::from_u128(0x00AAC56B_CD44_11D0_8CC2_00C04FC295EE);
        let status = WinVerifyTrust(HWND::default(), &mut action, &mut data as *mut _ as *mut _);
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        let _ = WinVerifyTrust(HWND::default(), &mut action, &mut data as *mut _ as *mut _);
        if status != 0 {
            return None;
        }
        signer_subject(&wpath)
    }
}

unsafe fn signer_subject(wpath: &[u16]) -> Option<String> {
    let mut store = HCERTSTORE::default();
    let mut msg: *mut core::ffi::c_void = std::ptr::null_mut();
    CryptQueryObject(
        CERT_QUERY_OBJECT_FILE,
        wpath.as_ptr() as *const _,
        CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
        CERT_QUERY_FORMAT_FLAG_BINARY,
        0,
        None,
        None,
        None,
        Some(&mut store),
        Some(&mut msg),
        None,
    )
    .ok()?;
    let mut result = None;
    let mut size = 0u32;
    if CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, None, &mut size).is_ok() && size > 0 && size < 65536 {
        let mut buf = vec![0u8; size as usize];
        if CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, Some(buf.as_mut_ptr() as *mut _), &mut size).is_ok() {
            // CMSG_SIGNER_INFO empieza por {dwVersion, Issuer, SerialNumber…}: CertFindCertificateInStore con
            // CERT_FIND_SUBJECT_CERT espera un CERT_INFO con Issuer y SerialNumber.
            let signer = &*(buf.as_ptr() as *const windows::Win32::Security::Cryptography::CMSG_SIGNER_INFO);
            let info = CERT_INFO { Issuer: signer.Issuer, SerialNumber: signer.SerialNumber, ..Default::default() };
            let ctx = CertFindCertificateInStore(
                store,
                X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
                0,
                CERT_FIND_SUBJECT_CERT,
                Some(&info as *const _ as *const _),
                None,
            );
            if !ctx.is_null() {
                let mut name = vec![0u16; 256];
                let n = CertGetNameStringW(ctx, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut name));
                if n > 1 {
                    result = Some(from_wide(&name));
                }
                let _ = CertFreeCertificateContext(Some(ctx));
            }
        }
    }
    let _ = CryptMsgClose(Some(msg));
    result.filter(|s| !s.is_empty())
}
