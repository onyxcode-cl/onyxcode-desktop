"""Pruebas de la parte PURA del lanzador (sin llamadas privilegiadas): `python3 -m unittest discover resources/wsl`.

Cubre protocol.py (tramas, validación de INIT con vectores generados por el lado TypeScript) y mux.py con
`socketpair`/`pipe` y sockets de 127.0.0.1 (nunca importa launcher.py ni llama a landlock.apply_policy).
"""
import io
import json
import os
import shutil
import socket
import tarfile
import tempfile
import threading
import unittest
from unittest import mock

import launcher as L
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
        self.assertEqual(P.drvfs_options("rw"), "noexec,nosuid,nodev,case=off,uid=1000,gid=1000")
        self.assertEqual(P.drvfs_options("ro"), "noexec,nosuid,nodev,case=off,ro,uid=1000,gid=1000")
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


MOUNTINFO = r"""22 1 8:1 / / rw,relatime - ext4 /dev/sdc rw
30 22 0:25 / /proc rw,nosuid - proc proc rw
41 22 0:40 / /mnt/c rw,noatime - 9p C:\134 rw,aname=drvfs;path=C:\;uid=1000
42 22 0:41 / /mnt/d rw,noatime - drvfs D:\134 rw
43 22 0:42 / /mnt/e rw - virtiofs drvfs rw
44 22 0:43 / /mnt/f rw - fuse.drvfs F:\134 rw
45 22 0:44 / /usr/lib/wsl/drivers ro,nosuid - 9p drivers ro
46 22 0:45 / /usr/lib/wsl/lib ro - overlay none ro
47 22 0:46 / /mnt/wslg rw - tmpfs none rw
48 22 0:47 / /mnt/wslg/distro ro - virtiofs none ro
49 22 0:48 / /tmp/.X11-unix ro - virtiofs none ro
50 22 0:49 / /data/otro rw - 9p share rw
51 22 0:50 / /home/u/fusefs rw - fuse.sshfs user@host:/ rw
52 22 0:51 / /win/c/lz/a rw - 9p C:\134 rw
53 22 0:52 / /mnt/con\040espacio rw - 9p C:\134 rw
"""


