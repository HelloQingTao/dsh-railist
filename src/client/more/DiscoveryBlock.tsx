/**
 * Settings-page card that surfaces shell-drawn rail buttons not yet adopted.
 *
 * Most rail entries are managed automatically (they register a slot). The rare
 * shell-drawn "wild" button needs one adapter line; this card tells the user
 * whether any such line is currently missing, and hands them a ready-to-paste
 * declaration. It never writes config or adopts anything at runtime — adoption
 * stays a one-line source edit (see `more/adapters.ts`).
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Translator } from '../i18n/index.ts'
import { discoverHostRows, type DiscoveredHostRow } from './discover.ts'

export interface DiscoveryBlockProps {
  t: Translator['t']
}

/** Copy-to-clipboard button; feedback is local, no round-trip to the model. */
function CopyButton({ text, t }: { text: string; t: Translator['t'] }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))
  }
  return (
    <button type="button" className="dsh-railist-settings-action" onClick={copy}>
      {copied ? t('settings.discover.copied') : t('settings.discover.copy')}
    </button>
  )
}

export function DiscoveryBlock({ t }: DiscoveryBlockProps): ReactNode {
  const [rows, setRows] = useState<readonly DiscoveredHostRow[]>([])

  // The sidebar is already mounted when the settings dialog opens, so a single
  // scan on mount is enough; re-running would only pick up host churn.
  useEffect(() => {
    setRows(discoverHostRows())
  }, [])

  return (
    <section className="dsh-railist-settings-block" data-testid="dsh-railist-settings-discovery">
      <h3 className="dsh-railist-settings-blockTitle">{t('settings.discover.title')}</h3>
      <p className="dsh-railist-settings-hint">{t('settings.discover.hint')}</p>
      {rows.length === 0
        ? (
          <p className="dsh-railist-settings-hint">{t('settings.discover.none')}</p>
        )
        : (
          <>
            <p className="dsh-railist-settings-hint">{t('settings.discover.count', { count: rows.length })}</p>
            {rows.map(row => (
              <div key={row.suggestedId} className="dsh-railist-settings-discovery-row">
                <span className="dsh-railist-settings-hint">{row.label}</span>
                <p className="dsh-railist-settings-hint">{t('settings.discover.snippetHint')}</p>
                <code className="dsh-railist-settings-discovery-snippet">{row.snippet}</code>
                <CopyButton text={row.snippet} t={t} />
              </div>
            ))}
          </>
        )}
    </section>
  )
}
