import type { Page } from 'playwright-core'
import { expectVisible } from './wait'

/** Pasa la bienvenida del primer uso («Empezar» si todo está bien, «Continuar» si hay una lista de chequeos; ninguno descarga nada) para llegar al primer paso del asistente. */
export async function passWelcome(page: Page): Promise<void> {
  await expectVisible(page.getByRole('heading', { name: /Bienvenido a Lazunox|Welcome to Lazunox/ }))
  await page.getByRole('button', { name: /^(Empezar|Get started|Continuar|Continue)$/ }).click()
}
