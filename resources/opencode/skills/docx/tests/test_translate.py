"""Pruebas de translate_docx.py (traducir un Word sin cambiar el formato). Ejecutar: python -m unittest tests/test_translate.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(AQUI, "..", "scripts")

try:
    import docx
    from docx.shared import RGBColor
except ImportError:  # pragma: no cover
    docx = None


def run(*args, ok=(0,)):
    p = subprocess.run([sys.executable, os.path.join(SC, "translate_docx.py")] + list(args), capture_output=True, text=True)
    assert p.returncode in ok, "%s -> %d\n%s\n%s" % (args, p.returncode, p.stdout, p.stderr)
    return p


@unittest.skipIf(docx is None, "python-docx no instalado")
class TestTraducirWord(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="trdocx-")
        cls.src = os.path.join(cls.d, "src.docx")
        d = docx.Document()
        d.add_heading("Informe", 1)
        p = d.add_paragraph("El ")
        p.add_run("siniestro").bold = True
        p.add_run(" fue ")
        r = p.add_run("cubierto")
        r.italic = True
        r.font.color.rgb = RGBColor(0xC0, 0, 0)
        p.add_run(".")
        t = d.add_table(rows=2, cols=2)
        for i, txt in enumerate(["Nombre", "Monto", "Casa", "1.000 UF"]):
            t.cell(i // 2, i % 2).text = txt
        d.add_paragraph("Primero", style="List Bullet")
        d.sections[0].header.paragraphs[0].text = "Confidencial"
        d.add_paragraph("12345")   # sin letras: no se traduce
        d.save(cls.src)

    def segs(self):
        out = os.path.join(self.d, "seg.json")
        run("extraer", self.src, "-o", out)
        return {s["id"]: s["texto"] for s in json.load(open(out, encoding="utf-8"))["segmentos"]}

    def test_extrae_cuerpo_tablas_lista_y_encabezado_con_etiquetas(self):
        s = self.segs()
        textos = list(s.values())
        self.assertIn("El <b>siniestro</b> fue <c=#c00000><i>cubierto</i></c>.", textos)
        for esperado in ["Informe", "Nombre", "Monto", "Casa", "1.000 UF", "Primero", "Confidencial"]:
            self.assertIn(esperado, textos)
        self.assertNotIn("12345", textos)

    def test_aplica_conservando_estilo_formato_y_tabla(self):
        s = self.segs()
        tr = {}
        for sid, txt in s.items():
            tr[sid] = {
                "Informe": "Report",
                "Nombre": "Name",
                "Monto": "Amount",
                "Casa": "House",
                "Primero": "First",
                "Confidencial": "Confidential",
            }.get(txt, txt)
            if txt.startswith("El <b>"):
                tr[sid] = "The <b>claim</b> was <c=#c00000><i>covered</i></c>."
        tj = os.path.join(self.d, "tr.json")
        json.dump(tr, open(tj, "w", encoding="utf-8"))
        out = os.path.join(self.d, "out.docx")
        inf = os.path.join(self.d, "inf.json")
        run("aplicar", self.src, "-t", tj, "-o", out, "--informe", inf)
        d = docx.Document(out)
        self.assertEqual(d.paragraphs[0].text, "Report")
        self.assertEqual(d.paragraphs[0].style.name, "Heading 1")
        p = d.paragraphs[1]
        self.assertEqual(p.text, "The claim was covered.")
        runs = {r.text: r for r in p.runs}
        self.assertTrue(runs["claim"].bold)
        self.assertTrue(runs["covered"].italic)
        self.assertEqual(str(runs["covered"].font.color.rgb), "C00000")
        self.assertFalse(runs["The "].bold or False)
        self.assertEqual([[c.text for c in r.cells] for r in d.tables[0].rows], [["Name", "Amount"], ["House", "1.000 UF"]])
        self.assertEqual(d.paragraphs[2].style.name, "List Bullet")
        self.assertEqual(d.sections[0].header.paragraphs[0].text, "Confidential")
        self.assertEqual(d.paragraphs[-1].text, "12345")
        informe = json.load(open(inf, encoding="utf-8"))
        self.assertEqual(informe["sin_traduccion"], [])

    def test_lo_que_falta_queda_en_el_original_y_se_informa(self):
        tj = os.path.join(self.d, "tr2.json")
        json.dump({"d1-0": "Report"}, open(tj, "w", encoding="utf-8"))
        out = os.path.join(self.d, "out2.docx")
        inf = os.path.join(self.d, "inf2.json")
        run("aplicar", self.src, "-t", tj, "-o", out, "--informe", inf)
        d = docx.Document(out)
        self.assertEqual(d.paragraphs[0].text, "Report")
        self.assertEqual(d.paragraphs[1].text, "El siniestro fue cubierto.")
        self.assertGreater(len(json.load(open(inf, encoding="utf-8"))["sin_traduccion"]), 3)

    def test_avisa_si_la_traduccion_perdio_etiquetas(self):
        s = self.segs()
        sid = next(k for k, v in s.items() if v.startswith("El <b>"))
        tj = os.path.join(self.d, "tr3.json")
        with open(tj, "w", encoding="utf-8") as f:
            json.dump({sid: "The claim was covered."}, f)
        out = os.path.join(self.d, "out3.docx")
        inf = os.path.join(self.d, "inf3.json")
        run("aplicar", self.src, "-t", tj, "-o", out, "--informe", inf)
        with open(inf, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["formato_perdido"], 1)

    def test_no_sobrescribe_y_rechaza_lo_que_no_es_docx(self):
        out = os.path.join(self.d, "existe.docx")
        open(out, "w").write("x")
        tj = os.path.join(self.d, "tr.json")
        json.dump({"d1-0": "x"}, open(tj, "w"))
        run("aplicar", self.src, "-t", tj, "-o", out, ok=(1,))
        falso = os.path.join(self.d, "falso.docx")
        open(falso, "w").write("no soy un zip")
        run("extraer", falso, "-o", os.path.join(self.d, "z.json"), ok=(1,))

    def test_documento_sin_texto_sale_con_codigo_2(self):
        vacio = os.path.join(self.d, "vacio.docx")
        d = docx.Document()
        d.add_paragraph("123")
        d.save(vacio)
        run("extraer", vacio, "-o", os.path.join(self.d, "v.json"), ok=(2,))


if __name__ == "__main__":
    unittest.main()
