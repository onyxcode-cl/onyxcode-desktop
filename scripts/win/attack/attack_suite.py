#!/usr/bin/python3
"""Suite de ataques A1-A20 de Tareas en Windows, para correr DENTRO del sandbox ya lanzado por `launcher.py`.

Es el banco de pruebas DEFENSIVO de NUESTRO sandbox: cada «ataque» corre dentro de una distro de prueba desechable
(`Lazunox-Attack`) contra nuestras barreras (Landlock, red apagada, carpetas aprobadas, sin SUID, case=off, sin escape
por rutas). No ataca a terceros ni sale a la red. Solo biblioteca estandar (corre con Python 3.9+).

Como llega aqui: `tasks-attack.ps1` instala un paquete LZPK1 con el flujo real (`lazunox-install`) cuyo `bin/opencode`
es un SHIM de 4 lineas que llama a `serve()`; el lanzador lo arranca como `lazunox` (sin capacidades, NO_NEW_PRIVS,
Landlock, red vacia), igual que al servidor de verdad. `serve()` escucha en el puerto del servidor (127.0.0.1 DENTRO del
espacio de nombres); `attack-tool.mjs` abre un flujo por el puente real, envia una linea JSON de configuracion y recibe
una linea JSON por resultado:

    {"type":"result","id":"A7","case":"...","criterion":"B","status":"pass|fail|skip","evidence":"...",
     "skipReason":"","durationMs":120}
    {"type":"done","count":N}

Reglas de diseno (siempre la lectura mas estricta):
  - FALLA CERRADO: un ataque que lanza una excepcion, se cuelga, muere sin resultado o no se pudo ejecutar es `fail`,
    nunca `pass`; un id que no corrio por el tiempo total tambien es `fail`; fuera del sandbox real (uid, NO_NEW_PRIVS,
    carpeta principal montada) todos son `fail`;
  - cada ataque corre en un proceso hijo propio (fork) con tiempo maximo duro y grupo de procesos propio que se mata al
    terminar: no quedan procesos; cada subprocess lleva su propio tiempo maximo;
  - solo se escribe dentro de la carpeta aprobada (`<principal>/.lzx-attack-<run>/`), de la carpeta privada de la tarea
    (`$TMPDIR`, `$HOME`) y, donde el ataque lo exige, de las carpetas adicionales concedidas; el anfitrion borra todo;
  - el token del testigo (`victimToken`) NUNCA puede aparecer en la evidencia: si aparece, el resultado es `fail`;
  - un criterio que esta suite no puede medir desde dentro se emite como `skip` con el motivo (no cuenta como verde).
"""
import ctypes
import errno
import hashlib
import json
import os
import posixpath
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time

SUITE_VERSION = 1
EVIDENCE_MAX = 400
CFG_MAX_BYTES = 64 * 1024
SUBPROCESS_TIMEOUT = 8
ATTACK_TIMEOUT_DEFAULT = 30
TOTAL_TIMEOUT_DEFAULT = 600
RESULT_MAX_BYTES = 64 * 1024
STATUSES = ("pass", "fail", "skip")

# Errores que cuentan como «el nucleo lo nego» (o «no existe»). Cualquier otro error es inesperado: no se da por bueno.
DENY_READ = frozenset([errno.ENOENT, errno.EACCES, errno.EPERM, errno.ENOTDIR, errno.ELOOP])
DENY_WRITE = DENY_READ | frozenset([errno.EROFS, errno.EXDEV])
DENY_LINK = frozenset([errno.EACCES, errno.EPERM])

MINENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
SECRET_RE = re.compile(r"(?:sk-[A-Za-z0-9_\-]{12,}|Bearer\s+[A-Za-z0-9._\-]{12,})")
PLACEHOLDER_RE = re.compile(r"^sandboxed-placeholder-[0-9a-f]{16}$")
RESERVED_NAMES = ("CON", "nul.txt", "aux.md", "fin.", "fin ", "PROGRA~1")


# ───────────────────────── Utilidades puras (se prueban en macOS) ─────────────────────────


def ename(n):
    return errno.errorcode.get(n, str(n)) if isinstance(n, int) else str(n)


class Res(object):
    """Resultado de un intento: `ok` (no hubo error) o `err` (errno)."""

    def __init__(self, ok, value=None, err=None):
        self.ok = ok
        self.value = value
        self.err = err


def attempt(fn, *args):
    try:
        return Res(True, fn(*args))
    except OSError as e:
        return Res(False, err=e.errno if e.errno is not None else -1)


def denied(res, allowed):
    """True solo si fallo con un errno de la lista cerrada `allowed`."""
    return (not res.ok) and res.err in allowed


def read_file(path, limit=65536):
    with open(path, "rb") as f:
        return f.read(limit)


def row(status, evidence="", skip_reason="", **extra):
    r = {"status": status, "evidence": evidence, "skipReason": skip_reason}
    r.update(extra)
    return r


def finish(bad, notes):
    """`bad` vacio = pass; si no, fail con los fallos primero."""
    if bad:
        return row("fail", "FALLA: " + "; ".join(bad) + (" | " + "; ".join(notes) if notes else ""))
    return row("pass", "; ".join(notes))


def unescape_mnt(field):
    return re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), field)


def parse_mountinfo(text):
    """Lista de dicts {mnt, opts, fstype, source, sopts} a partir de /proc/self/mountinfo (formato proc(5))."""
    out = []
    for line in text.splitlines():
        head, sep, tail = line.partition(" - ")
        f = head.split(" ")
        t = tail.split(" ")
        if not sep or len(f) < 6 or len(t) < 3:
            continue
        out.append(
            {
                "mnt": unescape_mnt(f[4]),
                "opts": f[5].split(","),
                "fstype": t[0],
                "source": unescape_mnt(t[1]),
                "sopts": t[2],
            }
        )
    return out


NET_FS = ("9p", "drvfs", "virtiofs")
WSL_SYSTEM_MNT = ("/usr/lib/wsl", "/mnt/wslg", "/tmp/.X11-unix", "/mnt/c", "/mnt/wsl")


def foreign_mounts(rows, granted):
    """Montajes de red/FUSE o de sistema de WSL que NO son una carpeta concedida (lista vacia = bien)."""
    granted = set(granted)
    bad = []
    for m in rows:
        mnt, fs = m["mnt"], m["fstype"]
        if mnt in granted:
            continue
        is_net = fs in NET_FS or fs.startswith("fuse")
        is_wsl = any(mnt == p or mnt.startswith(p + "/") for p in WSL_SYSTEM_MNT) or mnt.startswith("/mnt/")
        if is_net or is_wsl:
            bad.append("%s(%s)" % (mnt, fs))
    return bad


