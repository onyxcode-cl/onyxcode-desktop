"""Prueba de humo de la skill docx: crear -> inspeccionar -> editar copia -> comentar -> verificar.

Ejecutar:  $LAZUNOX_PYTHON tests/test_docx.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")
PY = os.environ.get("LAZUNOX_PYTHON") or sys.executable
SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice"

from docx import Document  # noqa: E402


def run(script, *args, ok=(0,)):
    cp = subprocess.run([PY, os.path.join(SCRIPTS, script)] + [str(a) for a in args],
                        capture_output=True, text=True, cwd=TMP_CWD)
    assert cp.returncode in ok, "%s %s -> %d\n%s\n%s" % (script, args, cp.returncode, cp.stdout, cp.stderr)
    return cp


TMP_CWD = tempfile.mkdtemp(prefix="docxtest-")

CONTENT = {
    "title": "Informe de resultados 2025",
    "subtitle": "Ventas y proyecciones",
    "author": "Equipo Comercial",
    "date": "27 de septiembre de 2026",
    "header": "Confidencial",
    "footer": "Empresa Demo SpA",
    "toc": True,
    "blocks": [
        {"type": "heading", "level": 1, "text": "Resumen"},
        {"type": "paragraph", "text": "Las ventas crecieron un **12,5%** respecto de 2024, con un *fuerte* cierre en diciembre."},
        {"type": "heading", "level": 2, "text": "Hallazgos"},
        {"type": "bullets", "items": ["Primer hallazgo", "Segundo con **negrita**", ["Subpunto"]]},
        {"type": "numbered", "items": ["Paso uno", "Paso dos"]},
        {"type": "numbered", "items": ["Otra lista parte en uno"]},
        {"type": "heading", "level": 1, "text": "Cifras"},
        {"type": "table", "columns": ["Región", "Ventas 2025", "Variación"],
         "rows": [["Norte", 1234567, "5,0%"], ["Centro", 2345678.5, "12,5%"], ["Total", 3580245.5, "9,8%"]],
         "total_row": True, "caption": "Tabla 1. Ventas por región (CLP)"},
        {"type": "image", "path": "logo.png", "width_cm": 6, "caption": "Figura 1. Logotipo"},
        {"type": "page_break"},
        {"type": "heading", "level": 1, "text": "Conclusiones"},
        {"type": "paragraph", "text": "Valor estimado: 2025 será superado."},
    ],
}


class TestDocx(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PIL import Image
        Image.new("RGB", (400, 200), (31, 56, 100)).save(os.path.join(TMP_CWD, "logo.png"))
        with open(os.path.join(TMP_CWD, "c.json"), "w", encoding="utf-8") as f:
            json.dump(CONTENT, f, ensure_ascii=False)
        cls.out = os.path.join(TMP_CWD, "informe.docx")
        run("build_docx.py", os.path.join(TMP_CWD, "c.json"), cls.out)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP_CWD, ignore_errors=True)

    def test_01_estructura(self):
        d = Document(self.out)
        styles = {p.style.name for p in d.paragraphs}
        for s in ("Title", "Subtitle", "Heading 1", "Heading 2", "List Bullet", "List Number", "Caption"):
            self.assertIn(s, styles)
        self.assertEqual(len(d.tables), 1)
        self.assertEqual(len(d.inline_shapes), 1)
        t = d.tables[0]
        self.assertTrue(t.rows[0]._tr.xpath("./w:trPr/w:tblHeader"))
        self.assertEqual(t.rows[1].cells[1].text, "1.234.567")
        self.assertEqual(t.rows[2].cells[1].text, "2.345.678,50")
        self.assertEqual(t.rows[1].cells[1].paragraphs[0].alignment, 2)  # derecha
        self.assertAlmostEqual(d.sections[0].left_margin.cm, 2.5, places=1)
        self.assertIn("Página", "".join(p.text for p in d.sections[0].footer.paragraphs))
        # listas numeradas: la segunda lista reinicia
        nums = [p._p.pPr.numPr.numId.val for p in d.paragraphs
                if p.style.name == "List Number" and p._p.pPr.numPr is not None]
        self.assertEqual(len(set(nums)), 2)

    def test_02_inspect(self):
        cp = run("inspect_docx.py", self.out, "--json")
        data = json.loads(cp.stdout)
        self.assertEqual(data["resumen"]["tablas"], 1)
        self.assertEqual(data["resumen"]["imagenes"], 1)
        self.assertIn("Heading 1", data["resumen"]["estilos_usados"])
        txt = run("inspect_docx.py", self.out).stdout
        self.assertIn("TABLA 4x3", txt)

    def test_03_editar_y_comentar(self):
        v2 = os.path.join(TMP_CWD, "informe-v2.docx")
        # texto partido en varios runs: negrita en mitad
        cp = run("edit_docx.py", self.out, v2,
                 "--reemplazar", "12,5% respecto", "13,0% respecto",
                 "--reemplazar", "2025", "2026",
                 "--parrafo-despues", "Resumen", "Párrafo **nuevo** insertado",
                 "--borrar-parrafo", "Otra lista",
                 "--estilo", "Conclusiones", "Heading 2")
        d = Document(v2)
        textos = [p.text for p in d.paragraphs]
        self.assertTrue(any("13,0% respecto" in t for t in textos))
        self.assertFalse(any("2025" in t for t in textos))  # también en título
        self.assertFalse(any("Otra lista" in t for t in textos))
        self.assertIn("Párrafo nuevo insertado", textos)
        # el formato en negrita del tramo reemplazado se conserva
        p = [p for p in d.paragraphs if "13,0% respecto" in p.text][0]
        self.assertTrue(any(r.bold and "13,0%" in r.text for r in p.runs))
        # original intacto
        self.assertTrue(any("12,5%" in p.text for p in Document(self.out).paragraphs))
        # no sobrescribe
        run("edit_docx.py", self.out, v2, "--reemplazar", "a", "b", ok=(2,))
        # objetivo inexistente -> 1
        run("edit_docx.py", self.out, os.path.join(TMP_CWD, "x.docx"), "--reemplazar", "NOEXISTE", "x", ok=(1,))
        # tabla e imagen tras un párrafo
        with open(os.path.join(TMP_CWD, "t.json"), "w") as f:
            json.dump({"columns": ["A", "B"], "rows": [["x", 1], ["y", 2]]}, f)
        v3 = os.path.join(TMP_CWD, "informe-v3.docx")
        run("edit_docx.py", v2, v3, "--tabla-despues", "Párrafo nuevo", os.path.join(TMP_CWD, "t.json"),
            "--imagen-despues", "Conclusiones", os.path.join(TMP_CWD, "logo.png"), "4")
        d3 = Document(v3)
        self.assertEqual(len(d3.tables), 2)
        self.assertEqual(len(d3.inline_shapes), 2)
        # comentarios
        v4 = os.path.join(TMP_CWD, "informe-v4.docx")
        run("comments_docx.py", "añadir", v3, v4, "--texto-ancla", "fuerte", "--comentario", "Verificar cifra")
        out = run("comments_docx.py", "listar", v4).stdout
        self.assertIn("Verificar cifra", out)
        self.assertIn("Total: 1", out)
        run("comments_docx.py", "añadir", v3, os.path.join(TMP_CWD, "z.docx"),
            "--texto-ancla", "nada de esto", "--comentario", "x", ok=(1,))
        # check estructural
        cp = run("check_docx.py", v4, "--no-render")
        self.assertIn("RESULTADO: OK", cp.stdout)

    def test_04_check_con_render(self):
        cp = run("check_docx.py", self.out, "--outdir", os.path.join(TMP_CWD, "r"), ok=(0, 1))
        self.assertIn("Estructura:", cp.stdout)
        if os.path.exists(SOFFICE) and os.path.isfile(os.path.join(SCRIPTS, "..", "..", "_shared", "render.py")):
            self.assertIn("Render:", cp.stdout)

    def test_05_check_detecta_problemas(self):
        d = Document()
        d.add_paragraph("a")
        for _ in range(3):
            d.add_paragraph("")
        t = d.add_table(rows=2, cols=2)
        t.cell(0, 0).text = "x"
        bad = os.path.join(TMP_CWD, "malo.docx")
        d.save(bad)
        cp = run("check_docx.py", bad, "--no-render")
        self.assertIn("párrafos vacíos consecutivos", cp.stdout)
        self.assertIn("sin fila de encabezado", cp.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
