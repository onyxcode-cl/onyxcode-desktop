/** Composiciones pequeñas para la revisión de cuadros: se usan también en el smoke real. */
export function qualityComposition(kind: 'clean' | 'overflow' | 'overlap' | 'gap' | 'narrow'): string {
  const content =
    kind === 'clean' || kind === 'gap'
      ? '<section style="position:absolute;left:90px;top:220px;width:900px;height:1480px;background:#316851"><p style="position:absolute;left:40px;top:40px;width:820px;height:100px">Contenido claro</p><p style="position:absolute;left:40px;top:1300px;width:820px;height:100px">Cierre visible</p></section>'
      : kind === 'overflow'
        ? '<p style="position:absolute;left:1000px;top:500px;width:300px;height:20px;white-space:nowrap;overflow:hidden">Texto que se sale del lienzo y de su caja</p>'
        : kind === 'overlap'
          ? '<p style="position:absolute;left:100px;top:500px;width:800px;height:100px">HORARIO</p><p style="position:absolute;left:100px;top:500px;width:800px;height:100px">Otro texto encima</p><div style="position:absolute;left:100px;top:520px;width:800px;height:8px;background:red;pointer-events:none"></div>'
          : '<p style="position:absolute;left:100px;top:850px;width:880px;height:100px">Una franja angosta</p>'
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}#main{position:relative;width:1080px;height:1920px;background:#18251d;color:white;font:64px/80px Arial}p{margin:0}</style><div id="main" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="9" data-fps="30">${content}</div><script src="../node_modules/gsap/dist/gsap.min.js"></script><script>const tl=gsap.timeline({paused:true});tl.to({},{duration:9},0);${kind === 'gap' ? "tl.set('section',{opacity:0},3.5);tl.set('section',{opacity:1},4.5);" : ''}window.__timelines={main:tl};</script>`
}
