# -*- coding: utf-8 -*-
import json
import os
import subprocess
import sys
import tempfile
import unittest

SK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = os.path.join(SK, "scripts")
PY = os.environ.get("LAZUNOX_PYTHON") or sys.executable
SOFFICE = os.path.exists("/Applications/LibreOffice.app/Contents/MacOS/soffice")


def run(script, *args):
    return subprocess.run([PY, os.path.join(SC, script)] + list(args), capture_output=True, text=True)


class PptxTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (1200, 800), (40, 90, 140))
        ImageDraw.Draw(im).ellipse([300, 150, 900, 650], fill=(230, 180, 60))
        im.save(os.path.join(self.d, "foto.png"))
        long_bul = ["Punto número %d con una frase razonablemente larga para forzar el reparto en varias diapositivas" % i for i in range(20)]
        self.spec = {"theme": "sobrio", "title": "Prueba", "author": "Ana", "footer": "Informe", "slides": [
            {"type": "cover", "title": "Resultados anuales", "subtitle": "Resumen", "author": "Ana", "date": "27 de septiembre de 2026", "notes": "Saludar"},
            {"type": "bullets", "title": "Puntos clave", "bullets": ["Uno", {"text": "Dos", "sub": ["2a", "2b"]}, "Tres"], "notes": "Nota"},
            {"type": "bullets", "title": "Lista larga", "bullets": long_bul},
            {"type": "two_col", "title": "Comparación", "left": {"heading": "Antes", "bullets": ["a", "b"]}, "right": {"heading": "Después", "bullets": ["c", "d"]}},
            {"type": "image_text", "title": "Imagen", "image": "foto.png", "bullets": ["Texto al lado", "Otro"], "caption": "Figura 1"},
            {"type": "table", "title": "Tabla", "columns": ["Región", "Ventas"], "rows": [["Norte", "1.234,5"], ["Sur", "987,0"]]},
            {"type": "chart", "title": "Barras", "chart_type": "bar", "categories": ["T1", "T2", "T3"], "series": [{"name": "Ventas", "values": [10, 20, 15]}]},
            {"type": "chart", "title": "Líneas", "chart_type": "line", "categories": ["T1", "T2", "T3"], "series": [{"name": "A", "values": [1, 2, 3]}, {"name": "B", "values": [3, 2, 1]}]},
            {"type": "chart", "title": "Torta", "chart_type": "pie", "categories": ["X", "Y"], "series": [{"name": "Cuota", "values": [60, 40]}]},
            {"type": "quote", "text": "La calidad es hacer bien las cosas", "author": "Autor"},
            {"type": "stat", "title": "Crecimiento", "value": "+34 %", "label": "Ingresos", "text": "Frente al año anterior"},
            {"type": "closing", "title": "Gracias", "subtitle": "ana@ejemplo.cl"}]}
        self.sp = os.path.join(self.d, "spec.json")
        with open(self.sp, "w", encoding="utf-8") as f:
            json.dump(self.spec, f)


    def build(self, theme):
        out = os.path.join(self.d, "d-%s.pptx" % theme)
        r = run("build_pptx.py", self.sp, out, "--theme", theme)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return out

    def test_flujo_completo(self):
        for th in ("oscuro", "claro"):
            self.build(th)
        out = self.build("sobrio")
        from pptx import Presentation
        n = len(Presentation(out).slides)
        self.assertGreater(n, 12)   # la lista larga se divide
        r = run("inspect_pptx.py", out)
        self.assertEqual(r.returncode, 0)
        self.assertIn("Resultados anuales", r.stdout)
        self.assertIn("gráfico", r.stdout)
        j = json.loads(run("inspect_pptx.py", out, "--json").stdout)
        self.assertEqual(len(j["diapositivas"]), n)
        # edición
        v2 = os.path.join(self.d, "d-v2.pptx")
        r = run("edit_pptx.py", out, v2, "replace", "--find", "Puntos clave", "--replace", "Ideas centrales")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(run("edit_pptx.py", out, v2, "notes", "--slide", "2", "--text", "x").returncode, 1)  # no sobrescribe
        v3 = os.path.join(self.d, "d-v3.pptx")
        ops = os.path.join(self.d, "ops.json")
        with open(ops, "w") as fo:
            json.dump([{"op": "duplicate", "slide": 2}, {"op": "move", "slide": 3, "to": 1}, {"op": "delete", "slide": 4},
                   {"op": "add-slide", "layout": "Title and Content", "title": "Nueva", "bullets": "a|b", "at": 2},
                   {"op": "add-image", "slide": 5, "image": "foto.png", "width": 3}, {"op": "notes", "slide": 1, "text": "Notas nuevas"}], fo)
        r = run("edit_pptx.py", v2, v3, "batch", "--ops", ops)
        self.assertEqual(r.returncode, 0, r.stdout)
        j2 = json.loads(run("inspect_pptx.py", v3, "--json").stdout)
        self.assertEqual(len(j2["diapositivas"]), n + 1)
        titulos = [d["titulo"] for d in j2["diapositivas"]]
        self.assertIn("Nueva", titulos)
        self.assertEqual(j2["diapositivas"][0]["notas"], "Notas nuevas")
        import zipfile
        names = zipfile.ZipFile(v3).namelist()
        self.assertEqual(len(names), len(set(names)))
        j0 = json.loads(run("inspect_pptx.py", out, "--json").stdout)
        self.assertIn("Puntos clave", [d["titulo"] for d in j0["diapositivas"]])  # original intacto
        j1 = json.loads(run("inspect_pptx.py", v2, "--json").stdout)
        self.assertIn("Ideas centrales", [d["titulo"] for d in j1["diapositivas"]])
        # verificación
        r = run("check_pptx.py", out, "--no-render")
        self.assertEqual(r.returncode, 0, r.stdout)
        r = run("check_pptx.py", v3, "--no-render")
        self.assertEqual(r.returncode, 0, r.stdout)
        if SOFFICE:
            od = os.path.join(self.d, "chk")
            r = run("check_pptx.py", out, "--outdir", od)
            self.assertEqual(r.returncode, 0, r.stdout)
            hoja = os.path.join(od, "miniaturas.png")
            if os.path.exists(os.path.join(SK, "..", "_shared", "render.py")):
                self.assertTrue(os.path.exists(hoja), r.stdout)

    def test_errores(self):
        self.assertEqual(run("build_pptx.py", os.path.join(self.d, "no.json"), os.path.join(self.d, "x.pptx")).returncode, 1)
        bad = os.path.join(self.d, "bad.json")
        with open(bad, "w") as fo:
            json.dump({"slides": [{"type": "volcan"}]}, fo)
        self.assertEqual(run("build_pptx.py", bad, os.path.join(self.d, "y.pptx")).returncode, 1)

    def test_detecta_desborde(self):
        from pptx import Presentation
        from pptx.util import Inches, Pt
        prs = Presentation()
        s = prs.slides.add_slide(prs.slide_layouts[6])
        tb = s.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(0.5))
        tb.text_frame.word_wrap = True
        tb.text_frame.text = "texto larguísimo " * 30
        tb.text_frame.paragraphs[0].runs[0].font.size = Pt(24)
        f = os.path.join(self.d, "malo.pptx")
        prs.save(f)
        r = run("check_pptx.py", f, "--no-render")
        self.assertEqual(r.returncode, 1)
        self.assertIn("desborda", r.stdout)


if __name__ == "__main__":
    unittest.main()
