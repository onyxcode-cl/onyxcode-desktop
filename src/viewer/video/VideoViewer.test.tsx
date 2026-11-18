// @vitest-environment jsdom
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { VideoViewer } from './VideoViewer'
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
})
it('MP4 abre por el esquema, pausado y silenciado, con controles y sin blob ni reproducción automática', () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('React', React)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(VideoViewer, { token: 'a'.repeat(64), lang: 'es' })))
  const video = host.querySelector('video')!
  expect(video.getAttribute('src')).toBe(`/doc/${'a'.repeat(64)}`)
  expect(video.controls).toBe(true)
  expect(video.muted).toBe(true)
  expect(video.autoplay).toBe(false)
  expect(video.preload).toBe('metadata')
})
