/**
 * The sequence editor (README §3.1, task item 2).
 *
 * A plain, controlled list of the live rail rows. Drag and drop is the primary
 * channel (HTML5 DnD: drag a row onto another row to reorder, onto a group row
 * to join it, out of a group onto the list to leave it); the per-row
 * move-up/move-down buttons and "Group with next" are the keyboard-accessible
 * fallbacks.
 *
 * Every structural edit goes through {@link materializeSequence} first, so the
 * *partial* configured order becomes explicit (the live rail order the user is
 * looking at) before the edit lands. The pure functions in `shared/edit.ts`
 * own all sequence surgery — nothing here mutates a profile.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { mintGroupId, type ProfileConfig } from '../../shared/config.ts'
import {
  addToGroup,
  createGroup,
  dissolveGroup,
  materializeSequence,
  moveMember,
  moveMemberTo,
  moveRow,
  moveRowTo,
  removeFromGroup,
  setGroupHidden,
  setPanelHidden,
  type LiveRow,
} from '../../shared/edit.ts'
import type { Plan, RegisteredPanel } from '../../shared/model.ts'
import type { GlyphComponent, GlyphRequest } from '../contracts.ts'
import type { Translator } from '../i18n/index.ts'

/** Which row the appearance editor is currently editing. */
export interface SequenceSelection {
  kind: 'panel' | 'group'
  id: string
}

export interface SequenceEditorProps {
  plan: Plan
  /** Live rail registrations, needed to materialize a fresh, empty sequence. */
  registered: readonly RegisteredPanel[]
  t: Translator['t']
  glyph: (request: GlyphRequest) => ReactNode
  /** The contributor's own glyph, so an unconfigured row previews its real icon. */
  nativeGlyph: (panelId: string) => GlyphComponent | null
  selected: SequenceSelection | null
  onSelect: (selection: SequenceSelection) => void
  /** Apply an edit that needs no materialization. */
  apply: (edit: (profile: ProfileConfig) => ProfileConfig) => void
  /** Apply a structural edit: the live rail order is materialized first. */
  applyStructural: (edit: (profile: ProfileConfig) => ProfileConfig) => void
}

const DND_MIME = 'application/x-dsh-panellist'

interface DragPayload {
  kind: 'panel' | 'group'
  id: string
  /** Group the dragged panel currently sits in, or `null` for a top-level row. */
  fromGroupId: string | null
}

function decodePayload(raw: string): DragPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const kind = record['kind']
    const id = record['id']
    if ((kind !== 'panel' && kind !== 'group') || typeof id !== 'string') return null
    const fromGroupId = record['fromGroupId']
    return { kind, id, fromGroupId: typeof fromGroupId === 'string' ? fromGroupId : null }
  } catch {
    return null
  }
}

/** `DataTransfer` is typed non-nullable but is absent in jsdom and some hosts. */
function transferOf(event: DragEvent<HTMLElement>): DataTransfer | null {
  const raw: unknown = (event as { dataTransfer?: unknown }).dataTransfer
  return raw === null || raw === undefined ? null : (raw as DataTransfer)
}

/** Insert-before index in `moveRowTo` terms, given the source index. */
function beforeIndex(from: number, target: number): number {
  return from >= 0 && from < target ? target - 1 : target
}

