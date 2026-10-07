#!/usr/bin/python3
"""Lanzador de Tareas dentro de la distro `Lazunox-Tareas` (F8-B81). Corre como root en la distro, lo arranca
`wsl.exe -d Lazunox-Tareas -u root --cd / --exec /opt/lazunox/launcher.py` y habla con `main` por stdin/stdout.

  1. lee la trama INIT (JSON no confiable: se valida con protocol.validate_init; la clave real nunca viaja);
  2. comprueba el entorno y SE NIEGA a arrancar si hay interop o unidades de Windows montadas;
  3. unshare(MOUNT|NET|PID) y un PID 1 propio; /proc nuevo; interfaz `lo` arriba (no hay otra interfaz);
  4. monta SOLO las carpetas concedidas con `mount -t drvfs` (noexec,nosuid,nodev; `ro` las de solo lectura);
  5. relés TCP: los puertos permitidos de 127.0.0.1 de Windows aparecen con el MISMO número dentro; el servidor de
     OpenCode se expone a Windows por un flujo abierto desde fuera;
  6. el servidor corre como `lazunox` (sin capacidades, NO_NEW_PRIVS) bajo Landlock; el proceso raíz solo hace de relé;
  7. EOF de stdin (muere `main` o `wsl.exe`) => se mata todo el espacio de nombres PID.

NO se ejecuta en el Mac. `--probe` imprime un JSON con el estado del entorno y sale (lo usa `status()`).
Otros subcomandos (root, sin INIT): `--export-home` (tar de xdg/ a stdout), `--import-home` (tar por stdin, solo bajo
xdg/), `--du <clave>` y `--rm <clave>` (uso y borrado de los datos de una tarea).
"""
import ctypes
import ctypes.util
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tarfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landlock  # noqa: E402
import mux as M  # noqa: E402
import protocol as P  # noqa: E402

CLONE_NEWNS, CLONE_NEWPID, CLONE_NEWNET = 0x00020000, 0x20000000, 0x40000000
MS_REC, MS_PRIVATE = 0x4000, 1 << 18
SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
STDIN, STDOUT = 0, 1


def die(msg, code=97):
    sys.stderr.write("lazunox-launcher: %s\n" % msg)
    sys.stderr.flush()
    os._exit(code)


def read_exact_frame(fd):
    dec = P.FrameDecoder()
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            die("stdin cerrado antes de INIT", 96)
        frames = dec.push(chunk)
        if frames:
            if len(frames) != 1 or frames[0][1] != P.INIT or frames[0][0] != 0:
                # Diagnostico (sin contenido): cuantas tramas llegaron y el id/tipo de la primera.
                die("la primera trama no es INIT (tramas=%d id=%r tipo=%r bytes=%d)" % (len(frames), frames[0][0], frames[0][1], len(chunk)))
            if dec._buf:
                die("bytes tras INIT")  # el anfitrión no envía nada más hasta READY
            return frames[0][2]


NET_FSTYPES = ("9p", "drvfs", "virtiofs")
# Montajes que WSL pone por su cuenta (GPU, WSLg, X11): se informan APARTE para decidir con datos del PC.
WSL_SYSTEM_PREFIXES = ("/usr/lib/wsl", "/mnt/wslg", "/tmp/.X11-unix")
_DRIVE_SOURCE = re.compile(r"^[A-Za-z]:\\?$")
_OCTAL = re.compile(r"\\([0-7]{3})")
ROOTFS_MARKER = "/etc/lazunox-rootfs.json"
PAYLOAD_MANIFEST = "/opt/lazunox/MANIFEST.json"
HOME_ROOT = "/home/%s" % P.WSL_USER
KEY_RE = re.compile(r"^[0-9a-f]{16}\Z")


def _unescape(field):
    """mountinfo escapa espacios, tabuladores y barras invertidas como \\040, \\011, \\134."""
    return _OCTAL.sub(lambda m: chr(int(m.group(1), 8)), field)


def parse_mounts(text):
    """(driveMounts, wslSystemMounts) a partir de /proc/self/mountinfo.

    Unidad de Windows: tipo 9p/drvfs/virtiofs (o fuse*) cuyo origen es una unidad (`C:\\`, `drvfs`) y, para los tres
    tipos de red, cualquier montaje que no sea de sistema de WSL (falla cerrado). Los `fuse*` que no son unidades se
    ignoran (p. ej. un FUSE legítimo del usuario). Los montajes concedidos por nosotros (/win/...) no cuentan.
    """
    drives, system = [], []
    for line in text.splitlines():
        head, sep, tail = line.partition(" - ")
        fields = head.split(" ")
        rest = tail.split(" ")
        if not sep or len(fields) < 5 or len(rest) < 2:
            continue
        mnt, fstype, source = _unescape(fields[4]), rest[0], _unescape(rest[1])
        is_net = fstype in NET_FSTYPES
        if not (is_net or fstype.startswith("fuse")):
            continue
        if mnt.startswith("/win/"):
            continue
        drive_like = bool(_DRIVE_SOURCE.match(source)) or source == "drvfs"
        is_system = any(mnt == p or mnt.startswith(p + "/") for p in WSL_SYSTEM_PREFIXES)
        if drive_like:
            drives.append(mnt)
        elif is_system:
            system.append(mnt)
        elif is_net:
            drives.append(mnt)
    return drives, system


