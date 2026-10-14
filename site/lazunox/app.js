// Descargas directas desde este mismo sitio. `descargas/latest.json` (misma carpeta) dice la versión, el tamaño y la huella SHA-256 de cada
// instalador; aquí solo se muestra y se marca el botón del sistema de quien visita. Si no carga, los botones ya apuntan a los archivos.
;(function () {
  var ua = navigator.userAgent || ''
  var isMac = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)
  var isWin = /Windows/i.test(ua)
  var mac = document.getElementById('dl-mac')
  var win = document.getElementById('dl-win')
  if (isMac && mac) mac.classList.add('is-os')
  if (isWin && win) win.classList.add('is-os')

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
