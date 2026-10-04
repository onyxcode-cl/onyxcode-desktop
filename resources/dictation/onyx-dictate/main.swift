// onyx-dictate: PROTOTIPO de medicion del dictado de voz de OnyxCode (Fase 0). NO esta integrado en la app.
//
// Captura el microfono con AVAudioEngine (audio SOLO en memoria), reconoce EN EL DISPOSITIVO y escribe
// una linea JSON por evento en stdout:
//   {"type":"state","state":"starting|listening|finishing|stopped|self-test-ok", ...}
//   {"type":"partial","text":"...","ms":N}     (texto provisional; ms = desde que empezo a escuchar)
//   {"type":"final","text":"...","ms":N}
//   {"type":"error","code":"...","message":"..."}   (sin texto dictado)
// Reglas: nunca escribe audio en disco; nunca registra el texto en stderr/logs; nunca usa el servidor
// (si el idioma no tiene modelo local imprime error "no-disponible" y sale).
//
// Uso: onyx-dictate [--locale es-CL|es-ES|en-US] [--max-seconds 120] [--silence-seconds 8]
//                   [--install] [--help] [--version] [--self-test]
// Salida limpia con SIGINT/SIGTERM (entrega lo pendiente y sale con 0).
import AVFoundation
import Foundation
import Speech

let VERSION = "0.1.0-fase0"
let ALLOWED_LOCALES = ["es-CL", "es-ES", "en-US"]
let HARD_MAX_SECONDS = 120.0
let MAX_TEXT_BYTES = 8 * 1024

// MARK: - Salida JSON

let outLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    outLock.lock()
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
    outLock.unlock()
}
func emitState(_ s: String, _ extra: [String: Any] = [:]) {
    var o: [String: Any] = ["type": "state", "state": s]
    for (k, v) in extra { o[k] = v }
    emit(o)
}
func emitError(_ code: String, _ message: String) { emit(["type": "error", "code": code, "message": message]) }
func clip(_ s: String) -> String {
    // Tope por texto (8 KiB), cortando en un limite de caracter valido.
    guard s.utf8.count > MAX_TEXT_BYTES else { return s }
    var out = ""
    for ch in s { if out.utf8.count + String(ch).utf8.count > MAX_TEXT_BYTES { break }; out.append(ch) }
    return out
}

// MARK: - Maquina de estados (pura; probada por --self-test)

enum Phase: String {
    case idle, starting, listening, finishing, stopped
    func canGo(to n: Phase) -> Bool {
        switch (self, n) {
        case (.idle, .starting), (.starting, .listening), (.starting, .finishing),
             (.listening, .finishing), (.finishing, .stopped), (.starting, .stopped), (.listening, .stopped):
            return true
        default: return false
        }
    }
}

// MARK: - Argumentos

struct Options {
    var locale = "es-CL"
    var maxSeconds = HARD_MAX_SECONDS
    var silenceSeconds = 8.0
    var install = false
}
struct ArgError: Error { let msg: String }
enum Command { case help, version, selfTest, listen(Options) }

func parseArgs(_ args: [String]) -> Result<Command, ArgError> {
    var o = Options()
    var i = 0
    while i < args.count {
        let a = args[i]
        func value() -> String? { i += 1; return i < args.count ? args[i] : nil }
        switch a {
        case "--help", "-h": return .success(.help)
        case "--version": return .success(.version)
        case "--self-test": return .success(.selfTest)
        case "--install": o.install = true
        case "--locale":
            guard let v = value(), ALLOWED_LOCALES.contains(v) else { return .failure(ArgError(msg: "--locale debe ser es-CL, es-ES o en-US")) }
            o.locale = v
        case "--max-seconds":
            guard let v = value(), let d = Double(v), d >= 1 else { return .failure(ArgError(msg: "--max-seconds invalido")) }
            o.maxSeconds = min(d, HARD_MAX_SECONDS)
        case "--silence-seconds":
            guard let v = value(), let d = Double(v), d >= 1 else { return .failure(ArgError(msg: "--silence-seconds invalido")) }
            o.silenceSeconds = d
        default: return .failure(ArgError(msg: "argumento desconocido: \(a)"))
        }
        i += 1
    }
    return .success(.listen(o))
}

