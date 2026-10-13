/**
 * Arrastrar una carpeta a la ventana de Tareas: devuelve los manejadores para el contenedor y si hay algo arrastrándose encima (para
 * mostrar el aviso). La ruta real sale del preload (`window.lzxPaths`); main la valida antes de usarla (ver `dropFolder`).
 */
import { useCallback, useRef, useState } from 'react'
import { dropFolder } from './actions'

interface LzxPaths {
  forFile: (file: File) => string
}

/** Ruta de la primera entrada soltada (carpeta o archivo; si es un archivo, main la rechaza con «no es una carpeta válida»). */
export function droppedPath(files: FileList | null | undefined): string {
  const paths = (window as unknown as { lzxPaths?: LzxPaths }).lzxPaths
  const first = files?.[0]
  return first && paths ? paths.forFile(first) : ''
}

const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

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
      void dropFolder(droppedPath(e.dataTransfer.files))
    },
    [enabled]
  )
  return { dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