def mount_flag_problems(rows, mounts):
    """Cada carpeta concedida debe estar montada con noexec,nosuid,nodev y `ro` si es de solo lectura."""
    by = {}
    for m in rows:
        by[m["mnt"]] = m
    bad = []
    for mt in mounts:
        m = by.get(mt["linux"])
        if m is None:
            bad.append("%s: no esta montada" % mt["linux"])
            continue
        for flag in ("noexec", "nosuid", "nodev"):
            if flag not in m["opts"]:
                bad.append("%s: falta %s" % (mt["linux"], flag))
        want_ro = mt["mode"] == "ro"
        if want_ro and "ro" not in m["opts"]:
            bad.append("%s: deberia ser ro" % mt["linux"])
        if not want_ro and "ro" in m["opts"]:
            bad.append("%s: es ro y deberia ser rw" % mt["linux"])
    return bad


def parse_status(text):
    """Campos `Clave:\\tvalor` de /proc/self/status."""
    out = {}
    for line in text.splitlines():
        k, sep, v = line.partition(":")
        if sep:
            out[k.strip()] = v.strip()
    return out


def secrets_in(text):
    """Cadenas con forma de clave de proveedor o `Bearer` (los centinelas `sandboxed-placeholder-*` no cuentan)."""
    return [m.group(0)[:6] + "..." for m in SECRET_RE.finditer(text)]


def placeholder_problems(auth_content):
    """OPENCODE_AUTH_CONTENT solo puede ser `{}` o entradas {type:'api', key:<centinela>}."""
    try:
        parsed = json.loads(auth_content)
    except ValueError:
        return ["OPENCODE_AUTH_CONTENT no es JSON"]
    if not isinstance(parsed, dict):
        return ["OPENCODE_AUTH_CONTENT no es un objeto"]
    bad = []
    for name, e in parsed.items():
        if not isinstance(e, dict) or e.get("type") != "api" or not isinstance(e.get("key"), str) or not PLACEHOLDER_RE.match(e["key"]):
            bad.append("la entrada %r no es un centinela" % name)
    return bad


def casefold_problems(names, expect_one):
    """Con case=off, `A.txt` y `a.txt` son la misma entrada: `names` (listdir) debe traer exactamente una."""
    same = [n for n in names if n.lower() == expect_one.lower()]
    return [] if len(same) == 1 else ["dos entradas que difieren solo en mayusculas: %r" % (same,)]


# ───────────────────────── Contexto y ejecucion aislada ─────────────────────────


REQUIRED_CFG = (
    "v", "runId", "session", "main", "victim", "victimToken", "work", "scratch", "allowDelete", "mounts", "unmounted",
    "links", "evil", "payloadSha", "serverPort", "relayPorts", "attackTimeoutSec", "totalTimeoutSec", "only",
)


def validate_cfg(cfg):
    """Configuracion que envia el anfitrion (NUESTRO arnes, pero igual se valida: falla cerrado)."""
    if not isinstance(cfg, dict):
        raise ValueError("la configuracion no es un objeto")
    miss = [k for k in REQUIRED_CFG if k not in cfg]
    extra = [k for k in cfg if k not in REQUIRED_CFG]
    if miss or extra:
        raise ValueError("claves: faltan %s, sobran %s" % (miss, extra))
    if cfg["v"] != SUITE_VERSION:
        raise ValueError("version de configuracion")
    if not re.match(r"^[0-9a-f]{8,32}$", str(cfg["runId"])):
        raise ValueError("runId")
    for k in ("main", "victim", "work", "scratch"):
        v = cfg[k]
        if not isinstance(v, str) or not v.startswith("/win/") or ".." in v.split("/") or "\x00" in v:
            raise ValueError("ruta invalida: %s" % k)
    if not cfg["work"].startswith(cfg["main"] + "/"):
        raise ValueError("work debe estar dentro de la carpeta principal")
    if not cfg["scratch"].startswith(cfg["main"] + "/"):
        raise ValueError("scratch debe estar dentro de la carpeta principal")
    if not isinstance(cfg["mounts"], list) or not cfg["mounts"]:
        raise ValueError("mounts")
    for m in cfg["mounts"]:
        if not isinstance(m, dict) or m.get("mode") not in ("rw", "ro") or not str(m.get("linux", "")).startswith("/win/"):
            raise ValueError("mount invalido")
    if cfg["mounts"][0]["linux"] != cfg["main"]:
        raise ValueError("el primer montaje es la carpeta principal")
    if not isinstance(cfg["unmounted"], list) or not all(isinstance(p, str) and p.startswith("/win/") for p in cfg["unmounted"]):
        raise ValueError("unmounted")
    if not isinstance(cfg["links"], dict):
        raise ValueError("links")
    if not isinstance(cfg["only"], list) or not all(isinstance(i, str) for i in cfg["only"]):
        raise ValueError("only")
    if not isinstance(cfg["allowDelete"], bool):
        raise ValueError("allowDelete")
    return cfg


def sandbox_problems(cfg, proc_status, mountinfo_text, uid):
    """El suite solo vale dentro del sandbox real: uid 1000, sin capacidades, NO_NEW_PRIVS y la carpeta montada."""
    bad = []
    if uid != 1000:
        bad.append("uid %s (se esperaba 1000)" % uid)
    st = parse_status(proc_status)
    if st.get("NoNewPrivs") != "1":
        bad.append("NoNewPrivs != 1")
    for k in ("CapEff", "CapPrm"):
        if st.get(k, "x").strip("0") != "":
            bad.append("%s != 0" % k)
    mnts = [m["mnt"] for m in parse_mountinfo(mountinfo_text)]
    if cfg["main"] not in mnts:
        bad.append("la carpeta principal no esta montada")
    return bad


def _write_all(fd, data):
    while data:
        n = os.write(fd, data)
        data = data[n:]


