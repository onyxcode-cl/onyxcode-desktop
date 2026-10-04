#!/usr/bin/python3
"""Lanzador de Tareas dentro de la distro `OnyxCode-Tareas` (F8-B81). Corre como root en la distro, lo arranca
`wsl.exe -d OnyxCode-Tareas -u root --cd / --exec /opt/onyx/launcher.py` y habla con `main` por stdin/stdout.

  1. lee la trama INIT (JSON no confiable: se valida con protocol.validate_init; la clave real nunca viaja);
  2. comprueba el entorno y SE NIEGA a arrancar si hay interop o unidades de Windows montadas;
  3. unshare(MOUNT|NET|PID) y un PID 1 propio; /proc nuevo; interfaz `lo` arriba (no hay otra interfaz);
  4. monta SOLO las carpetas concedidas con `mount -t drvfs` (noexec,nosuid,nodev; `ro` las de solo lectura);
  5. relés TCP: los puertos permitidos de 127.0.0.1 de Windows aparecen con el MISMO número dentro; el servidor de
     OpenCode se expone a Windows por un flujo abierto desde fuera;
  6. el servidor corre como `onyx` (sin capacidades, NO_NEW_PRIVS) bajo Landlock; el proceso raíz solo hace de relé;
  7. EOF de stdin (muere `main` o `wsl.exe`) => se mata todo el espacio de nombres PID.

NO se ejecuta en el Mac. `--probe` imprime un JSON con el estado del entorno y sale (lo usa `status()`).
"""
import ctypes
import ctypes.util
import fcntl
import json
import os
import signal
import socket
import struct
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landlock  # noqa: E402
import mux as M  # noqa: E402
import protocol as P  # noqa: E402

CLONE_NEWNS, CLONE_NEWPID, CLONE_NEWNET = 0x00020000, 0x20000000, 0x40000000
MS_REC, MS_PRIVATE = 0x4000, 1 << 18
SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
STDIN, STDOUT = 0, 1


def die(msg, code=97):
    sys.stderr.write("onyx-launcher: %s\n" % msg)
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
                die("la primera trama no es INIT")
            if dec._buf:
                die("bytes tras INIT")  # el anfitrión no envía nada más hasta READY
            return frames[0][2]


def drvfs_mounts_present():
    """Montajes drvfs/9p de unidades de Windows visibles ahora (deben ser ninguno)."""
    bad = []
    with open("/proc/self/mountinfo") as f:
        for line in f:
            parts = line.split(" - ")
            if len(parts) < 2:
                continue
            fstype = parts[1].split()[0]
            mnt = line.split()[4]
            if fstype in ("9p", "drvfs") and not mnt.startswith("/win/"):
                bad.append(mnt)
    return bad


def probe():
    info = {
        "interop": os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop") or os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop-late"),
        "driveMounts": drvfs_mounts_present(),
        "landlockAbi": landlock.abi_version(),
        "kernel": os.uname().release,
        "uid": os.getuid(),
    }
    sys.stdout.write(json.dumps(info) + "\n")
    sys.exit(0)


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
    """Dentro del nuevo espacio de montaje: sin unidades de Windows ni sockets de interop."""
    for mnt in drvfs_mounts_present():
        if lc.umount2(mnt.encode(), 2) != 0:  # MNT_DETACH
            die("no se pudo desmontar %s" % mnt)
    if os.path.isdir("/run/WSL"):
        run(["mount", "-t", "tmpfs", "-o", "mode=0555,size=4k", "tmpfs", "/run/WSL"])
    if drvfs_mounts_present():
        die("quedan unidades de Windows montadas")


def mount_folders(init):
    for m in sorted(init["mounts"], key=lambda m: len(m["linux"])):
        os.makedirs(m["linux"], exist_ok=True)
        run(["mount", "-t", "drvfs", m["win"], m["linux"], "-o", P.drvfs_options(m["mode"])])


def prepare_private(init):
    key = init["sandboxKey"]
    root = "/home/%s/xdg/%s" % (P.WSL_USER, key)
    for d in ("config", "data", "cache", "state", "tmp", "home"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    tmp = "/tmp/onyx-%s" % key
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
        sys.stderr.write("onyx-launcher: no se pudo arrancar el servidor: %s\n" % e)
        os._exit(98)


def namespace_init(init):
    """PID 1 del nuevo espacio: monta, lanza el servidor y hace de relé hasta EOF."""
    lc = libc()
    hide_windows(lc)
    run(["mount", "-t", "proc", "proc", "/proc"])
    lo_up()
    mount_folders(init)
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
    if os.getuid() != 0:
        die("debe correr como root dentro de la distro dedicada")
    try:
        init = P.validate_init(read_exact_frame(STDIN))
    except P.ProtocolError as e:
        die("INIT inválido (%s): %s" % (e.code, e))
    if os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop") or os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop-late"):
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
