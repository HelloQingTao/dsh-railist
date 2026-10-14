/**
 * The settings unit (README §3).
 *
 * Registers one `settings.section` entry — id `dsh-railist`, a late order,
 * and a label thunk so a locale switch needs no re-registration — and hands the
 * shell the page component bound to this unit's dependencies.
 */
import type { ReactNode } from 'react'
import type { SettingsUnit, SettingsUnitDeps } from '../contracts.ts'
import { Section } from './Section.tsx'
import { SETTINGS_CSS } from './settings.css.ts'
import { DRAG_CSS } from './drag.css.ts'
import { SETTINGS_POLISH_CSS } from './polish.css.ts'

/**
 * Create the unit.
 * @param deps - the frozen settings seam (store, plan, translator, styles…).
 * @returns a handle that removes the registration.
 */
export function createSettingsUnit(deps: SettingsUnitDeps): SettingsUnit {
  // Idempotent by id, and registered before the section so the page is styled
  // the first frame it renders.
  deps.styles.register('settings', SETTINGS_CSS)
  // The drag affordances live in their own chunk: they are the sequence editor's
  // own hooks and change on their own schedule, so keeping them out of the page
  // chunk keeps both reviewable.
  deps.styles.register('settings-drag', DRAG_CSS)
  // The polish chunk loads last and overrides spacing/state values only. It is
  // apart from `settings` so the base layout stays the file a reviewer reads
  // first, and apart from `settings-drag` because it must not depend on the
  // editor's structure.
  deps.styles.register('settings-polish', SETTINGS_POLISH_CSS)

  const SettingsSection = (): ReactNode => <Section deps={deps} />

  const dispose = deps.ctx.slots.inject('settings.section', () => deps.ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-railist',
    order: 100,
    label: () => deps.translate.t('settings.nav'),
  }, SettingsSection))

  return { dispose }
}
