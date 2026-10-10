/**
 * The settings page (README §3, ARCHITECTURE §6, task item 1).
 *
 * Sections render inside the settings dialog's content column, so this page
 * owns its own header and cards. It is the single owner of reactivity: the
 * controller's change stream (`deps.subscribe`), the language
 * (`deps.translate.subscribe`) and the self-check controller are all read
 * through `useSyncExternalStore`-style hooks, and every child below is a plain
 * controlled component, so any plan/store change re-renders the page without
 * remounting it.
 */
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ProfileConfig } from '../../shared/config.ts'
import { materializeSequence, setPanelLocked } from '../../shared/edit.ts'
import type { SelfCheckState, SettingsUnitDeps } from '../contracts.ts'
import type { I18nKey, Translator } from '../i18n/index.ts'
import { AppearanceEditor } from './AppearanceEditor.tsx'
import { ConfigBlock } from './ConfigBlock.tsx'
import { SequenceEditor, type SequenceSelection } from './SequenceEditor.tsx'

export interface SectionProps {
  deps: SettingsUnitDeps
  /** The one shell affordance a settings section receives. */
  close: () => void
}

/**
 * Re-render on every controller notification. A monotonic counter is the
 * snapshot value: it always differs after a notification, and it never trips
 * React's "getSnapshot should be cached" rule.
 */
function useControllerSubscription(deps: SettingsUnitDeps): void {
  const revision = useRef(0)
  // The disposer matters here: the page mounts and unmounts with the settings
  // dialog, so the controller's listener set must shrink again on unmount.
  const subscribe = useCallback((onChange: () => void) => deps.subscribe(() => {
    revision.current += 1
    onChange()
  }), [deps])
  const getSnapshot = useCallback(() => revision.current, [])
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The translate function, rebound whenever the active language changes. */
function useTranslate(deps: SettingsUnitDeps): Translator['t'] {
  const subscribe = useCallback((onChange: () => void) => deps.translate.subscribe(onChange), [deps])
  const getSnapshot = useCallback(() => deps.translate.lang(), [deps])
  const lang = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useCallback(
    (key: I18nKey, params?: Record<string, string | number>) => deps.translate.t(key, params),
    [deps, lang],
  )
}

/** The self-check state, cached between controller notifications. */
function useSelfCheckState(deps: SettingsUnitDeps): SelfCheckState {
  const cache = useRef<{ value: SelfCheckState } | null>(null)
  const subscribe = useCallback((onChange: () => void) => deps.selfCheck.subscribe(() => {
    cache.current = null
    onChange()
  }), [deps])
  const getSnapshot = useCallback(() => {
    if (cache.current === null) cache.current = { value: deps.selfCheck.getState() }
    return cache.current.value
  }, [deps])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function Section({ deps, close }: SectionProps): ReactNode {
  useControllerSubscription(deps)
  const t = useTranslate(deps)
  const selfCheck = useSelfCheckState(deps)
  const [selected, setSelected] = useState<SequenceSelection | null>(null)

  const plan = deps.plan()
  const snapshot = deps.snapshot()
  const registered = deps.registered()
  const health = deps.health()

  const apply = useCallback((edit: (profile: ProfileConfig) => ProfileConfig): void => {
    void deps.store.update(edit)
  }, [deps])

  /** Structural edits materialize the live rail order the user is looking at. */
  const applyStructural = useCallback((edit: (profile: ProfileConfig) => ProfileConfig): void => {
    const rows = deps.plan().rows.map(row => ({ kind: row.kind, id: row.id }))
    void deps.store.update(profile => edit(materializeSequence(profile, rows)))
  }, [deps])

  const rerun = useCallback(() => deps.selfCheck.rerun(), [deps])

  const selection = selected !== null && (selected.kind === 'group'
    ? plan.groups.has(selected.id)
    : plan.panels.has(selected.id))
    ? selected
    : null

  // Locked panels are not rail rows (the model leaves them exactly as
  // registered), so without this list a locked panel would have no way back:
  // deselect its row, or reload the page, and it would be invisible forever.
  const lockedPanels = [...plan.panels.values()].filter(panel => panel.locked)

  return (
    <section className="dsh-panellist-settings" aria-label={t('settings.title')}>
      <header className="dsh-panellist-settings-header">
        <div className="dsh-panellist-settings-headerText">
          <h2 className="dsh-panellist-settings-title">{t('settings.title')}</h2>
          <p className="dsh-panellist-settings-subtitle">{t('settings.subtitle')}</p>
        </div>
        <button type="button" className="dsh-panellist-settings-action" onClick={close}>
          {t('common.done')}
        </button>
      </header>

      {snapshot.status === 'loading' ? <p className="dsh-panellist-settings-hint">{t('common.loading')}</p> : null}

      <SequenceEditor
        plan={plan}
        registered={registered}
        t={t}
        glyph={deps.glyph}
        nativeGlyph={deps.nativeGlyph}
        selected={selection}
        onSelect={setSelected}
        apply={apply}
        applyStructural={applyStructural}
      />

      {selection === null
        ? null
        : (
          <AppearanceEditor
            key={`${selection.kind}:${selection.id}`}
            plan={plan}
            profile={snapshot.profile}
            selection={selection}
            t={t}
            glyph={deps.glyph}
            nativeGlyph={deps.nativeGlyph}
            builtinNames={deps.builtinNames}
            sanitizeSvg={deps.sanitizeSvg}
            apply={apply}
            applyStructural={applyStructural}
          />
        )}

      {lockedPanels.length === 0
        ? null
        : (
          <details className="dsh-panellist-settings-block" data-block="lockedPanels">
            <summary className="dsh-panellist-settings-blockTitle">{t('settings.appearance.locked')}</summary>
            <p className="dsh-panellist-settings-hint">{t('settings.appearance.lockedHint')}</p>
            <ul className="dsh-panellist-settings-plainList">
              {lockedPanels.map(panel => (
                <li key={panel.id} className="dsh-panellist-settings-lockedRow" data-locked-id={panel.id}>
                  <span className="dsh-panellist-settings-rowName">{panel.label}</span>
                  <label className="dsh-panellist-settings-switchRow">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => apply(edit => setPanelLocked(edit, panel.id, false))}
                    />
                    <span>{t('settings.appearance.locked')}</span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        )}

      <ConfigBlock
        plan={plan}
        snapshot={snapshot}
        selfCheck={selfCheck}
        health={health}
        registeredIds={registered.map(panel => panel.id)}
        t={t}
        store={deps.store}
        rerun={rerun}
        apply={apply}
      />
    </section>
  )
}
