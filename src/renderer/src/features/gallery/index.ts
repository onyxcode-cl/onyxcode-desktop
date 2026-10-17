import { LayoutGrid } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { GalleryView } from './impl/GalleryView'

/** «Lo que has creado»: galería de los archivos que la IA creó en Chat y en Overdrive (solo escritorio). */
export const galleryMode: ModeDefinition = {
  id: 'gallery',
  get label() {
    return MODE_LABELS.gallery
  },
  icon: LayoutGrid,
  View: GalleryView
}
