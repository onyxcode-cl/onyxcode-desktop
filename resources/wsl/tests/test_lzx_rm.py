"""Sin aislamiento ni permisos de borrado de main: protocolo, argumentos y caída al nativo."""
import contextlib
import http.server
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lzx_rm as R
import launcher as L


class NativeCalled(Exception):
    pass


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.real_native = R.native
        self.native = mock.patch.object(R, "native", side_effect=NativeCalled)
        self.call = self.native.start()
        self.addCleanup(self.native.stop)
        self.env = {"LAZUNOX_RM_BILLETE": "a" * 64, "LAZUNOX_RM_URL": "http://127.0.0.1:1/own"}

    def fallback(self, argv, env=None):
        with self.assertRaises(NativeCalled):
            R.main(argv, self.env if env is None else env)
        self.call.assert_called_with(argv[0], argv[1:])

    def test_opciones_conocidas_y_fin_de_opciones(self):
        indices, opts = R.parse_args("rm", ["-Rfdv", "--", "-nombre"])
        self.assertEqual(indices, [2])
        self.assertEqual(opts, {"recursive": True, "directory": True, "force": True, "verbose": True})
        self.assertEqual(R.parse_args("rmdir", ["vacio"])[1]["directory"], True)
        self.assertEqual(R.parse_args("unlink", ["fichero"])[0], [0])

    def test_desconocidas_sin_billete_y_rutas_no_normalizables_siempre_nativo(self):
        with mock.patch.object(R, "ask_main") as ask:
            for args in (["-i", "nuevo"], ["--recursive", "nuevo"], ["nuevo/"], ["nuevo/."],
                         ["enlace/../previo"], ["//nuevo"], [""], ["-"], []):
                self.fallback(["rm"] + args)
            self.fallback(["rm", "nuevo"], {})
            self.fallback(["unlink", "uno", "dos"])
            self.fallback(["rmdir", "-p", "uno"])
            ask.assert_not_called()

    def test_billete_vencido_app_caida_y_respuesta_invalida_siempre_nativo(self):
        for result in (None,):
            with mock.patch.object(R, "ask_main", return_value=result):
                self.fallback(["rm", "-f", "nuevo"])
        for error in (OSError("app caída"), ValueError("JSON inválido")):
            with mock.patch.object(R, "ask_main", side_effect=error):
                self.fallback(["rm", "nuevo"])

    def test_main_solo_recibe_rutas_resueltas_no_sigue_enlaces(self):
        with mock.patch.object(R, "ask_main", return_value={"deleted": [True]}) as ask:
            self.assertEqual(R.main(["rm", "nuevo"], self.env), 0)
            payload = ask.call_args.args[2]
            self.assertEqual(payload["paths"], [os.path.join(os.getcwd(), "nuevo")])
            self.assertEqual(payload["cwd"], os.getcwd())
            self.assertEqual(payload["action"], "delete")
            self.assertEqual(payload["ticket"], self.env["LAZUNOX_RM_BILLETE"])
        self.call.assert_not_called()

    def test_mezcla_propios_y_previos_conserva_opciones_y_solo_delega_rechazados(self):
        with mock.patch.object(R, "ask_main", return_value={"deleted": [True, False]}), self.assertRaises(NativeCalled):
            R.main(["rm", "propio", "-rf", "--", "previo"], self.env)
        self.call.assert_called_once_with("rm", ["-rf", "--", "previo"])

    def test_verbose_solo_imprime_los_borrados_por_main(self):
        result = {"deleted": [True], "removed": [{"path": os.path.abspath("nuevo"), "isDirectory": False}]}
        with mock.patch.object(R, "ask_main", return_value=result), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(R.main(["rm", "-v", "nuevo"], self.env), 0)
        self.assertIn("nuevo", out.getvalue())

    def test_verbose_recursivo_preserva_descendientes_orden_prefijo_y_formato_bsd_gnu(self):
        for platform in ("darwin", "linux"):
            for operand in ("./con espacios", os.path.abspath("con espacios")):
                root = os.path.abspath(operand)
                result = {"deleted": [True], "removed": [
                    {"path": root + "/hijo.txt", "isDirectory": False},
                    {"path": root, "isDirectory": True}
                ]}
                with mock.patch.object(R, "ask_main", return_value=result), mock.patch.object(R.sys, "platform", platform), \
                        contextlib.redirect_stdout(io.StringIO()) as out:
                    self.assertEqual(R.main(["rm", "-rv", operand], self.env), 0)
                expected = ([operand + "/hijo.txt", operand] if platform == "darwin" else [
                    "removed " + repr(operand + "/hijo.txt"), "removed directory " + repr(operand)
                ])
                self.assertEqual(out.getvalue().splitlines(), expected)

    def test_verbose_force_inexistente_no_inventa_salida(self):
        with mock.patch.object(R, "ask_main", return_value={"deleted": [True], "removed": []}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(R.main(["rm", "-fv", "inexistente"], self.env), 0)
        self.assertEqual(out.getvalue(), "")

    def test_nativo_usa_ruta_fija_y_no_el_path(self):
        with mock.patch.object(R.os.path, "isfile", return_value=True), mock.patch.object(R.os, "access", return_value=True), \
                mock.patch.object(R.os, "execv", side_effect=NativeCalled) as execute:
            with self.assertRaises(NativeCalled):
                self.real_native("rm", ["-f", "fichero"])
            execute.assert_called_once_with("/bin/rm", ["rm", "-f", "fichero"])

    def test_prefijo_interno_para_python_con_ruta_con_espacios(self):
        with mock.patch.object(R, "ask_main", return_value={"deleted": [True]}):
            self.assertEqual(R.main(["/con espacios/lzx_rm.py", "--lazunox-verb", "rm", "nuevo"], self.env), 0)
        self.fallback(["rm", "--lazunox-verb", "rm", "nuevo"])


class HttpTests(unittest.TestCase):
    @contextlib.contextmanager
    def server(self, response, status=200):
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(status)
                self.end_headers()
                self.wfile.write(response)

            def log_message(self, *_):
                pass

        try:
            server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        except PermissionError as error:
            self.skipTest("El encierro no permite bind de loopback: %s" % error)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield "http://127.0.0.1:%d/own" % server.server_port, received
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_http_real_bearer_es_billete_y_no_token_general(self):
        with self.server(b'{"deleted":[true,false]}') as (url, received):
            self.assertEqual(R.ask_main(url, "billete", {"paths": ["/a", "/b"]}), {"deleted": [True, False]})
        self.assertEqual(received[0][0], "/own")
        self.assertEqual(received[0][1]["Authorization"], "Bearer billete")

    def test_http_sin_socket_revisa_cabecera_resultado_y_limite_de_lectura(self):
        response = mock.Mock(status=200)
        response.read.return_value = b'{"deleted":[true,false]}'
        conn = mock.Mock()
        conn.getresponse.return_value = response
        with mock.patch.object(R.http.client, "HTTPConnection", return_value=conn) as connection:
            result = R.ask_main("http://127.0.0.1:7654/own", "billete", {"paths": ["/a", "/b"]})
        self.assertEqual(result, {"deleted": [True, False]})
        connection.assert_called_once_with("127.0.0.1", 7654, timeout=10)
        self.assertEqual(conn.request.call_args.kwargs["headers"]["Authorization"], "Bearer billete")
        response.read.assert_called_once_with(R.MAX_RESPONSE + 1)
        conn.close.assert_called_once()

    def test_http_sin_socket_rechaza_error_billete_redireccion_y_resultados_malformados(self):
        for status, body in ((403, b''), (302, b''), (200, b'{"deleted":[1]}'),
                             (200, b'{"deleted":[]}'), (200, b'null'), (200, b'x' * (R.MAX_RESPONSE + 1))):
            response = mock.Mock(status=status)
            response.read.return_value = body
            conn = mock.Mock()
            conn.getresponse.return_value = response
            with mock.patch.object(R.http.client, "HTTPConnection", return_value=conn):
                self.assertIsNone(R.ask_main("http://127.0.0.1:7654/own", "billete", {"paths": ["/a"]}))
            conn.close.assert_called_once()

    def test_errores_de_billete_y_respuestas_no_booleanas_vuelven_nativo(self):
        for body, status in ((b'{"deleted":[true]}', 403), (b'{"deleted":[1]}', 200),
                             (b'{"deleted":[]}', 200), (b'null', 200), (b'{"deleted":[false]}', 200)):
            with self.server(body, status) as (url, _):
                expected = {"deleted": [False]} if body == b'{"deleted":[false]}' else None
                self.assertEqual(R.ask_main(url, "billete", {"paths": ["/a"]}), expected)

    def test_verbose_valida_eventos_no_permite_nombres_fuera_de_operandos_ni_tipos_falsos(self):
        payload = {"paths": ["/propio"], "options": {"verbose": True}}
        valid = {"deleted": [True], "removed": [
            {"path": "/propio/hijo", "isDirectory": False}, {"path": "/propio", "isDirectory": True}
        ]}
        for result, expected in (
                (valid, valid), ({"deleted": [True]}, None),
                ({"deleted": [True], "removed": [{"path": "/otro", "isDirectory": False}]}, None),
                ({"deleted": [True], "removed": [{"path": "/propio/../otro", "isDirectory": False}]}, None),
                ({"deleted": [True], "removed": [{"path": "/propio/hijo", "isDirectory": 1}]}, None)):
            response = mock.Mock(status=200)
            response.read.return_value = json.dumps(result).encode("utf-8")
            conn = mock.Mock()
            conn.getresponse.return_value = response
            with mock.patch.object(R.http.client, "HTTPConnection", return_value=conn):
                self.assertEqual(R.ask_main("http://127.0.0.1:7654/own", "billete", payload), expected)

    def test_nunca_red_dns_proxy_ni_redireccion(self):
        with mock.patch.object(R.http.client, "HTTPConnection") as conn:
            for url in ("https://127.0.0.1:5/a", "http://localhost:5/a", "http://example.com:5/a",
                        "http://127.0.0.1:5/a?x=y", "http://u:p@127.0.0.1:5/a", "http://127.0.0.1:5/a#x"):
                self.assertIsNone(R.ask_main(url, "billete", {"paths": ["/a"]}))
            conn.assert_not_called()
        with self.server(b'', 302) as (url, _):
            self.assertIsNone(R.ask_main(url, "billete", {"paths": ["/a"]}))


class LauncherRmTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="lzx-rm-")
        self.addCleanup(shutil.rmtree, self.root)
        shutil.copyfile(Path(__file__).resolve().parents[1] / "lzx_rm.py", Path(self.root) / "lzx_rm.py")

    def test_gate_apagada_no_crea_programas_ni_exporta_ruta(self):
        self.assertIsNone(L.prepare_rm_bin({"env": {}}, self.root))
        self.assertNotIn("LAZUNOX_RM_BIN_DIR", L.child_env({"env": {"LAZUNOX_RM_BIN_DIR": "atacante"}}, "/r", "/t"))
        self.assertFalse(os.path.exists(os.path.join(self.root, "own-delete-bin")))

    def test_prepara_tres_copias_ejecutables_en_directorio_no_modificable(self):
        init = {"env": {"LAZUNOX_OWN_DELETE_RUNTIME": "1", "LAZUNOX_RM_BIN_DIR": "atacante"}}
        target = L.prepare_rm_bin(init, self.root)
        self.assertEqual(L.child_env(init, "/r", "/t")["LAZUNOX_RM_BIN_DIR"], "/opt/lazunox/own-delete-bin")
        for verb in R.VERBS:
            path = Path(target) / verb
            self.assertEqual(path.read_bytes(), (Path(self.root) / "lzx_rm.py").read_bytes())
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
        self.assertEqual(sorted(os.listdir(target)), list(R.VERBS))

    def test_rechaza_enlace_y_directorio_escribible(self):
        target = Path(self.root) / "own-delete-bin"
        target.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            L.prepare_rm_bin({"env": {"LAZUNOX_OWN_DELETE_RUNTIME": "1"}}, self.root)
        target.unlink()
        target.mkdir(mode=0o777)
        target.chmod(0o777)
        with self.assertRaises(ValueError):
            L.prepare_rm_bin({"env": {"LAZUNOX_OWN_DELETE_RUNTIME": "1"}}, self.root)


class NativeProcessTests(unittest.TestCase):
    def test_python_aislado_conserva_salida_y_codigo_del_rm_nativo_al_no_tener_billete(self):
        root = tempfile.mkdtemp(prefix="lzx native ")
        self.addCleanup(shutil.rmtree, root)
        source = Path(__file__).resolve().parents[1] / "lzx_rm.py"
        target = Path(root) / "propio con espacios"
        target.write_text("contenido", encoding="utf-8")
        env = {"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}
        command = [sys.executable, "-I", str(source), "--lazunox-verb", "rm"]
        result = subprocess.run(command + [str(target)], env=env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"")
        self.assertFalse(target.exists())
        missing = subprocess.run(command + ["-f", str(target)], env=env, capture_output=True, timeout=10)
        self.assertEqual(missing.returncode, 0)
        target.write_text("intacto", encoding="utf-8")
        invalid = subprocess.run(command + ["-Z", str(target)], env=env, capture_output=True, timeout=10)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn(b"rm:", invalid.stderr)
        self.assertEqual(target.read_text(encoding="utf-8"), "intacto")


if __name__ == "__main__":
    unittest.main()
