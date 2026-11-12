"""Pruebas de verificar_office.py (unittest). Ejecutar: python -m unittest tests/test_verificar_office.py"""
import os
from contextlib import ExitStack, redirect_stdout
from io import StringIO
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(AQUI), "verificar_office.py")
sys.path.insert(0, os.path.dirname(AQUI))
import verificar_office


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
        self.assertIn("valor guardado distinto o ausente", out)
        self.assertIn("Sheet!B3", out)

    def test_xlsx_media_suelta_no_es_total(self):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["Prioridad", "Casos"])
        ws.append(["Alta", 5])
        ws.append(["Media", 12])
        ws.append(["Baja", 3])
        wb.save(self.p("prioridades.xlsx"))
        rc, out = correr(self.p("prioridades.xlsx"))
        self.assertEqual(rc, 0, out)

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

    def test_pptx_copia_y_en_sitio_sin_borrar_ni_renombrar(self):
        from pptx import Presentation
        from pptx.util import Inches, Pt
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, 'nuevo.pptx')
            copy = os.path.join(folder, 'copia.pptx')
            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            title = slide.shapes.add_textbox(Inches(1), Inches(0.5), Inches(6), Inches(1))
            title.text = 'Mi título'
            title.text_frame.paragraphs[0].runs[0].font.size = Pt(40)
            prs.save(source)
            with open(source, 'rb') as f:
                original = f.read()
            with ExitStack() as stack, redirect_stdout(StringIO()):
                guards = [stack.enter_context(patch.object(os, op, side_effect=PermissionError('denegado')))
                          for op in ('rename', 'replace', 'unlink', 'remove')]
                self.assertEqual(verificar_office.main([source, '--arreglar', copy]), 0)
                with open(source, 'rb') as f:
                    self.assertEqual(f.read(), original)
                self.assertEqual(verificar_office.main([source, '--en-sitio']), 0)
                for guard in guards:
                    guard.assert_not_called()
            for path in (source, copy):
                self.assertEqual(Presentation(path).slides[0].shapes.title.text, 'Mi título')
            self.assertEqual(set(os.listdir(folder)), {'nuevo.pptx', 'copia.pptx'})

    def test_pptx_no_crea_salida_si_falla_la_serializacion(self):
        from pptx import Presentation
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, 'original.pptx')
            copy = os.path.join(folder, 'copia.pptx')
            Presentation().save(source)
            with open(source, 'rb') as f:
                original = f.read()
            for in_place in (False, True):
                with patch('pptx.presentation.Presentation.save', side_effect=ValueError('fallo al serializar')):
                    with self.assertRaisesRegex(ValueError, 'fallo al serializar'):
                        verificar_office.arregla_pptx(source, source if in_place else copy, en_sitio=in_place)
                with open(source, 'rb') as f:
                    self.assertEqual(f.read(), original)
                self.assertEqual(os.listdir(folder), ['original.pptx'])


if __name__ == "__main__":
    unittest.main()


class PruebasAvisoWsl(unittest.TestCase):
    """En WSL (Tareas de Windows) ArtCraft puede estar instalado pero no ser usable: el aviso no manda a instalarlo."""

    def _aviso(self, wsl):
        env = dict(os.environ)
        env.pop("WSL_DISTRO_NAME", None)
        env.pop("WSL_INTEROP", None)
        if wsl:
            env["WSL_DISTRO_NAME"] = "Lazunox-Tareas"
        r = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, %r); import render; print(render.AVISO_SIN_ARTCRAFT)" % os.path.dirname(AQUI)],
                           capture_output=True, text=True, env=env, timeout=60)
        return r.stdout

    def test_wsl_no_manda_a_instalar(self):
        a = self._aviso(True)
        self.assertIn("entorno aislado de Windows", a)
        self.assertIn("verificar_office.py", a)
        self.assertNotIn("Componentes opcionales", a)

    def test_fuera_de_wsl_sigue_pidiendo_instalarlo(self):
        if os.path.exists("/proc/version") and "microsoft" in open("/proc/version").read().lower():
            self.skipTest("esta prueba corre dentro de WSL")
        self.assertIn("Componentes opcionales", self._aviso(False))
