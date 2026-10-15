/**
 * The configuration half of the settings page (README §3.4): the profile's
 * configuration file path, and the plan's structural warnings.
 *
 * The missing-panel list, the JSON import/export, the "open config file"
 * button, the reset-to-defaults action and the compatibility block were all
 * removed on request — the page keeps the sequence editor and this. The
 * host routes those removed controls called (`/reset`, `/reveal`, `/export`,
 * `/import`) are still served for external scripts, so nothing there changed.
 */
import type { ReactNode } from 'react'
import type { Plan, PlanWarning } from '../../shared/model.ts'
import type { HealthReport } from '../../shared/protocol.ts'
import type { StoreSnapshot } from '../config/store.ts'
import type { Translator } from '../i18n/index.ts'

export interface ConfigBlockProps {
  plan: Plan
  snapshot: StoreSnapshot
  health: HealthReport | null
  t: Translator['t']
}

function warningParams(warning: PlanWarning): Record<string, string> {
  const params: Record<string, string> = {}
  if ('groupId' in warning) params['groupId'] = warning.groupId
  if ('panelId' in warning) params['panelId'] = warning.panelId
  return params
}

/** Configuration: where the file lives, plus the plan's structural warnings. */
export function ConfigBlock(props: ConfigBlockProps): ReactNode {
  const { plan, snapshot, health, t } = props
  return (
    <section className="dsh-railist-settings-block">
      <h3 className="dsh-railist-settings-blockTitle">{t('settings.io.title')}</h3>

      {snapshot.status === 'loading' ? <p className="dsh-railist-settings-hint">{t('common.loading')}</p> : null}
      {snapshot.error === null
        ? null
        : (
          <p className="dsh-railist-settings-error" role="alert">
            {snapshot.status === 'error'
              ? t('error.load', { reason: snapshot.error })
              : t('error.save', { reason: snapshot.error })}
          </p>
        )}

      {health === null
        ? null
        : <p className="dsh-railist-settings-hint" data-state="filePath">{t('settings.io.filePath', { path: health.configPath })}</p>}

      {plan.warnings.length === 0
        ? null
        : (
          <ul className="dsh-railist-settings-warnings">
            {plan.warnings.map((warning, index) => (
              <li key={`${warning.code}:${index}`} data-warning={warning.code}>
                {t(`warning.${warning.code}`, warningParams(warning))}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
