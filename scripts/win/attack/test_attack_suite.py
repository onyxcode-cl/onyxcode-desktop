"""Pruebas (macOS/Linux, sin Windows ni WSL) de `attack_suite.py`: partes puras, fallo cerrado de la ejecucion aislada y
«pruebas de mutacion» (se fabrica en un tmp el hueco que el ataque debe detectar y se comprueba que lo detecta).
NO ejecuta los ataques contra un sandbox: eso solo ocurre en el PC con `tasks-attack.ps1`.

    python3 -m unittest discover -s scripts/win/attack -p 'test_*.py'
"""
import json
import os
import re
import socket
import stat
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attack_suite as S  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TOKEN = "t0k3n" + "ab" * 14


def required_ids():
    src = open(os.path.join(ROOT, "src/main/tasks/tasks-win-report.ts"), encoding="utf-8").read()
    block = re.search(r"REQUIRED_ATTACK_IDS = \[(.*?)\] as const", src, re.S).group(1)
    return re.findall(r"'(A\d+b?)'", block)


def make_cfg(tmp, **over):
    main = os.path.join(tmp, "a")
    victim = os.path.join(tmp, "victima")
    os.makedirs(main + "/.lazunox/trabajo")
    os.makedirs(victim)
    with open(victim + "/x.txt", "w") as f:
        f.write(TOKEN)
    cfg = {
        "v": 1, "runId": "0123456789abcdef", "session": "normal", "main": main, "victim": victim, "victimToken": TOKEN,
        "work": main + "/.lzx-attack-0123456789abcdef", "scratch": main + "/.lazunox/trabajo", "allowDelete": False,
        "mounts": [{"linux": main, "mode": "rw"}], "unmounted": [victim], "links": {}, "evil": None,
        "payloadSha": "0" * 64, "serverPort": 49731, "relayPorts": [38917], "attackTimeoutSec": 10, "totalTimeoutSec": 60, "only": [],
    }
    cfg.update(over)
    return cfg


def win_cfg(tmp, **over):
    """Como make_cfg pero con rutas /win/... (solo para validate_cfg)."""
    cfg = make_cfg(tmp)
    cfg.update(
        main="/win/c/lzx/attack/r1/a", victim="/win/c/lzx/attack/r1/victima", work="/win/c/lzx/attack/r1/a/.lzx-attack-0123456789abcdef",
        scratch="/win/c/lzx/attack/r1/a/.lazunox/trabajo", unmounted=["/win/c/lzx/attack/r1/victima"],
        mounts=[{"linux": "/win/c/lzx/attack/r1/a", "mode": "rw"}],
    )
    cfg.update(over)
    return cfg


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="lzx-attack-test-")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)


MOUNTINFO = r"""22 1 8:1 / / rw,relatime - ext4 /dev/sdc rw
40 22 0:50 / /win/c/lzx/attack/r1/a rw,nosuid,nodev,noexec,noatime - 9p C:\134 rw,dirsync,aname=drvfs;path=C:\134;uid=1000
41 22 0:51 / /win/c/lzx/attack/r1/ro ro,nosuid,nodev,noexec,noatime - 9p C:\134 ro,dirsync,aname=drvfs;path=C:\134
42 22 0:52 / /mnt/c rw,noatime - 9p C:\134 rw,aname=drvfs
43 22 0:53 / /usr/lib/wsl/drivers ro - 9p drivers ro
44 22 0:54 / /home/x/fuse rw - fuse.sshfs u@h:/ rw
"""


