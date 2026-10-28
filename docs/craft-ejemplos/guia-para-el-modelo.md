# Crear presentaciones con diseño Lazunox

1. Escribe un archivo `spec.json` con SOLO el contenido (no hay comandos ni rutas). Formato: {"slides":[ ... ]}. Cada diapositiva tiene "type":

- cover {title (corto, p.ej. una palabra), subtitle, note, badge}
- stat {kicker, title, stat (cifra grande, p.ej. "4.000+"), statLabel, items:[2 x {title, body}]}
- timeline {kicker, title, items:[3 x {title, body}], callout}
- grid {kicker, title, items:[4 x {title, body}], footnote}
- steps {kicker, title, items:[4 x {title}]}
- compare {kicker, title, left:{label,text,foot}, right:{label,text,foot}}
- rows {kicker, title, rows:[2 a 4 x {label, value, note}]}
- quad {kicker, title, items:[4 x {title, body}]}
- stats {kicker, title, stat, statLabel, items:[3 x {value (1 carácter o número corto), label}]}
- closing {title, text, sources}
  Textos cortos: título ≤ 60 caracteres, cuerpo ≤ 90. Mezcla tipos distintos; empieza con cover y termina con closing.

2. Ejecuta: node lazunox-deck.mjs spec.json salida.pptx
3. Si da ERROR, corrige el spec.json según el mensaje y repite.

Regla importante: usa SOLO datos de la investigación o de lo que pidió la persona. No inventes cifras ni fechas (nada de «24/7», «0 peticiones» si no están en las fuentes).
