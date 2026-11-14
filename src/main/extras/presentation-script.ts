/** Runs only in the isolated artifact window, after slide geometry and assets are ready. */
export function presentationScript(labels: { counter: string; controls: string }): string {
  return `(() => {
    const slides = [...document.querySelectorAll('.slide')];
    let current = 0;
    document.documentElement.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;background:#000';
    document.body.style.cssText = 'margin:0;width:100vw;height:100vh;overflow:hidden;background:#000';
    const counter = document.createElement('div');
    counter.setAttribute('data-lzx-slide-counter', '');
    counter.setAttribute('role', 'status');
    counter.setAttribute('aria-live', 'polite');
    counter.style.cssText = 'position:fixed!important;bottom:4px!important;right:12px!important;color:#fff!important;background:#000!important;font:14px/24px Arial,sans-serif!important;z-index:2147483647!important;pointer-events:none!important';
    const controls = document.createElement('div');
    controls.textContent = ${JSON.stringify(labels.controls)};
    controls.style.cssText = 'position:fixed!important;bottom:4px!important;left:12px!important;color:#ddd!important;background:#000!important;font:12px/24px Arial,sans-serif!important;z-index:2147483647!important;pointer-events:none!important';
    document.body.append(controls, counter);
    function show(index) {
      const next = Math.max(0, Math.min(index, slides.length - 1));
      slides.forEach((slide, n) => slide.style.setProperty('display', n === next ? (slide.dataset.lzxExportDisplay || 'block') : 'none', 'important'));
      current = next;
      counter.textContent = (current + 1) + ' / ' + slides.length;
      counter.setAttribute('aria-label', ${JSON.stringify(labels.counter)}.replace('{current}', String(current + 1)).replace('{total}', String(slides.length)));
    }
    function fit() {
      const availableHeight = Math.max(1, innerHeight - 32);
      const scale = Math.min(innerWidth / 960, availableHeight / 540);
      const x = (innerWidth - 960 * scale) / 2, y = (availableHeight - 540 * scale) / 2;
      slides.forEach(slide => {
        const values = { position:'fixed', left:x + 'px', top:y + 'px', right:'auto', bottom:'auto', zoom:'1', transformOrigin:'top left', transform:'scale(' + (scale * Number(slide.dataset.lzxExportScale || 1)) + ')' };
        for (const [key, value] of Object.entries(values)) slide.style.setProperty(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value, 'important');
      });
    }
    // Capture stops the deck's own navigation from advancing a second time. Layout never reloads.
    window.addEventListener('keydown', event => {
      let target;
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) target = current + 1;
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) target = current - 1;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = slides.length - 1;
      else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); window.close(); return; }
      else return;
      event.preventDefault(); event.stopImmediatePropagation(); show(target);
    }, true);
    window.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); show(current + 1); }, true);
    window.addEventListener('resize', fit);
    fit(); show(0);
  })()`
}
