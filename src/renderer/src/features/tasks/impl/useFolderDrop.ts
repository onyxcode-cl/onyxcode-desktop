/**
 * Arrastrar archivos o una carpeta a Tareas. Las carpetas siguen la autorización habitual;
 * los archivos se copian como bytes de File, sin dar a main una ruta de lectura arbitraria.
 */
import { useCallback, useRef, useState } from 'react'
import { dropFolder } from './actions'
import { attachDroppedFiles } from './drop-files'
import { useTasks } from './store'
import { t } from '@shared/i18n'

interface LzxPaths {
  forFile: (file: File) => string
}

/** Ruta real de la primera carpeta soltada (main vuelve a validarla). */
export function droppedPath(files: FileList | null | undefined): string {
  const paths = (window as unknown as { lzxPaths?: LzxPaths }).lzxPaths
  const first = files?.[0]
  return first && paths ? paths.forFile(first) : ''
}

const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** Se lee durante el evento: Chromium vacía los items tras terminar el manejador. */
export function droppedEntries(data: Pick<DataTransfer, 'items' | 'files'>): { folders: File[]; files: File[] } {
  const folders: File[] = []
  const files: File[] = []
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file')
  if (!items.length) return { folders, files: Array.from(data.files) }
  for (const item of items) {
    const file = item.getAsFile()
    if (!file) continue
    if (item.webkitGetAsEntry?.()?.isDirectory) folders.push(file)
    else files.push(file)
  }
  return { folders, files }
}

export function acceptDrop(data: Pick<DataTransfer, 'items' | 'files'>): void {
  const { folders, files } = droppedEntries(data)
  if (folders.length && files.length) {
    useTasks.setState({ error: t('tasks.drop.mixed') })
    return
  }
  if (folders.length) void dropFolder(droppedPath(folders as unknown as FileList))
  else void attachDroppedFiles(files)
}

export function useFolderDrop(enabled: boolean): {
  dragging: boolean
  handlers: Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>
} {
  const [dragging, setDragging] = useState(false)
  // `dragenter/leave` se disparan también al pasar por los hijos: se cuenta la profundidad para no parpadear.
  const depth = useRef(0)
  const reset = (): void => {
    depth.current = 0
    setDragging(false)
  }
  const onDragEnter = useCallback(
    (e: React.DragEvent): void => {
      if (!enabled || !hasFiles(e)) return
      depth.current += 1
      setDragging(true)
    },
    [enabled]
  )
  const onDragOver = useCallback(
    (e: React.DragEvent): void => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault() // sin esto el navegador no permite soltar
      e.dataTransfer.dropEffect = 'copy'
    },
    [enabled]
  )
  const onDragLeave = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [])
  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      reset()
      acceptDrop(e.dataTransfer)
    },
    [enabled]
  )
  return { dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
