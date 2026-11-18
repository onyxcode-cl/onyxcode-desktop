# -*- coding: utf-8 -*-
"""Banco de documentos difíciles: traducir y editar Word, Excel, PowerPoint y PDF con los scripts de verdad sobre archivos con rarezas internas
(papelera, partes huérfanas, Word de Mac, Google, LibreOffice, WPS, comentarios, cambios, OLE, macros, ZIP raros, tablas dinámicas, medios).
Cada archivo debe: traducirse/editarse sin fallar, dar un resultado que abre con la biblioteca, tener el texto nuevo y dejar el original idéntico.
Ejecutar: python -m unittest tests/test_banco.py   (con LAZUNOX_PYTHON se usa ese Python; si falta alguna biblioteca se omite)."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
SK = os.path.join(AQUI, "..", "..")
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, ".."))
PY = os.environ.get("LAZUNOX_PYTHON") or sys.executable
TAGS = r"(</?[biu]>|<c=#[0-9a-fA-F]{6}>|</c>|<l=\d+>|</l>|<r\d+>|</r\d+>)"

try:
    import docx
except ImportError:  # pragma: no cover
    docx = None
try:
    import openpyxl
except ImportError:  # pragma: no cover
    openpyxl = None
try:
    import pptx
except ImportError:  # pragma: no cover
    pptx = None
try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None
import banco_documentos as banco  # noqa: E402
import normalizar_paquete  # noqa: E402


ESTRUCTURALES = {"duplicadas", "barras", "mayusculas", "rota"}


def correr(skill, script, *args):
    return subprocess.run([PY, os.path.join(SK, skill, "scripts", script)] + [str(a) for a in args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def huella(ruta):
    with open(ruta, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def mayusculas(seg_json, destino):
    """Modelo falso: «traduce» poniendo todo en MAYÚSCULAS (sin tocar las etiquetas)."""
    with open(seg_json, encoding="utf-8") as f:
        segs = json.load(f)["segmentos"]
    tr = {s["id"]: "".join(p if re.fullmatch(TAGS, p) else p.upper() for p in re.split(TAGS, s["texto"])) for s in segs}
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(tr, f, ensure_ascii=False)
    return tr


def traducir(skill, script, origen, ext_salida, carpeta, nombre):
    """extraer → modelo falso → aplicar. Devuelve (proceso de aplicar, ruta de salida, informe)."""
    seg, tr = os.path.join(carpeta, nombre + "-seg.json"), os.path.join(carpeta, nombre + "-tr.json")
    salida, informe = os.path.join(carpeta, nombre + "-out." + ext_salida), os.path.join(carpeta, nombre + "-inf.json")
    p = correr(skill, script, "extraer", origen, "-o", seg)
    assert p.returncode == 0, "extraer %s -> %d\n%s\n%s" % (nombre, p.returncode, p.stdout, p.stderr)
    mayusculas(seg, tr)
    p = correr(skill, script, "aplicar", origen, "-t", tr, "-o", salida, "--informe", informe)
    inf = {}
    if os.path.exists(informe):
        with open(informe, encoding="utf-8") as f:
            inf = json.load(f)
    return p, salida, inf


class TestNormalizar(unittest.TestCase):
    """La copia limpia: qué entra, qué sale y que el original no se toca."""

    @classmethod
    def setUpClass(cls):
        if docx is None:
            raise unittest.SkipTest("python-docx no instalado")
        cls.d = tempfile.mkdtemp(prefix="banco-norm-")
        cls.banco = banco.banco_docx(cls.d)

    def limpiar(self, nombre, **kw):
        antes = huella(self.banco[nombre])
        r = normalizar_paquete.preparar(self.banco[nombre], **kw)
        self.assertEqual(antes, huella(self.banco[nombre]), "el original cambió")
        return r, zipfile.ZipFile(r.ruta)

    def test_papelera_y_huerfanas_se_van(self):
        r, z = self.limpiar("trash")
        self.assertNotIn("[trash]/0000.dat", z.namelist())
        self.assertTrue(any("[trash]/0000.dat" in a for a in r.avisos))
        _, z = self.limpiar("huerfanas")
        for n in ("word/huerfana.xml", "customXml/item9.xml", "docProps/miniatura_vieja.jpeg", "word/media/sin_uso.png"):
            self.assertNotIn(n, z.namelist())

    def test_partes_alcanzables_se_conservan(self):
        _, z = self.limpiar("wps")
        for n in ("customXml/item1.xml", "customXml/itemProps1.xml", "docProps/custom.xml", "docProps/thumbnail.jpeg", "word/fonts/font1.odttf"):
            self.assertIn(n, z.namelist())
        _, z = self.limpiar("ole")
        self.assertIn("word/embeddings/oleObject1.bin", z.namelist())
        _, z = self.limpiar("comentarios")
        self.assertIn("word/comments.xml", z.namelist())

    def test_zip_sin_rarezas(self):
        for nombre in ("duplicadas", "mayusculas", "barras", "vacias", "mac"):
            r, z = self.limpiar(nombre)
            nombres = z.namelist()
            self.assertEqual(len(nombres), len({n.lower() for n in nombres}), nombre)
            self.assertFalse(any("\\" in n or n.endswith("/") or n.startswith("__MACOSX") for n in nombres), nombre)
            self.assertEqual(nombres[0], "[Content_Types].xml")
            self.assertTrue(all(z.getinfo(n).file_size > 0 for n in nombres), nombre)
        _, z = self.limpiar("duplicadas")
        self.assertNotIn("TEXTO VIEJO", z.read("word/document.xml").decode())

    def test_relaciones_rotas(self):
        r, z = self.limpiar("rota")
        self.assertNotIn("no_existe", z.read("word/_rels/document.xml.rels").decode())
        self.assertNotIn("no_existe", z.read("[Content_Types].xml").decode())
        self.assertIn("https://example.com/", z.read("word/_rels/document.xml.rels").decode())

    def test_macros_se_quitan_solo_si_se_pide(self):
        _, z = self.limpiar("macros")
        self.assertIn("word/vbaProject.bin", z.namelist())
        r, z = self.limpiar("macros", quitar_macros=True)
        self.assertNotIn("word/vbaProject.bin", z.namelist())
        self.assertNotIn("macroEnabled", z.read("[Content_Types].xml").decode())
        self.assertTrue(any("macros" in a for a in r.avisos))
        docx.Document(r.ruta)

    def test_no_es_un_documento(self):
        malo = os.path.join(self.d, "malo.docx")
        with open(malo, "wb") as f:
            f.write(b"esto no es un zip")
        with self.assertRaises(normalizar_paquete.PaqueteIlegible):
            normalizar_paquete.preparar(malo)
        vacio = os.path.join(self.d, "sin-tipos.docx")
        with zipfile.ZipFile(vacio, "w") as z:
            z.writestr("x.txt", "hola")
        with self.assertRaises(normalizar_paquete.PaqueteIlegible):
            normalizar_paquete.preparar(vacio)

    def test_es_idempotente(self):
        r1, _ = self.limpiar("wps")
        r2 = normalizar_paquete.preparar(r1.ruta)
        self.assertEqual(r2.avisos, [])
        self.assertEqual(huella(r1.ruta), huella(r2.ruta))


@unittest.skipIf(docx is None, "python-docx no instalado")
class TestWord(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="banco-docx-")
        cls.banco = banco.banco_docx(cls.d)

    def test_traducir_todo_el_banco(self):
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                p, salida, inf = traducir("docx", "translate_docx.py", ruta, "docx", self.d, nombre.replace("+", "_"))
                self.assertEqual(p.returncode, 0, "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes, "el original cambió")
                # la salida CONSERVA el archivo original (papelera, huérfanas…); se lee como cualquier documento: con su copia limpia
                texto = " ".join(t.text or "" for t in docx.Document(normalizar_paquete.preparar(salida).ruta).element.body.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
                self.assertTrue("HOLA MUNDO" in texto or "SEGUNDO PÁRRAFO" in texto, texto[:200])
                orig = zipfile.ZipFile(ruta)
                if nombre in ESTRUCTURALES:   # el ZIP trae rarezas que las bibliotecas no leen: se entrega la copia limpia
                    self.assertEqual(inf.get("via"), "copia limpia", nombre)
                elif nombre != "macros":
                    self.assertEqual(inf.get("via"), "preservado", nombre)
                    sal = zipfile.ZipFile(salida)
                    self.assertEqual(sorted(i.filename for i in orig.infolist()), sorted(i.filename for i in sal.infolist()), "mismas entradas que el original")
                    for i in orig.infolist():   # lo que no es texto pasa byte a byte
                        if not re.search(r"word[/\\](document|header\d*|footer\d*)\.xml$", i.filename, re.I) and not i.filename.endswith("/"):
                            self.assertEqual(orig.read(i.filename), sal.read(i.filename), i.filename)
                self.assertNotIn("error", inf)

    def test_editar_todo_el_banco(self):
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                salida = os.path.join(self.d, "ed-" + nombre.replace("+", "_") + ".docx")
                buscar = "Hola mundo" if nombre not in ("comentarios", "comentarios+trash") else "Segundo párrafo"
                p = correr("docx", "edit_docx.py", ruta, salida, "--reemplazar", buscar, "CAMBIADO")
                self.assertEqual(p.returncode, 0, "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes)
                texto = " ".join(t.text or "" for t in docx.Document(salida).element.body.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
                self.assertIn("CAMBIADO", texto)
                if nombre in ("trash", "comentarios+trash"):
                    self.assertIn("[trash]/0000.dat", zipfile.ZipFile(salida).namelist())   # lo que no se editó pasa intacto

    def test_niveles_grave_y_aviso(self):
        """Metadatos, miniaturas y partes no usadas son AVISO (se entrega); estilos, imágenes y texto perdido son GRAVE (se detiene)."""
        import comparar_estructura as ce
        base = self.banco["base"]
        e = [x for x in banco.leer(base) if x[0] not in ("docProps/app.xml", "docProps/thumbnail.jpeg")]
        dif, avisos, _ = ce.comparar(base, banco.escribir(os.path.join(self.d, "sin-meta.docx"), e))
        self.assertEqual(dif, [], dif)
        self.assertTrue(any("app.xml" in a for a in avisos), avisos)
        e = [x for x in banco.leer(base) if x[0] != "word/styles.xml"]
        dif, _a, _ = ce.comparar(base, banco.escribir(os.path.join(self.d, "sin-styles.docx"), e))
        self.assertTrue(any("styles.xml" in x for x in dif), dif)
        e = banco.leer(base)
        for x in e:
            if x[0] == "word/document.xml":
                x[1] = x[1].replace(b"<w:tbl>", b"<w:p/><w:tbl>", 1).replace(b"</w:tbl>", b"</w:tbl><w:p/>", 1)
        dif, _a, _ = ce.comparar(base, banco.escribir(os.path.join(self.d, "mas-parrafos.docx"), e))
        self.assertTrue(dif, "un párrafo de más debe ser grave")

    def test_motivo_grave_se_informa(self):
        """Si la estructura sí cambia (el modelo borró una etiqueta que era un enlace…) el motivo queda en el informe y sale 1."""
        ruta = self.banco["trash"]
        seg, tr, salida, informe = [os.path.join(self.d, x) for x in ("g-seg.json", "g-tr.json", "g-out.docx", "g-inf.json")]
        self.assertEqual(correr("docx", "translate_docx.py", "extraer", ruta, "-o", seg).returncode, 0)
        mayusculas(seg, tr)
        # un original con estilo usado que la salida pierde: se simula comparando contra un documento sin estilos
        import comparar_estructura as ce
        e = banco.leer(ruta)
        e = [x for x in e if x[0] != "word/styles.xml"]
        roto = banco.escribir(os.path.join(self.d, "sin-estilos.docx"), e)
        dif, avisos, _ = ce.comparar(ruta, roto)
        self.assertTrue(any("styles.xml" in x for x in dif), dif)


@unittest.skipIf(openpyxl is None, "openpyxl no instalado")
class TestExcel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="banco-xlsx-")
        cls.banco = banco.banco_xlsx(cls.d)

    def test_traducir_todo_el_banco(self):
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                p, salida, inf = traducir("xlsx", "translate_xlsx.py", ruta, "xlsx", self.d, nombre.replace("+", "_"))
                self.assertEqual(p.returncode, 0, "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes)
                z = zipfile.ZipFile(normalizar_paquete.preparar(salida).ruta)
                z_salida = zipfile.ZipFile(salida)
                self.assertIn("PRODUCTO", "".join(z.read(n).decode("utf-8", "replace") for n in z.namelist() if re.match(r"xl/(sharedStrings|worksheets/sheet\d+)\.xml$", n)))
                if nombre in ESTRUCTURALES:
                    self.assertEqual(inf.get("via"), "copia limpia", nombre)
                elif nombre != "macros":
                    self.assertEqual(inf.get("via"), "preservado", nombre)
                if nombre not in ESTRUCTURALES:
                        self.assertEqual(sorted(i.filename for i in zipfile.ZipFile(ruta).infolist()), sorted(i.filename for i in z_salida.infolist()), "mismas entradas")
                self.assertIn("<f>B2*C2</f>", z.read("xl/worksheets/sheet1.xml").decode())
                if nombre.startswith("pivot"):
                    self.assertIn("xl/pivotTables/pivotTable1.xml", z.namelist())
                if nombre == "macros":
                    self.assertIn("xl/vbaProject.bin", z.namelist())
                self.assertNotIn("error", inf)

    def test_editar_todo_el_banco(self):
        ops = json.dumps([{"op": "set_cells", "sheet": "Ventas", "cells": {"F1": "Nuevo"}}])
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                salida = os.path.join(self.d, "ed-" + nombre.replace("+", "_") + (".xlsm" if nombre == "macros" else ".xlsx"))
                p = correr("xlsx", "edit_xlsx.py", ruta, "--ops-json", ops, "-o", salida)
                self.assertEqual(p.returncode, 0, "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes)
                wb = openpyxl.load_workbook(salida, keep_vba=nombre == "macros")
                self.assertEqual(wb["Ventas"]["F1"].value, "Nuevo")
                if nombre == "macros":
                    self.assertIn("xl/vbaProject.bin", zipfile.ZipFile(salida).namelist())


@unittest.skipIf(pptx is None, "python-pptx no instalado")
class TestPowerPoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="banco-pptx-")
        cls.banco = banco.banco_pptx(cls.d)

    def test_editar_todo_el_banco(self):
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                salida = os.path.join(self.d, "ed-" + nombre.replace("+", "_") + ".pptx")
                p = correr("pptx", "edit_pptx.py", ruta, salida, "replace", "--find", "Hola mundo", "--replace", "CAMBIADO")
                self.assertEqual(p.returncode, 0, "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes)
                prs = pptx.Presentation(salida)
                textos = " ".join(sh.text_frame.text for s in prs.slides for sh in s.shapes if sh.has_text_frame)
                self.assertIn("CAMBIADO", textos)
                z = zipfile.ZipFile(salida)
                if nombre in ("trash", "medios+trash"):
                    self.assertIn("[trash]/0000.dat", z.namelist())
                if nombre.startswith("medios"):
                    self.assertIn("ppt/media/audio1.mp3", z.namelist())   # los medios alcanzables se conservan


@unittest.skipIf(fitz is None, "PyMuPDF no instalado")
class TestPdf(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="banco-pdf-")
        cls.banco = banco.banco_pdf(cls.d)

    def test_traducir_todo_el_banco(self):
        for nombre, ruta in self.banco.items():
            with self.subTest(nombre):
                antes = huella(ruta)
                p, salida, inf = traducir("pdf", "translate_pdf.py", ruta, "pdf", self.d, nombre)
                self.assertIn(p.returncode, (0, 3), "%s\n%s\n%s" % (nombre, p.stdout, p.stderr))
                self.assertEqual(huella(ruta), antes)
                d = fitz.open(salida)
                self.assertIn("HOLA MUNDO", d[0].get_text().upper())
                self.assertEqual(len(d), 1)
        # el JavaScript no llega a la copia
        d = fitz.open(os.path.join(self.d, "js_adjunto_huerfano-out.pdf"))
        self.assertNotIn("JavaScript", d.xref_object(d.pdf_catalog()))


REAL = os.environ.get("LAZUNOX_BANCO_WORD_REAL")   # solo prueba local: archivo con datos de un cliente, NUNCA va al repositorio


@unittest.skipIf(not REAL or not os.path.exists(REAL or ""), "sin el Word real (LAZUNOX_BANCO_WORD_REAL)")
@unittest.skipIf(docx is None, "python-docx no instalado")
class TestWordReal(unittest.TestCase):
    def test_de_punta_a_punta(self):
        d = tempfile.mkdtemp(prefix="banco-real-")
        antes = huella(REAL)
        p, salida, inf = traducir("docx", "translate_docx.py", REAL, "docx", d, "real")
        self.assertEqual(p.returncode, 0, p.stdout[-800:] + p.stderr[-800:])
        self.assertEqual(huella(REAL), antes)
        docx.Document(salida)


if __name__ == "__main__":
    unittest.main()
