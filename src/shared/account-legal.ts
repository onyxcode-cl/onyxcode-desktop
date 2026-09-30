/**
 * BORRADORES de la política de privacidad y de los términos que la pantalla de acceso muestra
 * mientras `PRIVACY_URL` / `TERMS_URL` (brand.ts) estén vacías. No son texto legal definitivo:
 * el titular debe revisarlos (idealmente con un abogado) antes de activar las cuentas.
 * La versión larga vive en docs/PRIVACIDAD-BORRADOR.md y docs/TERMINOS-BORRADOR.md: mantener ambas al día.
 */

export interface LegalSection {
  heading: string
  body: string[]
}

export interface LegalDoc {
  title: string
  sections: LegalSection[]
}

export const LEGAL_DRAFT_NOTICE = 'Borrador sin revisar: el titular de la app y un abogado deben validarlo antes de publicarlo.'

/** Frase corta sobre qué datos se guardan (debajo de los botones de acceso). */
export const ACCOUNT_DATA_SENTENCE =
  'Guardamos tu correo para gestionar tu cuenta y contar usuarios. Tus conversaciones y claves de IA siguen en tu Mac.'

/** Nota única para quien ya usaba la app antes de las cuentas. */
export const EXISTING_USER_NOTE = 'Tus conversaciones y claves de IA siguen en tu Mac.'

export const PRIVACY_DRAFT: LegalDoc = {
  title: 'Política de privacidad (borrador)',
  sections: [
    {
      heading: 'Qué guardamos',
      body: [
        'Tu correo electrónico y, si entras con Google, el identificador de esa cuenta. También la fecha en que creaste la cuenta y la de tu último acceso.',
        'No guardamos tus conversaciones, archivos ni claves de IA: todo eso sigue en tu Mac.'
      ]
    },
    {
      heading: 'Para qué lo usamos',
      body: [
        'Para gestionar tu cuenta, contar cuántas personas usan la app y enviarte avisos del servicio (por ejemplo, el código de acceso).'
      ]
    },
    {
      heading: 'Cuánto tiempo',
      body: [
        'Mientras tengas la cuenta. Si pasas 24 meses sin entrar, la borraremos y te avisaremos antes.',
        'Los registros técnicos se conservan 7 días y las copias de seguridad hasta 30 días.'
      ]
    },
    {
      heading: 'Tus derechos',
      body: ['Puedes descargar tus datos y borrar tu cuenta desde Ajustes › Cuenta, o pedirnos corregirlos.']
    },
    {
      heading: 'Con quién los compartimos',
      body: ['No está previsto compartirlos con terceros, salvo los proveedores imprescindibles para operar el servicio (por definir).']
    },
    {
      heading: 'Pendiente de revisión legal',
      body: ['Este texto debe revisarse frente a la Ley 19.628 y la Ley 21.719 de Chile y, si hay usuarios en Europa, el RGPD.']
    }
  ]
}

export const TERMS_DRAFT: LegalDoc = {
  title: 'Términos de uso (borrador)',
  sections: [
    {
      heading: 'La cuenta',
      body: ['La cuenta es personal. Eres responsable de mantener el acceso a tu correo y de no compartir tu sesión.']
    },
    {
      heading: 'Tu contenido',
      body: ['Tus conversaciones, archivos y claves de IA permanecen en tu Mac y son tuyos. La cuenta no los sube a nuestro servidor.']
    },
    {
      heading: 'El servicio',
      body: [
        'El servidor de cuentas se ofrece tal cual, sin garantía de disponibilidad continua. Si no responde, la app sigue abriendo hasta 30 días con una sesión válida.'
      ]
    },
    {
      heading: 'Cierre de la cuenta',
      body: ['Puedes borrar tu cuenta cuando quieras. Podemos suspenderla ante un uso abusivo del servicio.']
    },
    {
      heading: 'Cambios y ley aplicable',
      body: ['Podemos actualizar estos términos y te avisaremos. La ley aplicable y el foro están por definir.']
    },
    {
      heading: 'Pendiente de revisión legal',
      body: ['Este texto es un borrador y debe ser revisado por el titular y un abogado antes de publicarse.']
    }
  ]
}
