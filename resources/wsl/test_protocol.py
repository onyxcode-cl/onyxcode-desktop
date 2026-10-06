"""Pruebas de la parte PURA del lanzador (sin llamadas privilegiadas): `python3 -m unittest discover resources/wsl`.

Cubre protocol.py (tramas, validación de INIT con vectores generados por el lado TypeScript) y mux.py con
`socketpair`/`pipe` y sockets de 127.0.0.1 (nunca importa launcher.py ni llama a landlock.apply_policy).
"""
import json
import os
import socket
import threading
import unittest

import mux as M
import protocol as P

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "vectors.json"), encoding="utf-8") as f:
    VECTORS = json.load(f)


def code_of(fn, *a):
    try:
        fn(*a)
    except P.ProtocolError as e:
        return e.code
    return None


class FrameVectors(unittest.TestCase):
    def test_vectores_compartidos_con_typescript(self):
        for v in VECTORS["frames"]:
            data = bytes.fromhex(v["data_hex"])
            frame = P.encode_frame(v["id"], v["type"], data)
            self.assertEqual(frame.hex(), v["frame_hex"])
            self.assertEqual(P.FrameDecoder().push(frame), [(v["id"], v["type"], data)])

    def test_pegadas_y_partidas(self):
        a = P.encode_frame(1, P.DATA, b"hola") + P.encode_frame(2, P.CLOSE)
        self.assertEqual(len(P.FrameDecoder().push(a)), 2)
        d, out = P.FrameDecoder(), []
        for b in a:
            out += d.push(bytes([b]))
        self.assertEqual([f[1] for f in out], [P.DATA, P.CLOSE])

    def test_limites_y_envenenado(self):
        self.assertEqual(code_of(P.encode_frame, 1, P.DATA, b"x" * (P.MAX_FRAME_DATA + 1)), "frame_too_large")
        self.assertEqual(code_of(P.encode_frame, -1, P.DATA), "bad_id")
        self.assertEqual(code_of(P.encode_frame, 1, 0), "bad_type")
        d = P.FrameDecoder()
        self.assertEqual(code_of(d.push, bytes([0, 0, 0, 1, 3, 0xFF, 0xFF, 0xFF, 0xFF])), "frame_too_large")
        self.assertEqual(code_of(d.push, P.encode_frame(1, P.PING)), "frame_too_large")

    def test_carga_util(self):
        self.assertEqual(P.decode_port(P.encode_port(4096)), 4096)
        self.assertEqual(code_of(P.encode_port, 0), "bad_payload")
        self.assertEqual(code_of(P.decode_port, b"\x00\x00"), "bad_payload")
        self.assertEqual(P.decode_window(P.encode_window(7)), 7)


class LandlockTables(unittest.TestCase):
    def test_tablas_iguales_a_las_de_typescript(self):
        ll = VECTORS["landlock"]
        self.assertEqual(ll["access"], P.LANDLOCK_ACCESS)
        self.assertEqual([list(r) for r in P.SYSTEM_RULES], ll["system_rules"])
        self.assertEqual(ll["rights"], P.LANDLOCK_RIGHTS)

    def test_sin_borrado_no_incluye_remove_ni_refer(self):
        m = P.rights_mask("rw-nodelete")
        for r in ("REMOVE_FILE", "REMOVE_DIR", "REFER", "MAKE_SYM", "EXECUTE"):
            self.assertFalse(m & (1 << P.LANDLOCK_RIGHTS.index(r)), r)
        d = P.rights_mask("rw-delete")
        for r in ("REMOVE_FILE", "REMOVE_DIR", "REFER"):
            self.assertTrue(d & (1 << P.LANDLOCK_RIGHTS.index(r)), r)

    def test_opciones_de_montaje(self):
        self.assertEqual(P.drvfs_options("rw"), "noexec,nosuid,nodev,uid=1000,gid=1000")
        self.assertEqual(P.drvfs_options("ro"), "noexec,nosuid,nodev,ro,uid=1000,gid=1000")
        self.assertEqual(code_of(P.drvfs_options, "rwx"), "init_invalid")


