// Aserciones con reintento sobre Locators (playwright-core no trae `expect`): usan `expect.poll` de Vitest.
import { expect } from 'vitest'
import type { Locator } from 'playwright-core'

const T = 15_000

export async function expectVisible(loc: Locator, timeout = T): Promise<void> {
  await expect.poll(() => loc.first().isVisible(), { timeout, message: `no visible: ${loc}` }).toBe(true)
}

export async function expectCount(loc: Locator, n: number, timeout = T): Promise<void> {
  await expect.poll(() => loc.count(), { timeout, message: `count de ${loc}` }).toBe(n)
}

export async function expectAttr(loc: Locator, name: string, value: string | null, timeout = T): Promise<void> {
  await expect.poll(() => loc.first().getAttribute(name), { timeout, message: `atributo ${name} de ${loc}` }).toBe(value)
}