def run_isolated(fn, cfg, timeout):
    """Corre `fn(cfg)` en un hijo con grupo de procesos propio y tiempo duro. Devuelve (filas | None, motivo_del_fallo)."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        code = 70
        try:
            os.setsid()
            os.close(r)
            try:
                rows = fn(cfg)
                payload = json.dumps(rows if isinstance(rows, list) else [rows]).encode("utf-8")
                if len(payload) > RESULT_MAX_BYTES:
                    payload = json.dumps([row("fail", "resultado demasiado grande")]).encode("utf-8")
            except BaseException as e:  # noqa: BLE001 - falla cerrado: cualquier excepcion es un fallo del ataque
                payload = json.dumps([row("fail", "excepcion: %s: %s" % (type(e).__name__, str(e)[:200]))]).encode("utf-8")
            _write_all(w, payload)
            code = 0
        finally:
            os._exit(code)
    os.close(w)
    chunks = []
    reason = None
    deadline = time.time() + timeout
    try:
        while True:
            left = deadline - time.time()
            if left <= 0:
                reason = "tiempo agotado (%d s)" % timeout
                break
            ready, _, _ = select.select([r], [], [], min(left, 0.5))
            if ready:
                b = os.read(r, 65536)
                if not b:
                    break
                chunks.append(b)
                if sum(len(c) for c in chunks) > RESULT_MAX_BYTES * 2:
                    reason = "resultado demasiado grande"
                    break
    finally:
        try:
            os.killpg(pid, signal.SIGKILL)  # nada queda vivo: ni el hijo ni lo que lanzo
        except (ProcessLookupError, PermissionError):
            pass
        os.close(r)
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    if reason:
        return None, reason
    try:
        rows = json.loads(b"".join(chunks).decode("utf-8"))
        if not isinstance(rows, list) or not rows:
            raise ValueError("vacio")
        return rows, None
    except ValueError:
        return None, "el ataque termino sin devolver un resultado valido"


def normalize_row(r, aid, criterion, title, token, duration_ms):
    """Fila definitiva con el esquema del informe. Estados raros -> fail; el token en la evidencia -> fail."""
    if not isinstance(r, dict):
        r = row("fail", "fila invalida")
    status = r.get("status")
    evidence = str(r.get("evidence", ""))
    skip_reason = str(r.get("skipReason", ""))
    if status not in STATUSES:
        status, evidence = "fail", "estado invalido (%r): %s" % (status, evidence)
    if status == "skip" and not skip_reason.strip():
        status, evidence = "fail", "skip sin motivo: " + evidence
    if token and (token in evidence or token in skip_reason):
        status, evidence, skip_reason = "fail", "el token del testigo aparecio en la evidencia (redactado)", ""
    crit = r.get("criterion", criterion)
    return {
        "type": "result",
        "id": str(r.get("id", aid)),
        "case": str(r.get("case", title))[:200],
        "criterion": crit if crit in ("B", "I") else "B",
        "status": status,
        "evidence": evidence[:EVIDENCE_MAX],
        "skipReason": skip_reason[:EVIDENCE_MAX],
        "durationMs": int(duration_ms),
    }


# ───────────────────────── Registro de ataques ─────────────────────────

ATTACKS = []  # (id, criterio, titulo, funcion)


def attack(aid, title, criterion="B"):
    def deco(fn):
        ATTACKS.append((aid, criterion, title, fn))
        return fn

    return deco


def sh(argv, cwd=None, timeout=SUBPROCESS_TIMEOUT, stdin_data=b""):
    """Lanza un programa (sin shell) con tiempo maximo. (rc, salida) o (None, 'timeout') / (-1, 'ERRNO')."""
    try:
        p = subprocess.run(argv, cwd=cwd, input=stdin_data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, env=MINENV)
        return p.returncode, p.stdout[:4096].decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return None, "timeout"
    except OSError as e:
        return -1, ename(e.errno)


def libc():
    return ctypes.CDLL(None, use_errno=True)


def tmpdir():
    return os.environ.get("TMPDIR") or ""


def first_leak(token, *texts):
    return any(token in t for t in texts if isinstance(t, str))


def check_denied(bad, notes, name, res, allowed=DENY_READ, token=None):
    if res.ok:
        leaked = token is not None and isinstance(res.value, (bytes, bytearray)) and token.encode() in bytes(res.value)
        bad.append("%s: PERMITIDO%s" % (name, " y filtro el token" if leaked else ""))
    elif res.err not in allowed:
        bad.append("%s: error inesperado %s" % (name, ename(res.err)))
    else:
        notes.append("%s=%s" % (name, ename(res.err)))


def kind_of(path):
    st = attempt(os.lstat, path)
    if not st.ok:
        return "ausente(%s)" % ename(st.err)
    m = st.value.st_mode
    return "symlink" if stat.S_ISLNK(m) else "dir" if stat.S_ISDIR(m) else "archivo" if stat.S_ISREG(m) else "otro"


def traverse_link(cfg, link, is_dir):
    """Intenta leer la victima a traves de un enlace NTFS que el anfitrion dejo en la carpeta principal."""
    token = cfg["victimToken"]
    p = cfg["main"] + "/" + link
    bad, notes = [], ["%s es %s" % (link, kind_of(p))]
    target = p + "/x.txt" if is_dir else p
    r = attempt(read_file, target)
    if r.ok:
        bad.append("leyo %s a traves del enlace (%d bytes%s)" % (link, len(r.value), ", con el token" if token.encode() in r.value else ""))
    else:
        notes.append("lectura=%s" % ename(r.err))
    if is_dir:
        ls = attempt(os.listdir, p)
        if ls.ok and "x.txt" in ls.value:
            bad.append("listdir(%s) muestra x.txt de la victima" % link)
        else:
            notes.append("listdir=%s" % (ename(ls.err) if not ls.ok else "sin x.txt"))
    rc, out = sh(["/bin/cat", target])
    if rc == 0 or token in out:
        bad.append("cat %s funciono (rc=%s)" % (link, rc))
    return bad, notes


@attack("A1", "lectura fuera de la carpeta: ../victima, listado del padre, /win/c y /mnt/c")
def a1(cfg):
    token, main, victim = cfg["victimToken"], cfg["main"], cfg["victim"]
    run_dir = posixpath.dirname(main)
    vname = posixpath.basename(victim)
    bad, notes = [], []
    check_denied(bad, notes, "open victima/x.txt", attempt(read_file, victim + "/x.txt"), token=token)
    check_denied(bad, notes, "open ../victima/x.txt", attempt(read_file, main + "/../" + vname + "/x.txt"), token=token)
    for d in (run_dir, "/win/c", "/win", "/mnt/c", "/mnt"):
        check_denied(bad, notes, "listdir %s" % d, attempt(os.listdir, d))
    rc, out = sh(["/bin/cat", "../" + vname + "/x.txt"], cwd=main)
    if rc == 0 or token in out:
        bad.append("cat ../victima/x.txt: rc=%s" % rc)
    else:
        notes.append("cat ../victima rc=%s" % rc)
    rc, out = sh(["/bin/ls", run_dir])
    if rc == 0 or vname in out:
        bad.append("ls del directorio padre funciono")
    return finish(bad, notes)


@attack("A2", "junction NTFS hacia la victima (readlink, cat j/x.txt, ls j)")
def a2(cfg):
    link = cfg["links"].get("junction")
    if not link:
        return row("skip", "", "el anfitrion no pudo crear la junction: %s" % cfg["links"].get("junctionNote", "sin motivo"))
    bad, notes = traverse_link(cfg, link, True)
    rl = attempt(os.readlink, cfg["main"] + "/" + link)
    notes.append("readlink=%s" % (("ok:" + str(rl.value)[:60]) if rl.ok else ename(rl.err)))
    return finish(bad, notes)


@attack("A3", "symlink NTFS a directorio y a archivo (requiere privilegio o Modo de desarrollador)")
def a3(cfg):
    rows = []
    bad, notes, tested = [], [], 0
    for key, is_dir in (("symDir", True), ("symFile", False)):
        link = cfg["links"].get(key)
        if link:
            tested += 1
            b, n = traverse_link(cfg, link, is_dir)
            bad += b
            notes += n
    if tested == 0:
        rows.append(row("skip", "", "el anfitrion no pudo crear symlinks NTFS: %s" % cfg["links"].get("symNote", "sin motivo")))
    else:
        rows.append(finish(bad, notes))
    hard = cfg["links"].get("hard")
    if hard:
        r = attempt(read_file, cfg["main"] + "/" + hard)
        readable = r.ok and cfg["victimToken"].encode() in r.value
        rows.append(row("pass", "hardlink %s: %s (por diseno igual que en macOS)" % (hard, "se lee" if readable else "no se lee ahora: %s" % (ename(r.err) if not r.ok else "otro contenido")), id="A3", criterion="I", case="hardlink a la victima (informativo)"))
    else:
        rows.append(row("skip", "", "sin hardlink: %s" % cfg["links"].get("hardNote", "sin motivo"), id="A3", criterion="I", case="hardlink a la victima (informativo)"))
    return rows


@attack("A4", "ln -s hacia la victima: sin MAKE_SYM debe dar EACCES y no crear nada")
def a4(cfg):
    main, victim, work = cfg["main"], cfg["victim"], cfg["work"]
    os.makedirs(work + "/A4", exist_ok=True)
    bad, notes = [], []
    for base, label in ((main, "principal"), (work + "/A4", "subcarpeta")):
        for name, target in (("l", victim + "/x.txt"), ("l2", "../" + posixpath.basename(victim))):
            p = base + "/lzx-" + name
            r = attempt(os.symlink, target, p)
            if r.ok:
                bad.append("symlink %s/%s CREADO" % (label, name))
            elif r.err not in DENY_LINK:
                bad.append("symlink %s/%s: error inesperado %s" % (label, name, ename(r.err)))
            else:
                notes.append("symlink %s/%s=%s" % (label, name, ename(r.err)))
            if attempt(os.lstat, p).ok:
                bad.append("quedo un enlace en %s" % p)
    rc, out = sh(["/bin/ln", "-s", victim + "/x.txt", work + "/A4/lzx-l3"])
    if rc == 0:
        bad.append("ln -s funciono")
    else:
        notes.append("ln -s rc=%s" % rc)
    r = attempt(os.symlink, "x", cfg["scratch"] + "/lzx-l4")
    if r.ok or r.err not in DENY_LINK:
        bad.append("symlink en el scratch: %s" % ("CREADO" if r.ok else ename(r.err)))
    return finish(bad, notes)


@attack("A5", "UNC, \\\\?\\, \\\\.\\, \\\\wsl.localhost y // como rutas Linux (lado main: bateria de macOS; SMB: anfitrion)")
def a5(cfg):
    bad, notes = [], []
    vectors = [
        "//192.0.2.1/share/x.txt",
        "//srv/x",
        "/win/c/Windows/win.ini",
        "/mnt/wsl",
        "/mnt/c/Windows/win.ini",
        "\\\\?\\C:\\Windows\\win.ini",
        "\\\\.\\pipe\\x",
        "\\\\wsl.localhost\\Lazunox-Tareas\\etc\\shadow",
        "C:\\Windows\\win.ini",
    ]
    for v in vectors:
        check_denied(bad, notes, "open %s" % v[:30], attempt(read_file, v))
    return finish(bad, notes)


@attack("A6", "flujo NTFS alterno: echo x > 'a.txt:oculto'")
def a6(cfg):
    d = cfg["work"] + "/A6"
    os.makedirs(d, exist_ok=True)
    with open(d + "/a.txt", "wb") as f:
        f.write(b"x")
    bad, notes = [], []
    r = attempt(lambda: os.close(os.open(d + "/a.txt:oculto", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)))
    names = sorted(os.listdir(d))
    if r.ok:
        extra = [n for n in names if n != "a.txt"]
        notes.append("creado como entrada aparte: %r" % [n.encode("unicode_escape").decode() for n in extra])
        if not extra:
            bad.append("se creo pero no hay entrada distinta de a.txt (posible ADS)")
        if os.path.getsize(d + "/a.txt") != 1:
            bad.append("a.txt cambio de tamano")
    else:
        notes.append("creacion=%s" % ename(r.err))
    return finish(bad, notes + ["(PowerShell: Get-Item a.txt -Stream * no debe mostrar flujos)"])


@attack("A6b", "nombres reservados, 8.3, punto y espacio final (se registra que crea drvfs)", "I")
def a6b(cfg):
    d = cfg["work"] + "/A6b"
    os.makedirs(d, exist_ok=True)
    out = []
    for n in RESERVED_NAMES:
        r = attempt(lambda: os.close(os.open(d + "/" + n, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)))
        out.append("%r=%s" % (n, "creado" if r.ok else ename(r.err)))
    return row("pass", "; ".join(out) + " | el anfitrion limpia con \\\\?\\ y reporta lo que no se pueda borrar")


@attack("A7", "montajes visibles: /win/c/Users, /mnt/c, /proc/mounts, mount drvfs y --bind como lazunox")
def a7(cfg):
    bad, notes = [], []
    for p in ("/win/c/Users", "/win/c/Windows", "/mnt/c", "/mnt/c/Users", "/mnt/wslg", "/usr/lib/wsl"):
        check_denied(bad, notes, "listdir %s" % p, attempt(os.listdir, p))
    with open("/proc/self/mountinfo") as f:
        rows = parse_mountinfo(f.read())
    granted = [m["linux"] for m in cfg["mounts"]]
    fm = foreign_mounts(rows, granted)
    if fm:
        bad.append("montajes ajenos visibles: %s" % ", ".join(fm[:6]))
    notes.append("%d montajes, %d concedidos" % (len(rows), len(granted)))
    found = []
    for root in ("/win", "/mnt", "/home"):
        for dp, dns, fns in os.walk(root, onerror=lambda e: None):
            for n in dns + fns:
                if n == "Login Data" or ".ssh" in n:
                    found.append(os.path.join(dp, n))
            if len(found) > 5:
                break
    if found:
        bad.append("secretos tipicos visibles: %s" % found[:3])
    lc = libc()
    tmp = tmpdir()
    if not tmp:
        bad.append("sin TMPDIR para probar mount")
    else:
        tgt = tmp + "/mnt-a7"
        os.makedirs(tgt, exist_ok=True)
        for label, src, fstype, flags in (("drvfs", b"C:\\", b"drvfs", 0), ("bind", tgt.encode(), None, 4096), ("tmpfs", b"tmpfs", b"tmpfs", 0)):
            ctypes.set_errno(0)
            rc = lc.mount(src, tgt.encode(), fstype, ctypes.c_ulong(flags), None)
            en = ctypes.get_errno()
            if rc == 0:
                bad.append("mount %s FUNCIONO" % label)
                lc.umount2(tgt.encode(), 2)
            elif en not in (errno.EPERM, errno.EACCES):
                bad.append("mount %s: error inesperado %s" % (label, ename(en)))
            else:
                notes.append("mount %s=%s" % (label, ename(en)))
    return finish(bad, notes + ["(anfitrion: findmnt fuera no debe mostrar drvfs/9p con C:\\)"])


@attack("A7b", "solo lo concedido es visible; una carpeta ro no se escribe (EROFS/EACCES)")
def a7b(cfg):
    bad, notes = [], []
    for m in cfg["mounts"]:
        ls = attempt(os.listdir, m["linux"])
        if not ls.ok:
            bad.append("la carpeta concedida %s no se puede listar: %s" % (m["linux"], ename(ls.err)))
            continue
        probe = m["linux"] + "/lzx-a7b-" + cfg["runId"]
        if m["mode"] == "ro":
            r = attempt(lambda: os.close(os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)))
            if r.ok:
                bad.append("%s es ro y se pudo escribir" % m["linux"])
                attempt(os.unlink, probe)
            elif r.err not in (errno.EROFS, errno.EACCES, errno.EPERM):
                bad.append("%s ro: error inesperado %s" % (m["linux"], ename(r.err)))
            else:
                notes.append("ro %s=%s" % (posixpath.basename(m["linux"]), ename(r.err)))
        else:
            notes.append("rw %s listada" % posixpath.basename(m["linux"]))
    for p in cfg["unmounted"]:
        check_denied(bad, notes, "no concedida %s" % posixpath.basename(p), attempt(os.listdir, p))
    return finish(bad, notes)


@attack("A8", "ejecutar evil.exe, cmd.exe, powershell.exe, /init y el interop de WSL")
def a8(cfg):
    bad, notes = [], []
    evil = cfg["evil"]
    if not evil:
        return row("skip", "", "el anfitrion no dejo un ejecutable de Windows inocuo en la carpeta")
    try:
        p = subprocess.Popen([cfg["main"] + "/" + evil], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=MINENV)
        try:
            p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        bad.append("evil.exe SE EJECUTO (pid %d, rc=%s)" % (p.pid, p.poll()))
        p.kill()
    except OSError as e:
        if e.errno not in (errno.EACCES, errno.ENOEXEC, errno.ENOENT, errno.EPERM):
            bad.append("evil.exe: error inesperado %s" % ename(e.errno))
        else:
            notes.append("evil.exe=%s" % ename(e.errno))
    rc, out = sh(["/bin/sh", "-c", './"$1"', "sh", evil], cwd=cfg["main"])
    if rc == 0:
        bad.append("sh -c ./evil.exe devolvio 0")
    else:
        notes.append("sh ./evil rc=%s" % rc)
    for exe in ("/mnt/c/Windows/System32/cmd.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", "/init", "/run/WSL/1_interop"):
        try:
            subprocess.Popen([exe], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=MINENV).kill()
            bad.append("%s SE EJECUTO" % exe)
        except OSError as e:
            if e.errno not in (errno.EACCES, errno.ENOENT, errno.EPERM, errno.ENOEXEC, errno.ENOTDIR):
                bad.append("%s: error inesperado %s" % (exe, ename(e.errno)))
            else:
                notes.append("%s=%s" % (posixpath.basename(exe), ename(e.errno)))
    for name in ("cmd.exe", "powershell.exe"):
        for d in MINENV["PATH"].split(":"):
            if os.path.exists(d + "/" + name):
                bad.append("%s esta en el PATH (%s)" % (name, d))
    if os.environ.get("WSL_INTEROP"):
        bad.append("WSL_INTEROP definido")
    for p in ("/proc/sys/fs/binfmt_misc/WSLInterop", "/proc/sys/fs/binfmt_misc/WSLInterop-late"):
        r = attempt(os.stat, p)
        if r.ok:
            bad.append("existe %s" % p)
        elif r.err not in DENY_READ:
            bad.append("%s: error inesperado %s" % (p, ename(r.err)))
    return finish(bad, notes + ["(anfitrion: sin proceso nuevo de Windows ni evil.exe en marcha)"])


@attack("A9", "la clave del proveedor no se ve dentro (entorno, /proc, ps, auth.json)")
def a9(cfg):
    bad, notes = [], []
    env = dict(os.environ)
    auth = env.get("OPENCODE_AUTH_CONTENT")
    if auth is not None:
        bad += placeholder_problems(auth)
        notes.append("OPENCODE_AUTH_CONTENT solo con centinelas" if not bad else "OPENCODE_AUTH_CONTENT dudoso")
    for k, v in env.items():
        s = secrets_in(v)
        if s:
            bad.append("entorno %s con forma de clave %s" % (k, s[:1]))
    seen = 0
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        for leaf in ("environ", "cmdline"):
            r = attempt(read_file, "/proc/%s/%s" % (pid, leaf))
            if r.ok:
                seen += 1
                s = secrets_in(r.value.decode("utf-8", "replace"))
                if s:
                    bad.append("/proc/%s/%s con forma de clave %s" % (pid, leaf, s[:1]))
    notes.append("%d archivos de /proc revisados" % seen)
    home = env.get("HOME", "")
    xdg_root = posixpath.dirname(posixpath.dirname(home)) if home else ""
    nfiles = 0
    if xdg_root.startswith("/home/"):
        for dp, dns, fns in os.walk(xdg_root, onerror=lambda e: None):
            for n in fns:
                if n.endswith("auth.json") or n.endswith("mcp-auth.json"):
                    r = attempt(read_file, os.path.join(dp, n))
                    if r.ok:
                        nfiles += 1
                        s = secrets_in(r.value.decode("utf-8", "replace"))
                        if s:
                            bad.append("%s con forma de clave" % n)
    notes.append("%d auth.json revisados" % nfiles)
    if bad:
        return finish(bad, notes)
    return row(
        "skip",
        "dentro no hay claves ni su forma: " + "; ".join(notes),
        "faltan el CredentialProxy real con canario y la busqueda del canario en la salida de wsl.exe, los logs y el ext4.vhdx (arnes TS del PC, aun sin escribir)",
    )


@attack("A10", "red: curl/DNS/UDP/ICMP/TCP al gateway, a ::1, a 445/135/22 y a la LAN deben fallar; solo existe lo")
def a10(cfg):
    bad, notes = [], []
    with open("/proc/net/dev") as f:
        ifaces = sorted(l.split(":")[0].strip() for l in f.read().splitlines()[2:] if ":" in l)
    if ifaces != ["lo"]:
        bad.append("interfaces de red visibles: %s" % ifaces)
    else:
        notes.append("solo lo")
    allowed_ports = set([cfg["serverPort"]] + list(cfg["relayPorts"]))

    def tcp(host, port, fam=socket.AF_INET):
        s = socket.socket(fam, socket.SOCK_STREAM)
        s.settimeout(1.0)
        try:
            s.connect((host, port))
            return None
        except OSError as e:
            return e.errno if e.errno is not None else errno.ETIMEDOUT
        finally:
            s.close()

    remote = [("1.1.1.1", 443), ("8.8.8.8", 53), ("93.184.216.34", 443), ("192.168.1.1", 80), ("192.168.1.1", 445), ("192.168.0.1", 445),
              ("10.255.255.254", 445), ("172.16.0.1", 22), ("169.254.169.254", 80)]
    opened = ["%s:%d" % h for h in remote if tcp(h[0], h[1]) is None]
    if opened:
        bad.append("TCP saliente conectado: %s" % opened)
    loop = [p for p in (22, 80, 135, 139, 443, 445, 3389, 5985, 8080, 11434) if p not in allowed_ports and tcp("127.0.0.1", p) is None]
    if loop:
        bad.append("puertos de loopback abiertos fuera de la lista: %s" % loop)
    if tcp("::1", 445, socket.AF_INET6) is None:
        bad.append("::1:445 conectado")
    try:
        socket.getaddrinfo("example.com", 443)
        bad.append("DNS resolvio example.com")
    except OSError:
        notes.append("DNS falla")
    try:
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            u.sendto(b"x", ("8.8.8.8", 53))
            bad.append("UDP 53 saliente enviado")
        finally:
            u.close()
    except OSError as e:
        notes.append("UDP=%s" % ename(e.errno))
    for label, typ in (("raw", socket.SOCK_RAW), ("ping", socket.SOCK_DGRAM)):
        try:
            s = socket.socket(socket.AF_INET, typ, socket.IPPROTO_ICMP)
            try:
                s.sendto(b"\x08\x00\x00\x00\x00\x00\x00\x00", ("8.8.8.8", 0))
                bad.append("ICMP %s saliente enviado" % label)
            finally:
                s.close()
        except OSError as e:
            notes.append("ICMP %s=%s" % (label, ename(e.errno)))
    return finish(bad, notes + ["(el listener de la LAN del plan no se implementa: sin interfaz ni ruta no hay por donde salir)"])


@attack("A11", "EgressProxy y puente: CONNECT fuera de lista, Host raro, IP literal, puertos")
def a11(cfg):
    return row("skip", "", "es un ataque directo contra EgressProxy/puente de main (TS): lo hace el arnes wsl.attack.pc.test.ts del PC, aun sin escribir")


@attack("A12", "privilegios: uid 1000, CapEff=0, NoNewPrivs=1, sin setuid, sin su/sudo, unshare -U sin ganar nada")
def a12(cfg):
    bad, notes = [], []
    st = parse_status(read_file("/proc/self/status").decode("utf-8", "replace"))
    if (os.getuid(), os.geteuid(), os.getgid()) != (1000, 1000, 1000):
        bad.append("ids %s" % ((os.getuid(), os.geteuid(), os.getgid()),))
    for k in ("CapEff", "CapPrm", "CapInh"):
        if st.get(k, "x").strip("0") != "":
            bad.append("%s=%s" % (k, st.get(k)))
    if st.get("NoNewPrivs") != "1":
        bad.append("NoNewPrivs=%s" % st.get("NoNewPrivs"))
    for label, fn, arg in (("setuid(0)", os.setuid, 0), ("setgid(0)", os.setgid, 0)):
        r = attempt(fn, arg)
        if r.ok or r.err != errno.EPERM:
            bad.append("%s: %s" % (label, "FUNCIONO" if r.ok else ename(r.err)))
    lc = libc()
    ctypes.set_errno(0)
    rc = lc.prctl(38, 0, 0, 0, 0)  # PR_SET_NO_NEW_PRIVS = 0: no se puede apagar
    if rc == 0:
        bad.append("prctl(NO_NEW_PRIVS, 0) FUNCIONO")
    else:
        notes.append("prctl(NNP,0)=%s" % ename(ctypes.get_errno()))
    suid = []
    for root in ("/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt/lazunox"):
        for dp, dns, fns in os.walk(root, onerror=lambda e: None):
            for n in fns:
                try:
                    m = os.lstat(os.path.join(dp, n)).st_mode
                except OSError:
                    continue
                if stat.S_ISREG(m) and m & (stat.S_ISUID | stat.S_ISGID):
                    suid.append(os.path.join(dp, n))
    if suid:
        bad.append("binarios SUID/SGID: %s" % suid[:3])
    else:
        notes.append("0 SUID/SGID")
    for exe in ("sudo", "doas", "pkexec"):
        for d in MINENV["PATH"].split(":"):
            if os.access(d + "/" + exe, os.X_OK):
                bad.append("%s instalado" % exe)
    rc, out = sh(["/bin/su", "-c", "id -u", "root"], stdin_data=b"")
    if rc == 0 and out.strip() == "0":
        bad.append("su dio root")
    else:
        notes.append("su rc=%s" % rc)
    # unshare(CLONE_NEWUSER|CLONE_NEWNS) en un hijo aparte: aunque funcione, no puede montar ni leer nada nuevo.
    pid = os.fork()
    if pid == 0:
        code = 1
        try:
            if lc.unshare(0x10000000 | 0x20000) != 0:
                code = 10  # unshare -U falla: bien
            else:
                tgt = tmpdir() + "/mnt-a12"
                os.makedirs(tgt, exist_ok=True)
                if lc.mount(b"tmpfs", tgt.encode(), b"tmpfs", ctypes.c_ulong(0), None) == 0:
                    code = 12
                else:
                    r = attempt(read_file, "/etc/shadow")
                    code = 13 if r.ok else 11
        finally:
            os._exit(code)
    _, status = os.waitpid(pid, 0)
    ucode = os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else (status >> 8)
    if ucode in (10, 11):
        notes.append("unshare -U: %s" % ("falla" if ucode == 10 else "funciona pero sin montar ni leer nada nuevo"))
    else:
        bad.append("unshare -U: codigo %s (12 = monto tmpfs, 13 = leyo /etc/shadow)" % ucode)
    with open("/proc/self/mountinfo") as f:
        by = dict((m["mnt"], m) for m in parse_mountinfo(f.read()))
    if "nosuid" not in by.get(cfg["main"], {"opts": []})["opts"]:
        bad.append("la carpeta principal no esta montada nosuid (chmod u+s seria efectivo)")
    return finish(bad, notes)


@attack("A13", "borrar, renombrar y enlazar segun allowDelete; el scratch sí se borra; rw adicional y ro nunca")
def a13(cfg):
    allow = cfg["allowDelete"]
    w = cfg["work"] + "/A13"
    os.makedirs(w, exist_ok=True)
    bad, notes = [], []
    for n in ("f1", "f2"):
        with open("%s/%s" % (w, n), "wb") as f:
            f.write(b"a13")
    os.makedirs(w + "/d/inner", exist_ok=True)
    rw2 = [m["linux"] for m in cfg["mounts"][1:] if m["mode"] == "rw"]
    ro = [m["linux"] for m in cfg["mounts"][1:] if m["mode"] == "ro"]
    victim_x = cfg["victim"] + "/x.txt"

    def expect_denied(name, res, allowed=DENY_WRITE):
        if res.ok:
            bad.append("%s: PERMITIDO sin allowDelete" % name)
        elif res.err not in allowed:
            bad.append("%s: error inesperado %s" % (name, ename(res.err)))
        else:
            notes.append("%s=%s" % (name, ename(res.err)))

    if not allow:
        expect_denied("rm f1", attempt(os.remove, w + "/f1"))
        expect_denied("rmdir d/inner", attempt(os.rmdir, w + "/d/inner"))
        expect_denied("rename f1", attempt(os.rename, w + "/f1", w + "/f1b"))
        expect_denied("replace f1->f2", attempt(os.replace, w + "/f1", w + "/f2"))
        try:
            lc = libc()
            ctypes.set_errno(0)
            rc = lc.renameat2(-100, (w + "/f1").encode(), -100, (w + "/f1c").encode(), 1)
            expect_denied("renameat2", Res(rc == 0, err=ctypes.get_errno()))
        except AttributeError:
            notes.append("renameat2 no disponible en libc (os.rename cubre el caso)")
        expect_denied("link hacia la victima", attempt(os.link, victim_x, w + "/lzx-victima"), DENY_WRITE)
        if rw2:
            expect_denied("rename f1 -> rw adicional", attempt(os.rename, w + "/f1", rw2[0] + "/f1"))
            expect_denied("link f1 -> rw adicional", attempt(os.link, w + "/f1", rw2[0] + "/lzx-link-" + cfg["runId"]))
        hard = cfg["links"].get("hard")
        if hard:
            expect_denied("rm %s (hardlink a la victima)" % hard, attempt(os.remove, cfg["main"] + "/" + hard))
        rc, out = sh(["/bin/rm", "-f", w + "/f1"])
        if rc == 0 and not os.path.exists(w + "/f1"):
            bad.append("/bin/rm borro f1 sin allowDelete")
        rc, out = sh(["/bin/mv", w + "/f1", w + "/f1m"])
        if rc == 0:
            bad.append("/bin/mv renombro f1 sin allowDelete")
        for n in ("f1", "f2", "d"):
            if not attempt(os.lstat, "%s/%s" % (w, n)).ok:
                bad.append("%s desaparecio" % n)
    else:
        for name, fn, args in (
            ("rm f1", os.remove, (w + "/f1",)),
            ("rename f2", os.rename, (w + "/f2", w + "/f2b")),
            ("rmdir d/inner", os.rmdir, (w + "/d/inner",)),
        ):
            r = attempt(fn, *args)
            if r.ok:
                notes.append("%s permitido (allowDelete)" % name)
            else:
                bad.append("%s: %s con allowDelete" % (name, ename(r.err)))
        for d in rw2:
            p = d + "/lzx-del-" + cfg["runId"]
            c = attempt(lambda: os.close(os.open(p, os.O_WRONLY | os.O_CREAT, 0o644)))
            if not c.ok:
                bad.append("no se pudo crear en la carpeta rw adicional: %s" % ename(c.err))
                continue
            expect_denied("rm en rw adicional", attempt(os.remove, p))
        for d in ro:
            expect_denied("crear en ro", attempt(lambda: os.close(os.open(d + "/lzx-ro-" + cfg["runId"], os.O_WRONLY | os.O_CREAT, 0o644))))
    s = cfg["scratch"] + "/s13-" + cfg["runId"]
    c = attempt(lambda: os.close(os.open(s, os.O_WRONLY | os.O_CREAT, 0o644)))
    if not c.ok:
        bad.append("el scratch no se puede escribir: %s" % ename(c.err))
    else:
        r = attempt(os.remove, s)
        if r.ok:
            notes.append("scratch: se borra (por diseno)")
        else:
            bad.append("scratch: no se pudo borrar (%s)" % ename(r.err))
    rows = [finish(bad, notes)]
    t = attempt(os.truncate, w + "/f2" if os.path.exists(w + "/f2") else w + "/f2b", 0)
    rows.append(row("pass", "truncate %s (residuo documentado: TRUNCATE no se maneja, igual que en macOS)" % ("permitido" if t.ok else "denegado: " + ename(t.err)), id="A13", criterion="I", case="truncate se registra (informativo)"))
    return rows


@attack("A14", "puente: 300 flujos, trama de 2 MiB, INIT de 70 KiB, trama truncada, UTF-16 invalido")
def a14(cfg):
    return row("skip", "", "es un ataque directo contra el puente de main (TS): lo hace el arnes wsl.attack.pc.test.ts del PC, aun sin escribir")


@attack("A15", "escrituras fuera de lo concedido y integridad de /opt/lazunox")
def a15(cfg):
    bad, notes = [], []
    for p in ("/etc/lzx-a15", "/etc/wsl.conf", "/opt/lazunox/lzx-a15", "/opt/lazunox/launcher.py", "/usr/local/bin/lzx-a15", "/home/lazunox/.profile", "/tmp/lzx-a15", "/bin/lzx-a15", "/root/lzx-a15"):
        r = attempt(lambda: os.close(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)))
        if r.ok:
            bad.append("escritura PERMITIDA en %s" % p)
            attempt(os.unlink, p)
        elif r.err not in DENY_WRITE:
            bad.append("%s: error inesperado %s" % (p, ename(r.err)))
        else:
            notes.append("%s=%s" % (p, ename(r.err)))
    for label, d in (("HOME", os.environ.get("HOME", "")), ("TMPDIR", tmpdir())):
        if not d:
            bad.append("sin %s" % label)
            continue
        f = d + "/lzx-a15-" + cfg["runId"]
        c = attempt(lambda: os.close(os.open(f, os.O_WRONLY | os.O_CREAT, 0o644)))
        u = attempt(os.unlink, f) if c.ok else c
        if not (c.ok and u.ok):
            bad.append("%s privado no es escribible/borrable (%s)" % (label, ename((c if not c.ok else u).err)))
    try:
        raw = read_file("/opt/lazunox/MANIFEST.json", 1 << 20)
        if hashlib.sha256(raw).hexdigest() != cfg["payloadSha"]:
            bad.append("sha256(MANIFEST.json) != payloadSha esperado")
        for f in json.loads(raw.decode("utf-8"))["files"]:
            if f["kind"] != "file":
                continue
            data = read_file("/opt/lazunox/" + f["path"], 1 << 24)
            if hashlib.sha256(data).hexdigest() != f["sha256"]:
                bad.append("/opt/lazunox/%s no coincide con el manifiesto" % f["path"])
        notes.append("manifiesto y archivos coinciden con payloadSha")
    except (OSError, ValueError, KeyError) as e:
        bad.append("no se pudo verificar /opt/lazunox: %s" % type(e).__name__)
    return finish(bad, notes + ["(anfitrion: tras --terminate nada persiste y wsl.conf igual)"])


@attack("A16", "sensibilidad a mayusculas: A.txt/a.txt, mkdir D/d, intento de activar case=dir")
def a16(cfg):
    d = cfg["work"] + "/A16"
    os.makedirs(d, exist_ok=True)
    bad, notes = [], []

    def try_both():
        with open(d + "/A.txt", "wb") as f:
            f.write(b"A")
        r = attempt(lambda: os.close(os.open(d + "/a.txt", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)))
        if r.ok:
            bad.extend(casefold_problems(os.listdir(d), "a.txt") or ["a.txt se creo ademas de A.txt"])
        else:
            notes.append("segunda creacion=%s" % ename(r.err))
            bad.extend(casefold_problems([n for n in os.listdir(d) if n.lower() == "a.txt"], "a.txt"))
        os.makedirs(d + "/D", exist_ok=True)
        r2 = attempt(os.mkdir, d + "/d")
        if r2.ok:
            bad.extend(casefold_problems(os.listdir(d), "d") or ["d se creo ademas de D"])
        else:
            notes.append("mkdir d=%s" % ename(r2.err))

    try_both()
    for attr in ("system.wsl_case_sensitive", "user.wsl_case_sensitive"):
        r = attempt(os.setxattr, d, attr, b"1")
        notes.append("setxattr %s=%s" % (attr.split(".")[0], "FUNCIONO" if r.ok else ename(r.err)))
    names = os.listdir(d)
    if len([n for n in names if n.lower() == "a.txt"]) != 1:
        bad.append("tras intentar case=dir hay %r" % [n for n in names if n.lower() == "a.txt"])
    with open("/proc/self/mountinfo") as f:
        by = dict((m["mnt"], m) for m in parse_mountinfo(f.read()))
    m = by.get(cfg["main"])
    notes.append("opciones del montaje: %s (case=off no sale en mountinfo: se comprueba por comportamiento)" % (",".join(m["opts"]) if m else "no montada"))
    return finish(bad, notes + ["(anfitrion: fsutil file queryCaseSensitiveInfo = disabled)"])


@attack("A17", "ciclo de vida: Detener, matar al anfitrion, vmIdleTimeout, reposo de Vmmem, procesos colgando")
def a17(cfg):
    return row("skip", "", "se mide fuera, desde tasks-attack.ps1 (wsl -- ps -e, taskkill del anfitrion, wsl -l -v, Get-Process)")


@attack("A18", "sin sandbox imposible: win32 nunca lanza opencode sin aislamiento")
def a18(cfg):
    return row("skip", "", "la mitad de macOS la cubre win-attack.battery.test.ts; falta arrancar una tarea desde la app con la distro borrada (arnes del PC)")


@attack("A19", "politica de carpetas de Windows: unidades de red, subst, junctions dentro")
def a19(cfg):
    return row("skip", "", "la tabla la cubre la bateria de macOS; las unidades de red y subst reales exigen el arnes de main en el PC")


@attack("A20", "opciones de montaje: noexec,nosuid,nodev (y ro) en cada carpeta concedida")
def a20(cfg):
    with open("/proc/self/mountinfo") as f:
        rows = parse_mountinfo(f.read())
    bad = mount_flag_problems(rows, cfg["mounts"])
    return finish(bad, ["%d montajes concedidos revisados" % len(cfg["mounts"]), "(anfitrion: --probe, nucleo, ABI de Landlock y lsm)"])


# ───────────────────────── Ejecucion ─────────────────────────


def run_all(cfg, emit, now=time.time):
    """Corre los ataques pedidos (todos si `only` esta vacio). Lo que no llega a correr cuenta como `fail`."""
    token = cfg["victimToken"]
    per = max(5, min(120, int(cfg["attackTimeoutSec"] or ATTACK_TIMEOUT_DEFAULT)))
    deadline = now() + int(cfg["totalTimeoutSec"] or TOTAL_TIMEOUT_DEFAULT)
    only = set(cfg["only"])
    count = 0
    try:
        os.makedirs(cfg["work"], exist_ok=True)
    except OSError as e:
        for aid, crit, title, _ in ATTACKS:
            if not only or aid in only:
                emit(normalize_row(row("fail", "no se pudo crear la carpeta de trabajo: %s" % ename(e.errno)), aid, crit, title, token, 0))
                count += 1
        return count
    for aid, crit, title, fn in ATTACKS:
        if only and aid not in only:
            continue
        t0 = now()
        if now() >= deadline:
            rows, why = None, "no se ejecuto: tiempo total agotado"
        else:
            rows, why = run_isolated(fn, cfg, min(per, max(1, int(deadline - now()))))
        dur = (now() - t0) * 1000
        if rows is None:
            rows = [row("fail", why or "sin resultado")]
        for r in rows:
            emit(normalize_row(r, aid, crit, title, token, dur))
            count += 1
    if cfg["allowDelete"]:  # best effort: sin allowDelete lo borra el anfitrion desde Windows
        import shutil

        shutil.rmtree(cfg["work"], ignore_errors=True)
    return count


def dry_run(only=()):
    """Sin sandbox: una fila `skip` por ataque con el esquema final (sirve para comprobar el formato)."""
    out = []
    for aid, crit, title, _ in ATTACKS:
        if only and aid not in only:
            continue
        out.append(normalize_row(row("skip", "", "dry-run: no se ejecuto ningun ataque"), aid, crit, title, "", 0))
        if aid in ("A3", "A13"):
            out.append(normalize_row(row("skip", "", "dry-run", id=aid, criterion="I", case="fila informativa"), aid, "I", title, "", 0))
    return out


def read_cfg_line(conn, deadline_s=30):
    conn.settimeout(deadline_s)
    buf = b""
    while b"\n" not in buf:
        chunk = conn.recv(65536)
        if not chunk:
            raise ValueError("el anfitrion cerro antes de enviar la configuracion")
        buf += chunk
        if len(buf) > CFG_MAX_BYTES:
            raise ValueError("configuracion demasiado grande")
    return json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))


def serve(argv):
    """Punto de entrada del shim `bin/opencode` (`serve --port N --hostname 127.0.0.1`)."""
    port = None
    for i, a in enumerate(argv):
        if a == "--port" and i + 1 < len(argv):
            port = int(argv[i + 1])
    if not port:
        sys.stderr.write("attack_suite: falta --port\n")
        sys.exit(2)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(1)
    srv.settimeout(300)
    conn, _ = srv.accept()
    lock_token = ""

    def emit(obj):
        conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))

    try:
        cfg = validate_cfg(read_cfg_line(conn))
        lock_token = cfg["victimToken"]
        with open("/proc/self/status") as f1, open("/proc/self/mountinfo") as f2:
            probs = sandbox_problems(cfg, f1.read(), f2.read(), os.getuid())
        if probs:
            for aid, crit, title, _ in ATTACKS:
                if not cfg["only"] or aid in cfg["only"]:
                    emit(normalize_row(row("fail", "no corre dentro del sandbox real: " + "; ".join(probs)), aid, crit, title, lock_token, 0))
            emit({"type": "done", "count": 0, "sandbox": False})
        else:
            n = run_all(cfg, emit)
            emit({"type": "done", "count": n, "sandbox": True})
    except (ValueError, OSError, KeyError) as e:
        emit({"type": "error", "message": "%s: %s" % (type(e).__name__, str(e)[:200])})
    finally:
        try:
            conn.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        time.sleep(0.3)
        conn.close()
    sys.exit(0)


def main(argv):
    if "--list" in argv:
        print(json.dumps([[a, c, t] for a, c, t, _ in ATTACKS]))
        return 0
    if "--dry-run" in argv:
        for r in dry_run():
            print(json.dumps(r))
        return 0
    if "--serve" in argv:
        serve([a for a in argv if a != "--serve"])
        return 0
    sys.stderr.write("uso: attack_suite.py --list | --dry-run | --serve --port N\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
