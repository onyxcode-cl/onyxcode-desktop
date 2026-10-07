import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runHelper = vi.hoisted(() => vi.fn())
vi.mock('../util/exec', () => ({ runHelper }))

import { AppVisibility } from './app-visibility'

const dirs: string[] = []
afterEach(() => {
  runHelper.mockReset()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const make = (): AppVisibility => {
  const d = mkdtempSync(join(tmpdir(), 'lzx-vis-'))
  dirs.push(d)
  return new AppVisibility(() => 'cu-helper', join(d, 'hidden.json'))
}

describe('AppVisibility: las claves viajan codificadas al helper', () => {
  const brave = 'exe:c:\\program files\\brave\\brave.exe|pub:brave software, inc.'
  const enc = 'exe:c:\\program files\\brave\\brave.exe|pub:brave software%2C inc.'

  it('hide-apps: la coma del editor no parte la clave (%2C) y un % va como %25', async () => {
    runHelper.mockResolvedValue(JSON.stringify({ hidden: [] }))
    await make().hide([brave, 'aumid:x!app', 'exe:c:\\a%b.exe|pub:p'])
    expect(runHelper).toHaveBeenCalledWith('cu-helper', ['hide-apps', `${enc},aumid:x!app,exe:c:\\a%25b.exe|pub:p`])
  })

  it('unhide-apps: lo ocultado se restaura con las mismas claves codificadas', async () => {
    const v = make()
    runHelper.mockResolvedValueOnce(JSON.stringify({ hidden: [brave] }))
    await v.hide([])
    runHelper.mockResolvedValueOnce('{}')
    await v.unhide()
    expect(runHelper).toHaveBeenLastCalledWith('cu-helper', ['unhide-apps', enc])
  })

  it('macOS: un bundle id viaja igual que siempre', async () => {
    runHelper.mockResolvedValue(JSON.stringify({ hidden: [] }))
    await make().hide(['com.apple.finder', 'com.google.Chrome'])
    expect(runHelper).toHaveBeenCalledWith('cu-helper', ['hide-apps', 'com.apple.finder,com.google.Chrome'])
  })
})
