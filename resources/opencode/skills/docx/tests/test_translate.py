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


@unittest.skipIf(docx is None, "python-docx no instalado")
class TestCasosBorde(unittest.TestCase):
    """Hallazgos de la revisión: nada debe perder texto ni tumbar el documento."""

    @classmethod
    def setUpClass(cls):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        cls.d = tempfile.mkdtemp(prefix="trdocx2-")
        d = docx.Document()
        p = d.add_paragraph("Inicio ")
        st = OxmlElement("w:smartTag")
        r = OxmlElement("w:r")
        t = OxmlElement("w:t")
        t.text = "Paris city"
        r.append(t)
        st.append(r)
        p._p.append(st)
        p.add_run(" fin del texto")                                   # 0: smartTag
        p = d.add_paragraph("Nota importante")
        r = OxmlElement("w:r")
        r.append(OxmlElement("w:footnoteReference"))
        p._p.append(r)                                                # 1: referencia de nota
        p = d.add_paragraph("Antes")
        p.add_run().add_break(docx.enum.text.WD_BREAK.PAGE)
        p.add_run("después del salto")                                # 2: salto de página
        p = d.add_paragraph("Area en m")
        p.add_run("2").font.superscript = True                        # 3: superíndice
        p = d.add_paragraph()
        p.add_run("Frase larga toda en negrita aquí ").bold = True
        p.add_run("y un trozo normal")                                # 4: mayoría negrita
        p = d.add_paragraph()
        r = p.add_run("Texto con idioma")
        r.bold = True
        r.font.color.rgb = RGBColor(0x11, 0x22, 0x33)
        rpr = r._r.get_or_add_rPr()
        lang = OxmlElement("w:lang")
        lang.set(qn("w:val"), "en-US")
        rpr.append(lang)                                              # 5: w:lang
        cls.src = os.path.join(cls.d, "src.docx")
        d.save(cls.src)

    def extraer(self):
        out = os.path.join(self.d, "s.json")
        run("extraer", self.src, "-o", out)
        with open(out, encoding="utf-8") as f:
            data = json.load(f)
        return {s["id"]: s["texto"] for s in data["segmentos"]}, data["omitidos"]

    def test_omite_lo_que_no_puede_reescribir_sin_perder_texto(self):
        segs, omitidos = self.extraer()
        textos = " | ".join(segs.values())
        for no_debe in ("Inicio", "Nota importante", "Antes", "Area en m"):
            self.assertNotIn(no_debe, textos)
        self.assertEqual(sum(omitidos.values()), 4)

    def test_negrita_mayoritaria_no_contagia_al_trozo_normal(self):
        segs, _ = self.extraer()
        self.assertIn("<b>Frase larga toda en negrita aquí </b>y un trozo normal", segs.values())
        sid = next(k for k, v in segs.items() if v.startswith("<b>Frase"))
        tj = os.path.join(self.d, "t.json")
        with open(tj, "w", encoding="utf-8") as f:
            json.dump({sid: "<b>Long bold sentence here </b>and a plain bit"}, f)
        out = os.path.join(self.d, "o.docx")
        run("aplicar", self.src, "-t", tj, "-o", out)
        runs = {r.text: r for r in docx.Document(out).paragraphs[4].runs}
        self.assertTrue(runs["Long bold sentence here "].bold)
        self.assertFalse(runs["and a plain bit"].bold)

    def test_control_en_la_traduccion_no_tumba_el_documento_y_se_quita_el_idioma(self):
        segs, _ = self.extraer()
        sid = next(k for k, v in segs.items() if "idioma" in v)
        tj = os.path.join(self.d, "t2.json")
        with open(tj, "w", encoding="utf-8") as f:
            json.dump({sid: "<b><c=#112233>Text\x0b\x00 with language</c></b>"}, f)
        out = os.path.join(self.d, "o2.docx")
        run("aplicar", self.src, "-t", tj, "-o", out)
        r = docx.Document(out).paragraphs[5].runs[0]
        self.assertEqual(r.text, "Text with language")
        self.assertIsNone(r._r.find(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lang"))
        hijos = [h.tag.split("}")[1] for h in r._r.rPr]   # orden del esquema: b antes que color
        self.assertEqual(hijos, ["b", "color"])

    def test_docx_con_demasiado_contenido_al_descomprimir_se_rechaza(self):
        import zipfile
        bomba = os.path.join(self.d, "bomba.docx")
        with zipfile.ZipFile(bomba, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", "<x/>")
            z.writestr("relleno.bin", b"\0" * (310 * 1024 * 1024))
        run("extraer", bomba, "-o", os.path.join(self.d, "b.json"), ok=(1,))


if __name__ == "__main__":
    unittest.main()
