/**
 * The settings page (README §3).
 *
 * Sections render inside the settings dialog's content column, so this page
 * owns its own header and cards. It is the single owner of reactivity: the
 * controller's change stream (`deps.subscribe`) and the language
 * (`deps.translate.subscribe`) are both read through
 * `useSyncExternalStore`-style hooks, and every child below is a plain
 * controlled component, so any plan/store change re-renders the page without
 * remounting it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { cloneProfileConfig, isEntryItem, isManagedSeat, type ManagedSeat, type ProfileConfig } from '../../shared/config.ts'
import { materializeSequence } from '../../shared/edit.ts'
import { resolveSeats } from '../../shared/model.ts'
import type { SettingsUnitDeps } from '../contracts.ts'
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
  const [selected, setSelected] = useState<SequenceSelection | null>(null)

  const plan = deps.plan()
  const snapshot = deps.snapshot()
  const registered = deps.registered()
  const health = deps.health()

  /**
   * Whether the file still needs writing.
   *
   * The store keeps the section the host last confirmed (`saved`) beside the
   * working copy (`profile`), and a drag only touches the latter — so this is
   * the exact "you have edits that are not on disk yet" question, answered
   * without the page holding a copy of its own that could drift.
   */
  const dirty = snapshot.saved !== null
    && JSON.stringify(snapshot.saved) !== JSON.stringify(snapshot.profile)

  const apply = useCallback((edit: (profile: ProfileConfig) => ProfileConfig): void => {
    void deps.store.update(edit)
  }, [deps])

  /**
   * Structural edits materialize the live rail order the user is looking at.
   *
   * `rows` carries each row's resolved container, so the edited sequence keeps
   * every seat the user sees. A **cross-seat drag** needs one more fact the
   * rows cannot carry: they describe the rail *before* the edit, so the dragged
   * row's own entry would be materialized with its old seat. `moved` names the
   * dragged row; its new seat is re-resolved from the post-edit order the same
   * way the model does for a live drag (nearest unmoved row above), and only
   * when it actually differs from the pre-drag seat is it written into the
   * entry.
   *
   * Memory only: a drag fires on every pointer move, and one `PUT` per move made
   * the list stutter. `commit` writes the accumulated result when the user asks.
   */
  const applyStructural = useCallback((edit: (profile: ProfileConfig) => ProfileConfig, moved?: string | null): void => {
    const rows = deps.plan().rows.map(row => ({ kind: row.kind, id: row.id, container: row.container }))
    deps.store.preview(profile => {
      const next = edit(materializeSequence(profile, rows))
      if (moved == null) return next
      // The dragged row's new seat: the nearest UNMOVED row above it in the
      // post-edit order. `rows` predates the edit, so an unmoved row's
      // container IS its post-edit seat; group rows resolve the same way.
      const seats = new Map<string, ManagedSeat>()
      for (const row of rows) {
        if (isManagedSeat(row.container)) seats.set(row.id, row.container)
      }
      const ordered = next.sequence
      const seat = resolveSeats(ordered, seats, moved).get(moved)
      if (seat === undefined) return next
      const before = rows.find(row => row.id === moved)?.container
      if (seat === before) return next
      const entry = next.sequence.find(item => item.id === moved)
      if (entry === undefined || !isEntryItem(entry)) return next // a group row has no entry to seat
      entry.seat = seat
      return next
    })
  }, [deps])

  /** Persist what the drags produced. One write, however many moves led here. */
  const save = useCallback((): void => {
    void deps.store.commit()
  }, [deps])

  /** Drop every unpersisted edit and go back to what the file says. */
  const discard = useCallback((): void => {
    const saved = snapshot.saved
    if (saved === null) return
    deps.store.preview(() => cloneProfileConfig(saved))
  }, [deps, snapshot.saved])

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

      {/* The pending-edit bar. It stays out of the way until a drag actually
          changed something, so the page reads the same as before for anyone who
          never drags. `data-dirty` is the styling hook. */}
      <div
        className="dsh-panellist-settings-commitBar"
        data-testid="dsh-railist-settings-commitBar"
        data-dirty={dirty ? 'true' : 'false'}
        hidden={!dirty}
      >
        <p className="dsh-panellist-settings-commitHint">{t('settings.sequence.pendingHint')}</p>
        <div className="dsh-panellist-settings-commitActions">
          <button
            type="button"
            className="dsh-panellist-settings-commitAction"
            data-action="discard"
            onClick={discard}
          >{t('settings.sequence.discard')}</button>
          <button
            type="button"
            className="dsh-panellist-settings-commitAction dsh-panellist-settings-commitSave"
            data-action="save"
            onClick={save}
          >{t('settings.sequence.save')}</button>
        </div>
      </div>

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
        health={health}
        t={t}
      />
    </section>
  )
}
