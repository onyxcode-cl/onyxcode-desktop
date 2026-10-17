import {
  BookOpen,
  Briefcase,
  Bug,
  Calendar,
  Cloud,
  Compass,
  FileText,
  FileType,
  Folder,
  GitBranch,
  ListChecks,
  Mail,
  NotebookText,
  Plug,
  Presentation,
  Sparkles,
  Table,
  Terminal,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import type { CatalogIcon } from '@shared/catalogo'

/** Un ícono por nombre del catálogo (la lista permitida vive en `@shared/catalogo`: `CATALOG_ICONS`). */
export const ICONS: Record<CatalogIcon, LucideIcon> = {
  'book-open': BookOpen,
  briefcase: Briefcase,
  bug: Bug,
  calendar: Calendar,
  cloud: Cloud,
  compass: Compass,
  'file-text': FileText,
  'file-type': FileType,
  folder: Folder,
  'git-branch': GitBranch,
  'list-checks': ListChecks,
  mail: Mail,
  notebook: NotebookText,
  plug: Plug,
  presentation: Presentation,
  sparkles: Sparkles,
  table: Table,
  terminal: Terminal,
  users: Users,
  wallet: Wallet
}
