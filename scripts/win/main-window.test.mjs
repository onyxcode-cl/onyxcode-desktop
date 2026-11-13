import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainWindow } from './main-window.mjs'

const page = (url, ready = true) => ({ url: () => url, evaluate: async () => ready })
test('elige index.html aunque Entrada rápida sea la primera', async () => {
  const main = page('lazunox://app/index.html')
  assert.equal(await mainWindow([page('lazunox://app/quick/index.html'), page('lazunox://app/overlay/index.html'), main]), main)
})
test('admite desarrollo y fragmentos, comprueba el API de Tareas', async () => {
  const main = page('http://localhost:5173/index.html#tasks')
  assert.equal(await mainWindow([page('lazunox://app/index.html', false), main]), main)
  assert.equal(await mainWindow([page('http://127.0.0.1:5173/quick/'), page('https://example.com/index.html')]), undefined)
})