let HELP = """
onyx-dictate \(VERSION) - dictado local (prototipo de medicion)
Uso: onyx-dictate [--locale es-CL|es-ES|en-US] [--max-seconds N<=120] [--silence-seconds N=8] [--install]
     onyx-dictate --help | --version | --self-test
Emite JSON por linea en stdout. Audio solo en memoria. Sin servidor: si no hay modelo local, error "no-disponible".
--install descarga (opt-in) el modelo de idioma del sistema (macOS 26+); no envia audio.
Ctrl+C o SIGTERM terminan limpiamente.
"""

// MARK: - Self-test (sin microfono)

func selfTest() -> Int32 {
    var ok = true
    func check(_ c: Bool, _ what: String) { if !c { ok = false; emitError("self-test", what) } }
    check(Phase.idle.canGo(to: .starting), "idle->starting")
    check(Phase.starting.canGo(to: .listening), "starting->listening")
    check(Phase.listening.canGo(to: .finishing), "listening->finishing")
    check(Phase.finishing.canGo(to: .stopped), "finishing->stopped")
    check(!Phase.stopped.canGo(to: .listening), "stopped->listening debe ser ilegal")
    check(!Phase.idle.canGo(to: .listening), "idle->listening debe ser ilegal")
    check(!Phase.finishing.canGo(to: .listening), "finishing->listening debe ser ilegal")
    check({ if case .failure = parseArgs(["--locale", "fr-FR"]) { return true } else { return false } }(), "locale invalido")
    check({ if case .success(.listen(let o)) = parseArgs(["--max-seconds", "999"]) { return o.maxSeconds == 120 } else { return false } }(), "tope 120 s")
    check(clip(String(repeating: "a", count: 20000)).utf8.count == MAX_TEXT_BYTES, "clip 8 KiB")
    // Secuencia fija del protocolo (frase ficticia, no es voz real).
    emitState("starting")
    emitState("listening", ["engine": "self-test", "locale": "es-CL"])
    emit(["type": "partial", "text": "hola qué", "ms": 400])
    emit(["type": "partial", "text": "hola qué tal \"comillas\" \\ y\nsalto", "ms": 700])
    emit(["type": "final", "text": "Hola, ¿qué tal?", "ms": 1200])
    emitState("finishing")
    emitError("no-disponible", "ejemplo de error de self-test")
    emitState("stopped", ["reason": "self-test"])
    emitState(ok ? "self-test-ok" : "self-test-fail")
    return ok ? 0 : 1
}

// MARK: - Sesion de escucha

final class Session {
    let opts: Options
    let q = DispatchQueue(label: "onyx-dictate.session")
    var phase: Phase = .idle
    let engine = AVAudioEngine()
    var t0 = Date()
    var lastVoice = Date()
    var heardVoice = false
    var firstPartialSent = false
    var pendingPartial = ""
    var endReason = "stopped"
    var timer: DispatchSourceTimer?
    var finishWork: (() async -> Void)?
    var legacyRequest: SFSpeechAudioBufferRecognitionRequest?
    var legacyTask: SFSpeechRecognitionTask?
    var yieldBuffer: ((AVAudioPCMBuffer) -> Void)?
    var finishInput: (() -> Void)?
    var legacyFinalSeen = false

    init(_ o: Options) { opts = o }

    func ms() -> Int { Int(Date().timeIntervalSince(t0) * 1000) }

    func go(_ n: Phase) -> Bool {
        guard phase.canGo(to: n) else { return false }
        phase = n
        return true
    }

    func fail(_ code: String, _ message: String) {
        emitError(code, message)
        cleanupAudio()
        _ = go(.stopped)
        emitState("stopped", ["reason": "error"])
        exit(2)
    }

    // Pide permisos. Informa (sin texto) cual se pidio, para la medicion del dueño.
    func authorize(needSpeech: Bool, _ done: @escaping (Bool) -> Void) {
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        emitState("permiso", ["mic": "\(micStatus.rawValue)", "speechNecesario": needSpeech])
        AVCaptureDevice.requestAccess(for: .audio) { micOK in
            guard micOK else { self.q.async { self.fail("mic-denegado", "Micrófono denegado") }; return }
            if !needSpeech { done(true); return }
            SFSpeechRecognizer.requestAuthorization { st in
                self.q.async {
                    if st == .authorized { done(true) } else { self.fail("voz-denegada", "Reconocimiento de voz denegado") }
                }
            }
        }
    }

