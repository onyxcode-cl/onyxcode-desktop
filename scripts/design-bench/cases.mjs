/** Contenido fijo: se cambia guía o armador, nunca los datos entre control y candidato. */
export const CASES = [
  {
    id: 'D01',
    topic: 'museo-marino',
    title: 'Conservación marina',
    audience: 'visitantes y equipo educativo de un museo marino',
    tone: 'documental, sereno y editorial',
    facts: [
      'El programa observa 12 playas y 4 humedales.',
      'Participan 240 voluntarios y 18 escuelas.',
      'Se retiraron 3,2 toneladas de residuos.',
      'La próxima campaña dura 8 semanas.'
    ],
    action: 'Invitar a una jornada de observación y limpieza; distinguir educación de resultados científicos.'
  },
  {
    id: 'D02',
    topic: 'comite-financiero',
    title: 'Decisiones del comité financiero',
    audience: 'comité financiero',
    tone: 'sobrio, preciso y ejecutivo',
    facts: [
      'Ingresos: 12,4 millones; presupuesto: 12,0 millones.',
      'Costos: 8,1 millones; presupuesto: 7,8 millones.',
      'Caja disponible: 2,6 millones.',
      'Inversión propuesta: 0,9 millones; plazo: 18 meses.'
    ],
    action: 'Comparar presupuesto y resultado, identificar el desvío de costos y pedir aprobación de la inversión.'
  },
  {
    id: 'D03',
    topic: 'cafeteria',
    title: 'Cafetería Patio Sur',
    audience: 'socios de una cafetería de barrio',
    tone: 'cálido, artesanal y cercano',
    facts: [
      'Local de 68 m² con 24 asientos.',
      'Carta: café de filtro, pan de masa madre y repostería de temporada.',
      'Ticket objetivo: 6.800 pesos; 90 ventas diarias.',
      'Apertura prevista en 12 semanas.'
    ],
    action: 'Explicar experiencia, operación y calendario; invitar a probar la carta.'
  },
  {
    id: 'D04',
    topic: 'seguridad-laboral',
    title: 'Trabajo seguro en bodega',
    audience: 'personal nuevo de una bodega',
    tone: 'directo, didáctico y preventivo',
    facts: [
      'Revisar equipo y rutas antes del turno.',
      'Mantener libres las salidas y separar peatones de vehículos.',
      'Reportar daños y detener el trabajo ante riesgo inmediato.',
      'Simulacro de evacuación: viernes a las 10:00.'
    ],
    action: 'Presentar pasos y una lista de comprobación, sin inventar normas ni garantías legales.'
  },
  {
    id: 'D05',
    topic: 'arquitectura',
    title: 'Biblioteca de barrio',
    audience: 'jurado de un proyecto de arquitectura',
    tone: 'espacial, sobrio y visual',
    facts: [
      'Superficie: 820 m²; patio central: 160 m².',
      'Tres áreas: lectura, talleres y servicios.',
      'Estructura de madera y luz natural controlada.',
      'Etapas: anteproyecto 6 semanas; proyecto 10 semanas; obra 32 semanas.'
    ],
    action: 'Comparar los usos y explicar circulación y relación con el patio; no inventar planos.'
  },
  {
    id: 'D06',
    topic: 'investigacion',
    title: 'Vegetación y temperatura urbana',
    audience: 'seminario de investigación científica',
    tone: 'riguroso, legible y prudente',
    facts: [
      'Estudio observacional de 24 plazas durante 8 semanas.',
      'Temperatura media: 29,1 °C con vegetación alta; 31,3 °C con vegetación baja.',
      'Se midió a las 14:00 con el mismo protocolo.',
      'Limitaciones: una estación y ausencia de asignación aleatoria.'
    ],
    action: 'Separar método, resultado y limitaciones; no atribuir causalidad ni inventar bibliografía.'
  },
  {
    id: 'D07',
    topic: 'campana-cultural',
    title: 'Noches de barrio',
    audience: 'vecinos y organizaciones culturales',
    tone: 'expresivo, festivo y accesible',
    facts: [
      'Festival gratuito durante tres sábados de noviembre.',
      'Programa: cine, música local y talleres de grabado.',
      'Cuatro sedes; 36 artistas; aforo total de 600 personas.',
      'Inscripción presencial y por formulario desde el 15 de octubre.'
    ],
    action: 'Hacer clara la invitación, el programa y la inscripción.'
  },
  {
    id: 'D08',
    topic: 'carta-formal',
    title: 'Propuesta de colaboración',
    audience: 'dirección de una biblioteca pública',
    tone: 'formal, breve y respetuoso',
    facts: [
      'Remitente ficticio: Asociación Lectura Abierta.',
      'Propuesta: cuatro talleres de lectura para 20 participantes.',
      'Duración por taller: 90 minutos; los miércoles de mayo.',
      'La asociación aporta facilitadores y materiales; solicita sala y difusión.'
    ],
    action: 'Solicitar una reunión y cerrar con firma institucional; en Word/PDF usar carta sin portada adicional.'
  },
  {
    id: 'D09',
    topic: 'manual-tecnico',
    title: 'Operación del registrador de datos',
    audience: 'operadores de un instrumento ficticio',
    tone: 'técnico, ordenado y funcional',
    facts: [
      'Preparación: conectar sensor y comprobar batería superior al 40 %.',
      'Registro: fijar intervalo en 30 segundos y pulsar Iniciar.',
      'Exportación: detener registro, conectar USB y exportar CSV.',
      'Error E02: sensor desconectado; E05: memoria llena.'
    ],
    action: 'Organizar pasos, tabla de errores y comprobación final; conservar literalmente E02 y E05.'
  },
  {
    id: 'D10',
    topic: 'informe-marca',
    title: 'Informe de Casa Bosque',
    audience: 'clientes de una marca ficticia de mobiliario',
    tone: 'editorial, cálido y coherente con la marca aportada',
    facts: [
      'Marca: fondo #F6F1E8, texto #24362B y acento #7D432A; títulos Georgia y cuerpo Arial.',
      'Producción: 320 unidades; 82 % de madera recuperada.',
      'Tres colecciones: Patio, Taller y Refugio.',
      'Plazo de entrega: 6 semanas; garantía comercial descrita por el cliente, sin inventarla.'
    ],
    action: 'Respetar exactamente los colores y fuentes; usar assets/brand-logo.png y assets/brand-photo.jpg, aportados para este banco.'
  }
]

export const FORMATS = ['pptx', 'docx', 'pdf']

export function makePrompt(item, format, guide) {
  const shape =
    format === 'pptx'
      ? 'Devuelve una presentación editable de exactamente 6 láminas como un único bloque ```pptx con el JSON PptxSpec.'
      : format === 'docx'
        ? 'Devuelve un documento Word como un único bloque ```docx con el JSON DocxSpec; unas 2 páginas, salvo la carta, que debe ser breve.'
        : 'Devuelve un documento PDF como un único bloque ```html con HTML y CSS autónomos; unas 2 páginas, salvo la carta breve. No incluyas scripts ni recursos de red.'
  return `${guide}\n\nPEDIDO DEL BANCO (datos ficticios, idénticos en control y candidato)\n${shape}\nTítulo: ${item.title}.\nDestinatarios: ${item.audience}. Tono: ${item.tone}.\n${item.facts.map((x) => '- ' + x).join('\n')}\n${item.action}\nDecide la identidad y la composición según el pedido. Conserva todos los datos; no inventes cifras, fotos ni fuentes. No uses herramientas: entrega directamente el bloque completo. El armador se ejecutará después. Las únicas imágenes disponibles son las mencionadas expresamente en el pedido. No hagas preguntas.\n`
}
