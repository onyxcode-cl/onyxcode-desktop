/** V28 ronda 7: comandos completos de la copia de opencode.db del 15-nov.
 * Solo se sustituyó la raíz personal. Los permisos se reconstruyen con los patrones del
 * registro y el contrato ShellTool.ask; el log no conserva los payloads SSE completos.
 * caf2 termina en pkill; su otra petición pertenece a todowrite (kill %1).
 */
export const round7Commands: Array<{
  name: string
  project: string
  command: string
  patterns: string[]
  tool: string
  directories: string[]
  allowed: boolean
  workdir?: string
}> = [
  {
    name: 'caf-1',
    patterns: [
      'ls -la',
      'echo "--- enlaces href internos ---"',
      'echo --- enlaces href internos ---',
      'grep -oh \'href="[^"#]*"\' *.html',
      'grep -oh href="[^"#]*" *.html',
      'sort',
      'uniq -c',
      'echo "--- stylesheet ---"',
      'echo --- stylesheet ---',
      "grep -l 'styles.css' *.html",
      'grep -l styles.css *.html',
      'echo "--- validacion XML-ish (tidy si existe) ---"',
      'echo --- validacion XML-ish (tidy si existe) ---',
      'command -v tidy >/dev/null',
      'command -v tidy',
      'tidy',
      'echo "$f:"',
      'echo $f:',
      'tidy -q -e "$f" 2>&1',
      'tidy -q -e $f',
      'tail -3',
      'echo "tidy no instalado"',
      'echo tidy no instalado',
      'echo "--- servidor local y HTTP ---"',
      'echo --- servidor local y HTTP ---',
      'python3 -m http.server 8765 >/tmp/caf-server.log 2>&1',
      'python3 -m http.server 8765',
      'sleep 2',
      'echo -n "$p -> "',
      'echo -n $p ->',
      'curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8765/$p',
      'curl -s -o /dev/null -w %{http_code}\\n http://127.0.0.1:8765/$p'
    ],
    project: '/fixture/adjunto/mac/caf',
    command:
      'cd /fixture/adjunto/mac/caf && ls -la && echo "--- enlaces href internos ---" && grep -oh \'href="[^"#]*"\' *.html | sort | uniq -c && echo "--- stylesheet ---" && grep -l \'styles.css\' *.html && echo "--- validacion XML-ish (tidy si existe) ---" && (command -v tidy >/dev/null && for f in *.html; do echo "$f:"; tidy -q -e "$f" 2>&1 | tail -3; done || echo "tidy no instalado") && echo "--- servidor local y HTTP ---" && (python3 -m http.server 8765 >/tmp/caf-server.log 2>&1 &) && sleep 2 && for p in index.html menu.html contacto.html styles.css; do echo -n "$p -> "; curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8765/$p; done',
    tool: 'bash',
    directories: ['/tmp'],
    allowed: true
  },
  {
    name: 'caf-2',
    patterns: [
      "python3 -c \"import html.parser,sys\nclass P(html.parser.HTMLParser):\n    def __init__(s): super().__init__(); s.st=[]; s.err=[]\n    v={'meta','link','input','br','img','hr'}\n    def handle_starttag(s,t,a):\n        if t not in s.v: s.st.append(t)\n    def handle_endtag(s,t):\n        if t in s.v: return\n        if s.st and s.st[-1]==t: s.st.pop()\n        else: s.err.append((t,s.getpos()))\np=P(); p.feed(open('$f',encoding='utf-8').read())\nprint('$f', 'OK' if not p.err and not p.st else ('ERR',p.err,p.st))\"",
      "python3 -c import html.parser,sys\nclass P(html.parser.HTMLParser):\n    def __init__(s): super().__init__(); s.st=[]; s.err=[]\n    v={'meta','link','input','br','img','hr'}\n    def handle_starttag(s,t,a):\n        if t not in s.v: s.st.append(t)\n    def handle_endtag(s,t):\n        if t in s.v: return\n        if s.st and s.st[-1]==t: s.st.pop()\n        else: s.err.append((t,s.getpos()))\np=P(); p.feed(open('$f',encoding='utf-8').read())\nprint('$f', 'OK' if not p.err and not p.st else ('ERR',p.err,p.st))"
    ],
    project: '/fixture/adjunto/mac/caf',
    command:
      "cd /fixture/adjunto/mac/caf && for f in *.html; do python3 -c \"import html.parser,sys\nclass P(html.parser.HTMLParser):\n    def __init__(s): super().__init__(); s.st=[]; s.err=[]\n    v={'meta','link','input','br','img','hr'}\n    def handle_starttag(s,t,a):\n        if t not in s.v: s.st.append(t)\n    def handle_endtag(s,t):\n        if t in s.v: return\n        if s.st and s.st[-1]==t: s.st.pop()\n        else: s.err.append((t,s.getpos()))\np=P(); p.feed(open('$f',encoding='utf-8').read())\nprint('$f', 'OK' if not p.err and not p.st else ('ERR',p.err,p.st))\"; done",
    tool: 'bash',
    directories: [],
    allowed: true
  },
  {
    name: 'caf-3',
    patterns: [
      'pkill -f "http.server 8765"',
      'pkill -f http.server 8765',
      'sleep 1',
      'pgrep -f "http.server 8765"',
      'pgrep -f http.server 8765',
      'echo "servidor detenido"',
      'echo servidor detenido'
    ],
    project: '/fixture/adjunto/mac/caf',
    command: 'pkill -f "http.server 8765" ; sleep 1; pgrep -f "http.server 8765" || echo "servidor detenido"',
    tool: 'bash',
    directories: [],
    allowed: false
  },
  {
    name: 'adj2-4',
    patterns: ['ls -la modelo.glb', 'file modelo.glb', 'xxd -l 12 modelo.glb', 'python3'],
    project: '/fixture/adjunto/mac/adj2',
    command:
      "cd /fixture/adjunto && ls -la modelo.glb && file modelo.glb && xxd -l 12 modelo.glb && python3 - <<'EOF'\nimport struct, json\nwith open('modelo.glb','rb') as f:\n    magic, ver, length = struct.unpack('<4sII', f.read(12))\n    print('magic:', magic, 'version:', ver, 'length:', length)\n    while True:\n        h = f.read(8)\n        if len(h) < 8: break\n        clen, ctype = struct.unpack('<II', h)\n        data = f.read(clen)\n        print('chunk type:', hex(ctype), 'size:', clen)\n        if ctype == 0x4E4F534A:\n            j = json.loads(data.decode('utf-8'))\n            print(json.dumps({k: (v if k not in ('bufferViews','accessors') else f'{len(v)} items') for k,v in j.items()}, indent=1, ensure_ascii=False)[:4000])\nEOF",
    tool: 'bash',
    directories: ['/fixture/adjunto'],
    allowed: true,
    workdir: '/fixture/adjunto'
  },
  {
    name: 'adj2-5',
    patterns: ['python3', 'python3 -c "\nimport numpy" 2>/dev/null', 'python3 -c \nimport numpy', 'echo numpy_ok', 'ls'],
    project: '/fixture/adjunto/mac/adj2',
    command:
      "cd /fixture/adjunto && python3 - <<'EOF'\nimport struct, json\nimport sys\nwith open('modelo.glb','rb') as f:\n    f.seek(12)\n    clen, _ = struct.unpack('<II', f.read(8))\n    j = json.loads(f.read(clen))\nprint(json.dumps(j['accessors'], indent=1)); print(json.dumps(j['bufferViews'], indent=1))\nEOF\npython3 -c \"\nimport numpy\" 2>/dev/null && echo numpy_ok; ls",
    tool: 'bash',
    directories: ['/fixture/adjunto'],
    allowed: true
  },
  {
    name: 'adj2-6',
    patterns: ['python3'],
    project: '/fixture/adjunto/mac/adj2',
    command:
      "cd /fixture/adjunto && python3 - <<'EOF'\nimport struct, collections\nwith open('modelo.glb','rb') as f:\n    f.seek(12+8+384+8)\n    b = f.read()\nprint(len(b), 'bytes bin chunk')\nprint('first 36 bytes floats:', struct.unpack('<9f', b[:36]))\nrest = b[36:]\nprint('unique byte values in rest (sample):', collections.Counter(rest[:1000000]).most_common(3))\nprint('all zero in rest sample:', rest[:1000000].count(0)==len(rest[:1000000]))\nEOF",
    tool: 'bash',
    directories: ['/fixture/adjunto'],
    allowed: true
  },
  {
    name: 'caf2-7',
    patterns: [
      'ls -la',
      'python3 -m http.server 8765 >/dev/null 2>&1',
      'python3 -m http.server 8765',
      'sleep 1',
      'curl -s -o /dev/null -w "%{http_code} $p\\n" http://localhost:8765/$p',
      'curl -s -o /dev/null -w %{http_code} $p\\n http://localhost:8765/$p',
      'echo "--- enlaces internos ---"',
      'echo --- enlaces internos ---',
      'grep -oh \'href="[^"#]*\\.html"\' *.html',
      'grep -oh href="[^"#]*\\.html" *.html',
      'sort',
      'uniq -c',
      'echo "--- stylesheet ---"',
      'echo --- stylesheet ---',
      'grep -l \'href="style.css"\' *.html',
      'grep -l href="style.css" *.html',
      'echo "--- html válido básico ---"',
      'echo --- html válido básico ---',
      "python3 -c \"import html.parser,sys\nclass P(html.parser.HTMLParser):\n  def __init__(s): super().__init__(); s.st=[]; s.err=0\n  def handle_starttag(s,t,a):\n    if t not in ('meta','link','br','input','img','hr'): s.st.append(t)\n  def handle_endtag(s,t):\n    if t in s.st and s.st[-1]==t: s.st.pop()\n    else: s.err+=1\np=P(); p.feed(open('$f',encoding='utf-8').read()); print('$f', 'OK' if not p.err and not p.st else 'REVISAR', p.err, p.st)\"",
      "python3 -c import html.parser,sys\nclass P(html.parser.HTMLParser):\n  def __init__(s): super().__init__(); s.st=[]; s.err=0\n  def handle_starttag(s,t,a):\n    if t not in ('meta','link','br','input','img','hr'): s.st.append(t)\n  def handle_endtag(s,t):\n    if t in s.st and s.st[-1]==t: s.st.pop()\n    else: s.err+=1\np=P(); p.feed(open('$f',encoding='utf-8').read()); print('$f', 'OK' if not p.err and not p.st else 'REVISAR', p.err, p.st)",
      'pkill -f "http.server 8765"',
      'pkill -f http.server 8765'
    ],
    project: '/fixture/adjunto/mac/caf2',
    command:
      "cd /fixture/adjunto/mac/caf2 && ls -la && (python3 -m http.server 8765 >/dev/null 2>&1 &) && sleep 1 && for p in index.html menu.html contacto.html style.css; do curl -s -o /dev/null -w \"%{http_code} $p\\n\" http://localhost:8765/$p; done; echo \"--- enlaces internos ---\"; grep -oh 'href=\"[^\"#]*\\.html\"' *.html | sort | uniq -c; echo \"--- stylesheet ---\"; grep -l 'href=\"style.css\"' *.html; echo \"--- html válido básico ---\"; for f in *.html; do python3 -c \"import html.parser,sys\nclass P(html.parser.HTMLParser):\n  def __init__(s): super().__init__(); s.st=[]; s.err=0\n  def handle_starttag(s,t,a):\n    if t not in ('meta','link','br','input','img','hr'): s.st.append(t)\n  def handle_endtag(s,t):\n    if t in s.st and s.st[-1]==t: s.st.pop()\n    else: s.err+=1\np=P(); p.feed(open('$f',encoding='utf-8').read()); print('$f', 'OK' if not p.err and not p.st else 'REVISAR', p.err, p.st)\"; done; pkill -f \"http.server 8765\"",
    tool: 'bash',
    directories: [],
    allowed: false
  },
  {
    name: 'caf2-8',
    patterns: [
      'python3 -m http.server 8765',
      'sleep 1',
      'curl -sf -o /dev/null -w "%{http_code} $p\\n" http://localhost:8765/$p',
      'curl -sf -o /dev/null -w %{http_code} $p\\n http://localhost:8765/$p',
      'exit 1',
      'kill %1'
    ],
    project: '/fixture/adjunto/mac/caf2',
    command:
      'cd /fixture/adjunto/mac/caf2 && python3 -m http.server 8765 >/dev/null 2>&1 & sleep 1; for p in index.html menu.html contacto.html style.css; do curl -sf -o /dev/null -w "%{http_code} $p\\n" http://localhost:8765/$p || exit 1; done; kill %1',
    tool: 'todowrite',
    directories: [],
    allowed: false
  }
]
