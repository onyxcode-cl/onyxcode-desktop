"""Multiplexor de flujos del lanzador de Tareas (F8-B81): una sola hebra, `selectors`, sin privilegios.

Une la stdio de `wsl.exe` (tramas de protocol.py) con sockets TCP de 127.0.0.1 DENTRO del espacio de red vacío:
  - flujos 'out' (agente -> Windows): un listener por puerto de `relay_ports` (mismo número que en Windows, así el
    entorno y la configuración no se reescriben); cada conexión abre un flujo PAR hacia Windows, que decide si el
    puerto está permitido (el anfitrión rechaza cualquier otro);
  - flujos 'in' (Windows -> servidor): Windows abre un flujo IMPAR con el puerto del servidor; aquí solo se acepta
    EXACTAMENTE `server_port`.
Control de flujo por créditos (WINDOW) y topes duros (256 flujos, tramas <= 1 MiB, cola de salida acotada).
Cualquier violación del protocolo corta la sesión (Mux.run() devuelve el motivo).
"""
import errno
import os
import selectors
import socket

import protocol as P

LOOPBACK = "127.0.0.1"
OUT_CAP = 16 * 1024 * 1024  # bytes pendientes hacia wsl.exe antes de abortar
GRANT_BATCH = 32 * 1024


class Stream:
    __slots__ = ("id", "sock", "send_window", "outbuf", "consumed", "reading", "closing")

    def __init__(self, sid, sock):
        self.id = sid
        self.sock = sock
        self.send_window = P.INITIAL_WINDOW  # créditos para enviar al otro lado
        self.outbuf = bytearray()  # datos de Windows pendientes de escribir al socket
        self.consumed = 0  # bytes ya escritos al socket y aún no devueltos como WINDOW
        self.reading = False
        self.closing = False


