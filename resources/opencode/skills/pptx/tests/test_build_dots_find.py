# -*- coding: utf-8 -*-
"""`build_dots.find_deckcraft` en macOS y Windows (simulado): variable del motor, carpeta de la app y marca de instalación."""
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import build_dots as bd  # noqa: E402


def ejecutable(ruta):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    open(ruta, "w").write("#!/bin/sh\n")
    os.chmod(ruta, 0o755)
    return ruta


class FindDeckcraft(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.bin = os.path.join(self.d, "bin")
        self.carpeta = os.path.join(self.bin, "craft-0.5.0")
        self.marca = os.path.join(self.carpeta, "installed-deckcraft.json")
        os.makedirs(self.carpeta)
        open(self.marca, "w").write("{}")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.d, ignore_errors=True)

    def test_windows_encuentra_deckcraft_exe(self):
        exe = ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli.exe"))
        with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(os.environ, {"LAZUNOX_BIN_DIR": self.bin}, clear=True):
            self.assertEqual(bd.find_deckcraft(), exe)

    def test_windows_sin_marca_no_se_usa(self):
        ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli.exe"))
        os.remove(self.marca)
        with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(os.environ, {"LAZUNOX_BIN_DIR": self.bin}, clear=True):
            self.assertEqual(bd.find_deckcraft(), "")

    def test_marca_antigua_installed_json_vale(self):
        exe = ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli.exe"))
        os.remove(self.marca)
        open(os.path.join(self.carpeta, "installed.json"), "w").write("{}")
        with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(os.environ, {"LAZUNOX_BIN_DIR": self.bin}, clear=True):
            self.assertEqual(bd.find_deckcraft(), exe)

    def test_variable_del_motor_tiene_prioridad(self):
        otro = ejecutable(os.path.join(self.d, "otro", "deckcraft-cli.exe"))
        ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli.exe"))
        with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(
                os.environ, {"LAZUNOX_BIN_DIR": self.bin, "LAZUNOX_DECKCRAFT": otro}, clear=True):
            self.assertEqual(bd.find_deckcraft(), otro)

    def test_macos_sigue_igual(self):
        exe = ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli"))
        with mock.patch.object(sys, "platform", "darwin"), mock.patch.dict(os.environ, {"LAZUNOX_BIN_DIR": self.bin}, clear=True):
            self.assertEqual(bd.find_deckcraft(), exe)

    def test_macos_no_busca_exe(self):
        ejecutable(os.path.join(self.carpeta, "deck", "deckcraft-cli.exe"))
        with mock.patch.object(sys, "platform", "darwin"), mock.patch.dict(os.environ, {"LAZUNOX_BIN_DIR": self.bin}, clear=True):
            self.assertEqual(bd.find_deckcraft(), "")


if __name__ == "__main__":
    unittest.main()
