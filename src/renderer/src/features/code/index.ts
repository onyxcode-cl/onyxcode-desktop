import { Code2 } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { CodeView } from './CodeView'

export const codeMode: ModeDefinition = {
  id: 'code',
  label: 'Code',
  icon: Code2,
  View: CodeView
}
