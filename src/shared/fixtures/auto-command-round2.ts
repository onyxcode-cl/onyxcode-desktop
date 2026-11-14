// Comandos de la DB de la prueba Mac final. Solo se sustituye la raíz personal.
export function round2Commands(root: string): Array<{ command: string; tool: string; allowed: boolean }> {
  return [
    {
      command:
        'cd __ROOT__ && (python3 -m http.server 8765 >/tmp/caf1.log 2>&1 &) && sleep 1 && for p in / /index.html /menu.html /contacto.html /css/styles.css; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\\n" "http://127.0.0.1:8765$p"; done && echo "--- enlaces internos:" && grep -ho \'href="[^"#]*\\.html"\' *.html | sort | uniq -c && echo "--- hojas/scripts:" && grep -ho \'href="css[^"]*"\' *.html | sort | uniq -c && curl -s http://127.0.0.1:8765/contacto.html | grep -c "form-contacto" && pkill -f "http.server 8765"; echo done'.replaceAll(
          '__ROOT__',
          root
        ),
      tool: 'bash',
      allowed: false
    },
    {
      command: 'cd __ROOT__ && (python3 -m http.server 8765 >/tmp/caf1.log 2>&1 &) && sleep 1 && echo started'.replaceAll('__ROOT__', root),
      tool: 'bash',
      allowed: false
    },
    {
      command:
        "cd __ROOT__ && for f in index.html menu.html contacto.html; do python3 -c \"import html.parser,sys\nclass P(html.parser.HTMLParser):\n    def __init__(s): super().__init__(); s.st=[]; s.err=[]\n    def handle_starttag(s,t,a):\n        if t not in ('meta','link','input','br','img'): s.st.append(t)\n    def handle_endtag(t_s,t):\n        pass\np=P(); p.feed(open('$f').read()); print('$f', 'tags abiertos sin cerrar:', p.st)\"; done; node -e \"new Function(require('fs').readFileSync('contacto.html','utf8').split('<script>')[1].split('</script>')[0]); console.log('JS del formulario: sintaxis OK')\"; pkill -f \"http.server 8765\"; echo stopped".replaceAll(
          '__ROOT__',
          root
        ),
      tool: 'bash',
      allowed: false // Contiene pkill: requiere aprobación de ejecución aunque se autorice una ruta exterior.
    },
    {
      command:
        'cd __ROOT__ && test -f index.html && test -f menu.html && test -f contacto.html && test -f css/styles.css && echo OK'.replaceAll(
          '__ROOT__',
          root
        ),
      tool: 'todowrite',
      allowed: true
    },
    { command: 'python3 -m unittest -v 2>&1'.replaceAll('__ROOT__', root), tool: 'bash', allowed: true },
    { command: 'python3 -m unittest'.replaceAll('__ROOT__', root), tool: 'todowrite', allowed: true }
  ]
}
