import { memo } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ToolRow } from '../code/impl/ToolCard'

/**
 * Llamada a herramienta del Chat: la MISMA fila humanizada que Code y que Chat en el celular (una línea, verbo + objeto +
 * estado, sin el JSON crudo del input). Rediseño de escritorio: antes solo el celular la usaba.
 */
export const ChatToolCall = memo(function ChatToolCall({ part }: { part: ToolPart }): React.JSX.Element {
  return <ToolRow part={part} root={null} />
})
