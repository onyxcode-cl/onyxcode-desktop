"""Pruebas del instalador de la carga (`rootfs/lazunox-install`) contra una raíz temporal (nunca toca /opt real).

`LAZUNOX_INSTALL_ROOT` solo se admite con LAZUNOX_INSTALL_TEST=1 y uid != 0. Los vectores LZPK1 los genera el lado
TypeScript (`wsl-payload.test.ts`) y son comunes con `payload-vectors.json`: `python3 -m unittest test_protocol test_install`.
"""
import gzip
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALL = os.path.join(HERE, "rootfs", "lazunox-install")
with open(os.path.join(HERE, "payload-vectors.json"), encoding="utf-8") as f:
    VECTORS = json.load(f)

_loader = importlib.machinery.SourceFileLoader("lazunox_install", INSTALL)
_spec = importlib.util.spec_from_loader("lazunox_install", _loader)
I = importlib.util.module_from_spec(_spec)
_loader.exec_module(I)


def tgz(members):
    """members: [(nombre, datos | ('symlink', destino))]."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as t:
        for name, d in members:
            ti = tarfile.TarInfo(name)
            ti.mtime = 0
            if isinstance(d, tuple):
                ti.type = tarfile.SYMTYPE
                ti.linkname = d[1]
                t.addfile(ti)
            else:
                ti.size = len(d)
                ti.mode = 0o755
                t.addfile(ti, io.BytesIO(d))
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=0) as g:
        g.write(raw.getvalue())
    return out.getvalue()


def build(files, mutate=None):
    """Codifica LZPK1 en Python (solo para casos negativos). files: [(ruta, bytes)]."""
    entries = []
    for p, d in files:
        entries.append({"path": p, "size": len(d), "sha256": hashlib.sha256(d).hexdigest(),
                        "mode": 0o755 if p in ("launcher.py", "bin/opencode") else 0o644,
                        "kind": "opencode-tgz" if p == "bin/opencode" else "file"})
    manifest = {"v": 1, "files": entries}
    if mutate:
        mutate(manifest)
    m = json.dumps(manifest, separators=(",", ":")).encode()
    return b"LZPK1\n" + struct.pack(">I", len(m)) + m + b"".join(d for _, d in files)


GOOD_TGZ = tgz([("opencode", b"BIN-v1")])
GOOD = [("launcher.py", b"print('v1')\n"), ("bin/opencode", GOOD_TGZ)]


def tree(root):
    out = {}
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            with open(p, "rb") as fh:
                out[os.path.relpath(p, root)] = fh.read()
    return out


class InstallBase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="lzinst-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.target = os.path.join(self.root, "opt", "lazunox")

    def run_install(self, data):
        return I.install(io.BytesIO(data), self.root)

    def fails(self, data, text=None):
        with self.assertRaises(I.InstallError) as cm:
            self.run_install(data)
        if text:
            self.assertIn(text, str(cm.exception))
        return cm.exception

    def assert_no_leftovers(self):
        left = [n for n in os.listdir(os.path.join(self.root, "opt")) if n != "lazunox"]
        self.assertEqual(left, [])


class Vectors(InstallBase):
    def test_vectores_de_typescript_se_instalan_y_dan_el_mismo_payload_sha(self):
        self.assertTrue(VECTORS["cases"])
        for c in VECTORS["cases"]:
            shutil.rmtree(os.path.join(self.root, "opt"), ignore_errors=True)
            sha = self.run_install(bytes.fromhex(c["payloadHex"]))
            self.assertEqual(sha, c["payloadSha"], c["name"])
            with open(os.path.join(self.target, "MANIFEST.json"), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), c["payloadSha"])
            for f in c["files"]:
                p = os.path.join(self.target, f["path"])
                if f["path"] == "bin/opencode":
                    with open(p, "rb") as fh:
                        self.assertEqual(fh.read(), bytes.fromhex(VECTORS["opencodeBinaryHex"]))
                else:
                    with open(p, "rb") as fh:
                        self.assertEqual(fh.read(), bytes.fromhex(f["dataHex"]))
            self.assertEqual(os.stat(os.path.join(self.target, "bin/opencode")).st_mode & 0o777, 0o755)
            self.assertEqual(os.stat(os.path.join(self.target, "launcher.py")).st_mode & 0o777, 0o755)
            self.assertEqual(os.stat(os.path.join(self.target, "MANIFEST.json")).st_mode & 0o777, 0o644)
            self.assert_no_leftovers()

    def test_ejecutable_por_stdin_con_la_raiz_de_prueba(self):
        env = {"PATH": os.environ.get("PATH", ""), "LAZUNOX_INSTALL_ROOT": self.root, "LAZUNOX_INSTALL_TEST": "1",
               "PYTHONDONTWRITEBYTECODE": "1"}
        if os.getuid() == 0:
            self.skipTest("la raíz de prueba no se admite como root")
        c = VECTORS["cases"][0]
        r = subprocess.run([sys.executable, INSTALL], input=bytes.fromhex(c["payloadHex"]), env=env, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"ok": True, "payloadSha": c["payloadSha"]})


class RootVariable(unittest.TestCase):
    def test_sin_modo_de_prueba_o_como_root_se_rechaza(self):
        with mock.patch.dict(os.environ, {"LAZUNOX_INSTALL_ROOT": "/tmp/x"}, clear=False):
            os.environ.pop("LAZUNOX_INSTALL_TEST", None)
            with self.assertRaises(I.InstallError):
                I.install_root()
            os.environ["LAZUNOX_INSTALL_TEST"] = "1"
            with mock.patch("os.getuid", return_value=0):
                with self.assertRaises(I.InstallError):
                    I.install_root()
            with mock.patch("os.getuid", return_value=501):
                self.assertEqual(I.install_root(), "/tmp/x")
            os.environ["LAZUNOX_INSTALL_ROOT"] = "relativa"
            with mock.patch("os.getuid", return_value=501):
                with self.assertRaises(I.InstallError):
                    I.install_root()

    def test_sin_variable_es_la_raiz_real(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LAZUNOX_INSTALL_ROOT", None)
            self.assertEqual(I.install_root(), "")

    def test_main_como_root_con_la_variable_sale_con_error_sin_escribir(self):
        with mock.patch.dict(os.environ, {"LAZUNOX_INSTALL_ROOT": "/tmp/lz-nunca", "LAZUNOX_INSTALL_TEST": "1"}):
            with mock.patch("os.getuid", return_value=0), mock.patch("sys.stdin", io.TextIOWrapper(io.BytesIO(b""))):
                self.assertEqual(I.main(), 2)
        self.assertFalse(os.path.exists("/tmp/lz-nunca"))


class Rejections(InstallBase):
    def test_hash_incorrecto_en_un_cuerpo(self):
        bad = build(GOOD, lambda m: m["files"][0].__setitem__("sha256", "0" * 64))
        self.fails(bad, "sha256")
        self.assertFalse(os.path.exists(self.target))
        self.assert_no_leftovers()

    def test_hash_incorrecto_del_tgz(self):
        data = build([GOOD[0], ("bin/opencode", GOOD_TGZ)], lambda m: m["files"][0].__setitem__("sha256", "f" * 64))
        self.fails(data, "sha256")

    def test_rutas_fuera_de_la_lista_cerrada(self):
        for p in ["../evil.py", "/etc/passwd", "sub/x.py", "bin/other", "Launcher.py", "x.sh", "bin/opencode/x", "x.py\n", "a b.py", ""]:
            data = build(GOOD + [(p, b"x")])
            self.fails(data, "ruta")
        self.assertFalse(os.path.exists(self.target))

    def test_duplicados_y_faltantes(self):
        self.fails(build(GOOD + [("launcher.py", b"otra")]), "duplicada")
        self.fails(build([GOOD[1]]), "falta launcher.py")
        self.fails(build([GOOD[0], ("mux.py", b"x")]), "falta bin/opencode")

    def test_manifiesto_invalido(self):
        def mut(fn):
            return build(GOOD, fn)
        self.fails(mut(lambda m: m.__setitem__("v", 2)), "inválido")
        self.fails(mut(lambda m: m.__setitem__("extra", 1)), "inválido")
        self.fails(mut(lambda m: m["files"][0].__setitem__("mode", 0o4755)), "modo")
        self.fails(mut(lambda m: m["files"][0].__setitem__("mode", 0o777)), "modo")
        self.fails(mut(lambda m: m["files"][0].__setitem__("size", -1)), "tamaño")
        self.fails(mut(lambda m: m["files"][0].__setitem__("size", True)), "tamaño")
        self.fails(mut(lambda m: m["files"][0].__setitem__("kind", "opencode-tgz")), "tipo")
        self.fails(mut(lambda m: m["files"][1].__setitem__("kind", "file")), "tipo")
        self.fails(mut(lambda m: m["files"][0].__setitem__("sha256", "ABC")), "sha256")
        self.fails(mut(lambda m: m["files"][0].__setitem__("extra", 1)), "inválida")
        self.fails(mut(lambda m: m.__setitem__("files", [])), "archivos")
        self.fails(mut(lambda m: m["files"][0].__setitem__("size", I.MAX_TOTAL + 1)), "grande")
        self.assertFalse(os.path.exists(self.target))

    def test_magia_y_longitud_de_manifiesto(self):
        self.fails(b"LZPK2\n" + b"\0" * 20, "magia")
        self.fails(b"LZPK1\n" + struct.pack(">I", I.MAX_MANIFEST + 1) + b"x", "longitud")
        self.fails(b"LZPK1\n" + struct.pack(">I", 0), "longitud")
        self.fails(b"LZPK1\n" + struct.pack(">I", 3) + b"{x}", "JSON")

    def test_tgz_con_enlace(self):
        t = tgz([("opencode", ("symlink", "/etc/passwd"))])
        self.fails(build([GOOD[0], ("bin/opencode", t)]), "tgz")

    def test_tgz_con_dos_miembros_o_miembro_ajeno(self):
        self.fails(build([GOOD[0], ("bin/opencode", tgz([("opencode", b"A"), ("extra", b"B")]))]), "más de un miembro")
        self.fails(build([GOOD[0], ("bin/opencode", tgz([("../opencode", b"A")]))]), "opencode")
        self.fails(build([GOOD[0], ("bin/opencode", tgz([("./opencode", b"A")]))]), "opencode")
        self.fails(build([GOOD[0], ("bin/opencode", tgz([("bin/opencode", b"A")]))]), "opencode")
        self.fails(build([GOOD[0], ("bin/opencode", tgz([]))]), "opencode")

    def test_tgz_que_no_es_tgz(self):
        self.fails(build([GOOD[0], ("bin/opencode", b"no soy gzip")]), "tgz")

    def test_miembro_demasiado_grande(self):
        with mock.patch.object(I, "MAX_OPENCODE", 4):
            self.fails(build([GOOD[0], ("bin/opencode", tgz([("opencode", b"12345")]))]), "tamaño")

    def test_truncados_en_cada_frontera(self):
        full = build(GOOD)
        m_end = 10 + struct.unpack(">I", full[6:10])[0]
        for cut in (0, 3, 6, 8, 12, m_end - 1, m_end + 2, len(full) - 1):
            self.fails(full[:cut])
            self.assertFalse(os.path.exists(self.target), cut)
            self.assert_no_leftovers()

    def test_bytes_sobrantes(self):
        self.fails(build(GOOD) + b"x", "sobrantes")


class Atomicity(InstallBase):
    def setUp(self):
        super().setUp()
        self.run_install(build(GOOD))
        self.before = tree(self.target)
        self.assertIn("MANIFEST.json", self.before)

    def v2(self):
        return build([("launcher.py", b"print('v2')\n"), ("bin/opencode", tgz([("opencode", b"BIN-v2")]))])

    def test_actualizacion_correcta_reemplaza_todo(self):
        self.run_install(self.v2())
        after = tree(self.target)
        self.assertNotEqual(after, self.before)
        self.assertEqual(after["bin/opencode"], b"BIN-v2")
        self.assert_no_leftovers()

    def test_fallo_de_validacion_deja_intacta_la_anterior(self):
        for bad in (build(GOOD, lambda m: m["files"][0].__setitem__("sha256", "0" * 64)), self.v2()[:-3],
                    build([GOOD[0], ("bin/opencode", tgz([("opencode", b"A"), ("x", b"B")]))])):
            with self.assertRaises(I.InstallError):
                self.run_install(bad)
            self.assertEqual(tree(self.target), self.before)
            self.assert_no_leftovers()

    def test_un_new_a_medias_de_un_corte_anterior_no_estorba(self):
        os.makedirs(self.target + ".new/bin")
        with open(self.target + ".new/basura", "w") as f:
            f.write("x")
        self.run_install(self.v2())
        self.assertEqual(tree(self.target)["bin/opencode"], b"BIN-v2")
        self.assert_no_leftovers()

    def test_fallo_en_el_ultimo_renombrado_restaura_la_anterior(self):
        real = os.rename

        def fake(src, dst, *a, **k):
            if src.endswith("lazunox.new"):
                raise OSError(28, "No space left")
            return real(src, dst, *a, **k)

        with mock.patch("os.rename", side_effect=fake):
            with self.assertRaises(OSError):
                self.run_install(self.v2())
        self.assertEqual(tree(self.target), self.before)
        self.assert_no_leftovers()

    def test_corte_entre_renombrados_se_recupera_en_la_siguiente_ejecucion(self):
        os.rename(self.target, self.target + ".old")  # simula el corte: no hay carga, hay .old
        self.fails(b"LZPK1\n")  # la ejecución siguiente (aunque falle) restaura primero
        self.assertEqual(tree(self.target), self.before)

    def test_error_de_io_al_escribir_deja_la_anterior(self):
        def boom(p):
            raise OSError(5, "I/O error")

        with mock.patch.object(I, "fsync_dir", side_effect=boom):
            with self.assertRaises(OSError):
                self.run_install(self.v2())
        self.assertEqual(tree(self.target), self.before)
        self.assert_no_leftovers()


if __name__ == "__main__":
    unittest.main()