class ValidateInit(unittest.TestCase):
    def init(self):
        return json.loads(json.dumps(VECTORS["init"]))

    def check(self, mutate):
        i = self.init()
        mutate(i)
        return code_of(P.validate_init, json.dumps(i))

    def test_el_vector_de_typescript_es_valido(self):
        self.assertEqual(P.validate_init(json.dumps(VECTORS["init"]))["sandboxKey"], "0123456789abcdef")

    def test_rechazos(self):
        cases = {
            "clave extra": lambda i: i.update(extra=1),
            "version": lambda i: i.update(v=2),
            "sandboxKey": lambda i: i.update(sandboxKey="../etc"),
            "montaje fuera de /win": lambda i: i["mounts"][0].update(linux="/etc", win="C:\\etc"),
            "montaje con ..": lambda i: i["mounts"][0].update(linux="/win/c/a/../b", win="C:\\a\\..\\b"),
            "win incoherente": lambda i: i["mounts"][0].update(win="D:\\otra"),
            "montaje ADS": lambda i: i["mounts"][1].update(linux="/win/d/a:b", win="D:\\a:b"),
            "modo": lambda i: i["mounts"][0].update(mode="rwx"),
            "principal ro": lambda i: i["mounts"][0].update(mode="ro"),
            "cwd": lambda i: i.update(cwd="/tmp"),
            "puerto": lambda i: i.update(serverPort=0),
            "relay dup": lambda i: i.update(relayPorts=[52000, 52000]),
            "serveArgs sin serve": lambda i: i.update(serveArgs=["sh", "-c", "x"]),
            "env no permitida": lambda i: i["env"].update(LD_PRELOAD="/x.so"),
            "env XDG": lambda i: i["env"].update(XDG_DATA_HOME="/x"),
            "minAbi": lambda i: i["landlock"].update(minAbi=1),
            "regla fuera": lambda i: i["landlock"]["rules"].append({"path": "/root", "access": "private"}),
            "regla ..": lambda i: i["landlock"]["rules"].append({"path": "/win/c/lazunox/tareas/a/../../x", "access": "ro"}),
            "sistema alterado": lambda i: i["landlock"]["rules"][0].update(access="private"),
            "ro con escritura": lambda i: [r.update(access="rw-delete") for r in i["landlock"]["rules"] if r["path"] == "/win/d/Ref"],
            "borrar fuera de la principal": lambda i: i["landlock"]["rules"].append({"path": "/win/d/Ref", "access": "rw-delete"}),
        }
        for name, mutate in cases.items():
            self.assertIn(self.check(mutate), ("init_invalid", "init_secret"), name)

    def test_la_clave_real_se_rechaza(self):
        def real(i):
            i["env"]["OPENCODE_AUTH_CONTENT"] = json.dumps({"opencode-go": {"type": "api", "key": "sk-real-1234567890"}})

        self.assertEqual(self.check(real), "init_secret")

        def extra(i):
            i["env"]["OPENCODE_AUTH_CONTENT"] = json.dumps({"x": {"type": "api", "key": "sandboxed-placeholder-0123456789abcdef", "refresh": "r"}})

        self.assertEqual(self.check(extra), "init_secret")

    def test_basura(self):
        for raw in (b"", b"no json", b"[]", b"\xff\xfe", b"x" * (P.MAX_INIT_BYTES + 1)):
            self.assertEqual(code_of(P.validate_init, raw), "init_invalid")


class MuxSockets(unittest.TestCase):
    """Mux con una tubería como stdio de `wsl.exe` y sockets de 127.0.0.1 (sin privilegios)."""

    def setUp(self):
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.server_port = self.srv.getsockname()[1]
        tmp = socket.socket()
        tmp.bind(("127.0.0.1", 0))
        self.relay_port = tmp.getsockname()[1]
        tmp.close()
        self.host, agent = socket.socketpair()  # el lado "host" = wsl.exe
        # En producción stdin y stdout son fds distintos (0 y 1): aquí se duplica el del socketpair.
        self.wfd = os.dup(agent.fileno())
        self.mux = M.Mux(agent.fileno(), self.wfd, [self.relay_port], self.server_port)
        self.agent = agent
        self.mux.start()
        self.result = {}
        self.thread = threading.Thread(target=lambda: self.result.update(r=self.mux.run()), daemon=True)
        self.thread.start()
        self.dec = P.FrameDecoder()
        self.host.settimeout(3)

    def tearDown(self):
        self.host.close()
        self.thread.join(5)
        self.mux.close_all()
        self.agent.close()
        os.close(self.wfd)
        self.srv.close()

    def recv_frames(self, n):
        out = []
        while len(out) < n:
            out += self.dec.push(self.host.recv(65536))
        return out

    def test_flujo_in_hacia_el_servidor_y_vuelta(self):
        self.host.sendall(P.encode_frame(1, P.OPEN, P.encode_port(self.server_port)))
        conn, _ = self.srv.accept()
        self.host.sendall(P.encode_frame(1, P.DATA, b"ping"))
        self.assertEqual(conn.recv(10), b"ping")
        conn.sendall(b"pong")
        frames = [f for f in self.recv_frames(2)]
        self.assertIn((1, P.DATA, b"pong"), frames)  # tras el WINDOW de lo escrito
        self.assertTrue(any(f[1] == P.WINDOW for f in frames))
        conn.close()

    def test_open_a_otro_puerto_se_rechaza(self):
        self.host.sendall(P.encode_frame(1, P.OPEN, P.encode_port(self.server_port + 1 if self.server_port < 65535 else 1024)))
        f = self.recv_frames(2)
        self.assertEqual([x[1] for x in f], [P.ERROR, P.CLOSE])
        self.assertEqual(int.from_bytes(f[0][2][:2], "big"), P.ERROR_CODES["port_denied"])

    def test_flujo_out_abre_un_flujo_par_hacia_windows(self):
        c = socket.create_connection(("127.0.0.1", self.relay_port))
        (f,) = self.recv_frames(1)
        self.assertEqual((f[0] % 2, f[1], P.decode_port(f[2])), (0, P.OPEN, self.relay_port))
        c.sendall(b"CONNECT x")
        (d,) = self.recv_frames(1)
        self.assertEqual((d[1], d[2]), (P.DATA, b"CONNECT x"))
        c.close()

    def test_violaciones_cortan_la_sesion(self):
        self.host.sendall(P.encode_frame(2, P.OPEN, P.encode_port(self.server_port)))  # id par desde el host
        self.thread.join(3)
        self.assertEqual(self.result.get("r"), "bad_id")

    def test_eof_de_stdin_termina(self):
        self.host.shutdown(socket.SHUT_WR)
        self.thread.join(3)
        self.assertEqual(self.result.get("r"), "eof")


if __name__ == "__main__":
    unittest.main()
