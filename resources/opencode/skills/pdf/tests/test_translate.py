"""Pruebas de translate_pdf.py (traducir sin cambiar el diseño). Ejecutar: python -m unittest tests/test_translate.py
Necesita PyMuPDF; si no está instalado se omiten."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(AQUI, "..", "scripts")

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None


def run(*args, ok=(0,)):
    p = subprocess.run([sys.executable, os.path.join(SC, "translate_pdf.py")] + list(args), capture_output=True, text=True)
    assert p.returncode in ok, "%s -> %d\n%s\n%s" % (args, p.returncode, p.stdout, p.stderr)
    return p


@unittest.skipIf(fitz is None, "PyMuPDF no instalado")
class TestTraducir(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="trtest-")
        cls.src = os.path.join(cls.d, "src.pdf")
        doc = fitz.open()
        p = doc.new_page(width=612, height=792)
        p.insert_text((87, 100), "TIPO:", fontname="hebo", fontsize=9)
        p.insert_text((204, 100), "Seguro de Todo Riesgo.", fontname="helv", fontsize=9)
        p.insert_text((87, 130), "Excluye:", fontname="hebo", fontsize=9)
        p.draw_rect(fitz.Rect(150, 121, 190, 133), color=None, fill=(1, 1, 0), overlay=False)  # resaltado
        p.insert_text((150, 130), "desaparición", fontname="helv", fontsize=9)
        p.insert_text((87, 700), "Ref: 2026-30", fontname="helv", fontsize=9)   # sin letras traducibles aparte de «Ref»
        doc.save(cls.src)

    def test_extraer_y_aplicar_conserva_posiciones(self):
        seg = os.path.join(self.d, "seg.json")
        run("extraer", self.src, "-o", seg)
        with open(seg, encoding="utf-8") as f:
            datos = json.load(f)["segmentos"]
        textos = {s["texto"]: s["id"] for s in datos}
        self.assertIn("TIPO:", textos)
        tr = {textos["TIPO:"]: "TYPE:", textos["Seguro de Todo Riesgo."]: "All Risks Insurance."}
        hl = [s for s in datos if "resaltado" in s]
        self.assertTrue(hl, "debe detectar el resaltado")
        tr[hl[0]["id"]] = "[[disappearance]]" if hl[0]["texto"] == "desaparición" else tr.get(hl[0]["id"], "x")
        tfile = os.path.join(self.d, "tr.json")
        with open(tfile, "w", encoding="utf-8") as f:
            json.dump(tr, f)
        out = os.path.join(self.d, "out.pdf")
        run("aplicar", self.src, "-t", tfile, "-o", out, "--informe", os.path.join(self.d, "inf.json"), ok=(0,))
        pag = fitz.open(out)[0]
        texto = pag.get_text()
        self.assertIn("TYPE:", texto)
        self.assertIn("All Risks Insurance.", texto)
        self.assertNotIn("Seguro de Todo Riesgo", texto)
        # lo traducido queda en el mismo sitio
        r = pag.search_for("TYPE:")[0]
        self.assertAlmostEqual(r.x0, 87, delta=2)

    def test_no_sobrescribe_salida(self):
        seg = os.path.join(self.d, "seg2.json")
        run("extraer", self.src, "-o", seg)
        p = subprocess.run([sys.executable, os.path.join(SC, "translate_pdf.py"), "aplicar", self.src, "-t", seg, "-o", self.src],
                           capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)

    def test_pdf_sin_texto_avisa(self):
        vacio = os.path.join(self.d, "vacio.pdf")
        d = fitz.open()
        d.new_page()
        d.save(vacio)
        p = subprocess.run([sys.executable, os.path.join(SC, "translate_pdf.py"), "extraer", vacio, "-o", os.path.join(self.d, "v.json")],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn("ESCANEADO", p.stderr)

    def _traducir(self, doc_builder, mapa):
        src = os.path.join(self.d, "al_%d.pdf" % id(mapa))
        doc = fitz.open()
        doc_builder(doc.new_page(width=612, height=792))
        doc.save(src)
        seg = src + ".json"
        run("extraer", src, "-o", seg)
        with open(seg, encoding="utf-8") as f:
            datos = json.load(f)["segmentos"]
        tr = {s["id"]: mapa[s["texto"]] for s in datos if s["texto"] in mapa}
        tfile = src + ".tr.json"
        with open(tfile, "w", encoding="utf-8") as f:
            json.dump(tr, f)
        out = src + ".out.pdf"
        run("aplicar", src, "-t", tfile, "-o", out, ok=(0, 3))
        return fitz.open(out)[0]

    def test_conserva_alineacion_derecha_y_centrada(self):
        def build(p):
            p.insert_text((87, 100), "Texto normal a la izquierda del documento.", fontname="helv", fontsize=9)
            w = fitz.get_text_length("Fecha de emisión", fontname="helv", fontsize=9)
            p.insert_text((525 - w, 140), "Fecha de emisión", fontname="helv", fontsize=9)           # pegado a la derecha
            wc = fitz.get_text_length("Título centrado", fontname="hebo", fontsize=14)
            p.insert_text((306 - wc / 2, 180), "Título centrado", fontname="hebo", fontsize=14)       # centrado en la hoja
            p.insert_text((87, 400), "Pie de página", fontname="helv", fontsize=9)
            p.insert_text((525 - fitz.get_text_length("x", fontname="helv", fontsize=9), 400), "x", fontname="helv", fontsize=9)
        pag = self._traducir(build, {"Texto normal a la izquierda del documento.": "Plain text on the left of the document.",
                                     "Fecha de emisión": "Date of issue (long form)", "Título centrado": "Centered heading"})
        r = pag.search_for("Date of issue (long form)")[0]
        self.assertAlmostEqual(r.x1, 530, delta=3)            # sigue pegado a la derecha (el borde real del texto original es 530)
        c = pag.search_for("Centered heading")[0]
        self.assertAlmostEqual((c.x0 + c.x1) / 2, 306, delta=3)  # sigue centrado

    def test_no_reescribe_si_la_traduccion_es_igual(self):
        def build(p):
            p.insert_text((87, 100), "Hannover Rück Se", fontname="helv", fontsize=9)
            p.insert_text((87, 130), "Hola", fontname="helv", fontsize=9)
        pag = self._traducir(build, {"Hannover Rück Se": "Hannover Rück Se", "Hola": "Hello"})
        self.assertIn("Hannover", pag.get_text())
        self.assertIn("Hello", pag.get_text())

    def test_enlaces_y_colores_se_conservan(self):
        def build(p):
            p.insert_text((87, 100), "Visite ", fontname="helv", fontsize=10)
            x = 87 + fitz.get_text_length("Visite ", fontname="helv", fontsize=10)
            p.insert_text((x, 100), "nuestro sitio", fontname="helv", fontsize=10, color=(0, 0, 1))
            w = fitz.get_text_length("nuestro sitio", fontname="helv", fontsize=10)
            p.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(x, 90, x + w, 103), "uri": "https://example.com/x"})
            p.insert_text((x + w, 100), " hoy.", fontname="helv", fontsize=10)
        src = os.path.join(self.d, "enlace.pdf")
        doc = fitz.open()
        build(doc.new_page(width=612, height=792))
        doc.save(src)
        seg = src + ".json"
        run("extraer", src, "-o", seg)
        with open(seg, encoding="utf-8") as f:
            datos = json.load(f)["segmentos"]
        self.assertIn("<l=0>", datos[0]["texto"])
        self.assertIn("<c=#0000ff>", datos[0]["texto"])
        tfile = src + ".tr.json"
        with open(tfile, "w", encoding="utf-8") as f:
            json.dump({datos[0]["id"]: "Visit <l=0><c=#0000ff>our site</c></l> today."}, f)
        out = src + ".out.pdf"
        run("aplicar", src, "-t", tfile, "-o", out)
        pag = fitz.open(out)[0]
        enl = pag.get_links()
        self.assertEqual(len(enl), 1)
        self.assertEqual(enl[0]["uri"], "https://example.com/x")
        self.assertIn("our site", pag.get_textbox(fitz.Rect(enl[0]["from"])))


if __name__ == "__main__":
    unittest.main()
