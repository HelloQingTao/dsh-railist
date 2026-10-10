/**
 * The settings unit (README §3).
 *
 * Registers one `settings.section` entry — id `dsh-panellist`, a late order,
 * and a label thunk so a locale switch needs no re-registration — and hands the
 * shell the page component bound to this unit's dependencies.
 */
import type { ReactNode } from 'react'
import type { SettingsUnit, SettingsUnitDeps } from '../contracts.ts'
import { Section } from './Section.tsx'
import { SETTINGS_CSS } from './settings.css.ts'

/**
 * Create the unit.
 * @param deps - the frozen settings seam (store, plan, translator, styles…).
 * @returns a handle that removes the registration.
 */
export function createSettingsUnit(deps: SettingsUnitDeps): SettingsUnit {
  // Idempotent by id, and registered before the section so the page is styled
  // the first frame it renders.
  deps.styles.register('settings', SETTINGS_CSS)

  const SettingsSection = (): ReactNode => <Section deps={deps} />

  const dispose = deps.ctx.slots.inject('settings.section', () => deps.ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-panellist',
    order: 100,
    label: () => deps.translate.t('settings.nav'),
  }, SettingsSection))

  return { dispose }
}
