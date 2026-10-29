"""Pruebas de build_chat_pdf.py (HTML del Chat → PDF) con un «Chromium» falso. Ejecutar: python -m unittest tests/test_chat_pdf.py"""
import os
import stat
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(AQUI, "..", "scripts")
sys.path.insert(0, SC)
import build_chat_pdf as b  # noqa: E402

FALSO = """#!/bin/sh
for a in "$@"; do
  case "$a" in
    --print-to-pdf=*) PDF="${a#--print-to-pdf=}";;
    file://*) SRC="${a#file://}";;
    --user-data-dir=*) PERFIL="${a#--user-data-dir=}";;
  esac
done
cp "$SRC" "$REGISTRO.html"
printf '%s\\n' "$@" > "$REGISTRO.args"
[ "$FALLA" = "1" ] && exit 5
[ "$SIN_PDF" = "1" ] && exit 0
printf '%%PDF-1.4 falso' > "$PDF"
"""


class TestChatPdf(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="chatpdf-")
        cls.nav = os.path.join(cls.d, "chromium-falso")
        with open(cls.nav, "w") as f:
            f.write(FALSO)
        os.chmod(cls.nav, 0o755)
        cls.reg = os.path.join(cls.d, "reg")

    def run_cli(self, html, salida, **env):
        h = os.path.join(self.d, "doc.html")
        with open(h, "w", encoding="utf-8") as f:
            f.write(html)
        e = {"PATH": "/usr/bin:/bin", "LAZUNOX_CHROMIUM": self.nav, "REGISTRO": self.reg}
        e.update(env)
        return subprocess.run([sys.executable, os.path.join(SC, "build_chat_pdf.py"), h, os.path.join(self.d, salida)], capture_output=True, text=True, env=e)

    def test_crea_el_pdf_con_csp_sin_red_y_perfil_temporal(self):
        r = self.run_cli("<html><head><title>x</title></head><body><h1>Hola</h1></body></html>", "ok.pdf")
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(self.d, "ok.pdf"), "rb") as f:
            self.assertEqual(f.read(4), b"%PDF")
        with open(self.reg + ".html", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("Content-Security-Policy", html)
        self.assertIn("default-src 'none'", html)
        self.assertLess(html.index("@page{size:A4}"), html.index("<h1>"))
        with open(self.reg + ".args") as f:
            args = f.read()
        self.assertIn("--host-resolver-rules=MAP * ~NOTFOUND", args)
        self.assertIn("--headless=new", args)
        self.assertNotIn("--no-sandbox", args)
        self.assertIn("lazunox-chatpdf-", args)  # perfil en una carpeta temporal propia

    def test_no_sobrescribe_ni_toca_el_existente(self):
        with open(os.path.join(self.d, "viejo.pdf"), "w") as f:
            f.write("DEL USUARIO")
        r = self.run_cli("<p>x</p>", "viejo.pdf")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no se sobrescribe", r.stderr)
        with open(os.path.join(self.d, "viejo.pdf")) as f:
            self.assertEqual(f.read(), "DEL USUARIO")

    def test_errores_de_contenido_y_del_navegador(self):
        self.assertEqual(self.run_cli("   ", "v.pdf").returncode, 1)
        r = self.run_cli("<p>x</p>", "falla.pdf", FALLA="1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no generó el PDF", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.d, "falla.pdf")))
        self.assertEqual(self.run_cli("<p>x</p>", "sinpdf.pdf", SIN_PDF="1").returncode, 1)
        grande = self.run_cli("<p>" + "x" * (b.MAX_HTML_BYTES + 10) + "</p>", "g.pdf")
        self.assertEqual(grande.returncode, 1)
        self.assertIn("5 MB", grande.stderr)

    def test_uso_y_sin_navegador(self):
        p = subprocess.run([sys.executable, os.path.join(SC, "build_chat_pdf.py"), "a.html", "b.txt"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        # sin ningún Chromium: código 3 (la skill sigue con build_pdf.py)
        codigo = ("import sys, shutil; sys.path.insert(0, %r); import build_chat_pdf as b; b.CANDIDATOS = {}; shutil.which = lambda n: None; "
                  "sys.exit(b.main(['x', %r, %r]))" % (SC, os.path.join(self.d, "doc.html"), os.path.join(self.d, "tres.pdf")))
        r = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("build_pdf.py", r.stderr)

    def test_preparar_en_fragmento_documento_y_doctype(self):
        self.assertTrue(b.preparar("<p>hola</p>").startswith('<!doctype html><html lang="es"><head><meta http-equiv="Content-Security-Policy"'))
        doc = b.preparar("<!DOCTYPE html><html><head><style>@page{size:A5}</style></head><body>x</body></html>")
        self.assertTrue(doc.lower().startswith("<!doctype html><meta http-equiv"))
        # la base A4 va ANTES del CSS del documento, que la pisa (preferCSSPageSize del Chat)
        self.assertLess(doc.index("size:A4"), doc.index("size:A5"))
        self.assertNotIn("<head><meta", b.preparar("<html><body>x</body></html>"))  # sin <head>: no se inventa uno roto


if __name__ == "__main__":
    unittest.main()
