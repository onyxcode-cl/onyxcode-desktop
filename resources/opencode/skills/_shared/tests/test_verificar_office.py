"""Pruebas de verificar_office.py (unittest). Ejecutar: python -m unittest tests/test_verificar_office.py"""
import os
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(AQUI), "verificar_office.py")


def correr(*args):
    r = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout


class PruebasVerificar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = cls.tmp.name

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def p(self, n):
        return os.path.join(self.d, n)

    def test_docx_malo_y_bueno(self):
        from docx import Document
        malo = Document()
        malo.add_paragraph("Informe de ventas")          # Normal, no Title
        malo.add_paragraph("• primera")
        malo.add_paragraph("• segunda")
        t = malo.add_table(rows=2, cols=2)
        t.cell(0, 0).text = "Región"
        t.cell(0, 1).text = "Monto"
        t.cell(1, 0).text = "Norte"
        malo.save(self.p("malo.docx"))
        rc, out = correr(self.p("malo.docx"))
        self.assertEqual(rc, 1)
        self.assertIn("no Title/Heading", out)
        self.assertIn("escritos a mano", out)
        self.assertIn("Celdas vacías", out)
        bueno = Document()
        bueno.add_heading("Informe de ventas", 0)
        bueno.add_heading("Resumen", 1)
        bueno.add_paragraph("primera", style="List Bullet")
        t = bueno.add_table(rows=2, cols=2)
        for i, v in enumerate(["Región", "Monto", "Norte", "10"]):
            t.cell(i // 2, i % 2).text = v
        bueno.save(self.p("bueno.docx"))
        rc, out = correr(self.p("bueno.docx"))
        self.assertEqual(rc, 0, out)

    def test_xlsx_total_pegado_error_y_sin_valor(self):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["Región", "Monto"])
        ws.append(["Norte", 10])
        ws.append(["Sur", 5])
        ws.append(["Total", 15])      # pegado
        ws["D1"] = "#DIV/0!"
        wb.save(self.p("malo.xlsx"))
        rc, out = correr(self.p("malo.xlsx"))
        self.assertEqual(rc, 1)
        self.assertIn("número pegado", out)
        self.assertIn("con error", out)
        wb = Workbook()
        ws = wb.active
        ws.append(["Región", "Monto"])
        ws.append(["Norte", 10])
        ws.append(["Total", "=SUM(B2:B2)"])
        wb.save(self.p("sinvalor.xlsx"))
        rc, out = correr(self.p("sinvalor.xlsx"))
        self.assertEqual(rc, 1)
        self.assertIn("sin valor recalculado", out)

    def test_pptx_sin_titulo_arreglar_y_fuera_de_borde(self):
        from pptx import Presentation
        from pptx.util import Inches, Pt
        prs = Presentation()
        s = prs.slides.add_slide(prs.slide_layouts[6])  # Blank
        a = s.shapes.add_textbox(Inches(1), Inches(0.5), Inches(6), Inches(1))
        a.text_frame.text = "Mi título"
        a.text_frame.paragraphs[0].runs[0].font.size = Pt(40)
        b = s.shapes.add_textbox(Inches(1), Inches(4), Inches(6), Inches(1))
        b.text_frame.text = "cuerpo"
        b.text_frame.paragraphs[0].runs[0].font.size = Pt(18)
        c = s.shapes.add_textbox(Inches(9), Inches(1), Inches(3), Inches(1))  # sale del borde (ancho 10")
        c.text_frame.text = "afuera"
        prs.save(self.p("malo.pptx"))
        rc, out = correr(self.p("malo.pptx"))
        self.assertEqual(rc, 1)
        self.assertIn("sin marcador de título", out)
        self.assertIn("fuera de los bordes", out)
        rc, out = correr(self.p("malo.pptx"), "--arreglar", self.p("fix.pptx"))
        self.assertIn("1 marcador", out)
        prs2 = Presentation(self.p("fix.pptx"))
        self.assertEqual(prs2.slides[0].shapes.title.text_frame.text, "Mi título")
        rc, out = correr(self.p("malo.pptx"), "--arreglar", self.p("fix.pptx"))
        self.assertEqual(rc, 1)  # no sobrescribe

    def test_pptx_en_sitio(self):
        from pptx import Presentation
        from pptx.util import Inches, Pt
        prs = Presentation()
        s = prs.slides.add_slide(prs.slide_layouts[6])
        a = s.shapes.add_textbox(Inches(1), Inches(0.5), Inches(6), Inches(1))
        a.text_frame.text = "Solo yo"
        a.text_frame.paragraphs[0].runs[0].font.size = Pt(40)
        prs.save(self.p("sitio.pptx"))
        rc, out = correr(self.p("sitio.pptx"), "--en-sitio")
        self.assertEqual(rc, 0, out)
        self.assertEqual(Presentation(self.p("sitio.pptx")).slides[0].shapes.title.text_frame.text, "Solo yo")
        self.assertFalse([f for f in os.listdir(self.d) if f.endswith(".arreglando.pptx")])


if __name__ == "__main__":
    unittest.main()
