// Descargas directas desde este mismo sitio. `descargas/latest.json` (misma carpeta) dice la versión, el tamaño y la huella SHA-256 de cada
// instalador. Aquí solo se detecta el sistema para poner primero la descarga que te corresponde; no se envía nada a ningún sitio.
;(function () {
  var ua = navigator.userAgent || ''
  var isMobile = /iPhone|iPad|iPod|Android/i.test(ua)
  var isMac = /Macintosh|Mac OS X/i.test(ua) && !isMobile
  var isWin = /Windows/i.test(ua) && !isMobile
  var mac = document.getElementById('dl-mac')
  var win = document.getElementById('dl-win')
  var box = document.getElementById('downloads')
  var other = document.getElementById('other-os')

  function show(id, on) {
    var el = document.getElementById(id)
    if (el) el.hidden = !on
  }

  if (isMobile) {
    // Lazunox es de computador: se avisa y se ofrece copiar el enlace para abrirlo desde el Mac o el PC.
    show('mobile-note', true)
    if (box) box.classList.add('is-mobile')
    var dlSub = document.getElementById('dl-sub')
    if (dlSub) dlSub.textContent = 'Para Mac y Windows'
    var cp = document.getElementById('copy-link')
    if (cp) {
      cp.addEventListener('click', function () {
        if (!navigator.clipboard) return
        navigator.clipboard.writeText(location.origin + location.pathname).then(function () {
          cp.textContent = 'Enlace copiado'
        })
      })
    }
  } else if (isMac || isWin) {
    if (box) box.classList.add('has-os')
    ;(isMac ? mac : win).classList.add('is-os')
    show('other-os', false)
    var link = document.getElementById('other-os-link')
    if (link) link.textContent = 'Ver las dos descargas'
  }

  if (isMac) {
    // Los navegadores casi nunca dicen si el Mac es Intel o Apple Silicon: se pregunta con la forma de comprobarlo. Si el navegador sí lo
    // informa (Chrome y derivados) y es Intel, se avisa con más fuerza.
    show('chip-note', true)
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      navigator.userAgentData
        .getHighEntropyValues(['architecture'])
        .then(function (v) {
          if (v && v.architecture === 'x86') {
            show('chip-note', false)
            show('chip-warn', true)
          }
        })
        .catch(function () {})
    }
  }

  fetch('descargas/latest.json', { cache: 'no-cache' })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('sin manifiesto'))
    })
    .then(function (m) {
      function wire(el, f, label, shaId) {
        if (!f) return
        if (el) {
          el.href = 'descargas/' + f.file
          var sub = el.querySelector('.btn-sub')
          if (sub) sub.textContent = label + ' · versión ' + m.version + ' · ' + Math.round(f.size / 1048576) + ' MB'
        }
        var sha = document.getElementById(shaId)
        if (sha) sha.textContent = f.sha256
      }
      wire(mac, m.files && m.files.mac, 'Chip Apple (M1 o posterior)', 'sha-mac')
      wire(win, m.files && m.files.win, 'Windows 10 u 11, 64 bits', 'sha-win')
    })
    .catch(function () {})

  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = document.getElementById(btn.getAttribute('data-copy'))
      if (!code || !navigator.clipboard) return
      navigator.clipboard.writeText(code.textContent).then(function () {
        var old = btn.textContent
        btn.textContent = 'Copiado'
        setTimeout(function () {
          btn.textContent = old
        }, 1600)
      })
    })
  })
})()
