import { describe, expect, it } from 'vitest'
import { planOwnDelete } from './own-delete-plan'

describe('subconjunto compuesto cerrado, igual en Mac y WSL', () => {
  it.each(['/tarea', '/win/c/tarea', '/win/d/tarea'])('resuelve cd y conserva verificaciones en %s', (root) => {
    const p = planOwnDelete('cd .lazunox/trabajo && rm -rf x; test -e x || echo borrado', root)!
    expect(p.command.paths).toEqual([root + '/.lazunox/trabajo/x'])
    expect(p.directories).toEqual([root, root + '/.lazunox/trabajo'])
    expect(p.replacement).toBe(`cd -- '${root}/.lazunox/trabajo'&& :; test -e x|| echo borrado`)
  })
  it.each([';', '\n', '&&'])('reúne todos los borrados antes de las lecturas: %j', (separator) => {
    const p = planOwnDelete('rm a' + separator + 'rm b; ls', '/tarea')!
    expect(p.command.paths).toEqual(['/tarea/a', '/tarea/b'])
  })
  it('separa respetando comillas y admite comprobación con corchetes', () => {
    const p = planOwnDelete(`rm 'a;b'; [ -e 'a;b' ] || printf 'borrado'`, '/tarea')
    // El parser simple no admite separadores ni siquiera dentro del nombre de borrado.
    expect(p).toBeNull()
    expect(planOwnDelete(`rm 'a b'; [ -e 'a b' ] || printf 'borrado'`, '/tarea')).not.toBeNull()
  })
  it.each(['test -e', 'test -f', 'test -d', '[ -e', '[ -f', '[ -d'])(
    'planifica solo la guardia inmediata del mismo destino: %s',
    (prefix) => {
      const p = planOwnDelete(`${prefix} './a b'${prefix.startsWith('[') ? ' ]' : ''} && rm -rf 'a b'; ls`, '/tarea')!
      expect(p.guards).toEqual([{ path: '/tarea/a b', kind: prefix.slice(-2) }])
      expect(p.command.paths).toEqual(['/tarea/a b'])
      expect(p.replacement).toBe(':&& :; ls')
    }
  )
  it.each(['/tarea', '/win/c/tarea', '/win/d/tarea'])('resuelve la guardia tras cd en %s', (root) => {
    const p = planOwnDelete('cd sub && test -f ./a && rm a; ls', root)!
    expect(p.guards).toEqual([{ path: root + '/sub/a', kind: '-f' }])
    expect(p.command.paths).toEqual([root + '/sub/a'])
  })
  it.each([
    'test -e otro && rm a',
    'test -e A && rm a',
    'test -e é && rm é',
    'test -e a; rm a',
    'test -e a || rm a',
    'test -e a && true && rm a',
    'test -e a && rm a b',
    'test -s a && rm a',
    'test ! -e a && rm a',
    '[ -e a ] extra && rm a',
    'test -e a/ && rm -rf a',
    'test -e a/. && rm a',
    'test -f a && rm a/.',
    'test -e sub/../a && rm a',
    'cat a; test -e a && rm a',
    'rm a; ls; test -e b && rm b',
    'cd [ab]; rm x',
    'rm a; rm A',
    'rm é; rm é',
    'cd X; rm -rf /tarea/x',
    'rm a; printf fallo && rm b',
    'echo previo; rm a',
    'rm a || rm b',
    'echo no && rm a',
    'cat a; rm a',
    'rm a; ls; rm b',
    'rm a; cd x',
    'rm a; rm -f b',
    'rm a; rm a',
    'rm -rf a; rm -rf a/b',
    'cd x; rm -rf .',
    'cd ..; rm a',
    'cd ""; rm a',
    'rm a & echo fin',
    'rm a;; echo fin',
    'rm a &&',
    'rm a; echo "sin cerrar',
    'rm a; ls [ab]',
    'rm a; printf x\\n',
    'rm a; exec true',
    'rm a; echo $HOME',
    'rm a; echo `true`'
  ])('rechaza sin interpretar: %s', (source) => expect(planOwnDelete(source, '/tarea')).toBeNull())
})
