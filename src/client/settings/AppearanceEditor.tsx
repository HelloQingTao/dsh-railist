/**
 * The appearance editor (README §3.2 / §3.3, task item 3).
 *
 * One row's overrides: display name, glyph (keep original / built-in set /
 * pasted SVG), hidden, locked. A group row edits the trigger instead: its
 * name, its glyph, its own hidden flag, and its ordered member list.
 *
 * Every write goes through the pure functions in `shared/edit.ts`; structural
 * edits (member order, take-out-of-group) are materialized first by the caller.
 */
import { useRef, useState, type ReactNode } from 'react'
import {
  MAX_LABEL_LENGTH,
  MAX_SVG_LENGTH,
  type BuiltinIconName,
  type IconRef,
  type ProfileConfig,
} from '../../shared/config.ts'
import type { I18nKey } from '../i18n/index.ts'
import type { SanitizeFailure } from '../contracts.ts'
import {
  moveMember,
  removeFromGroup,
  setGroupIcon,
  setGroupLabel,
  setPanelHidden,
  setPanelIcon,
  setPanelLabel,
} from '../../shared/edit.ts'
import type { Plan } from '../../shared/model.ts'
import type { GlyphComponent, GlyphRequest, SanitizeResult } from '../contracts.ts'
import type { Translator } from '../i18n/index.ts'
import type { SequenceSelection } from './SequenceEditor.tsx'

/** One localized sentence per closed-set refusal code. */
const SANITIZE_REASON_KEYS: Record<SanitizeFailure, I18nKey> = {
  size: 'settings.appearance.iconReason.size',
  malformed: 'settings.appearance.iconReason.malformed',
  forbidden: 'settings.appearance.iconReason.forbidden',
  reference: 'settings.appearance.iconReason.reference',
}

export interface AppearanceEditorProps {
  plan: Plan
  /** The live profile section: raw overrides are read from here. */
  profile: ProfileConfig
  selection: SequenceSelection
  t: Translator['t']
  glyph: (request: GlyphRequest) => ReactNode
  /** The contributor's own glyph, so "keep original" previews the real icon. */
  nativeGlyph: (panelId: string) => GlyphComponent | null
  /** Select another row: a group member's name opens the member's own editor. */
  onSelect: (selection: SequenceSelection) => void
  builtinNames: readonly BuiltinIconName[]
  sanitizeSvg: (source: string) => SanitizeResult
  apply: (edit: (profile: ProfileConfig) => ProfileConfig) => void
  applyStructural: (edit: (profile: ProfileConfig) => ProfileConfig) => void
}

interface IconPickerProps {
  idPrefix: string
  label: string
  t: Translator['t']
  glyph: (request: GlyphRequest) => ReactNode
  /** The glyph the rail shows when no override is set. */
  native: GlyphComponent | null
  builtinNames: readonly BuiltinIconName[]
  sanitizeSvg: (source: string) => SanitizeResult
  /** `null` means "keep the original". */
  current: IconRef | null
  onPick: (icon: IconRef | null) => void
}

