"""Verifica imports, versiones y origen efectivo de las bibliotecas de oficina, sin pip ni red."""
import argparse
import importlib
import importlib.metadata
import json
from pathlib import Path
import sys

MODULES = {
    "python-docx": "docx", "openpyxl": "openpyxl", "python-pptx": "pptx",
    "pypdf": "pypdf", "pdfplumber": "pdfplumber", "reportlab": "reportlab",
    "pypdfium2": "pypdfium2", "pillow": "PIL", "lxml": "lxml.etree",
    "pymupdf": "fitz", "cffi": "cffi", "charset-normalizer": "charset_normalizer",
    "cryptography": "cryptography", "et_xmlfile": "et_xmlfile", "pdfminer.six": "pdfminer",
    "pycparser": "pycparser", "typing_extensions": "typing_extensions", "xlsxwriter": "xlsxwriter",
}


def verify(requirements, site=None):
    packages = {}
    for line in Path(requirements).read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, expected = line.strip().split("==")
        actual = importlib.metadata.version(name)
        if actual != expected:
            raise ValueError(f"{name}: {actual}, esperado {expected}")
        module = importlib.import_module(MODULES[name])
        origin = Path(module.__file__).resolve()
        if site and not origin.is_relative_to(Path(site).resolve()):
            raise ValueError(f"{name}: origen fuera de {site}: {origin}")
        packages[name] = actual
    # Componentes nativos utilizados por las skills, además del módulo principal.
    for module in ("pymupdf", "PIL.Image", "reportlab.pdfgen.canvas", "cryptography.hazmat.bindings._rust", "_cffi_backend"):
        importlib.import_module(module)
    return {"python": sys.version.split()[0], "executable": sys.executable, "packages": packages}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requirements")
    parser.add_argument("--site", help="Exigir que los módulos procedan de esta carpeta")
    args = parser.parse_args()
    print(json.dumps(verify(args.requirements, args.site), sort_keys=True))
