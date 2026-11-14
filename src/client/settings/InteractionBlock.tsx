/**
 * The "Interaction" card of the settings page.
 *
 * Currently one global switch: whether resting the pointer on a group row opens
 * its member menu. It applies instantly (the caller writes straight through on
 * change), and its default is ON — an absent behaviour object, or an absent
 * field, both mean "enabled".
 */
import type { ReactNode } from 'react'
import type { ProfileBehavior } from '../../shared/config.ts'
import type { Translator } from '../i18n/index.ts'

export interface InteractionBlockProps {
  /** Current profile behaviour; absent means every field sits at its default. */
  behavior: ProfileBehavior | undefined
  /** Toggle hover-to-open (the default is on). */
  onToggleHoverOpen(next: boolean): void
  t: Translator['t']
}

export function InteractionBlock({ behavior, onToggleHoverOpen, t }: InteractionBlockProps): ReactNode {
  // Default is ON: no behaviour object, or no field, means enabled.
  const hoverOpen = behavior?.hoverOpenGroups !== false
  return (
    <section className="dsh-railist-settings-block" data-testid="dsh-railist-settings-interaction">
      <h3 className="dsh-railist-settings-blockTitle">{t('settings.interaction.title')}</h3>
      <label className="dsh-railist-settings-toggleRow">
        <span className="dsh-railist-settings-toggleText">
          <span className="dsh-railist-settings-fieldLabel">{t('settings.interaction.hoverOpen')}</span>
          <span className="dsh-railist-settings-hint">{t('settings.interaction.hoverOpenHint')}</span>
        </span>
        <span className="dsh-railist-settings-switch">
          <input
            type="checkbox"
            className="dsh-railist-settings-switchInput"
            checked={hoverOpen}
            onChange={(event) => { onToggleHoverOpen(event.target.checked) }}
            data-testid="dsh-railist-settings-hoverOpen"
          />
          <span className="dsh-railist-settings-switchTrack" aria-hidden="true" />
        </span>
      </label>
    </section>
  )
}