def read_mounts():
    with open("/proc/self/mountinfo") as f:
        return parse_mounts(f.read())


def drvfs_mounts_present():
    """Montajes de unidades de Windows visibles ahora (deben ser ninguno)."""
    return read_mounts()[0]


def read_rootfs_marker():
    try:
        with open(ROOTFS_MARKER, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def read_payload_sha():
    try:
        with open(PAYLOAD_MANIFEST, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


WSL_CONF = "/etc/wsl.conf"


def wsl_conf_interop_disabled(text):
    """¿Dice el wsl.conf `[interop] enabled=false`? ini mínimo; sin la clave o con otro valor el interop cuenta como ACTIVO."""
    section = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            continue
        if section == "interop" and "=" in line:
            key, value = line.split("=", 1)
            if key.strip().lower() == "enabled":
                return value.strip().strip('"').lower() == "false"
    return False


def interop_active(conf_path=WSL_CONF):
    """El interop de WSL está activo salvo que el wsl.conf de la distro lo apague (`[interop] enabled=false`).

    NO se mira si existe /proc/sys/fs/binfmt_misc/WSLInterop: el registro binfmt es del núcleo (compartido por todas las distros de WSL2) y
    aparece aunque este distro tenga el interop apagado. Medido en el PC de pruebas (WSL 2.7.3, núcleo 6.6.114): con `enabled=false` el
    registro sigue ahí, pero un .exe de Windows copiado a la distro NO se ejecuta (`accept4 failed 110`). Si no se puede leer el
    wsl.conf, se asume activo (falla cerrado)."""
    try:
        with open(conf_path, encoding="utf-8") as f:
            return not wsl_conf_interop_disabled(f.read())
    except OSError:
        return True


def probe():
    drives, system = read_mounts()
    info = {
        "interop": interop_active(),
        "driveMounts": drives,
        "wslSystemMounts": system,
        "landlockAbi": landlock.abi_version(),
        "kernel": os.uname().release,
        "uid": os.getuid(),
        "rootfs": read_rootfs_marker(),
        "payloadSha": read_payload_sha(),
    }
    sys.stdout.write(json.dumps(info) + "\n")
    sys.exit(0)


# ───────────────────────── Datos (xdg) de las tareas ─────────────────────────


def export_home(out, home=HOME_ROOT):
    """tar (sin compresión) de `xdg/`: solo directorios y archivos regulares; enlaces y especiales se omiten."""
    xdg = os.path.join(home, "xdg")

    def keep(ti):
        return ti if (ti.isdir() or ti.isreg()) else None

    with tarfile.open(fileobj=out, mode="w|", format=tarfile.PAX_FORMAT) as tf:
        if os.path.isdir(xdg) and not os.path.islink(xdg):
            tf.add(xdg, arcname="xdg", recursive=True, filter=keep)


def _safe_member_name(name):
    parts = name.split("/")
    if name.startswith("/") or "\\" in name or "\0" in name or ".." in parts:
        return False
    return parts[0] == "xdg"


def import_home(inp, home=HOME_ROOT, chown=None):
    """Extrae un tar de `export_home` SOLO bajo `xdg/`: archivos y directorios regulares, sin setuid, dueño 1000."""
    if chown is None:
        chown = os.getuid() == 0
    xdg = os.path.join(home, "xdg")
    if os.path.islink(xdg) or (os.path.exists(xdg) and not os.path.isdir(xdg)):
        raise ValueError("xdg no es un directorio")
    os.makedirs(xdg, exist_ok=True)
    if chown:
        os.chown(xdg, P.WSL_UID, P.WSL_UID)
    count = 0
    with tarfile.open(fileobj=inp, mode="r|") as tf:
        for m in tf:
            if not _safe_member_name(m.name) or not (m.isreg() or m.isdir()):
                raise ValueError("miembro no permitido: %r" % m.name[:80])
            m.mode = m.mode & 0o755
            m.uid = m.gid = P.WSL_UID
            m.uname = m.gname = ""
            dest = os.path.join(home, m.name)
            parent = os.path.dirname(dest)
            if os.path.islink(parent) or (os.path.lexists(dest) and os.path.islink(dest)):
                raise ValueError("enlace en el destino: %r" % m.name[:80])
            if hasattr(tarfile, "data_filter"):
                tf.extract(m, path=home, filter="data")
            else:
                tf.extract(m, path=home)
            count += 1
    if chown:
        for dp, dns, fns in os.walk(xdg):
            for n in dns + fns:
                p = os.path.join(dp, n)
                if not os.path.islink(p):
                    os.chown(p, P.WSL_UID, P.WSL_UID)
    return count


def _key_dir(key, home=HOME_ROOT):
    if not KEY_RE.match(key or ""):
        raise ValueError("clave inválida")
    return os.path.join(home, "xdg", key)


def du_key(key, home=HOME_ROOT):
    """Bytes ocupados por los datos de una tarea (sin seguir enlaces)."""
    total = 0
    for dp, _, fns in os.walk(_key_dir(key, home)):
        for n in fns:
            try:
                st = os.lstat(os.path.join(dp, n))
            except OSError:
                continue
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
    return total


def rm_key(key, home=HOME_ROOT, tmp_root="/tmp"):
    """Borra los datos de una tarea y su tmp; nunca sigue un enlace."""
    for d in (_key_dir(key, home), os.path.join(tmp_root, "lazunox-%s" % key)):
        if os.path.islink(d):
            os.unlink(d)
        elif os.path.isdir(d):
            shutil.rmtree(d)


def subcommand(argv):
    """Subcomandos sin INIT. Devuelve el código de salida o None si no es uno."""
    if not argv or argv[0] not in ("--export-home", "--import-home", "--du", "--rm"):
        return None
    cmd = argv[0]
    if os.getuid() != 0:
        die("debe correr como root dentro de la distro dedicada")
    try:
        if cmd == "--export-home" and len(argv) == 1:
            export_home(sys.stdout.buffer)
            sys.stdout.buffer.flush()
        elif cmd == "--import-home" and len(argv) == 1:
            n = import_home(sys.stdin.buffer)
            sys.stdout.write(json.dumps({"ok": True, "entries": n}) + "\n")
        elif cmd == "--du" and len(argv) == 2:
            sys.stdout.write(json.dumps({"ok": True, "bytes": du_key(argv[1])}) + "\n")
        elif cmd == "--rm" and len(argv) == 2:
            rm_key(argv[1])
            sys.stdout.write(json.dumps({"ok": True}) + "\n")
        else:
            die("argumentos inválidos para %s" % cmd, 2)
    except (ValueError, OSError, tarfile.TarError) as e:
        die("%s falló: %s" % (cmd, type(e).__name__ + ": " + str(e)[:200]), 3)
    return 0


def libc():
    return ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)


def lo_up():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        ifr = struct.pack("16sH14s", b"lo", 0, b"\x00" * 14)
        flags = struct.unpack("16sH14s", fcntl.ioctl(s, SIOCGIFFLAGS, ifr))[1]
        fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sH14s", b"lo", flags | IFF_UP, b"\x00" * 14))
    finally:
        s.close()


def run(cmd):
    r = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
    if r.returncode != 0:
        die("falló %s: %s" % (" ".join(cmd[:3]), r.stderr.decode("utf-8", "replace")[:300]))


def isolate_namespaces():
    lc = libc()
    if lc.unshare(CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET) != 0:
        die("unshare falló: errno %d" % ctypes.get_errno())
    if lc.mount(None, b"/", None, MS_REC | MS_PRIVATE, None) != 0:
        die("mount --make-rprivate falló")


def hide_windows(lc):
    """Dentro del nuevo espacio de montaje: sin unidades de Windows. Los sockets de interop y /init se tapan DESPUÉS de montar (hide_init)."""
    drives, system = read_mounts()
    for mnt in drives:
        if lc.umount2(mnt.encode(), 2) != 0:  # MNT_DETACH
            die("no se pudo desmontar %s" % mnt)
    for mnt in system:  # GPU/WSLg del anfitrión: dentro de /usr serían legibles; en este espacio de montaje sobran
        lc.umount2(mnt.encode(), 2)
    if drvfs_mounts_present():
        die("quedan unidades de Windows montadas")


def hide_init():
    """Tapa los sockets de interop (/run/WSL) y /init SOLO en este espacio de montaje y DESPUÉS de montar las carpetas: `mount -t drvfs`
    ejecuta /sbin/mount.drvfs (un enlace a /init) y habla con WSL por un socket de /run/WSL (taparlos antes rompía el montaje: «connect
    failed 2» / «Failed to parse /proc/1/stat»; medido en el PC). /init es el intérprete del binfmt de interop (mejor esfuerzo: si falla, el
    interop sigue apagado por el wsl.conf y el lanzador ya comprobó que lo está)."""
    if os.path.isdir("/run/WSL"):
        run(["mount", "-t", "tmpfs", "-o", "mode=0555,size=4k", "tmpfs", "/run/WSL"])
    if os.path.isfile("/init"):
        subprocess.run(["mount", "--bind", "/dev/null", "/init"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)


def mount_folders(init):
    for m in sorted(init["mounts"], key=lambda m: len(m["linux"])):
        os.makedirs(m["linux"], exist_ok=True)
        run(["mount", "-t", "drvfs", m["win"], m["linux"], "-o", P.drvfs_options(m["mode"])])


def prepare_private(init):
    key = init["sandboxKey"]
    root = "/home/%s/xdg/%s" % (P.WSL_USER, key)
    for d in ("config", "data", "cache", "state", "tmp", "home"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    tmp = "/tmp/lazunox-%s" % key
    os.makedirs(tmp, exist_ok=True)
    for p in (root, tmp):
        for dirpath, dirnames, _ in os.walk(p):
            os.chown(dirpath, P.WSL_UID, P.WSL_UID)
    return root, tmp


def child_env(init, root, tmp):
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": root + "/home",
        "LANG": "C.UTF-8",
        "XDG_CONFIG_HOME": root + "/config",
        "XDG_DATA_HOME": root + "/data",
        "XDG_CACHE_HOME": root + "/cache",
        "XDG_STATE_HOME": root + "/state",
        "TMPDIR": tmp,
        "npm_config_cache": root + "/cache/npm",
        "BUN_INSTALL_CACHE_DIR": root + "/cache/bun",
        "PIP_CACHE_DIR": root + "/cache/pip",
        "UV_CACHE_DIR": root + "/cache/uv",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "OPENCODE_DISABLE_AUTOUPDATE": "1",
    }
    env.update(init["env"])  # ya validado: solo prefijos permitidos
    return env


def spawn_server(init, root, tmp):
    pid = os.fork()
    if pid:
        return pid
    try:
        os.setsid()
        os.chdir(init["cwd"])
        os.setgroups([])
        os.setgid(P.WSL_UID)
        os.setuid(P.WSL_UID)
        landlock.apply_policy(init["landlock"]["rules"], init["landlock"]["minAbi"])
        for fd in (STDIN, STDOUT):
            os.close(fd)  # el servidor no ve la stdio del puente
        os.open(os.devnull, os.O_RDONLY)
        os.open(os.devnull, os.O_WRONLY)
        os.execve(P.OPENCODE_BIN, [P.OPENCODE_BIN] + init["serveArgs"], child_env(init, root, tmp))
    except BaseException as e:  # noqa: BLE001
        sys.stderr.write("lazunox-launcher: no se pudo arrancar el servidor: %s\n" % e)
        os._exit(98)


def namespace_init(init):
    """PID 1 del nuevo espacio: monta, lanza el servidor y hace de relé hasta EOF."""
    lc = libc()
    hide_windows(lc)
    run(["mount", "-t", "proc", "proc", "/proc"])
    lo_up()
    mount_folders(init)
    hide_init()
    root, tmp = prepare_private(init)
    mux = M.Mux(STDIN, STDOUT, init["relayPorts"], init["serverPort"])
    mux.start()
    server = spawn_server(init, root, tmp)
    mux.send(0, P.READY)
    state = {"exit": None}

    def reap(*_):
        try:
            pid, status = os.waitpid(server, os.WNOHANG)
        except ChildProcessError:
            pid, status = server, 0
        if pid == server:
            state["exit"] = os.waitstatus_to_exitcode(status)

    signal.signal(signal.SIGCHLD, reap)
    reason = mux.run(should_stop=lambda: state["exit"] is not None)
    if state["exit"] is not None:
        mux.send(0, P.EXIT, P.encode_exit(state["exit"]))
        mux._on_stdout()
    try:
        os.killpg(server, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    mux.close_all()
    os._exit(0 if reason in ("eof", "stopped") else 95)


def main():
    if "--probe" in sys.argv[1:]:
        probe()
    rc = subcommand(sys.argv[1:])
    if rc is not None:
        sys.exit(rc)
    if os.getuid() != 0:
        die("debe correr como root dentro de la distro dedicada")
    try:
        init = P.validate_init(read_exact_frame(STDIN))
    except P.ProtocolError as e:
        die("INIT inválido (%s): %s" % (e.code, e))
    if interop_active():
        die("el interop de WSL está activo: me niego a arrancar", 94)
    if landlock.abi_version() < init["landlock"]["minAbi"]:
        die("Landlock no disponible (ABI %d): me niego a arrancar sin protección de borrado" % landlock.abi_version(), 93)
    isolate_namespaces()
    pid = os.fork()  # el hijo es el PID 1 del nuevo espacio de nombres
    if pid == 0:
        try:
            namespace_init(init)
        except BaseException as e:  # noqa: BLE001
            die("fallo en el espacio de nombres: %s" % e)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


if __name__ == "__main__":
    main()
