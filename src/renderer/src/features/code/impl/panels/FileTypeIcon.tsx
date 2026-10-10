/** Icono de archivo según su nombre o extensión, con un color propio por tipo (el árbol de Archivos deja de ser todo gris). */
import {
  BookOpen,
  Box,
  Braces,
  Database,
  File,
  FileCode,
  FileImage,
  FileText,
  GitBranch,
  Globe,
  Lock,
  Package,
  Palette,
  ScrollText,
  Settings,
  Sparkles,
  Terminal,
  type LucideIcon
} from 'lucide-react'

interface Look {
  icon: LucideIcon
  color: string
}

const BY_NAME: Record<string, Look> = {
  'package.json': { icon: Package, color: 'text-green-500' },
  'package-lock.json': { icon: Lock, color: 'text-subtle' },
  'pnpm-lock.yaml': { icon: Lock, color: 'text-subtle' },
  'yarn.lock': { icon: Lock, color: 'text-subtle' },
  'claude.md': { icon: Sparkles, color: 'text-orange-500' },
  'agents.md': { icon: Sparkles, color: 'text-orange-500' },
  'readme.md': { icon: BookOpen, color: 'text-sky-500' },
  license: { icon: ScrollText, color: 'text-subtle' },
  dockerfile: { icon: Box, color: 'text-sky-500' },
  '.gitignore': { icon: GitBranch, color: 'text-orange-500' },
  '.gitattributes': { icon: GitBranch, color: 'text-orange-500' },
  '.prettierrc': { icon: Settings, color: 'text-violet-500' },
  '.prettierignore': { icon: Settings, color: 'text-violet-500' },
  '.env': { icon: Settings, color: 'text-yellow-500' }
}

const BY_EXT: Record<string, Look> = {
  ts: { icon: FileCode, color: 'text-sky-500' },
  tsx: { icon: FileCode, color: 'text-sky-500' },
  js: { icon: FileCode, color: 'text-yellow-500' },
  jsx: { icon: FileCode, color: 'text-yellow-500' },
  mjs: { icon: FileCode, color: 'text-yellow-500' },
  cjs: { icon: FileCode, color: 'text-yellow-500' },
  json: { icon: Braces, color: 'text-amber-500' },
  jsonc: { icon: Braces, color: 'text-amber-500' },
  md: { icon: FileText, color: 'text-sky-400' },
  mdx: { icon: FileText, color: 'text-sky-400' },
  txt: { icon: FileText, color: 'text-subtle' },
  css: { icon: Palette, color: 'text-fuchsia-500' },
  scss: { icon: Palette, color: 'text-fuchsia-500' },
  html: { icon: Globe, color: 'text-orange-500' },
  py: { icon: FileCode, color: 'text-emerald-500' },
  rs: { icon: FileCode, color: 'text-orange-600' },
  go: { icon: FileCode, color: 'text-cyan-500' },
  swift: { icon: FileCode, color: 'text-orange-500' },
  java: { icon: FileCode, color: 'text-red-500' },
  sh: { icon: Terminal, color: 'text-green-500' },
  zsh: { icon: Terminal, color: 'text-green-500' },
  yml: { icon: Settings, color: 'text-violet-500' },
  yaml: { icon: Settings, color: 'text-violet-500' },
  toml: { icon: Settings, color: 'text-violet-500' },
  png: { icon: FileImage, color: 'text-pink-500' },
  jpg: { icon: FileImage, color: 'text-pink-500' },
  jpeg: { icon: FileImage, color: 'text-pink-500' },
  gif: { icon: FileImage, color: 'text-pink-500' },
  webp: { icon: FileImage, color: 'text-pink-500' },
  svg: { icon: FileImage, color: 'text-pink-500' },
  pdf: { icon: FileText, color: 'text-red-500' },
  lock: { icon: Lock, color: 'text-subtle' },
  sql: { icon: Database, color: 'text-cyan-500' },
  db: { icon: Database, color: 'text-cyan-500' }
}

const CONFIG_NAME =
  /^(\.?eslint|\.?prettier|tsconfig|vite|electron\.vite|electron-builder|tailwind|postcss|vitest|jest|babel|\.babelrc|\.editorconfig)/i

/** Aspecto (icono y color) de un archivo por su nombre. */
export function fileLook(name: string): Look {
  const lower = name.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  if (CONFIG_NAME.test(name)) return { icon: Settings, color: 'text-violet-500' }
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot + 1) : ''
  return BY_EXT[ext] ?? { icon: File, color: 'text-subtle' }
}

export function FileTypeIcon({ name, size = 14 }: { name: string; size?: number }): React.JSX.Element {
  const { icon: Icon, color } = fileLook(name)
  return <Icon size={size} className={`shrink-0 ${color}`} aria-hidden />
}
