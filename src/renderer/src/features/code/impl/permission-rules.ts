import type { PermissionRuleset } from '@opencode-ai/sdk/v2/client'
import type { PermissionMode } from './types'

/** ¿Dos rulesets son iguales (mismas reglas, mismo orden)? */
export function sameRuleset(a: PermissionRuleset | undefined, b: PermissionRuleset | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

/**
 * Traduce un `PermissionMode` a un `PermissionRuleset` para `session.update`. `undefined` deja
 * el ruleset de la sesión sin tocar (se usa para 'plan', que no depende de permisos sino del agente).
 */
export function rulesetFor(mode: PermissionMode): PermissionRuleset | undefined {
  switch (mode) {
    case 'manual':
      // Ruleset vacío no equivale a "preguntar por todo": si no hay reglas, el agente cae a su
      // configuración por defecto (que puede permitir). Por eso Manual fija `ask` explícito en
      // los permisos habituales en vez de dejar el array vacío.
      return [
        { permission: 'edit', pattern: '*', action: 'ask' },
        { permission: 'write', pattern: '*', action: 'ask' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        { permission: 'webfetch', pattern: '*', action: 'ask' },
        { permission: 'websearch', pattern: '*', action: 'ask' },
        { permission: 'external_directory', pattern: '*', action: 'ask' }
      ]
    case 'acceptEdits':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' }
      ]
    case 'auto':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: 'git status*', action: 'allow' },
        { permission: 'bash', pattern: 'git diff*', action: 'allow' },
        { permission: 'bash', pattern: 'git log*', action: 'allow' },
        { permission: 'bash', pattern: 'npm run*', action: 'allow' },
        { permission: 'bash', pattern: 'npm test*', action: 'allow' }
      ]
    case 'bypass':
      return [
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'allow' },
        { permission: 'webfetch', pattern: '*', action: 'allow' },
        { permission: 'websearch', pattern: '*', action: 'allow' },
        { permission: 'external_directory', pattern: '*', action: 'allow' }
      ]
    case 'plan':
      return undefined
  }
}
