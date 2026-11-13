"""Regresiones de presentación y pérdida de estructura; sin Word ni modelos."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from build_docx import build
from check_docx import structural, sparse_pages
from _report_layout import prepare, column_widths
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def examples():
    table = {"type": "table", "columns": ["Acción y resultado esperado", "Mes", "Monto CLP"],
             "rows": [["Renovar el equipamiento de atención", "Enero", 120000], ["Capacitar al equipo de soporte", "Febrero", 80000], ["Total", "Semestre", 200000]], "total_row": True}
    short = {"title": "Informe de continuidad operativa", "subtitle": "Evaluación semestral 2026", "author": "Equipo de operaciones", "date": "12 de noviembre de 2026",
             "cover": True, "toc": True, "footer": "Cifras ficticias para pruebas",
             "blocks": [{"type": "heading", "level": 1, "text": "Resumen ejecutivo"},
                        {"type": "paragraph", "text": "Se recomienda renovar el equipamiento y capacitar al equipo. El presupuesto de ejemplo cubre ambas acciones. La prioridad es mantener la atención durante el cambio y comprobar cada entrega antes de cerrar el semestre."},
                        {"type": "heading", "level": 3, "text": "9.2 Medidas acordadas"}, table,
                        {"type": "heading", "level": 1, "text": "8) Recomendación"},
                        {"type": "paragraph", "text": "Aprobar las acciones y revisar mensualmente los resultados con la jefatura de operaciones. Todos los datos de este documento son ficticios y se usan solo para verificar la plantilla."}]}
    long = copy.deepcopy(short)
    long["title"] = "Informe ampliado de continuidad operativa"
    long["cover"] = False
    long["blocks"] = []
    text = ("La revisión mensual permite detectar interrupciones, asignar responsables y comprobar los resultados. "
            "El equipo registra cada incidencia y contrasta la respuesta con el plazo acordado. "
            "Los datos son ficticios y describen un procedimiento de ejemplo para evaluar la presentación del informe profesional. ")
    for i, title in enumerate(["Resumen ejecutivo", "Diagnóstico", "Plan de trabajo", "Recursos", "Seguimiento", "Recomendación"]):
        long["blocks"].append({"type": "heading", "level": 1, "text": title})
        if i == 3:
            long["blocks"].append(copy.deepcopy(table))
        for p in range(3):
            long["blocks"].append({"type": "paragraph", "text": text * (3 if p == 0 else 2)})
    return short, long


class Report(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "informe.docx"

    def test_short_and_long_structure(self):
        for spec in examples():
            with self.subTest(title=spec["title"]):
                build(spec, str(self.out), self.temp.name)
                d = Document(self.out)
                errors, _, info = structural(str(self.out), spec)
                self.assertEqual(errors, [])
                self.assertEqual(info["tablas"], 1)
                self.assertEqual(len(d.tables[0].rows), 4)
                self.assertEqual(d.styles["Normal"].font.name, "Arial")
                self.assertEqual(d.styles["Normal"].font.size.pt, 11)
                self.assertAlmostEqual(d.sections[0].left_margin.cm, 2.5, places=2)
                self.assertTrue(d.sections[0].footer._element.xpath(".//w:instrText[contains(text(),'PAGE')]"))
                headings = [p.text for p in d.paragraphs if p.style.name.startswith("Heading")]
                self.assertEqual(headings[0], "1 Resumen ejecutivo")
                self.assertTrue(d.tables[0].rows[0]._tr.xpath("./w:trPr/w:tblHeader"))
                self.assertTrue(d.tables[0].cell(0, 0)._tc.xpath(".//w:shd[@w:fill='1F3864']"))
                widths = [c.width.cm for c in d.tables[0].columns]
                self.assertGreater(widths[0], widths[1])
                self.assertAlmostEqual(sum(widths), 16.59, places=1)
                toc = d.element.body.xpath(".//w:instrText[contains(text(),'TOC')]")
                self.assertEqual(bool(toc), spec is not None and spec["title"].startswith("Informe ampliado"))
        short, _ = examples()
        self.assertTrue(prepare(short)["cover"])
        self.assertEqual(prepare(short)["blocks"][2]["text"], "1.1 Medidas acordadas")

    def test_missing_table_and_missing_rows_fail_cli(self):
        spec = examples()[0]
        build(spec, str(self.out), self.temp.name)
        d = Document(self.out)
        d.tables[0]._element.getparent().remove(d.tables[0]._element)
        d.save(self.out)
        content = Path(self.temp.name) / "contenido.json"
        content.write_text(json.dumps(spec), encoding="utf-8")
        cp = subprocess.run([sys.executable, str(SCRIPTS / "check_docx.py"), str(self.out), "--no-render", "--spec", str(content)], capture_output=True, text=True, timeout=30)
        self.assertEqual(cp.returncode, 1)
        self.assertIn("restaure las tablas", cp.stdout)
        build(spec, str(self.out), self.temp.name)
        d = Document(self.out)
        d.tables[0]._tbl.remove(d.tables[0].rows[-1]._tr)
        d.save(self.out)
        self.assertTrue(any("filas perdidas" in e for e in structural(str(self.out), spec)[0]))
        build(spec, str(self.out), self.temp.name)
        d = Document(self.out)
        d.tables[0].cell(0, 0).text = "Tabla de otro contenido"
        d.save(self.out)
        self.assertTrue(any("encabezados no coinciden" in e for e in structural(str(self.out), spec)[0]))

    def test_empty_heading_empty_table_missing_page_fail(self):
        d = Document()
        d.add_heading(" ", 1)
        d.add_table(rows=1, cols=2)
        d.save(self.out)
        errors = structural(str(self.out))[0]
        for message in ("título vacío", "sin filas de datos", "campo PAGE"):
            self.assertTrue(any(message in e for e in errors), errors)

    def test_numpages_is_not_page_and_simple_page_is_valid(self):
        d = Document()
        d.add_paragraph("Texto")
        f = OxmlElement("w:fldSimple")
        f.set(qn("w:instr"), "NUMPAGES")
        d.sections[0].footer.paragraphs[0]._p.append(f)
        d.save(self.out)
        self.assertTrue(any("campo PAGE" in e for e in structural(str(self.out))[0]))
        f.set(qn("w:instr"), "PAGE \\* MERGEFORMAT")
        d.save(self.out)
        self.assertFalse(any("campo PAGE" in e for e in structural(str(self.out))[0]))

    def test_avoidable_pages_and_short_final_page(self):
        build(examples()[0], str(self.out), self.temp.name)
        d = Document(self.out)
        d.add_page_break()
        d.save(self.out)
        self.assertTrue(any("final vacía" in e for e in structural(str(self.out))[0]))
        d.add_paragraph("Una conclusión breve es válida.")
        d.save(self.out)
        self.assertFalse(any("final vacía" in e for e in structural(str(self.out))[0]))
        d = Document()
        d.add_paragraph("Título")
        d.add_page_break()
        d.add_paragraph("Cuerpo")
        d.save(self.out)
        self.assertTrue(any("casi vacía" in e for e in structural(str(self.out))[0]))

    def test_raster_blank_and_sparse_ignore_footer(self):
        from PIL import Image, ImageDraw
        paths = []
        for name, y in [("sparse", 140), ("blank", None), ("last", 140)]:
            im = Image.new("RGB", (600, 800), "white")
            draw = ImageDraw.Draw(im)
            draw.rectangle((100, 750, 200, 760), fill="black")
            if y:
                draw.rectangle((100, y, 400, y + 12), fill="black")
            path = Path(self.temp.name) / (name + ".png")
            im.save(path)
            paths.append(str(path))
        self.assertEqual(sparse_pages(paths), ([2], [1]))

    def test_invalid_content_is_not_silently_lost(self):
        for block in [{"type": "heading", "text": " "}, {"type": "table", "columns": ["A"], "rows": []}, {"type": "table", "columns": ["A", "B"], "rows": [[1]]}]:
            with self.assertRaises(ValueError):
                build({"blocks": [block]}, str(self.out), self.temp.name)
            self.assertFalse(self.out.exists())

    def test_long_cover_and_bounded_widths(self):
        for requested in ([], [3], [30, 10, 5]):
            widths = column_widths(["Acción", "Monto"], [["Revisión", 100]], requested)
            self.assertEqual(len(widths), 2)
            self.assertAlmostEqual(sum(widths), 16.59)
        _, spec = examples()
        spec["cover"] = True
        spec["blocks"][-1]["text"] += " más contenido"
        self.assertTrue(prepare(spec)["cover"])
        spec["blocks"].append({"type": "table", "columns": ["A", "B"], "rows": [[1, 2]], "widths_cm": [30, 10]})
        build(spec, str(self.out), self.temp.name)
        widths = [c.width.cm for c in Document(self.out).tables[-1].columns]
        self.assertAlmostEqual(sum(widths), 16.59, places=1)
        self.assertAlmostEqual(widths[0] / widths[1], 3, places=1)

    def test_cover_explicit_and_automatic(self):
        for words in (0, 1199, 1200, 2000):
            for cover in (True, False, None):
                with self.subTest(words=words, cover=cover):
                    spec = {"title": "Informe", "blocks": [{"type": "paragraph", "text": "palabra " * words}]}
                    if cover is not None:
                        spec["cover"] = cover
                    self.assertEqual(prepare(spec)["cover"], cover if cover is not None else words >= 1200)
        self.assertFalse(prepare({"cover": True, "blocks": []})["cover"])

    def test_short_explicit_cover_has_page_break(self):
        spec = {"title": "Informe breve", "cover": True, "blocks": [{"type": "paragraph", "text": "Contenido breve."}]}
        build(spec, str(self.out), self.temp.name)
        d = Document(self.out)
        self.assertTrue(d.element.body.xpath(".//w:br[@w:type='page']"))
        self.assertIn("Contenido breve.", [p.text for p in d.paragraphs])
        self.assertEqual(structural(str(self.out), spec)[0], [])
        self.assertTrue(any("casi vacía" in error for error in structural(str(self.out), {**spec, "cover": False})[0]))


if __name__ == "__main__":
    unittest.main()