export function SequenceEditor(props: SequenceEditorProps): ReactNode {
  const { plan, registered, t, glyph, nativeGlyph, selected, onSelect, apply, applyStructural } = props
  const dragRef = useRef<DragPayload | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  /**
   * The whole rail, listed from the start: the sequence is not a separate
   * "configured" subset any more, so there is nothing for the user to opt into
   * before they can touch a panel.
   */
  const rows = plan.rows

  /** The live rail order: what "use the current rail order" snapshots. */
  const railRows = (): LiveRow[] => {
    if (plan.rows.length > 0) return plan.rows.map(row => ({ kind: row.kind, id: row.id }))
    // Nothing is registered-but-unsorted yet, so the rail order IS the
    // registration order: sort by the declared order only — a stable sort keeps
    // ledger order on ties, exactly like the shell.
    return [...registered]
      .sort((left, right) => left.order - right.order)
      .map(panel => ({ kind: 'panel' as const, id: panel.id }))
  }

  const beginDrag = (event: DragEvent<HTMLElement>, payload: DragPayload, key: string): void => {
    dragRef.current = payload
    setDraggingKey(key)
    const transfer = transferOf(event)
    if (transfer === null) return
    try {
      transfer.setData(DND_MIME, JSON.stringify(payload))
      transfer.setData('text/plain', payload.id)
      transfer.effectAllowed = 'move'
    } catch {
      // A host may expose a read-only DataTransfer; the ref above still carries
      // the payload, so the drop handler keeps working.
    }
  }

  const endDrag = (): void => {
    dragRef.current = null
    setDraggingKey(null)
  }

  const payloadOf = (event: DragEvent<HTMLElement>): DragPayload | null => {
    if (dragRef.current !== null) return dragRef.current
    const transfer = transferOf(event)
    if (transfer === null) return null
    try {
      return decodePayload(transfer.getData(DND_MIME))
    } catch {
      return null
    }
  }

  const allowDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const transfer = transferOf(event)
    if (transfer !== null) transfer.dropEffect = 'move'
  }

  /* --------------------------------------------------------------- editing */

  const move = (id: string, delta: number): void => {
    applyStructural(profile => moveRow(profile, id, delta))
  }

  const groupWithNext = (index: number): void => {
    const row = rows[index]
    const next = rows[index + 1]
    if (row === undefined || next === undefined || next.kind !== 'panel') return
    const taken = [...rows.map(candidate => candidate.id), ...registered.map(panel => panel.id), ...plan.groups.keys()]
    const groupId = mintGroupId(taken)
    // No explicit label: README §2.6 makes the trigger's default identity the
    // first member's own name, resolved at render time. Baking a literal in here
    // would both contradict that default and freeze the creation-time language.
    applyStructural(profile => createGroup(profile, groupId, [row.id, next.id]))
  }

  const ungroup = (groupId: string): void => {
    applyStructural(profile => dissolveGroup(profile, groupId))
  }

  /**
   * Hide or show one row. A panel keeps its rail position and stays selectable
   * while hidden (README §2.3); a group trigger follows the same rule.
   */
  const toggleHidden = (kind: 'panel' | 'group', id: string, hidden: boolean): void => {
    apply(profile => (kind === 'group'
      ? setGroupHidden(profile, id, hidden)
      : setPanelHidden(profile, id, hidden)))
  }

  const dropOnRow = (event: DragEvent<HTMLLIElement>, index: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = payloadOf(event)
    endDrag()
    const target = rows[index]
    if (payload === null || target === undefined || payload.id === target.id) return
    if (target.kind === 'group' && payload.kind === 'panel') {
      if (payload.fromGroupId === target.id) return
      applyStructural(profile => addToGroup(profile, target.id, payload.id))
      return
    }
    if (payload.fromGroupId !== null) {
      // A member dropped outside its own group leaves the group.
      const groupId = payload.fromGroupId
      applyStructural(profile => removeFromGroup(profile, groupId, payload.id))
      return
    }
    const from = rows.findIndex(row => row.id === payload.id)
    const at = beforeIndex(from, index)
    applyStructural(profile => moveRowTo(profile, payload.id, at))
  }

  const dropOnList = (event: DragEvent<HTMLOListElement | HTMLDivElement>): void => {
    event.preventDefault()
    const payload = payloadOf(event)
    endDrag()
    if (payload === null) return
    if (payload.fromGroupId !== null) {
      const groupId = payload.fromGroupId
      applyStructural(profile => removeFromGroup(profile, groupId, payload.id))
      return
    }
    applyStructural(profile => moveRowTo(profile, payload.id, rows.length))
  }

  const dropOnMember = (event: DragEvent<HTMLLIElement>, groupId: string, index: number, members: readonly string[]): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = payloadOf(event)
    endDrag()
    if (payload === null || payload.kind !== 'panel') return
    const target = members[index]
    if (target === undefined || target === payload.id) return
    if (payload.fromGroupId === groupId) {
      applyStructural(profile => moveMemberTo(profile, groupId, payload.id, beforeIndex(members.indexOf(payload.id), index)))
      return
    }
    applyStructural(profile => addToGroup(profile, groupId, payload.id, index))
  }

  /* ---------------------------------------------------------------- render */

  const badge = (kind: string, text: string): ReactNode => (
    <span key={kind} className="dsh-panellist-settings-badge" data-badge={kind}>{text}</span>
  )

  const renderRow = (index: number): ReactNode => {
    const row = rows[index]
    if (row === undefined) return null
    const isGroup = row.kind === 'group'
    const group = isGroup ? plan.groups.get(row.id) : undefined
    const panel = isGroup ? undefined : plan.panels.get(row.id)
    const hidden = isGroup ? group?.hidden === true : panel?.hidden === true
    const locked = panel?.locked === true
    const missing = plan.orphans.includes(row.id) || plan.missingMembers.includes(row.id)
    const icon = isGroup ? group?.icon ?? null : panel?.icon ?? null
    // A group borrows the first live member's glyph when it has no icon of its
    // own, exactly as the rail trigger does.
    const nativePanelId = isGroup ? group?.iconFallbackPanelId ?? null : row.id
    const isSelected = selected !== null && selected.kind === row.kind && selected.id === row.id
    const next = rows[index + 1]
    const canGroupWithNext = !isGroup && next !== undefined && next.kind === 'panel'
    const members = group?.members ?? []
    const memberIds = members.map(member => member.id)

    const badges: ReactNode[] = []
    if (hidden) badges.push(badge('hidden', t('settings.appearance.hidden')))
    if (locked) badges.push(badge('locked', t('settings.appearance.locked')))
    if (isGroup) badges.push(badge('group', t('settings.sequence.members', { count: members.length })))
    if (missing) badges.push(badge('missing', t('rail.group.missing')))

    return (
      <li
        key={row.railId}
        className="dsh-panellist-settings-row"
        data-row-id={row.id}
        data-row-kind={row.kind}
        data-selected={isSelected ? 'true' : 'false'}
        data-dragging={draggingKey === row.railId ? 'true' : 'false'}
        draggable={!locked}
        onDragStart={event => beginDrag(event, { kind: row.kind, id: row.id, fromGroupId: null }, row.railId)}
        onDragEnd={endDrag}
        onDragOver={allowDrop}
        onDrop={event => dropOnRow(event, index)}
      >
        <div className="dsh-panellist-settings-rowMain">
          <button
            type="button"
            className="dsh-panellist-settings-rowSelect"
            data-action="select"
            aria-pressed={isSelected}
            onClick={() => onSelect({ kind: row.kind, id: row.id })}
          >
            <span className="dsh-panellist-settings-rowGlyph">{glyph({
              icon,
              native: nativePanelId === null ? null : nativeGlyph(nativePanelId),
              size: 18,
            })}</span>
            <span className="dsh-panellist-settings-rowName">{row.label}</span>
          </button>
          {badges.length === 0
            ? null
            : <span className="dsh-panellist-settings-badges">{badges}</span>}
          <span className="dsh-panellist-settings-actions dsh-panellist-settings-actionRow">
            <button
              type="button"
              className="dsh-panellist-settings-action"
              data-action="moveUp"
              aria-label={t('settings.sequence.moveUp')}
              title={t('settings.sequence.moveUp')}
              disabled={locked || index === 0}
              onClick={() => move(row.id, -1)}
            >↑</button>
            <button
              type="button"
              className="dsh-panellist-settings-action"
              data-action="moveDown"
              aria-label={t('settings.sequence.moveDown')}
              title={t('settings.sequence.moveDown')}
              disabled={locked || index === rows.length - 1}
              onClick={() => move(row.id, 1)}
            >↓</button>
            {isGroup
              ? (
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="ungroup"
                  onClick={() => ungroup(row.id)}
                >{t('settings.sequence.ungroup')}</button>
              )
              : (
                <button
                  type="button"
                  className="dsh-panellist-settings-action"
                  data-action="groupWithNext"
                  disabled={locked || !canGroupWithNext}
                  onClick={() => groupWithNext(index)}
                >{t('settings.sequence.groupWithNext')}</button>
              )}
            {/* Show/hide straight from the list: the per-row visibility toggle
                is the one action a user reaches for most often. */}
            <button
              type="button"
              className="dsh-panellist-settings-action"
              data-action="toggleHidden"
              data-hidden={hidden ? 'true' : 'false'}
              aria-pressed={hidden}
              aria-label={hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}
              title={t('settings.appearance.hiddenHint')}
              onClick={() => toggleHidden(row.kind, row.id, !hidden)}
            >{hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}</button>
          </span>
        </div>
        {isGroup && members.length > 0
          ? (
            <ul className="dsh-panellist-settings-members">
              {members.map((member, memberIndex) => (
                <li
                  key={member.id}
                  className="dsh-panellist-settings-member"
                  data-member-id={member.id}
                  draggable
                  onDragStart={event => {
                    // Otherwise the enclosing group row's own dragstart overwrites
                    // the payload and the member would look like a top-level row.
                    event.stopPropagation()
                    beginDrag(event, { kind: 'panel', id: member.id, fromGroupId: row.id }, `${row.railId}/${member.id}`)
                  }}
                  onDragEnd={event => { event.stopPropagation(); endDrag() }}
                  onDragOver={allowDrop}
                  onDrop={event => dropOnMember(event, row.id, memberIndex, memberIds)}
                >
                  <span className="dsh-panellist-settings-rowGlyph">{glyph({
                    icon: member.icon,
                    native: nativeGlyph(member.id),
                    size: 16,
                  })}</span>
                  <span className="dsh-panellist-settings-memberName">{member.label}</span>
                  {member.missing
                    ? <span className="dsh-panellist-settings-badge" data-badge="missing">{t('rail.group.missing')}</span>
                    : null}
                  <button
                    type="button"
                    className="dsh-panellist-settings-action"
                    data-action="memberMoveUp"
                    aria-label={t('settings.sequence.moveUp')}
                    title={t('settings.sequence.moveUp')}
                    disabled={memberIndex === 0}
                    onClick={() => applyStructural(profile => moveMember(profile, row.id, member.id, -1))}
                  >↑</button>
                  <button
                    type="button"
                    className="dsh-panellist-settings-action"
                    data-action="memberMoveDown"
                    aria-label={t('settings.sequence.moveDown')}
                    title={t('settings.sequence.moveDown')}
                    disabled={memberIndex === members.length - 1}
                    onClick={() => applyStructural(profile => moveMember(profile, row.id, member.id, 1))}
                  >↓</button>
                  <button
                    type="button"
                    className="dsh-panellist-settings-action"
                    data-action="memberRemove"
                    aria-label={t('settings.sequence.removeFromGroup')}
                    title={t('settings.sequence.removeFromGroup')}
                    onClick={() => applyStructural(profile => removeFromGroup(profile, row.id, member.id))}
                  >−</button>
                </li>
              ))}
            </ul>
          )
          : null}
      </li>
    )
  }

  return (
    <section className="dsh-panellist-settings-block">
      <h3 className="dsh-panellist-settings-blockTitle">{t('settings.sequence.title')}</h3>
      <p className="dsh-panellist-settings-hint">{t('settings.sequence.hint')}</p>

      {!plan.reordering
        ? (
          <div className="dsh-panellist-settings-banner" data-state="gated">
            <p className="dsh-panellist-settings-hint">{t('settings.sequence.gatedHint')}</p>
            <span className="dsh-panellist-settings-actionRow">
              <button
                type="button"
                className="dsh-panellist-settings-action"
                data-action="materialize"
                disabled={registered.length === 0}
                onClick={() => apply(profile => materializeSequence(profile, railRows()))}
              >{t('settings.sequence.materialize')}</button>
            </span>
          </div>
        )
        : null}

      {rows.length === 0
        ? <p className="dsh-panellist-settings-hint">{t('settings.sequence.empty')}</p>
        : (
          <div
            className="dsh-panellist-settings-dropZone"
            data-testid="dsh-panellist-settings-dropZone"
            onDragOver={allowDrop}
            onDrop={dropOnList}
          >
            <ol className="dsh-panellist-settings-rows">{rows.map((_row, index) => renderRow(index))}</ol>
          </div>
        )}
    </section>
  )
}
