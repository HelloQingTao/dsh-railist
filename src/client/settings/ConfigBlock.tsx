/**
 * The configuration half of the settings page (README §3.4-§3.7, task items
 * 4-6): missing panels, import / export / open file / reset, the compatibility
 * self-check, and the plan's structural warnings.
 *
 * Nothing here writes a profile directly: the destructive actions
 * (orphan clean-up, reset) call the store or a pure edit function, and both ask
 * for an inline confirmation first (`settings.orphans.cleanConfirm` /
 * `settings.io.resetConfirm`) instead of a native dialog, so the page stays
 * testable and cannot be trivially dismissed by a stray Enter.
 */
import { useState, type ReactNode } from 'react'
import type { ProfileConfig } from '../../shared/config.ts'
import { cleanOrphans } from '../../shared/edit.ts'
import type { Plan, PlanWarning } from '../../shared/model.ts'
import type { HealthReport } from '../../shared/protocol.ts'
import type { SelfCheckState } from '../contracts.ts'
import type { PanellistStore, StoreSnapshot } from '../config/store.ts'
import type { Translator } from '../i18n/index.ts'

export interface ConfigBlockProps {
  plan: Plan
  snapshot: StoreSnapshot
  selfCheck: SelfCheckState
  health: HealthReport | null
  /** Ids of every live rail registration (the orphan clean-up allow-list). */
  registeredIds: readonly string[]
  t: Translator['t']
  store: PanellistStore
  rerun: () => Promise<void>
  apply: (edit: (profile: ProfileConfig) => ProfileConfig) => void
}

interface ConfirmButtonProps {
  label: string
  message: string
  confirmLabel: string
  cancelLabel: string
  disabled?: boolean
  onConfirm: () => void
}

/** A two-step destructive action: the button swaps itself for a confirm pair. */
function ConfirmButton(props: ConfirmButtonProps): ReactNode {
  const { label, message, confirmLabel, cancelLabel, disabled, onConfirm } = props
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        className="dsh-panellist-settings-action"
        disabled={disabled === true}
        onClick={() => setOpen(true)}
      >{label}</button>
    )
  }
  return (
    <div className="dsh-panellist-settings-confirm" role="group" aria-label={label}>
      <p className="dsh-panellist-settings-hint">{message}</p>
      <span className="dsh-panellist-settings-actionRow">
        <button
          type="button"
          className="dsh-panellist-settings-action"
          onClick={() => { setOpen(false); onConfirm() }}
        >{confirmLabel}</button>
        <button
          type="button"
          className="dsh-panellist-settings-action"
          onClick={() => setOpen(false)}
        >{cancelLabel}</button>
      </span>
    </div>
  )
}

function warningParams(warning: PlanWarning): Record<string, string> {
  const params: Record<string, string> = {}
  if ('groupId' in warning) params['groupId'] = warning.groupId
  if ('panelId' in warning) params['panelId'] = warning.panelId
  return params
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea + `document.execCommand('copy')`.
 */
async function copyText(text: string): Promise<boolean> {
  const clipboard: Clipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or an insecure context: use the legacy path.
    }
  }
  if (typeof document === 'undefined') return false
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
    area.remove()
    return copied
  } catch {
    return false
  }
}

export interface OrphansBlockProps {
  plan: Plan
  t: Translator['t']
  registeredIds: readonly string[]
  apply: (edit: (profile: ProfileConfig) => ProfileConfig) => void
}

/** Missing panels: their configuration is kept, with an explicit clean-up. */
export function OrphansBlock(props: OrphansBlockProps): ReactNode {
  const { plan, t, registeredIds, apply } = props
  const count = plan.orphans.length
  return (
    <section className="dsh-panellist-settings-block">
      <h3 className="dsh-panellist-settings-blockTitle">{t('settings.orphans.title')}</h3>
      <p className="dsh-panellist-settings-hint">
        {count === 0 ? t('settings.orphans.none') : t('settings.orphans.body', { count })}
      </p>
      {count === 0
        ? null
        : <ul className="dsh-panellist-settings-plainList">{plan.orphans.map(id => <li key={id}>{id}</li>)}</ul>}
      <span className="dsh-panellist-settings-actionRow">
        <ConfirmButton
          label={t('settings.orphans.clean')}
          message={t('settings.orphans.cleanConfirm')}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          disabled={count === 0}
          onConfirm={() => apply(profile => cleanOrphans(profile, registeredIds))}
        />
      </span>
    </section>
  )
}

