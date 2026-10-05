/**
 * Quita del marcado SOLO las clases con prefijo `desk:` (la variante de escritorio, que por construcción no actúa en el celular)
 * para que las guardias de «escritorio sin cambios» no se rompan cuando un componente compartido añade `desk:*`. No toca ningún
 * otro texto: los literales y los `.snap` no se editan ni se regeneran (nunca `vitest -u`).
 */
export const stripDesk = (html: string): string => html.replace(/ desk:[^\s"]+/g, '')
