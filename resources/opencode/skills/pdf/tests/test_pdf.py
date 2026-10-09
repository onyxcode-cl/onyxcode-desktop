"""Pruebas de humo de la skill pdf. Ejecutar: python -m unittest tests/test_pdf.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(AQUI, "..", "scripts")


def run(script, *args, ok=(0,)):
    p = subprocess.run([sys.executable, os.path.join(SC, script)] + list(args), capture_output=True, text=True)
    assert p.returncode in ok, "%s %s -> %d\n%s\n%s" % (script, args, p.returncode, p.stdout, p.stderr)
    return p


class TestPdf(unittest.TestCase):
    def p(self, n):
        return os.path.join(self.d, n)

    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="pdftest-")
        contenido = {
            "titulo": "Informe de ventas", "subtitulo": "Tercer trimestre", "autor": "Equipo", "portada": True, "indice": True,
            "bloques": [
                {"tipo": "titulo", "nivel": 1, "texto": "Resumen"},
                {"tipo": "parrafo", "texto": "Las ventas crecieron **12,5%** respecto del año anterior. Ñandú."},
                {"tipo": "lista", "items": ["Primero", "Segundo"]},
                {"tipo": "tabla", "encabezado": ["Región", "Ventas", "Variación"],
                 "filas": [["Norte", "1.234.567", "12,5%"], ["Sur", "987.654", "-3,2%"], ["Centro", "2.345.678", "8,0%"]]},
                {"tipo": "salto"},
                {"tipo": "titulo", "nivel": 1, "texto": "Detalle"},
                {"tipo": "parrafo", "texto": "Segunda sección con más texto."},
            ]}
        with open(os.path.join(cls.d, "c.json"), "w", encoding="utf-8") as f:
            json.dump(contenido, f)

    def test_flujo_completo(self):
        p = self.p
        run("build_pdf.py", p("c.json"), "-o", p("informe.pdf"))
        # no sobrescribe
        run("build_pdf.py", p("c.json"), "-o", p("informe.pdf"), ok=(1,))
        from pypdf import PdfReader
        n = len(PdfReader(p("informe.pdf")).pages)
        self.assertGreaterEqual(n, 4)  # portada + índice + 2 secciones

        # extracción
        out = run("extract_pdf.py", p("informe.pdf"), "--formato", "json").stdout
        j = json.loads(out)
        self.assertFalse(j["escaneado"])
        todo = " ".join(pg["texto"] for pg in j["paginas"])
        self.assertIn("1.234.567", todo)
        self.assertIn("Ñandú", todo)
        run("extract_pdf.py", p("informe.pdf"), "--formato", "csv", "--outdir", p("csv"))
        self.assertTrue(any(f.endswith(".csv") for f in os.listdir(p("csv"))))

        # unir / dividir
        run("merge_split_pdf.py", "unir", p("informe.pdf"), p("informe.pdf"), "-o", p("doble.pdf"))
        self.assertEqual(len(PdfReader(p("doble.pdf")).pages), 2 * n)
        run("merge_split_pdf.py", "extraer", p("informe.pdf"), "--paginas", "1-2", "-o", p("parte.pdf"))
        self.assertEqual(len(PdfReader(p("parte.pdf")).pages), 2)
        run("merge_split_pdf.py", "rotar", p("informe.pdf"), "--paginas", "1", "--grados", "90", "-o", p("rot.pdf"))
        self.assertEqual(PdfReader(p("rot.pdf")).pages[0].rotation, 90)
        run("merge_split_pdf.py", "eliminar", p("informe.pdf"), "--paginas", "1", "-o", p("sin1.pdf"))
        self.assertEqual(len(PdfReader(p("sin1.pdf")).pages), n - 1)
        run("merge_split_pdf.py", "reordenar", p("parte.pdf"), "--orden", "2,1", "-o", p("ord.pdf"))

        # estampar
        run("stamp_pdf.py", p("informe.pdf"), "-o", p("sello.pdf"), "--marca", "BORRADOR", "--titulo", "Ventas T3", "--autor", "Ana")
        r = PdfReader(p("sello.pdf"))
        self.assertEqual(r.metadata.title, "Ventas T3")
        self.assertIn("BORRADOR", r.pages[1].extract_text())

        # verificar
        c = json.loads(run("check_pdf.py", p("informe.pdf"), "--json").stdout)
        self.assertEqual(c["paginas"], n)
        self.assertEqual(c["en_blanco"], [])
        run("check_pdf.py", p("informe.pdf"), "--render", "--outdir", p("png"))

    def test_formulario(self):
        from reportlab.pdfgen import canvas
        f = os.path.join(self.d, "form.pdf")
        c = canvas.Canvas(f)
        c.drawString(72, 760, "Nombre:")
        c.acroForm.textfield(name="nombre", x=130, y=750, width=200, height=20, borderStyle="inset")
        c.acroForm.textfield(name="rut", x=130, y=720, width=200, height=20)
        c.save()
        s = run("fill_form_pdf.py", "listar", f).stdout
        self.assertIn("nombre", s)
        run("fill_form_pdf.py", "rellenar", f, "--campo", "nombre=Ana Pérez", "--campo", "rut=12.345.678-5", "-o", os.path.join(self.d, "form-v2.pdf"))
        from pypdf import PdfReader
        v = PdfReader(os.path.join(self.d, "form-v2.pdf")).get_fields()
        self.assertEqual(v["nombre"]["/V"], "Ana Pérez")
        run("fill_form_pdf.py", "rellenar", f, "--campo", "nombre=Ana Pérez", "--aplanar", "-o", os.path.join(self.d, "form-plano.pdf"))
        self.assertIn("Ana", PdfReader(os.path.join(self.d, "form-plano.pdf")).pages[0].extract_text())
        run("fill_form_pdf.py", "rellenar", f, "--campo", "nada=1", "-o", os.path.join(self.d, "x.pdf"), ok=(1,))

    def test_sin_formulario_y_escaneado(self):
        from PIL import Image
        img = os.path.join(self.d, "e.png")
        Image.new("RGB", (400, 300), "white").save(img)
        md = os.path.join(self.d, "e.md")
        with open(md, "w", encoding="utf-8") as fh:
            fh.write("![solo imagen](e.png)\n")
        run("build_pdf.py", md, "-o", os.path.join(self.d, "e.pdf"))
        run("fill_form_pdf.py", "listar", os.path.join(self.d, "e.pdf"), ok=(2,))
        # PDF de imagen pura (sin texto): se debe avisar
        Image.new("RGB", (400, 300), "white").save(os.path.join(self.d, "esc.pdf"), "PDF")
        p = run("extract_pdf.py", os.path.join(self.d, "esc.pdf"), ok=(2,))
        self.assertIn("ESCANEADO", p.stderr)

    def test_markdown(self):
        md = os.path.join(self.d, "m.md")
        with open(md, "w", encoding="utf-8") as fh:
            fh.write("# Título\n\n## Sección\n\nTexto con *cursiva*.\n\n- a\n- b\n\n| A | B |\n|---|---|\n| x | 1.000 |\n")
        run("build_pdf.py", md, "-o", os.path.join(self.d, "m.pdf"), "--portada")
        t = run("extract_pdf.py", os.path.join(self.d, "m.pdf")).stdout
        self.assertIn("Sección", t)


if __name__ == "__main__":
    unittest.main()