/** Import / export / open file / reset. */
export function IoBlock(props: ConfigBlockProps): ReactNode {
  const { snapshot, health, t, store } = props
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)
  const [exported, setExported] = useState<'idle' | 'ok' | 'failed'>('idle')
  const [revealed, setRevealed] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const exportJson = (): void => {
    void copyText(store.exportDocument()).then(ok => { setExported(ok ? 'ok' : 'failed') })
  }

  const importJson = (): void => {
    void store.importDocument(importText).then(result => {
      if (result.ok) {
        setImportError(null)
        setImported(true)
        return
      }
      setImported(false)
      setImportError(result.error)
    })
  }

  return (
    <section className="dsh-panellist-settings-block">
      <h3 className="dsh-panellist-settings-blockTitle">{t('settings.io.title')}</h3>

      {snapshot.status === 'loading' ? <p className="dsh-panellist-settings-hint">{t('common.loading')}</p> : null}
      {snapshot.error === null
        ? null
        : (
          <p className="dsh-panellist-settings-error" role="alert">
            {snapshot.status === 'error'
              ? t('error.load', { reason: snapshot.error })
              : t('error.save', { reason: snapshot.error })}
          </p>
        )}

      <span className="dsh-panellist-settings-actionRow">
        <button type="button" className="dsh-panellist-settings-action" onClick={exportJson}>
          {t('settings.io.export')}
        </button>
        {exported === 'idle' ? null : (
          <span className="dsh-panellist-settings-hint" role="status" data-state="export">
            {exported === 'ok' ? t('common.done') : t('common.failed')}
          </span>
        )}
      </span>

      <label className="dsh-panellist-settings-field">
        <span className="dsh-panellist-settings-fieldLabel">{t('settings.io.import')}</span>
        <textarea
          className="dsh-panellist-settings-textarea"
          aria-label={t('settings.io.import')}
          placeholder={t('settings.io.importPlaceholder')}
          value={importText}
          rows={4}
          onChange={event => setImportText(event.currentTarget.value)}
        />
      </label>
      <span className="dsh-panellist-settings-actionRow">
        <button type="button" className="dsh-panellist-settings-action" onClick={importJson}>
          {t('settings.io.import')}
        </button>
        {imported && importError === null
          ? <span className="dsh-panellist-settings-hint" role="status" data-state="import">{t('settings.io.imported')}</span>
          : null}
      </span>
      {importError === null
        ? null
        : <p className="dsh-panellist-settings-error" role="alert">{t('settings.io.importInvalid', { reason: importError })}</p>}

      <span className="dsh-panellist-settings-actionRow">
        <button
          type="button"
          className="dsh-panellist-settings-action"
          onClick={() => { void store.reveal().then(ok => { setRevealed(ok) }) }}
        >{t('settings.io.openFile')}</button>
        {health === null
          ? null
          : <span className="dsh-panellist-settings-hint">{t('settings.io.filePath', { path: health.configPath })}</span>}
        {revealed ? <span className="dsh-panellist-settings-hint" role="status" data-state="reveal">{t('common.done')}</span> : null}
      </span>

      <span className="dsh-panellist-settings-actionRow">
        <ConfirmButton
          label={t('settings.io.reset')}
          message={t('settings.io.resetConfirm')}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { void store.reset().then(ok => { setResetDone(ok) }) }}
        />
        {resetDone ? <span className="dsh-panellist-settings-hint" role="status" data-state="reset">{t('settings.io.resetDone')}</span> : null}
      </span>
    </section>
  )
}

/** Compatibility: the four probes, the degraded banner and a re-run button. */
export function CompatibilityBlock(props: ConfigBlockProps): ReactNode {
  const { plan, selfCheck, t, rerun } = props
  const [running, setRunning] = useState(false)
  const failed = selfCheck.results.filter(result => !result.ok).length

  const rerunNow = (): void => {
    setRunning(true)
    void (async () => {
      try {
        await rerun()
      } catch {
        // The controller owns failure reporting; the page only reflects state.
      } finally {
        setRunning(false)
      }
    })()
  }

  return (
    <section className="dsh-panellist-settings-block">
      <h3 className="dsh-panellist-settings-blockTitle">{t('settings.selfcheck.title')}</h3>

      {selfCheck.degraded
        ? (
          <p className="dsh-panellist-settings-banner dsh-panellist-settings-banner-warn" role="status" data-state="degraded">
            {t('settings.selfcheck.degraded', { count: failed })}
          </p>
        )
        : <p className="dsh-panellist-settings-hint">{t('settings.selfcheck.ok')}</p>}

      {selfCheck.readOnly
        ? (
          <p className="dsh-panellist-settings-banner dsh-panellist-settings-banner-warn" data-state="readOnly">
            {t('settings.selfcheck.readOnly')}
          </p>
        )
        : null}

      {plan.warnings.length === 0
        ? null
        : (
          <ul className="dsh-panellist-settings-warnings">
            {plan.warnings.map((warning, index) => (
              <li key={`${warning.code}:${index}`} data-warning={warning.code}>
                {t(`warning.${warning.code}`, warningParams(warning))}
              </li>
            ))}
          </ul>
        )}

      <ul className="dsh-panellist-settings-probeList">
        {selfCheck.results.map(result => (
          <li key={result.id} className="dsh-panellist-settings-probe" data-probe={result.id} data-ok={result.ok ? 'true' : 'false'}>
            <span className="dsh-panellist-settings-probeHead">
              <span>{t(`probe.${result.id}`)}</span>
              <span className="dsh-panellist-settings-probeState">
                {result.ok ? t('probe.ok') : t('probe.failed')}
              </span>
            </span>
            {result.detail === undefined ? null : <code className="dsh-panellist-settings-probeDetail">{result.detail}</code>}
            {result.ok ? null : <p className="dsh-panellist-settings-probeImpact">{t(`probe.${result.id}.impact`)}</p>}
          </li>
        ))}
      </ul>

      {selfCheck.version === '' ? null : (
        <p className="dsh-panellist-settings-hint" data-state="version">
          {t('settings.selfcheck.version', { version: selfCheck.version })}
        </p>
      )}

      <span className="dsh-panellist-settings-actionRow">
        <button
          type="button"
          className="dsh-panellist-settings-action"
          disabled={running}
          onClick={rerunNow}
        >{t('settings.selfcheck.rerun')}</button>
      </span>
    </section>
  )
}

/** The configuration half of the page, in page order. */
export function ConfigBlock(props: ConfigBlockProps): ReactNode {
  return (
    <>
      <OrphansBlock plan={props.plan} t={props.t} registeredIds={props.registeredIds} apply={props.apply} />
      <IoBlock {...props} />
      <CompatibilityBlock {...props} />
    </>
  )
}