    func start() {
        guard go(.starting) else { return }
        emitState("starting", ["locale": opts.locale, "maxSeconds": opts.maxSeconds, "silenceSeconds": opts.silenceSeconds])
        if #available(macOS 26.0, *) {
            Task { await self.startAnalyzer() }
        } else {
            q.async { self.startLegacy() }
        }
    }

    // MARK: motor SpeechAnalyzer (macOS 26+)
    @available(macOS 26.0, *)
    func startAnalyzer() async {
        let wanted = Locale(identifier: opts.locale)
        guard let loc = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else {
            fail("no-disponible", "Idioma \(opts.locale) no disponible en este Mac"); return
        }
        let transcriber = SpeechTranscriber(locale: loc, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        let status = await AssetInventory.status(forModules: [transcriber])
        if status != .installed {
            if opts.install, status == .supported || status == .downloading {
                emitState("instalando-modelo", ["locale": opts.locale])
                do {
                    if let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                        try await req.downloadAndInstall()
                    }
                } catch { fail("instalacion", "No se pudo instalar el modelo"); return }
            } else {
                fail("no-disponible", "Sin modelo local para \(opts.locale) (usa --install para descargarlo; no se usa el servidor)"); return
            }
        }
        authorize(needSpeech: false) { _ in
            Task { await self.runAnalyzer(transcriber) }
        }
    }

    @available(macOS 26.0, *)
    func runAnalyzer(_ transcriber: SpeechTranscriber) async {
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            fail("motor", "Sin formato de audio compatible"); return
        }
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        let input = engine.inputNode
        let inFmt = input.outputFormat(forBus: 0)
        guard inFmt.sampleRate > 0, let conv = AVAudioConverter(from: inFmt, to: fmt) else {
            fail("sin-microfono", "No hay entrada de audio utilizable"); return
        }
        yieldBuffer = { buf in
            let ratio = fmt.sampleRate / inFmt.sampleRate
            let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 32
            guard let outBuf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return }
            var consumed = false
            var err: NSError?
            conv.convert(to: outBuf, error: &err) { _, status in
                if consumed { status.pointee = .noDataNow; return nil }
                consumed = true; status.pointee = .haveData; return buf
            }
            if err == nil, outBuf.frameLength > 0 { cont.yield(AnalyzerInput(buffer: outBuf)) }
        }
        finishInput = { cont.finish() }
        let resultsTask = Task {
            do {
                for try await r in transcriber.results {
                    let text = String(r.text.characters)
                    self.q.async { self.onText(text, isFinal: r.isFinal) }
                }
            } catch { self.q.async { self.fail("motor", "Fallo del motor de reconocimiento") } }
        }
        finishWork = {
            self.finishInput?()
            try? await analyzer.finalizeAndFinishThroughEndOfInput()
            _ = await resultsTask.result
        }
        do {
            try await analyzer.start(inputSequence: stream)
            try startEngine(input: input, inFmt: inFmt)
        } catch { fail("motor", "No se pudo iniciar la captura o el analizador"); return }
        q.async { self.beginListening("analyzer") }
    }

    // MARK: motor legacy (macOS 13-25)
    func startLegacy() {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: opts.locale)), rec.supportsOnDeviceRecognition else {
            fail("no-disponible", "Sin modelo local para \(opts.locale) (no se usa el servidor)"); return
        }
        authorize(needSpeech: true) { _ in
            self.q.async {
                let req = SFSpeechAudioBufferRecognitionRequest()
                req.requiresOnDeviceRecognition = true      // NUNCA servidor
                req.shouldReportPartialResults = true
                if #available(macOS 13.0, *) { req.addsPunctuation = true }
                self.legacyRequest = req
                self.legacyTask = rec.recognitionTask(with: req) { result, error in
                    if let r = result { self.q.async { self.onText(r.bestTranscription.formattedString, isFinal: r.isFinal); if r.isFinal { self.legacyFinalSeen = true } } }
                    else if error != nil { self.q.async { self.legacyFinalSeen = true } }
                }
                self.yieldBuffer = { buf in req.append(buf) }
                let input = self.engine.inputNode
                let inFmt = input.outputFormat(forBus: 0)
                guard inFmt.sampleRate > 0 else { self.fail("sin-microfono", "No hay entrada de audio utilizable"); return }
                self.finishWork = {
                    req.endAudio()
                    for _ in 0..<30 where !self.legacyFinalSeen { try? await Task.sleep(nanoseconds: 100_000_000) }
                }
                do { try self.startEngine(input: input, inFmt: inFmt) } catch { self.fail("motor", "No se pudo iniciar la captura"); return }
                self.beginListening("legacy")
            }
        }
    }

    // MARK: captura (solo RAM)
    func startEngine(input: AVAudioInputNode, inFmt: AVAudioFormat) throws {
        input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { [weak self] buf, _ in
            guard let self else { return }
            var sum: Float = 0
            if let ch = buf.floatChannelData?[0] {
                let n = Int(buf.frameLength)
                for i in 0..<n { sum += ch[i] * ch[i] }
                let rms = n > 0 ? (sum / Float(n)).squareRoot() : 0
                if rms > 0.012 { self.q.async { self.heardVoice = true; self.lastVoice = Date() } }
            }
            self.yieldBuffer?(buf)
        }
        engine.prepare()
        try engine.start()
    }

    func beginListening(_ engineName: String) {
        guard go(.listening) else { return }
        t0 = Date(); lastVoice = Date()
        emitState("listening", ["engine": engineName, "locale": opts.locale])
        let tm = DispatchSource.makeTimerSource(queue: q)
        tm.schedule(deadline: .now() + 0.25, repeating: 0.25)
        tm.setEventHandler { [weak self] in
            guard let self, self.phase == .listening else { return }
            let now = Date()
            if now.timeIntervalSince(self.t0) >= self.opts.maxSeconds { self.finish("max") }
            else if now.timeIntervalSince(self.lastVoice) >= self.opts.silenceSeconds { self.finish("silence") }
        }
        tm.resume()
        timer = tm
    }

    func onText(_ text: String, isFinal: Bool) {
        guard phase == .listening || phase == .finishing, !text.isEmpty else { return }
        lastVoice = Date()
        let t = clip(text)
        if isFinal {
            pendingPartial = ""
            emit(["type": "final", "text": t, "ms": ms()])
        } else {
            pendingPartial = t
            firstPartialSent = true
            emit(["type": "partial", "text": t, "ms": ms()])
        }
    }

    func cleanupAudio() {
        timer?.cancel(); timer = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        yieldBuffer = nil
    }

    func finish(_ reason: String) {
        guard phase == .listening || phase == .starting, go(.finishing) else { return }
        endReason = reason
        emitState("finishing", ["reason": reason])
        cleanupAudio()
        let work = finishWork
        Task {
            await work?()
            self.q.async {
                if !self.pendingPartial.isEmpty { emit(["type": "final", "text": self.pendingPartial, "ms": self.ms()]) }
                _ = self.go(.stopped)
                emitState("stopped", ["reason": self.endReason])
                exit(0)
            }
        }
    }
}

// MARK: - main

switch parseArgs(Array(CommandLine.arguments.dropFirst())) {
case .failure(let e):
    emitError("argumentos", e.msg)
    FileHandle.standardError.write((HELP + "\n").data(using: .utf8)!)
    exit(64)
case .success(.help):
    print(HELP); exit(0)
case .success(.version):
    print("onyx-dictate \(VERSION)"); exit(0)
case .success(.selfTest):
    exit(selfTest())
case .success(.listen(let o)):
    let session = Session(o)
    signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
    var sources: [DispatchSourceSignal] = []
    for s in [SIGINT, SIGTERM] {
        let src = DispatchSource.makeSignalSource(signal: s, queue: session.q)
        src.setEventHandler {
            if session.phase == .idle || session.phase == .starting {
                emitState("stopped", ["reason": "signal"]); exit(0)
            }
            session.finish("signal")
        }
        src.resume()
        sources.append(src)
    }
    session.q.async { session.start() }
    dispatchMain()
}
