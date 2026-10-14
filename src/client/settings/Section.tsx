/**
 * The settings page (README §3).
 *
 * Sections render inside the settings dialog's content column, so this page
 * owns its own header and cards. It is the single owner of reactivity: the
 * controller's change stream (`deps.subscribe`), the language
 * (`deps.translate.subscribe`) and the self-check controller are all read
 * through `useSyncExternalStore`-style hooks, and every child below is a plain
 * controlled component, so any plan/store change re-renders the page without
 * remounting it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ProfileConfig } from '../../shared/config.ts'
import { materializeSequence } from '../../shared/edit.ts'
import type { SelfCheckState, SettingsUnitDeps } from '../contracts.ts'
import type { I18nKey, Translator } from '../i18n/index.ts'
import { AppearanceEditor } from './AppearanceEditor.tsx'
import { ConfigBlock } from './ConfigBlock.tsx'
import { SequenceEditor, type SequenceSelection } from './SequenceEditor.tsx'
import type { PluginInfoStore } from './pluginInfo.ts'
import { sourceLabel } from './sourceLabel.ts'

export interface SectionProps {
  deps: SettingsUnitDeps
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

/**
 * The row subtitles, as already-rendered nodes keyed by panel id.
 *
 * Two things make this a hook rather than an inline read. It subscribes to the
 * plugin store through `useSyncExternalStore`, so the labels appear when the
 * `/plugins` answer lands without the page re-rendering for any other reason;
 * and it renders the text HERE, so the list component receives finished elements
 * and stays free of any knowledge of packages, versions or copy keys.
 *
 * A panel the store knows nothing about is simply absent from the map — the row
 * then renders exactly what it rendered before this feature existed. The `title`
 * carries the untruncated text, because the visible label may have been cut to
 * fit and a hover is where the full value belongs.
 */
function usePluginSources(deps: SettingsUnitDeps, t: Translator['t']): Record<string, ReactNode> {
  const store: PluginInfoStore = deps.plugins
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  const getSnapshot = useCallback(() => store.get(), [store])
  const info = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // One read per mount: a profile's installed plugins do not change while the
  // settings dialog is open, and the store makes the request unrefusable.
  useEffect(() => {
    void store.load()
  }, [store])

  const result: Record<string, ReactNode> = {}
  for (const [panelId, entry] of Object.entries(info)) {
    const resolved = sourceLabel(entry)
    if (resolved === null) continue
    const text = t(resolved.key, resolved.params)
    result[panelId] = (
      <span
        key={panelId}
        className="dsh-panellist-settings-source"
        data-source={panelId}
        title={text}
      >{text}</span>
    )
  }
  return result
}

export function Section({ deps }: SectionProps): ReactNode {
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

  /**
   * Structural edits materialize the live rail order the user is looking at.
   *
   * `rows` carries each row's resolved container, so a cross-seat drag is stored
   * as that row's seat in the new sequence — without it the drag would only live
   * in the store's `movedRow` and vanish on the next reload.
   */
  const applyStructural = useCallback((edit: (profile: ProfileConfig) => ProfileConfig, moved?: string | null): void => {
    const rows = deps.plan().rows.map(row => ({ kind: row.kind, id: row.id, container: row.container }))
    void deps.store.update(profile => edit(materializeSequence(profile, rows)), moved ?? null)
  }, [deps])

  const rerun = useCallback(() => deps.selfCheck.rerun(), [deps])

  const pluginSources = usePluginSources(deps, t)

  const selection = selected !== null && (selected.kind === 'group'
    ? plan.groups.has(selected.id)
    : plan.panels.has(selected.id))
    ? selected
    : null

  return (
    <section className="dsh-railist-settings" aria-label={t('settings.title')}>
      {/* The header is text only: the settings dialog already owns the close
          affordance (its X, next to this text), and a second button for the same
          action was one more thing to keep in sync with it. */}
      <header className="dsh-railist-settings-header">
        <div className="dsh-railist-settings-headerText">
          <h2 className="dsh-railist-settings-title">{t('settings.title')}</h2>
          <p className="dsh-railist-settings-subtitle">{t('settings.subtitle')}</p>
        </div>
      </header>

      {snapshot.status === 'loading' ? <p className="dsh-railist-settings-hint">{t('common.loading')}</p> : null}

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
        pluginInfo={pluginSources}
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
            onSelect={setSelected}
            builtinNames={deps.builtinNames}
            sanitizeSvg={deps.sanitizeSvg}
            apply={apply}
            applyStructural={applyStructural}
          />
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