/** The three-source glyph picker shared by panel rows and group triggers. */
function IconPicker(props: IconPickerProps): ReactNode {
  const { idPrefix, label, t, glyph, native, builtinNames, sanitizeSvg, current, onPick } = props
  const svgRef = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState<string | null>(null)
  const committed: 'original' | 'builtin' | 'custom' = current === null || current.kind === 'original' ? 'original' : current.kind
  // Picking the custom radio reveals the paste box *before* anything is
  // committed (there is no "custom" icon to derive it from yet).
  const [draft, setDraft] = useState<'original' | 'builtin' | 'custom' | null>(null)
  const mode = draft ?? committed

  const submitCustom = (): void => {
    const source = svgRef.current?.value ?? ''
    if (source.length > MAX_SVG_LENGTH) {
      setError(t('settings.appearance.iconCustomTooBig'))
      return
    }
    const result = sanitizeSvg(source)
    if (!result.ok) {
      // A coded refusal gets a sentence in the user's language; the raw English
      // reason stays in the tooltip for whoever has to debug the paste.
      setError(result.code === undefined
        ? t('settings.appearance.iconCustomInvalid', { reason: result.reason })
        : t(SANITIZE_REASON_KEYS[result.code]))
      return
    }
    setError(null)
    setDraft(null)
    onPick({ kind: 'custom', svg: result.svg })
  }

  return (
    <div className="dsh-panellist-settings-field">
      <span className="dsh-panellist-settings-fieldLabel">{label}</span>
      <div className="dsh-panellist-settings-radioRow" role="radiogroup" aria-label={label}>
        <label className="dsh-panellist-settings-radio">
          <input
            type="radio"
            name={`${idPrefix}-icon`}
            checked={mode === 'original'}
            onChange={() => { setError(null); setDraft(null); onPick(null) }}
          />
          <span>{t('settings.appearance.iconOriginal')}</span>
        </label>
        <label className="dsh-panellist-settings-radio">
          <input
            type="radio"
            name={`${idPrefix}-icon`}
            checked={mode === 'builtin'}
            onChange={() => {
              setError(null)
              setDraft(null)
              const fallback = builtinNames[0]
              onPick(fallback === undefined ? null : { kind: 'builtin', name: fallback })
            }}
          />
          <span>{t('settings.appearance.iconBuiltin')}</span>
        </label>
        <label className="dsh-panellist-settings-radio">
          <input
            type="radio"
            name={`${idPrefix}-icon`}
            checked={mode === 'custom'}
            onChange={() => { setError(null); setDraft('custom') }}
          />
          <span>{t('settings.appearance.iconCustom')}</span>
        </label>
      </div>

      {mode === 'builtin'
        ? (
          <div className="dsh-panellist-settings-iconGrid" role="group" aria-label={t('settings.appearance.iconBuiltin')}>
            {builtinNames.map(name => (
              <button
                key={name}
                type="button"
                className="dsh-panellist-settings-iconCell"
                aria-label={name}
                aria-pressed={current?.kind === 'builtin' && current.name === name}
                onClick={() => onPick({ kind: 'builtin', name })}
              >{glyph({ icon: { kind: 'builtin', name }, size: 18 })}</button>
            ))}
          </div>
        )
        : null}

      {mode === 'custom'
        ? (
          <div className="dsh-panellist-settings-field">
            <textarea
              ref={svgRef}
              className="dsh-panellist-settings-textarea"
              aria-label={t('settings.appearance.iconCustom')}
              placeholder={t('settings.appearance.iconCustomPlaceholder')}
              defaultValue={current?.kind === 'custom' ? current.svg : ''}
              rows={4}
            />
            <span className="dsh-panellist-settings-actionRow">
              <button type="button" className="dsh-panellist-settings-action" onClick={submitCustom}>
                {t('common.save')}
              </button>
            </span>
          </div>
        )
        : null}

      {error === null ? null : <p className="dsh-panellist-settings-error" role="alert">{error}</p>}

      <span className="dsh-panellist-settings-preview">
        <span className="dsh-panellist-settings-fieldLabel">{t('settings.appearance.preview')}</span>
        {glyph({ icon: current, native, size: 20 })}
      </span>
    </div>
  )
}