class Mux:
    def __init__(self, rfd, wfd, relay_ports, server_port):
        self.rfd, self.wfd = rfd, wfd
        self.relay_ports = list(relay_ports)
        self.server_port = server_port
        self.sel = selectors.DefaultSelector()
        self.decoder = P.FrameDecoder()
        self.streams = {}
        self.out = bytearray()
        self.next_id = 2
        self.listeners = []
        self.done = None
        os.set_blocking(rfd, False)
        os.set_blocking(wfd, False)

    # ── salida hacia wsl.exe ──
    def send(self, sid, typ, data=b""):
        self.out += P.encode_frame(sid, typ, data)
        if len(self.out) > OUT_CAP:
            self.abort("closed")
            return
        self._update_stdout()

    def _update_stdout(self):
        try:
            self.sel.unregister(self.wfd)
        except (KeyError, ValueError):
            pass
        if self.out:
            self.sel.register(self.wfd, selectors.EVENT_WRITE, ("stdout", None))

    def abort(self, reason):
        if self.done is None:
            self.done = reason

    # ── ciclo principal ──
    def start(self):
        self.sel.register(self.rfd, selectors.EVENT_READ, ("stdin", None))
        for port in self.relay_ports:
            ls = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            ls.bind((LOOPBACK, port))
            ls.listen(32)
            ls.setblocking(False)
            self.listeners.append(ls)
            self.sel.register(ls, selectors.EVENT_READ, ("listen", port))

    def run(self, should_stop=lambda: False):
        """Corre hasta EOF de stdin, violación del protocolo o `should_stop()`. Devuelve el motivo."""
        while self.done is None and not should_stop():
            for key, events in self.sel.select(timeout=0.5):
                kind, arg = key.data
                try:
                    if kind == "stdin":
                        self._on_stdin()
                    elif kind == "stdout":
                        self._on_stdout()
                    elif kind == "listen":
                        self._on_accept(key.fileobj, arg)
                    elif kind == "sock":
                        self._on_sock(arg, events)
                except P.ProtocolError as e:
                    self.abort(e.code)
                if self.done is not None:
                    break
        return self.done or "stopped"

    def close_all(self):
        for sid in list(self.streams):
            self._drop(sid, notify=False)
        for ls in self.listeners:
            try:
                self.sel.unregister(ls)
            except (KeyError, ValueError):
                pass
            ls.close()
        self.listeners = []

    # ── entrada desde wsl.exe ──
    def _on_stdin(self):
        try:
            chunk = os.read(self.rfd, 65536)
        except BlockingIOError:
            return
        if not chunk:
            self.abort("eof")
            return
        for sid, typ, data in self.decoder.push(chunk):
            self._frame(sid, typ, data)
            if self.done is not None:
                return

    def _on_stdout(self):
        try:
            n = os.write(self.wfd, self.out)
        except BlockingIOError:
            return
        except BrokenPipeError:
            self.abort("eof")
            return
        del self.out[:n]
        self._update_stdout()

    def _frame(self, sid, typ, data):
        if typ == P.OPEN:
            if P.id_owner(sid) != "host":
                raise P.ProtocolError("bad_id")
            port = P.decode_port(data)
            if port != self.server_port:
                self.send(sid, P.ERROR, P.encode_error("port_denied", "solo el puerto del servidor"))
                self.send(sid, P.CLOSE)
                return
            if sid in self.streams:
                raise P.ProtocolError("bad_id")
            if len(self.streams) >= P.MAX_STREAMS:
                raise P.ProtocolError("too_many_streams")
            try:
                s = socket.create_connection((LOOPBACK, self.server_port), timeout=2)
            except OSError as e:
                self.send(sid, P.ERROR, P.encode_error("closed", "servidor no accesible: %s" % errno.errorcode.get(e.errno, "?")))
                self.send(sid, P.CLOSE)
                return
            self._add(sid, s)
        elif typ == P.DATA:
            st = self.streams.get(sid)
            if st is None:
                self.send(sid, P.ERROR, P.encode_error("stream_unknown"))
                return
            st.outbuf += data
            self._update_sock(st)
        elif typ == P.CLOSE:
            self._drop(sid, notify=False)
        elif typ == P.WINDOW:
            st = self.streams.get(sid)
            if st is None:
                return
            credits = P.decode_window(data)
            if st.send_window + credits > 0xFFFFFFFF:
                raise P.ProtocolError("window_exceeded")
            st.send_window += credits
            self._update_sock(st)
        elif typ == P.PING:
            self.send(0, P.PONG, data[:64])
        elif typ in (P.PONG, P.ERROR):
            pass
        else:  # INIT/READY/EXIT no vienen de Windows tras el arranque
            raise P.ProtocolError("bad_type")

    # ── sockets ──
    def _add(self, sid, sock):
        sock.setblocking(False)
        st = Stream(sid, sock)
        self.streams[sid] = st
        self._update_sock(st)

    def _update_sock(self, st):
        mask = 0
        want_read = st.send_window > 0 and not st.closing
        if want_read:
            mask |= selectors.EVENT_READ
        if st.outbuf:
            mask |= selectors.EVENT_WRITE
        try:
            self.sel.unregister(st.sock)
        except (KeyError, ValueError):
            pass
        if mask:
            self.sel.register(st.sock, mask, ("sock", st.id))
        st.reading = want_read

    def _on_accept(self, ls, port):
        try:
            conn, _ = ls.accept()
        except (BlockingIOError, InterruptedError):
            return
        if len(self.streams) >= P.MAX_STREAMS:
            conn.close()
            return
        sid = self.next_id
        self.next_id += 2
        if self.next_id > 0xFFFFFFFE:
            self.abort("too_many_streams")
            conn.close()
            return
        self._add(sid, conn)
        self.send(sid, P.OPEN, P.encode_port(port))

    def _on_sock(self, sid, events):
        st = self.streams.get(sid)
        if st is None:
            return
        if events & selectors.EVENT_WRITE and st.outbuf:
            try:
                n = st.sock.send(st.outbuf)
            except (BlockingIOError, InterruptedError):
                n = 0
            except OSError:
                self._drop(sid, notify=True)
                return
            del st.outbuf[:n]
            st.consumed += n
            if st.consumed >= GRANT_BATCH or (not st.outbuf and st.consumed):
                self.send(sid, P.WINDOW, P.encode_window(st.consumed))
                st.consumed = 0
            self._update_sock(st)
        if events & selectors.EVENT_READ and st.send_window > 0:
            try:
                data = st.sock.recv(min(65536, st.send_window, P.MAX_FRAME_DATA))
            except (BlockingIOError, InterruptedError):
                return
            except OSError:
                self._drop(sid, notify=True)
                return
            if not data:
                self._drop(sid, notify=True)
                return
            st.send_window -= len(data)
            self.send(sid, P.DATA, data)
            self._update_sock(st)

    def _drop(self, sid, notify):
        st = self.streams.pop(sid, None)
        if st is None:
            return
        try:
            self.sel.unregister(st.sock)
        except (KeyError, ValueError):
            pass
        st.sock.close()
        if notify:
            self.send(sid, P.CLOSE)
