//! Capturas: GDI (`BitBlt` del monitor principal, que ya incluye lo compuesto por DWM y respeta
//! `WDA_EXCLUDEFROMCAPTURE`, como el overlay de Lazunox) y `PrintWindow` para una ventana. Codificación con WIC
//! (JPEG/PNG) en el propio helper. Todo se escribe SOLO en la ruta ya validada por `paths`.

use super::util::wide;
use crate::exitcode::{CuError, CuResult};
use crate::mask::Rect;
use crate::paths::ImageFormat;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{GENERIC_WRITE, HWND};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HDC, HGDIOBJ, SRCCOPY,
};
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Com::StructuredStorage::{PROPBAG2};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Variant::VT_R4;

/// Imagen BGRA de arriba abajo, con alfa 255.
pub struct Bgra {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

fn cap_err(what: &str) -> CuError {
    CuError::unavailable(format!("No se pudo capturar la pantalla ({what})"))
}

struct Dib {
    dc: HDC,
    bmp: windows::Win32::Graphics::Gdi::HBITMAP,
    old: HGDIOBJ,
    bits: *mut core::ffi::c_void,
    w: i32,
    h: i32,
}

impl Dib {
    fn new(w: i32, h: i32) -> CuResult<Dib> {
        if w <= 0 || h <= 0 || (w as i64) * (h as i64) > 64 * 1024 * 1024 {
            return Err(cap_err("tamaño no válido"));
        }
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return Err(cap_err("CreateCompatibleDC"));
            }
            let bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bmp = match CreateDIBSection(Some(dc), &bi, DIB_RGB_COLORS, &mut bits, None, 0) {
                Ok(b) if !bits.is_null() => b,
                _ => {
                    let _ = DeleteDC(dc);
                    return Err(cap_err("CreateDIBSection"));
                }
            };
            let old = SelectObject(dc, HGDIOBJ(bmp.0));
            Ok(Dib { dc, bmp, old, bits, w, h })
        }
    }

    fn into_bgra(self) -> Bgra {
        unsafe {
            let _ = GdiFlush();
            let n = self.w as usize * self.h as usize * 4;
            let mut px = std::slice::from_raw_parts(self.bits as *const u8, n).to_vec();
            for p in px.chunks_exact_mut(4) {
                p[3] = 255;
            }
            Bgra { w: self.w as usize, h: self.h as usize, px }
        }
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(HGDIOBJ(self.bmp.0));
            let _ = DeleteDC(self.dc);
        }
    }
}

/// Captura un rectángulo del escritorio (píxeles físicos).
pub fn grab_rect(r: Rect) -> CuResult<Bgra> {
    let d = Dib::new(r.w, r.h)?;
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err(cap_err("GetDC"));
        }
        let res = BitBlt(d.dc, 0, 0, r.w, r.h, Some(screen), r.x, r.y, SRCCOPY | CAPTUREBLT);
        ReleaseDC(None, screen);
        res.map_err(|_| cap_err("BitBlt"))?;
    }
    Ok(d.into_bgra())
}

/// Captura una ventana con `PrintWindow(PW_RENDERFULLCONTENT)`.
pub fn grab_window(hwnd: HWND, r: Rect) -> CuResult<Bgra> {
    let d = Dib::new(r.w, r.h)?;
    unsafe {
        if !PrintWindow(hwnd, d.dc, PRINT_WINDOW_FLAGS(2)).as_bool() {
            return Err(CuError::unavailable("No se pudo capturar la ventana (PrintWindow)"));
        }
    }
    Ok(d.into_bgra())
}

fn wic<T>(r: windows::core::Result<T>, what: &str) -> CuResult<T> {
    r.map_err(|e| CuError::generic(format!("Codificación de imagen ({what}): {e}")))
}

/// Escala a `target` y guarda en `path` (JPEG con `quality` 1..100, o PNG).
pub fn encode(img: &Bgra, path: &str, fmt: ImageFormat, target: (u32, u32), quality: i64) -> CuResult<()> {
    unsafe {
        let factory: IWICImagingFactory = wic(CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER), "fábrica")?;
        let bitmap = wic(
            factory.CreateBitmapFromMemory(img.w as u32, img.h as u32, &GUID_WICPixelFormat32bppBGRA, (img.w * 4) as u32, &img.px),
            "mapa de bits",
        )?;
        let scaler = wic(factory.CreateBitmapScaler(), "escalador")?;
        wic(scaler.Initialize(&bitmap, target.0, target.1, WICBitmapInterpolationModeHighQualityCubic), "escalar")?;
        let conv = wic(factory.CreateFormatConverter(), "conversor")?;
        let pixel_format = if fmt == ImageFormat::Jpeg { GUID_WICPixelFormat24bppBGR } else { GUID_WICPixelFormat32bppBGRA };
        wic(conv.Initialize(&scaler, &pixel_format, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom), "convertir")?;
        let container = if fmt == ImageFormat::Jpeg { GUID_ContainerFormatJpeg } else { GUID_ContainerFormatPng };
        let encoder = wic(factory.CreateEncoder(&container, std::ptr::null()), "codificador")?;
        let stream = wic(factory.CreateStream(), "flujo")?;
        let wpath = wide(path);
        wic(stream.InitializeFromFilename(PCWSTR(wpath.as_ptr()), GENERIC_WRITE.0), "abrir el archivo")?;
        wic(encoder.Initialize(&stream, WICBitmapEncoderNoCache), "inicializar")?;
        let mut frame: Option<IWICBitmapFrameEncode> = None;
        let mut props: Option<windows::Win32::System::Com::StructuredStorage::IPropertyBag2> = None;
        wic(encoder.CreateNewFrame(&mut frame, &mut props), "marco")?;
        let frame = frame.ok_or_else(|| CuError::generic("Codificación de imagen: sin marco"))?;
        if fmt == ImageFormat::Jpeg {
            if let Some(p) = &props {
                let mut name = wide("ImageQuality");
                let bag = PROPBAG2 { dwType: 1, vt: VT_R4, pstrName: PWSTR(name.as_mut_ptr()), ..Default::default() };
                let v = windows::Win32::System::Variant::VARIANT::from(quality.clamp(1, 100) as f32 / 100.0);
                let _ = p.Write(1, &bag, &v);
            }
        }
        wic(frame.Initialize(props.as_ref()), "inicializar el marco")?;
        wic(frame.SetSize(target.0, target.1), "tamaño")?;
        let mut pf = pixel_format;
        wic(frame.SetPixelFormat(&mut pf), "formato")?;
        wic(frame.WriteSource(&conv, std::ptr::null()), "escribir")?;
        wic(frame.Commit(), "confirmar el marco")?;
        wic(encoder.Commit(), "confirmar")?;
    }
    Ok(())
}