export function AppearanceEditor(props: AppearanceEditorProps): ReactNode {
  const { plan, profile, selection, t, glyph, nativeGlyph, onSelect, builtinNames, sanitizeSvg, apply, applyStructural } = props

  if (selection.kind === 'group') {
    const group = plan.groups.get(selection.id)
    if (group === undefined) return null
    const groupId = group.id
    return (
      <section className="dsh-panellist-settings-block" data-editor="group" data-editor-id={groupId}>
        <h3 className="dsh-panellist-settings-blockTitle">{t('settings.appearance.title')}</h3>
        <label className="dsh-panellist-settings-field">
          <span className="dsh-panellist-settings-fieldLabel">{t('settings.group.rename')}</span>
          <input
            key={`group-label:${groupId}`}
            type="text"
            className="dsh-panellist-settings-input"
            defaultValue={group.labelExplicit ? group.label : ''}
            placeholder={t('settings.appearance.namePlaceholder')}
            maxLength={MAX_LABEL_LENGTH}
            onBlur={event => apply(edit => setGroupLabel(edit, groupId, event.currentTarget.value))}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
        </label>

        <IconPicker
          idPrefix={`group-${groupId}`}
          label={t('settings.group.icon')}
          t={t}
          glyph={glyph}
          native={group.iconFallbackPanelId === null ? null : nativeGlyph(group.iconFallbackPanelId)}
          builtinNames={builtinNames}
          sanitizeSvg={sanitizeSvg}
          current={group.icon}
          onPick={icon => apply(edit => setGroupIcon(edit, groupId, icon))}
        />

        <div className="dsh-panellist-settings-field">
          <span className="dsh-panellist-settings-fieldLabel">{t('settings.group.members')}</span>
          <ul className="dsh-panellist-settings-members">
            {group.members.map((member, index) => (
              <li key={member.id} className="dsh-panellist-settings-member" data-member-id={member.id}>
                {/* Selecting a member here is the same navigation the sequence
                    list offers: the member's own name and icon open its editor. */}
                <button
                  type="button"
                  className="dsh-panellist-settings-rowSelect"
                  data-action="select"
                  onClick={() => onSelect({ kind: 'panel', id: member.id })}
                >
                  <span className="dsh-panellist-settings-rowGlyph">{glyph({
                    icon: member.icon,
                    native: nativeGlyph(member.id),
                    size: 16,
                  })}</span>
                  <span className="dsh-panellist-settings-memberName">{member.label}</span>
                </button>
                {member.missing
                  ? <span className="dsh-panellist-settings-badge" data-badge="missing">{t('rail.group.missing')}</span>
                  : null}
                {member.hidden
                  ? <span className="dsh-panellist-settings-badge" data-badge="hidden">{t('settings.appearance.hidden')}</span>
                  : null}
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="memberMoveUp"
                  aria-label={t('settings.sequence.moveUp')}
                  title={t('settings.sequence.moveUp')}
                  disabled={index === 0}
                  onClick={() => applyStructural(edit => moveMember(edit, groupId, member.id, -1))}
                >↑</button>
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="memberMoveDown"
                  aria-label={t('settings.sequence.moveDown')}
                  title={t('settings.sequence.moveDown')}
                  disabled={index === group.members.length - 1}
                  onClick={() => applyStructural(edit => moveMember(edit, groupId, member.id, 1))}
                >↓</button>
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="memberRemove"
                  aria-label={t('settings.sequence.removeFromGroup')}
                  title={t('settings.sequence.removeFromGroup')}
                  onClick={() => applyStructural(edit => removeFromGroup(edit, groupId, member.id))}
                >−</button>
                {/* Last in the row, like every other row's Hide/Show. The
                    member's rail row is already suppressed, so this is exactly
                    "show it in the group's menu". */}
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="memberToggleHidden"
                  aria-label={member.hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}
                  title={t('settings.appearance.hiddenHint')}
                  onClick={() => apply(edit => setPanelHidden(edit, member.id, !member.hidden))}
                >{member.hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}</button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }

  const panel = plan.panels.get(selection.id)
  if (panel === undefined) return null
  const panelId = panel.id
  const override = profile.entries[panelId]
  const currentIcon: IconRef | null = override?.icon === undefined || override.icon.kind === 'original' ? null : override.icon

  return (
    <section className="dsh-panellist-settings-block" data-editor="panel" data-editor-id={panelId}>
      <h3 className="dsh-panellist-settings-blockTitle">{t('settings.appearance.title')}</h3>

      <label className="dsh-panellist-settings-field">
        <span className="dsh-panellist-settings-fieldLabel">{t('settings.appearance.name')}</span>
        <input
          key={`panel-label:${panelId}`}
          type="text"
          className="dsh-panellist-settings-input"
          defaultValue={override?.label ?? ''}
          placeholder={t('settings.appearance.namePlaceholder')}
          maxLength={MAX_LABEL_LENGTH}
          onBlur={event => apply(edit => setPanelLabel(edit, panelId, event.currentTarget.value))}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
      </label>

      <IconPicker
        idPrefix={`panel-${panelId}`}
        label={t('settings.appearance.icon')}
        t={t}
        glyph={glyph}
        native={nativeGlyph(panelId)}
        builtinNames={builtinNames}
        sanitizeSvg={sanitizeSvg}
        current={currentIcon}
        onPick={icon => apply(edit => setPanelIcon(edit, panelId, icon))}
      />

      {/*
        Visibility has one entry point, and it is the per-row Hide/Show button in
        the sequence list above — a second checkbox here was a duplicate control
        for the same write, with its own hint text to keep in sync.
      */}
      {panel.suppressed
        ? <p className="dsh-panellist-settings-hint">{t('settings.appearance.groupedHint')}</p>
        : null}
    </section>
  )
}
