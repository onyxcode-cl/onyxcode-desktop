// Descargas: busca la última versión PUBLICADA en GitHub y apunta cada botón a su archivo. Si no hay ninguna publicada (o GitHub no
// responde), los botones llevan a la lista de versiones. No envía datos: es una lectura pública de la API.
;(function () {
  var REPO = 'onyxcode-cl/onyxcode-desktop'
  var RELEASES = 'https://github.com/' + REPO + '/releases'

  // Marca el botón del sistema que está usando la persona (sin mover el otro).
  var ua = navigator.userAgent || ''
  var isMac = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)
  var isWin = /Windows/i.test(ua)
  var mac = document.getElementById('dl-mac')
  var win = document.getElementById('dl-win')
  if (isMac && mac) mac.classList.add('is-os')
  if (isWin && win) win.classList.add('is-os')

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('sin versión publicada'))
    })
    .then(function (rel) {
      var assets = rel.assets || []
      var dmg = assets.find(function (a) {
        return /arm64\.dmg$/i.test(a.name)
      })
      var exe = assets.find(function (a) {
        return /x64\.exe$/i.test(a.name)
      })
      var version = String(rel.tag_name || '').replace(/^v/, '')
      function wire(el, asset, label) {
        if (!el || !asset) return
        el.href = asset.browser_download_url
        var sub = el.querySelector('.btn-sub')
        if (sub) sub.textContent = label + ' · versión ' + version + ' · ' + (asset.size / 1048576).toFixed(0) + ' MB'
      }
      wire(mac, dmg, 'Chip Apple (M1 o posterior)')
      wire(win, exe, 'Windows 10 u 11, 64 bits')
      var note = document.getElementById('dl-note')
      if (note && (dmg || exe)) {
        var sums = assets.find(function (a) {
          return a.name === 'SHA256SUMS'
        })
        note.innerHTML =
          'Gratis, sin cuenta y sin pasar por una tienda.' +
          (sums ? ' Para verificar tu descarga, usa <a href="' + sums.browser_download_url + '">SHA256SUMS</a>.' : '') +
          ' Otras versiones: <a href="' +
          RELEASES +
          '">lista completa</a>.'
      }
    })
    .catch(function () {
      /* se quedan los enlaces a la lista de versiones */
    })

  // Botones «Copiar» de los comandos.
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