class PureTests(unittest.TestCase):
    def test_ids_cubren_exactamente_los_del_informe(self):
        ids = sorted(set(i for i, _, _, _ in S.ATTACKS))
        self.assertEqual(ids, sorted(set(required_ids())))
        self.assertEqual(len(required_ids()), 22)

    def test_dry_run_tiene_el_esquema_exacto_y_nada_pasa(self):
        rows = S.dry_run()
        self.assertTrue(rows)
        keys = {"type", "id", "case", "criterion", "status", "evidence", "skipReason", "durationMs"}
        for r in rows:
            self.assertEqual(set(r), keys)
            self.assertEqual(r["status"], "skip")
            self.assertTrue(r["skipReason"])
            self.assertIn(r["criterion"], ("B", "I"))
        self.assertEqual(sorted(set(r["id"] for r in rows)), sorted(set(required_ids())))

    def test_parse_mountinfo_y_montajes_ajenos(self):
        rows = S.parse_mountinfo(MOUNTINFO)
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[1]["mnt"], "/win/c/lzx/attack/r1/a")
        self.assertEqual(rows[1]["fstype"], "9p")
        granted = ["/win/c/lzx/attack/r1/a", "/win/c/lzx/attack/r1/ro"]
        fm = S.foreign_mounts(rows, granted)
        self.assertEqual(sorted(fm), sorted(["/mnt/c(9p)", "/usr/lib/wsl/drivers(9p)", "/home/x/fuse(fuse.sshfs)"]))
        self.assertEqual(S.foreign_mounts(rows[:3], granted), [])

    def test_banderas_de_montaje(self):
        rows = S.parse_mountinfo(MOUNTINFO)
        ok = [{"linux": "/win/c/lzx/attack/r1/a", "mode": "rw"}, {"linux": "/win/c/lzx/attack/r1/ro", "mode": "ro"}]
        self.assertEqual(S.mount_flag_problems(rows, ok), [])
        self.assertTrue(S.mount_flag_problems(rows, [{"linux": "/win/c/lzx/attack/r1/a", "mode": "ro"}]))  # deberia ser ro
        self.assertTrue(S.mount_flag_problems(rows, [{"linux": "/win/c/lzx/attack/r1/ro", "mode": "rw"}]))  # es ro
        self.assertTrue(S.mount_flag_problems(rows, [{"linux": "/win/c/nada", "mode": "rw"}]))  # no esta montada
        bad = S.parse_mountinfo("40 22 0:50 / /win/c/x rw,nosuid - 9p C:\\134 rw")
        self.assertEqual(len(S.mount_flag_problems(bad, [{"linux": "/win/c/x", "mode": "rw"}])), 2)  # faltan noexec y nodev

    def test_status_y_sandbox(self):
        st = "Name:\tpython3\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nNoNewPrivs:\t1\n"
        cfg = {"main": "/win/c/lzx/attack/r1/a"}
        self.assertEqual(S.sandbox_problems(cfg, st, MOUNTINFO, 1000), [])
        self.assertTrue(S.sandbox_problems(cfg, st, MOUNTINFO, 0))
        self.assertTrue(S.sandbox_problems(cfg, st.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"), MOUNTINFO, 1000))
        self.assertTrue(S.sandbox_problems(cfg, st.replace("CapEff:\t0000000000000000", "CapEff:\t000001ffffffffff"), MOUNTINFO, 1000))
        self.assertTrue(S.sandbox_problems({"main": "/win/c/otra"}, st, MOUNTINFO, 1000))

    def test_secretos_y_centinelas(self):
        self.assertTrue(S.secrets_in("x sk-lzx-canary-0123456789abcdef0123456789abcdef y"))
        self.assertTrue(S.secrets_in("Authorization: Bearer abcdefghijklmnop12345"))
        self.assertEqual(S.secrets_in("sandboxed-placeholder-0123456789abcdef"), [])
        good = json.dumps({"opencode": {"type": "api", "key": "sandboxed-placeholder-0123456789abcdef"}})
        self.assertEqual(S.placeholder_problems(good), [])
        self.assertEqual(S.placeholder_problems("{}"), [])
        self.assertTrue(S.placeholder_problems(json.dumps({"opencode": {"type": "api", "key": "sk-real-0123456789abcdef"}})))
        self.assertTrue(S.placeholder_problems("no json"))
        self.assertTrue(S.placeholder_problems("[]"))

    def test_mayusculas(self):
        self.assertEqual(S.casefold_problems(["A.txt"], "a.txt"), [])
        self.assertTrue(S.casefold_problems(["A.txt", "a.txt"], "a.txt"))
        self.assertTrue(S.casefold_problems([], "a.txt"))

    def test_validate_cfg_rechaza_lo_raro(self):
        d = tempfile.mkdtemp()
        try:
            good = win_cfg(d)
            self.assertEqual(S.validate_cfg(dict(good))["runId"], good["runId"])
            bad_cases = [
                dict(good, main="/etc"),
                dict(good, victim="/win/c/../etc"),
                dict(good, work="/win/c/otra/work"),
                dict(good, runId="XYZ"),
                dict(good, allowDelete="no"),
                dict(good, mounts=[]),
                dict(good, mounts=[{"linux": "/win/c/otra", "mode": "rw"}]),
                dict(good, unmounted=["/etc"]),
                dict(good, v=2),
            ]
            for c in bad_cases:
                with self.assertRaises(ValueError):
                    S.validate_cfg(c)
            extra = dict(good, sorpresa=1)
            with self.assertRaises(ValueError):
                S.validate_cfg(extra)
            missing = dict(good)
            del missing["only"]
            with self.assertRaises(ValueError):
                S.validate_cfg(missing)
        finally:
            import shutil

            shutil.rmtree(d, ignore_errors=True)

    def test_read_cfg_line(self):
        a, b = socket.socketpair()
        try:
            a.sendall(b'{"x":1}\nresto')
            self.assertEqual(S.read_cfg_line(b, 2), {"x": 1})
            a.close()
            c, d = socket.socketpair()
            c.close()
            with self.assertRaises(ValueError):
                S.read_cfg_line(d, 2)
            d.close()
        finally:
            b.close()


class NormalizeTests(unittest.TestCase):
    def n(self, r):
        return S.normalize_row(r, "A1", "B", "titulo", TOKEN, 12)

    def test_normal(self):
        r = self.n(S.row("pass", "ENOENT"))
        self.assertEqual((r["id"], r["criterion"], r["status"], r["durationMs"], r["type"]), ("A1", "B", "pass", 12, "result"))

    def test_estado_invalido_es_fail(self):
        self.assertEqual(self.n({"status": "ok", "evidence": "x"})["status"], "fail")
        self.assertEqual(self.n({"status": "blocked"})["status"], "fail")
        self.assertEqual(self.n("basura")["status"], "fail")

    def test_skip_sin_motivo_es_fail(self):
        self.assertEqual(self.n(S.row("skip", "", ""))["status"], "fail")
        self.assertEqual(self.n(S.row("skip", "", "   "))["status"], "fail")
        self.assertEqual(self.n(S.row("skip", "", "motivo"))["status"], "skip")

    def test_el_token_en_la_evidencia_es_fail_y_se_redacta(self):
        r = self.n(S.row("pass", "leyo " + TOKEN))
        self.assertEqual(r["status"], "fail")
        self.assertNotIn(TOKEN, json.dumps(r))
        r = self.n(S.row("skip", "", "porque " + TOKEN))
        self.assertEqual(r["status"], "fail")
        self.assertNotIn(TOKEN, json.dumps(r))

    def test_overrides_de_fila_y_topes(self):
        r = self.n(S.row("pass", "e" * 1000, id="A3", criterion="I", case="otro"))
        self.assertEqual((r["id"], r["criterion"], r["case"], len(r["evidence"])), ("A3", "I", "otro", S.EVIDENCE_MAX))
        self.assertEqual(self.n(S.row("pass", "", criterion="Z"))["criterion"], "B")


class IsolatedTests(unittest.TestCase):
    def test_ok(self):
        rows, why = S.run_isolated(lambda c: [S.row("pass", "bien")], {}, 5)
        self.assertIsNone(why)
        self.assertEqual(rows[0]["status"], "pass")

    def test_excepcion_es_fail(self):
        def boom(c):
            raise RuntimeError("explota")

        rows, why = S.run_isolated(boom, {}, 5)
        self.assertEqual(rows[0]["status"], "fail")
        self.assertIn("RuntimeError", rows[0]["evidence"])

    def test_cuelgue_se_corta_y_no_deja_procesos(self):
        marker = os.path.join(tempfile.mkdtemp(), "pid")

        def hang(c):
            import subprocess

            p = subprocess.Popen(["/bin/sleep", "60"])
            open(marker, "w").write(str(p.pid))
            time.sleep(60)

        t = time.time()
        rows, why = S.run_isolated(hang, {}, 1)
        self.assertLess(time.time() - t, 6)
        self.assertIsNone(rows)
        self.assertIn("tiempo agotado", why)
        pid = int(open(marker).read())
        time.sleep(0.3)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)  # el hijo del hijo tambien murio (grupo de procesos)

    def test_muerte_sin_resultado(self):
        rows, why = S.run_isolated(lambda c: os._exit(0), {}, 5)
        self.assertIsNone(rows)
        self.assertIn("sin devolver", why)

    def test_resultado_enorme(self):
        rows, why = S.run_isolated(lambda c: [S.row("pass", "x" * 200000)], {}, 5)
        self.assertEqual(rows[0]["status"], "fail")


class RunAllTests(Tmp):
    def run_with(self, attacks, **over):
        saved = list(S.ATTACKS)
        S.ATTACKS[:] = attacks
        try:
            out = []
            cfg = make_cfg(self.tmp, **over)
            n = S.run_all(cfg, out.append)
            return n, out
        finally:
            S.ATTACKS[:] = saved

    def test_fallo_cerrado_en_todas_las_formas(self):
        def ok(c):
            return S.row("pass", "bien")

        def boom(c):
            raise ValueError("x")

        def leak(c):
            return S.row("pass", "lei " + TOKEN)

        def hang(c):
            time.sleep(60)

        def multi(c):
            return [S.row("pass", "a"), S.row("pass", "b", id="A3", criterion="I")]

        n, out = self.run_with(
            [("A1", "B", "ok", ok), ("A2", "B", "boom", boom), ("A3", "B", "leak", leak), ("A4", "B", "hang", hang), ("A5", "B", "multi", multi)],
            attackTimeoutSec=5,
        )
        by = {}
        for r in out:
            by.setdefault(r["id"], []).append(r["status"])
        self.assertEqual(by["A1"], ["pass"])
        self.assertEqual(by["A2"], ["fail"])
        self.assertIn("fail", by["A3"])  # el token filtrado a la evidencia
        self.assertEqual(by["A4"], ["fail"])  # colgado
        self.assertEqual(by["A5"], ["pass"])
        self.assertEqual(sorted(by["A3"]), ["fail", "pass"])  # la fila extra del ataque A5 con id A3
        self.assertEqual(n, len(out))
        self.assertNotIn(TOKEN, json.dumps(out))

    def test_only_filtra(self):
        n, out = self.run_with([("A1", "B", "a", lambda c: S.row("pass")), ("A2", "B", "b", lambda c: S.row("pass"))], only=["A2"])
        self.assertEqual([r["id"] for r in out], ["A2"])

    def test_tiempo_total_agotado_es_fail(self):
        calls = []

        def slow(c):
            time.sleep(2)
            return S.row("pass")

        saved = list(S.ATTACKS)
        S.ATTACKS[:] = [("A1", "B", "lento", slow), ("A2", "B", "no llega", lambda c: calls.append(1) or S.row("pass"))]
        try:
            out = []
            cfg = make_cfg(self.tmp, totalTimeoutSec=1, attackTimeoutSec=5)
            S.run_all(cfg, out.append)
        finally:
            S.ATTACKS[:] = saved
        a2 = [r for r in out if r["id"] == "A2"][0]
        self.assertEqual(a2["status"], "fail")
        self.assertIn("tiempo total", a2["evidence"])

    def test_sin_carpeta_de_trabajo_todo_falla(self):
        n, out = self.run_with([("A1", "B", "a", lambda c: S.row("pass"))], work="/proc/no/se/puede/crear")
        self.assertEqual(out[0]["status"], "fail")

    def test_allow_delete_limpia_el_trabajo(self):
        cfg = make_cfg(self.tmp, allowDelete=True)
        saved = list(S.ATTACKS)
        S.ATTACKS[:] = [("A1", "B", "a", lambda c: (open(c["work"] + "/f", "w").close(), S.row("pass"))[1])]
        try:
            S.run_all(cfg, lambda r: None)
        finally:
            S.ATTACKS[:] = saved
        self.assertFalse(os.path.exists(cfg["work"]))


class MutationTests(Tmp):
    """El hueco se fabrica en un tmp y el ataque tiene que verlo (si no lo viera, daria un falso verde)."""

    def test_a1_detecta_una_victima_legible(self):
        cfg = make_cfg(self.tmp)
        r = S.a1(cfg)
        self.assertEqual(r["status"], "fail")
        self.assertIn("PERMITIDO", r["evidence"])
        self.assertNotIn(TOKEN, json.dumps(S.normalize_row(r, "A1", "B", "t", TOKEN, 0)))

    def test_a1_marca_el_ls_del_padre_si_funciona(self):
        cfg = make_cfg(self.tmp)
        import shutil

        shutil.rmtree(cfg["victim"])
        cfg["unmounted"] = [cfg["victim"]]
        # /bin/ls del padre sigue funcionando en un tmp normal: el ataque lo marca (en el sandbox da EACCES)
        r = S.a1(cfg)
        self.assertEqual(r["status"], "fail")
        self.assertIn("ls del directorio padre", r["evidence"])

    def test_traverse_link_detecta_una_junction_que_atraviesa(self):
        cfg = make_cfg(self.tmp)
        os.symlink(cfg["victim"], cfg["main"] + "/j")
        bad, notes = S.traverse_link(cfg, "j", True)
        self.assertTrue(any("leyo j" in b for b in bad))
        self.assertTrue(any("x.txt" in b for b in bad))
        self.assertTrue(any("cat j" in b for b in bad))

    def test_traverse_link_pasa_con_un_enlace_roto_o_vacio(self):
        cfg = make_cfg(self.tmp)
        os.symlink(self.tmp + "/no-existe", cfg["main"] + "/j")
        bad, notes = S.traverse_link(cfg, "j", True)
        self.assertEqual(bad, [])
        os.makedirs(cfg["main"] + "/vacio")
        bad, notes = S.traverse_link(cfg, "vacio", True)
        self.assertEqual(bad, [])

    def test_traverse_link_archivo(self):
        cfg = make_cfg(self.tmp)
        os.symlink(cfg["victim"] + "/x.txt", cfg["main"] + "/f.txt")
        bad, _ = S.traverse_link(cfg, "f.txt", False)
        self.assertTrue(bad)

    def test_a2_y_a3_sin_enlaces_son_skip_con_motivo(self):
        cfg = make_cfg(self.tmp, links={"junctionNote": "sin privilegios", "symNote": "sin Modo de desarrollador", "hardNote": "otro volumen"})
        self.assertEqual((S.a2(cfg)["status"], S.a2(cfg)["skipReason"]), ("skip", "el anfitrion no pudo crear la junction: sin privilegios"))
        rows = S.a3(cfg)
        self.assertEqual([r["status"] for r in rows], ["skip", "skip"])
        self.assertEqual(rows[1]["criterion"], "I")
        self.assertIn("Modo de desarrollador", rows[0]["skipReason"])

    def test_a3_hardlink_informativo(self):
        cfg = make_cfg(self.tmp, links={"hard": "h.txt"})
        os.link(cfg["victim"] + "/x.txt", cfg["main"] + "/h.txt")
        rows = S.a3(cfg)
        self.assertEqual(rows[-1]["criterion"], "I")
        self.assertIn("se lee", rows[-1]["evidence"])
        self.assertNotIn(TOKEN, rows[-1]["evidence"])

    def test_a4_detecta_symlinks_que_se_crean(self):
        cfg = make_cfg(self.tmp)
        r = S.a4(cfg)  # en un tmp normal ln -s funciona: es el hueco
        self.assertEqual(r["status"], "fail")
        self.assertIn("CREADO", r["evidence"])

    def test_a8_detecta_un_ejecutable_que_corre(self):
        cfg = make_cfg(self.tmp, evil="evil.exe")
        p = cfg["main"] + "/evil.exe"
        with open(p, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(p, 0o755)
        r = S.a8(cfg)
        self.assertEqual(r["status"], "fail")
        self.assertIn("SE EJECUTO", r["evidence"])

    def test_a8_sin_ejecutable_es_skip(self):
        self.assertEqual(S.a8(make_cfg(self.tmp))["status"], "skip")

    def test_a13_detecta_borrado_sin_allowdelete(self):
        cfg = make_cfg(self.tmp)
        rows = S.a13(cfg)
        self.assertEqual(rows[0]["status"], "fail")
        self.assertIn("PERMITIDO", rows[0]["evidence"])
        self.assertEqual(rows[1]["criterion"], "I")

    def test_a13_con_allowdelete_exige_que_borre(self):
        cfg = make_cfg(self.tmp, allowDelete=True)
        rows = S.a13(cfg)
        self.assertEqual(rows[0]["status"], "pass")

    def test_a5_no_hay_falso_positivo_en_un_tmp_vacio(self):
        r = S.a5(make_cfg(self.tmp))
        self.assertEqual(r["status"], "pass")

    def test_a17_a18_a19_a11_a14_son_skip_con_motivo(self):
        cfg = make_cfg(self.tmp)
        for fn in (S.a11, S.a14, S.a17, S.a18, S.a19):
            r = fn(cfg)
            self.assertEqual(r["status"], "skip")
            self.assertTrue(r["skipReason"])


if __name__ == "__main__":
    unittest.main()