class ProbeMounts(unittest.TestCase):
    def test_unidades_y_montajes_de_sistema_van_por_separado(self):
        drives, system = L.parse_mounts(MOUNTINFO)
        self.assertEqual(drives, ["/mnt/c", "/mnt/d", "/mnt/e", "/mnt/f", "/data/otro", "/mnt/con espacio"])
        self.assertEqual(system, ["/usr/lib/wsl/drivers", "/mnt/wslg/distro", "/tmp/.X11-unix"])

    def test_fuse_que_no_es_unidad_y_los_concedidos_no_cuentan(self):
        drives, system = L.parse_mounts(MOUNTINFO)
        self.assertNotIn("/home/u/fusefs", drives + system)
        self.assertNotIn("/win/c/lz/a", drives + system)

    def test_lineas_raras_no_rompen(self):
        self.assertEqual(L.parse_mounts("basura\n\n1 2 3\nx - y\n"), ([], []))

    def test_probe_trae_los_campos_nuevos(self):
        with tempfile.TemporaryDirectory() as d:
            marker = os.path.join(d, "rootfs.json")
            manifest = os.path.join(d, "MANIFEST.json")
            with open(marker, "w") as f:
                f.write('{"id": "lazunox-rootfs", "version": "2026.10.1"}')
            with open(manifest, "wb") as f:
                f.write(b"abc")
            out = io.StringIO()
            with mock.patch.object(L, "ROOTFS_MARKER", marker), mock.patch.object(L, "PAYLOAD_MANIFEST", manifest), \
                    mock.patch.object(L, "read_mounts", return_value=(["/mnt/c"], ["/mnt/wslg"])), \
                    mock.patch.object(L.landlock, "abi_version", return_value=3), mock.patch("sys.stdout", out):
                with self.assertRaises(SystemExit) as cm:
                    L.probe()
            self.assertEqual(cm.exception.code, 0)
            info = json.loads(out.getvalue())
            self.assertEqual(info["driveMounts"], ["/mnt/c"])
            self.assertEqual(info["wslSystemMounts"], ["/mnt/wslg"])
            self.assertEqual(info["rootfs"]["version"], "2026.10.1")
            self.assertEqual(info["payloadSha"], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
            self.assertEqual(info["landlockAbi"], 3)

    def test_probe_sin_marcador_ni_carga(self):
        with mock.patch.object(L, "ROOTFS_MARKER", "/nonexistent/x"), mock.patch.object(L, "PAYLOAD_MANIFEST", "/nonexistent/y"):
            self.assertIsNone(L.read_rootfs_marker())
            self.assertIsNone(L.read_payload_sha())


KEY = "0123456789abcdef"


def make_tar(members):
    """members: [(nombre, datos | None=dir | ('link', destino))]."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as t:
        for name, d in members:
            ti = tarfile.TarInfo(name)
            if d is None:
                ti.type, ti.mode = tarfile.DIRTYPE, 0o755
                t.addfile(ti)
            elif isinstance(d, tuple):
                ti.type, ti.linkname = tarfile.SYMTYPE, d[1]
                t.addfile(ti)
            else:
                ti.size, ti.mode = len(d), 0o4755  # setuid a propósito: debe perderse
                t.addfile(ti, io.BytesIO(d))
    return io.BytesIO(raw.getvalue())


class HomeCommands(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="lzhome-")
        self.addCleanup(shutil.rmtree, self.home, True)

    def seed(self):
        d = os.path.join(self.home, "xdg", KEY, "data")
        os.makedirs(d)
        with open(os.path.join(d, "a.txt"), "w") as f:
            f.write("hola")
        os.symlink("/etc/passwd", os.path.join(d, "enlace"))

    def test_exportar_e_importar_ida_y_vuelta_omitiendo_enlaces(self):
        self.seed()
        buf = io.BytesIO()
        L.export_home(buf, self.home)
        names = tarfile.open(fileobj=io.BytesIO(buf.getvalue())).getnames()
        self.assertIn("xdg/%s/data/a.txt" % KEY, names)
        self.assertFalse([n for n in names if n.endswith("enlace")])
        other = tempfile.mkdtemp(prefix="lzhome2-")
        self.addCleanup(shutil.rmtree, other, True)
        n = L.import_home(io.BytesIO(buf.getvalue()), other, chown=False)
        self.assertGreater(n, 2)
        with open(os.path.join(other, "xdg", KEY, "data", "a.txt")) as f:
            self.assertEqual(f.read(), "hola")

    def test_exportar_sin_datos_da_un_tar_vacio_valido(self):
        buf = io.BytesIO()
        L.export_home(buf, self.home)
        self.assertEqual(tarfile.open(fileobj=io.BytesIO(buf.getvalue())).getnames(), [])

    def test_importar_rechaza_fuera_de_xdg_enlaces_y_rutas_peligrosas(self):
        for members in (
            [("etc/passwd", b"x")],
            [("xdg/../evil", b"x")],
            [("/xdg/x", b"x")],
            [("xdgx/a", b"x")],
            [("xdg/a", ("link", "/etc"))],
            [("xdg", None), ("xdg/b", ("link", "../.."))],
            [("xdg/a\\b", b"x")],
        ):
            with self.assertRaises((ValueError, tarfile.TarError), msg=str(members)):
                L.import_home(make_tar(members), self.home, chown=False)
        self.assertFalse(os.path.exists(os.path.join(self.home, "etc")))
        self.assertFalse(os.path.exists(os.path.join(self.home, "evil")))

    def test_importar_quita_setuid(self):
        L.import_home(make_tar([("xdg", None), ("xdg/f", b"x")]), self.home, chown=False)
        self.assertEqual(os.stat(os.path.join(self.home, "xdg", "f")).st_mode & 0o7000, 0)

    def test_importar_no_sigue_un_xdg_que_es_enlace(self):
        os.makedirs(os.path.join(self.home, "otro"))
        os.symlink(os.path.join(self.home, "otro"), os.path.join(self.home, "xdg"))
        with self.assertRaises(ValueError):
            L.import_home(make_tar([("xdg/f", b"x")]), self.home, chown=False)
        self.assertEqual(os.listdir(os.path.join(self.home, "otro")), [])

    def test_du_y_rm(self):
        self.seed()
        self.assertEqual(L.du_key(KEY, self.home), 4)
        tmp = tempfile.mkdtemp(prefix="lztmp-")
        self.addCleanup(shutil.rmtree, tmp, True)
        os.makedirs(os.path.join(tmp, "lazunox-" + KEY))
        L.rm_key(KEY, self.home, tmp)
        self.assertFalse(os.path.exists(os.path.join(self.home, "xdg", KEY)))
        self.assertFalse(os.path.exists(os.path.join(tmp, "lazunox-" + KEY)))
        L.rm_key(KEY, self.home, tmp)  # idempotente

    def test_clave_invalida_y_enlace_no_se_siguen(self):
        for bad in ("../x", "", "0123456789ABCDEF", "0123456789abcde", KEY + "0", "a/b"):
            with self.assertRaises(ValueError):
                L.du_key(bad, self.home)
            with self.assertRaises(ValueError):
                L.rm_key(bad, self.home)
        victim = tempfile.mkdtemp(prefix="lzvictim-")
        self.addCleanup(shutil.rmtree, victim, True)
        with open(os.path.join(victim, "f"), "w") as f:
            f.write("x")
        os.makedirs(os.path.join(self.home, "xdg"))
        os.symlink(victim, os.path.join(self.home, "xdg", KEY))
        L.rm_key(KEY, self.home, victim + "-no")
        self.assertTrue(os.path.exists(os.path.join(victim, "f")))
        self.assertFalse(os.path.lexists(os.path.join(self.home, "xdg", KEY)))

    def test_subcomando_desconocido_o_sin_root(self):
        self.assertIsNone(L.subcommand([]))
        self.assertIsNone(L.subcommand(["--otra"]))
        with mock.patch("os.getuid", return_value=1000), mock.patch.object(L, "die", side_effect=SystemExit(97)):
            with self.assertRaises(SystemExit):
                L.subcommand(["--du", KEY])


if __name__ == "__main__":
    unittest.main()


class InteropConfTests(unittest.TestCase):
    """El interop de WSL cuenta como apagado SOLO si el wsl.conf lo dice (`[interop] enabled=false`): el registro binfmt es del núcleo y
    aparece aunque la distro lo tenga apagado (medido en el PC de pruebas)."""

    def conf(self, text):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        p = os.path.join(d, "wsl.conf")
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def test_el_wsl_conf_de_la_imagen_lo_apaga(self):
        here = os.path.dirname(os.path.abspath(__file__))
        self.assertFalse(L.interop_active(os.path.join(here, "wsl.conf")))

    def test_apagado_en_su_seccion(self):
        self.assertFalse(L.interop_active(self.conf("[automount]\nenabled=true\n\n[interop]\nenabled=false\nappendWindowsPath=false\n")))

    def test_espacios_comillas_y_mayusculas(self):
        self.assertFalse(L.interop_active(self.conf("[ Interop ]\n Enabled = \"False\"  # sin interop\n")))

    def test_sin_la_clave_o_encendido_cuenta_como_activo(self):
        self.assertTrue(L.interop_active(self.conf("[interop]\nappendWindowsPath=false\n")))
        self.assertTrue(L.interop_active(self.conf("[interop]\nenabled=true\n")))
        self.assertTrue(L.interop_active(self.conf("")))

    def test_enabled_false_de_OTRA_seccion_no_vale(self):
        self.assertTrue(L.interop_active(self.conf("[automount]\nenabled=false\n")))
        self.assertTrue(L.interop_active(self.conf("[boot]\nenabled=false\n")))

    def test_comentado_no_vale(self):
        self.assertTrue(L.interop_active(self.conf("[interop]\n# enabled=false\n")))

    def test_sin_wsl_conf_falla_cerrado(self):
        self.assertTrue(L.interop_active("/no/existe/wsl.conf"))

    def test_la_existencia_del_registro_binfmt_ya_no_cuenta(self):
        off = self.conf("[interop]\nenabled=false\n")
        with mock.patch("os.path.exists", return_value=True):
            self.assertFalse(L.interop_active(off))
