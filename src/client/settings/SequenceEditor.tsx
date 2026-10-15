/**
 * The sequence editor (README §3.1, task item 2).
 *
 * A plain, controlled list of the live rail rows. Drag and drop is the primary
 * channel (HTML5 DnD: drag a row onto another row to reorder, onto a group row
 * to join it, out of a group onto the list to leave it), and the row's own
 * **grab handle** is the keyboard control too: focus it and press ↑ / ↓ to step
 * the row one position. There are deliberately no move-up/move-down buttons —
 * the handle carries the same capability, and a button pair per row was two
 * more tab stops per entry for an action the arrow keys already cover.
 *
 * The handle is also the *only* draggable node. The row itself used to be
 * draggable, which made Select / Hide / Ungroup mis-touch-prone: a slightly
 * moved click started a drag instead of pressing the button.
 *
 * Every structural edit goes through {@link materializeSequence} first, so the
 * *partial* configured order becomes explicit (the live rail order the user is
 * looking at) before the edit lands. The pure functions in `shared/edit.ts`
 * own all sequence surgery — nothing here mutates a profile.
 *
 * There is deliberately no gate to open first: `plan.rows` IS the rail, so the
 * list is complete from the first open and the write gate behind it (the plan
 * writes no `order` while the sequence holds no live row, README §2.10) stays
 * invisible — the first drag or grouping materializes the order on its way in.
 */
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { mintGroupId, type Container, type ProfileConfig } from '../../shared/config.ts'
import {
  addToGroup,
  createGroup,
  dissolveGroup,
  moveMember,
  moveMemberTo,
  moveRowTo,
  removeFromGroup,
  setGroupHidden,
  setPanelHidden,
} from '../../shared/edit.ts'
import type { Plan, PlanRow, RegisteredPanel } from '../../shared/model.ts'
import type { GlyphComponent, GlyphRequest } from '../contracts.ts'
import type { I18nKey, Translator } from '../i18n/index.ts'

/**
 * The blocks the list is drawn as, in the order they always appear.
 *
 * The order is FIXED — the panel list under the logo, then the action row, then
 * the shell's own settings row at the very bottom — so the three headings can
 * never repeat or swap places however the rows are dragged around. Rows move
 * between the first two blocks freely; only the headings stay put.
 */
const SECTION_ORDER = ['top', 'footer', 'pinned'] as const

/**
 * The two states of a row's visibility switch, on the shell's own 16×16 grid
 * and stroked with `currentColor` — so they take the shell's label colour and
 * follow the theme exactly like the rail's shipped icons.
 *
 * They are path data here rather than entries in `icons/builtin.tsx` on
 * purpose: that catalogue is the *user-selectable* glyph set, listed in the
 * schema and the icon picker, and a row's eye is neither — it is a control of
 * this list. Keeping it local also keeps the config surface unchanged.
 */
const EYE_ON_PATHS = [
  'M8 3.25C4.9 3.25 2.35 5.3 1.1 8c1.25 2.7 3.8 4.75 6.9 4.75S13.65 10.7 14.9 8C13.65 5.3 11.1 3.25 8 3.25Z',
  'M8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z',
]

const EYE_OFF_PATHS = [
  'M8 3.25C4.9 3.25 2.35 5.3 1.1 8c1.25 2.7 3.8 4.75 6.9 4.75S13.65 10.7 14.9 8C13.65 5.3 11.1 3.25 8 3.25Z',
  'M8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z',
  'M3.2 2.3 13.7 12.8',
]

/** One eye glyph, drawn inline so it inherits `currentColor`. */
function eyeGlyph(paths: readonly string[]): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2"
      strokeLinecap="round" strokeLinejoin="round">
      {paths.map(path => <path key={path} d={path} />)}
    </svg>
  )
}

const EYE_ON = eyeGlyph(EYE_ON_PATHS)
const EYE_OFF = eyeGlyph(EYE_OFF_PATHS)

/** Which row the appearance editor is currently editing. */
export interface SequenceSelection {
  kind: 'panel' | 'group'
  id: string
}

export interface SequenceEditorProps {
  plan: Plan
  /** Live rail registrations: a new group id is minted against them. */
  registered: readonly RegisteredPanel[]
  t: Translator['t']
  glyph: (request: GlyphRequest) => ReactNode
  /** The contributor's own glyph, so an unconfigured row previews its real icon. */
  nativeGlyph: (panelId: string) => GlyphComponent | null
  selected: SequenceSelection | null
  onSelect: (selection: SequenceSelection) => void
  /**
   * Panel id → its contributor subtitle (plugin name and version), already
   * rendered to copy by the caller. An absent id renders nothing, which is the
   * normal case on a profile whose contributors declare no origin metadata.
   *
   * Groups never carry one: a group has no contributor of its own, so only the
   * panel rows are looked up.
   */
  pluginInfo?: Record<string, ReactNode>
  /** Apply an edit that needs no materialization. */
  apply: (edit: (profile: ProfileConfig) => ProfileConfig) => void
  /**
   * Apply a structural edit: the live rail order is materialized first.
   *
   * `moved` names the row the user dragged across seats, when the edit came from a
   * cross-seat drag: the rail re-seats that row and leaves every other row in its
   * own seat (README §2.11). Omit it for edits that are not a cross-seat drag — a
   * reorder inside one seat, a rename, a merge — so no seat changes.
   */
  applyStructural: (edit: (profile: ProfileConfig) => ProfileConfig, moved?: string | null) => void
}

const DND_MIME = 'application/x-dsh-panellist'

/**
 * Where a drop would land, relative to the row under the pointer.
 *
 * `inside` is only produced for a group row under a panel drag: that is the
 * "join this group" gesture, and it is exclusive of `before`/`after` because a
 * group row is either a join target or a position in the list, never both.
 */
type DropEdge = 'before' | 'after' | 'inside'

/** Where the drag came from, which decides where it may land. */
type DragScope = 'rows' | 'members'

/** The row (or member) the pointer is over, and on which side of it. */
interface DropTarget {
  /** `railId` of the top-level row, or `railId/memberId` inside a group. */
  key: string
  edge: DropEdge
}

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
  const { plan, registered, t, glyph, nativeGlyph, selected, onSelect, apply, applyStructural, pluginInfo } = props
  const dragRef = useRef<DragPayload | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  /**
   * The subtree the drag is scoped to: a top-level drag may land on rows and on
   * the list, a member drag may land on its own group's member list or escape to
   * the top level. `null` means no drag is in flight.
   */
  const [dragScope, setDragScope] = useState<DragScope | null>(null)
  /** The candidate insertion point, drawn by the `data-drop-target` rules. */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  /** True while the trailing "move to the end" gap is the candidate. */
  const [dropAtEnd, setDropAtEnd] = useState(false)
  /**
   * The whole rail, listed from the start: the sequence is not a separate
   * "configured" subset any more, so there is nothing for the user to opt into
   * before they can touch a panel. `rows` IS the rail, which is why everything
   * here — including "use the current rail order" — reads it and nothing else.
   */
  const rows = plan.rows

  /**
   * The rows grouped into FIXED sections (README §2.12).
   *
   * The sequence is one flat list, but the rail it describes has three separate
   * places, and only two of them are places the user can put a row in: the panel
   * list under the logo (`top`) and the action row below it (`footer`). The third
   * is the shell's own settings row, which is fixed.
   *
   * So the editor is three blocks in a FIXED order — top, footer, then the pinned
   * row — and a block is never split, reordered or moved. That is the shape the
   * user asked for: "the sections cannot move, the section position is fixed,
   * what gets sorted is what is inside the section". The earlier design split the
   * list into per-appearance runs, which let a drag push a heading into the middle
   * of the list and duplicate it — the two identical "Bottom left · actions"
   * headings in the screenshot.
   *
   * Rows keep their relative order inside their block, which is the order the
   * sequence gives them; nothing is re-sorted here, because the whole point is
   * that the user is editing that order.
   */
  const sections = ((): Array<{ seat: Container | 'pinned'; rows: Array<{ row: PlanRow; index: number }> }> => {
    const bySeat = new Map<Container | 'pinned', Array<{ row: PlanRow; index: number }>>()
    rows.forEach((row, index) => {
      const seat: Container | 'pinned' = row.pinned ? 'pinned' : row.container
      const bucket = bySeat.get(seat)
      if (bucket === undefined) bySeat.set(seat, [{ row, index }])
      else bucket.push({ row, index })
    })
    const out: Array<{ seat: Container | 'pinned'; rows: Array<{ row: PlanRow; index: number }> }> = []
    for (const seat of SECTION_ORDER) {
      const bucket = bySeat.get(seat)
      if (bucket !== undefined && bucket.length > 0) out.push({ seat, rows: bucket })
    }
    return out
  })()

  const beginDrag = (
    event: DragEvent<HTMLElement>,
    payload: DragPayload,
    key: string,
    scope: DragScope,
  ): void => {
    dragRef.current = payload
    setDraggingKey(key)
    setDragScope(scope)
    setDropTarget(null)
    setDropAtEnd(false)
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
    setDragScope(null)
    setDropTarget(null)
    setDropAtEnd(false)
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

  /**
   * Move a top-level row to an absolute index — the primitive both the keyboard
   * control and the list-end drop need. It passes the row as `moved`, because a
   * move can cross seats and only the moved row may change seat.
   *
   * `moveRowTo` takes the index in the list *after* the row has been taken out
   * (it splices first, then inserts), which is exactly the "one step down from
   * here" the arrow keys mean — so the target index is passed through as-is.
   * Adding the before/after correction here would double-count the removal.
   */
  const moveTo = (id: string, to: number): void => {
    if (to < 0 || to >= rows.length) return
    applyStructural(profile => moveRowTo(profile, id, to), id)
  }

  /**
   * Keyboard reordering, the replacement for the removed ↑/↓ buttons.
   *
   * A top-level row steps through the list; a member steps inside its own group.
   * Only ↑/↓ are claimed, so Tab keeps walking the row's controls and the
   * handle keeps its own Enter/Space behaviour. `stopPropagation` matters: the
   * handle sits inside the row, and an arrow key that reached a list-level
   * handler would scroll the page as well.
   */
  const moveByKey = (delta: number, context: {
    kind: 'panel' | 'group'
    id: string
    groupId: string | null
    memberIds: readonly string[]
    index: number
  }): void => {
    if (context.groupId === null) {
      const to = context.index + delta
      if (to < 0 || to >= rows.length) return
      moveTo(context.id, to)
    } else {
      const to = context.index + delta
      if (to < 0 || to >= context.memberIds.length) return
      const groupId = context.groupId
      applyStructural(profile => moveMember(profile, groupId, context.id, delta))
    }
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, context: {
    kind: 'panel' | 'group'
    id: string
    groupId: string | null
    memberIds: readonly string[]
    index: number
  }): void => {
    // Alt/Ctrl/Meta + arrow keeps whatever the host binds to it (a11y tools and
    // the shell's own shortcuts), so only the bare arrow pair is claimed.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()
    moveByKey(delta, context)
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
    // Select the fresh group right away: the rename box and the icon picker live
    // in the group editor below the list, and a user who just grouped two rows
    // should not have to guess that clicking the row's own name opens it.
    onSelect({ kind: 'group', id: groupId })
  }

  const ungroup = (groupId: string): void => {
    applyStructural(profile => dissolveGroup(profile, groupId))
  }

  /**
   * Whether the strip's group verb would do anything for the current selection:
   * the selected row must be a panel with a panel directly after it. It mirrors
   * the per-row `canGroupWithNext` the row used to compute for its own button —
   * the rule is the same, only the place the button lives changed.
   */
  const canGroupSelected = ((): boolean => {
    if (selected === null || selected.kind === 'group') return false
    const index = rows.findIndex(row => row.kind === 'panel' && row.id === selected.id)
    const next = index === -1 ? undefined : rows[index + 1]
    return next !== undefined && next.kind === 'panel'
  })()

  /**
   * Hide or show one row. A panel keeps its rail position and stays selectable
   * while hidden (README §2.3); a group trigger follows the same rule.
   */
  const toggleHidden = (kind: 'panel' | 'group', id: string, hidden: boolean): void => {
    apply(profile => (kind === 'group'
      ? setGroupHidden(profile, id, hidden)
      : setPanelHidden(profile, id, hidden)))
  }

  const dropOnRow = (event: DragEvent<HTMLLIElement>, index: number, edge: DropEdge): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = payloadOf(event)
    endDrag()
    const target = rows[index]
    if (payload === null || target === undefined || payload.id === target.id) return
    if (target.kind === 'group' && payload.kind === 'panel' && edge === 'inside') {
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
    // A group row can only be a *position* for another row (`inside` is already
    // handled above and is unreachable for a group payload), so both kinds
    // converge on the same "insert at this boundary" edit.
    const from = rows.findIndex(row => row.id === payload.id)
    const at = beforeIndex(from, index + (edge === 'after' ? 1 : 0))
    // The dragged row is the one that may change seat; everything else stays put.
    applyStructural(profile => moveRowTo(profile, payload.id, at), payload.id)
  }

  /**
   * Move a row by keyboard. Same seat rule as a drag: the moved row is the only
   * one that may change seat, so it is passed as `moved` as well.
   */
  const dropAtListEnd = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = payloadOf(event)
    endDrag()
    if (payload === null) return
    if (payload.fromGroupId !== null) {
      const groupId = payload.fromGroupId
      applyStructural(profile => removeFromGroup(profile, groupId, payload.id))
      return
    }
    // Dropping at the very end puts the row in the last seat on screen — a
    // cross-seat drag just like dropping on a row, so it passes `moved` too.
    applyStructural(profile => moveRowTo(profile, payload.id, rows.length), payload.id)
  }

  /**
   * Which part of the row the pointer is over. A group row splits into three
   * bands while a panel is being dragged: the middle 40% joins the group, the
   * outer bands place the row next to it. Everything else is a plain
   * half-and-half before/after split, so the indicator always appears on the
   * side the drop will actually use.
   */
  const edgeOf = (event: DragEvent<HTMLElement>, canJoin: boolean): DropEdge => {
    const box = event.currentTarget.getBoundingClientRect()
    const height = box.height
    // jsdom reports a zero-height box: fall back to the joining gesture, which
    // is the one a group row offers and the tests exercise.
    if (height <= 0) return canJoin ? 'inside' : 'before'
    const offset = event.clientY - box.top
    if (canJoin && offset > height * 0.3 && offset < height * 0.7) return 'inside'
    return offset < height / 2 ? 'before' : 'after'
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
    applyStructural(profile => moveRowTo(profile, payload.id, rows.length), payload.id)
  }

  const dropOnMember = (event: DragEvent<HTMLLIElement>, groupId: string, index: number, members: readonly string[], edge: DropEdge): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = payloadOf(event)
    endDrag()
    if (payload === null || payload.kind !== 'panel') return
    const target = members[index]
    if (target === undefined || target === payload.id) return
    if (payload.fromGroupId === groupId) {
      const at = beforeIndex(members.indexOf(payload.id), index + (edge === 'after' ? 1 : 0))
      applyStructural(profile => moveMemberTo(profile, groupId, payload.id, at))
      return
    }
    applyStructural(profile => addToGroup(profile, groupId, payload.id, index + (edge === 'after' ? 1 : 0)))
  }

  /* ---------------------------------------------------------------- render */

  const badge = (kind: string, text: string): ReactNode => (
    <span key={kind} className="dsh-panellist-settings-badge" data-badge={kind}>{text}</span>
  )

  /** Everything the handle needs to describe and move its own row. */
  interface HandleContext {
    /** `railId`, or `railId/memberId` for a member: identifies the dragged node. */
    key: string
    label: string
    kind: 'panel' | 'group'
    id: string
    /** The owning group for a member, or `null` for a top-level row. */
    groupId: string | null
    memberIds: readonly string[]
    index: number
  }

  /**
   * The grab handle: the row's only drag origin and its keyboard reorder
   * control. It is a real `<button>`, so it is focusable and Enter/Space work
   * as they do everywhere else in the page — the arrow keys are the addition.
   *
   * The glyph is decorative and the button keeps a gap-free hit area, so it
   * stays a comfortable drag origin on touch and a stably-sized target while
   * the pointer travels.
   */
  const handle = (context: HandleContext): ReactNode => {
    const scope: DragScope = context.groupId === null ? 'rows' : 'members'
    // One translated sentence, so a language that orders the name differently
    // (or drops it) still reads correctly — never string-concatenated.
    const label = t('settings.sequence.handle', { name: context.label })
    const hint = t('settings.sequence.handleHint', { name: context.label })
    return (
      <button
        type="button"
        className="dsh-railist-settings-handle"
        data-drag-handle="true"
        data-drag-key={context.key}
        data-lifted={draggingKey === context.key ? 'true' : 'false'}
        aria-label={label}
        title={hint}
        draggable
        onDragStart={event => {
          // The enclosing group row must not also read this dragstart and turn a
          // member's drag into a top-level one.
          event.stopPropagation()
          beginDrag(event, { kind: context.kind, id: context.id, fromGroupId: context.groupId }, context.key, scope)
        }}
        onDragEnd={event => { event.stopPropagation(); endDrag() }}
        onKeyDown={event => onHandleKeyDown(event, context)}
      >
        <span className="dsh-railist-settings-handleGlyph" aria-hidden="true">⠿</span>
      </button>
    )
  }

  /**
   * Render one row.
   *
   * `pinned` marks the shell's own Settings row: it keeps its place in `rows`
   * (the plan lists the whole rail) but loses every control — no handle, no
   * grouping, no hide — because the seat it lives in is the shell's and moving
   * or hiding it there is exactly what this plugin must never do.
   */
  const renderRow = (index: number, pinned = false): ReactNode => {
    const row = rows[index]
    if (row === undefined) return null
    const isGroup = row.kind === 'group'
    const group = isGroup ? plan.groups.get(row.id) : undefined
    const panel = isGroup ? undefined : plan.panels.get(row.id)
    const hidden = isGroup ? group?.hidden === true : panel?.hidden === true
    const missing = plan.orphans.includes(row.id) || plan.missingMembers.includes(row.id)
    // Registered, but nothing rendered a row for it right now. A DIFFERENT fact
    // from `missing`: that one means no registration answers at all, while this
    // one means a live registration whose own component renders nothing yet (an
    // entry that only shows itself while its feature is on). It is never a
    // reason to drop the row — the user still has to be able to reach it.
    const unrendered = row.unrendered && !missing
    const icon = isGroup ? group?.icon ?? null : panel?.icon ?? null
    // A group borrows the first live member's glyph when it has no icon of its
    // own, exactly as the rail trigger does.
    const nativePanelId = isGroup ? group?.iconFallbackPanelId ?? null : row.id
    const isSelected = selected !== null && selected.kind === row.kind && selected.id === row.id
    const members = group?.members ?? []
    const memberIds = members.map(member => member.id)

    const badges: ReactNode[] = []
    if (hidden) badges.push(badge('hidden', t('settings.appearance.hidden')))
    if (isGroup) badges.push(badge('group', t('settings.sequence.members', { count: members.length })))
    if (missing) badges.push(badge('missing', t('rail.group.missing')))
    if (unrendered) {
      badges.push(
        <span
          key="unrendered"
          className="dsh-panellist-settings-badge"
          data-badge="unrendered"
          title={t('rail.group.unrenderedHint')}
        >
          {t('rail.group.unrendered')}
        </span>,
      )
    }
    if (pinned) {
      badges.push(
        <span
          key="pinned"
          className="dsh-panellist-settings-badge"
          data-badge="pinned"
          title={t('settings.sequence.pinnedHint')}
        >
          {t('settings.sequence.pinned')}
        </span>,
      )
    }

    const targetEdge = pinned ? null : dropTarget !== null && dropTarget.key === row.railId ? dropTarget.edge : null

    return (
      <li
        key={row.railId}
        className="dsh-panellist-settings-row"
        data-row-id={row.id}
        data-row-kind={row.kind}
        data-selected={isSelected ? 'true' : 'false'}
        data-dragging={draggingKey === row.railId ? 'true' : 'false'}
        data-drop-target={targetEdge ?? undefined}
        data-pinned={pinned ? 'true' : undefined}
        onDragOver={pinned
          ? undefined
          : event => {
            allowDrop(event)
            if (dragScope === null) return
            const payload = payloadOf(event)
            // The dragged row is never its own drop target: a pointer that has not
            // left the handle yet must not paint an indicator on top of it.
            if (payload === null || payload.id === row.id) {
              setDropTarget(null)
              return
            }
            setDropAtEnd(false)
            // Only a panel can join a group; a group payload always takes a
            // position, so it never sees the `inside` band.
            const canJoin = isGroup && payload.kind === 'panel' && payload.fromGroupId !== row.id
            const next = { key: row.railId, edge: edgeOf(event, canJoin) }
            // A `dragover` fires for every pointer move, so handing a fresh object
            // to `setState` here re-rendered the whole editor dozens of times a
            // second — the drag stutter. Only a changed candidate is news.
            setDropTarget(current =>
              current !== null && current.key === next.key && current.edge === next.edge ? current : next)
          }}
        onDragLeave={pinned
          ? undefined
          : event => {
            // `dragleave` fires for every child the pointer crosses, so only a
            // departure from the row itself clears the indicator.
            const to = event.relatedTarget as Node | null
            if (to !== null && event.currentTarget.contains(to)) return
            setDropTarget(current => (current !== null && current.key === row.railId ? null : current))
          }}
        onDrop={pinned
          ? undefined
          : event => {
            const edge = dropTarget !== null && dropTarget.key === row.railId ? dropTarget.edge : edgeOf(event, isGroup)
            dropOnRow(event, index, edge)
          }}
      >
        <div className="dsh-panellist-settings-rowMain">
          {pinned ? null : handle({ key: row.railId, label: row.label, kind: row.kind, id: row.id, groupId: null, memberIds: [], index })}
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
          {/* The contributor subtitle, right of the name. Only a panel row has
              one — a group's trigger has no contributor of its own. Absent id
              (the common case) renders nothing at all. */}
          {isGroup ? null : pluginInfo?.[row.id] ?? null}
          {badges.length === 0
            ? null
            : <span className="dsh-panellist-settings-badges">{badges}</span>}
          {/* One icon per row, and it is the visibility switch (README §3.4):
              the row itself is "glyph, name, optional subtitle and badges", and
              the eye sits at the far right of that line. Hiding is the only
              per-row action, so it is the only one that survives; grouping and
              ungrouping moved to the strip under the list, where they can be
              reached without hunting a row's buttons. A pinned row has no
              controls at all, so it has no eye either. */}
          {pinned
            ? null
            : (
              <button
                type="button"
                className="dsh-railist-settings-eye"
                data-action="toggleHidden"
                data-state={hidden ? 'hidden' : 'shown'}
                // A command button, not a toggle: the accessible name IS the
                // action, so `aria-pressed` would contradict the label the moment
                // the row flips.
                aria-label={hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}
                title={t('settings.appearance.hiddenHint')}
                onClick={() => toggleHidden(row.kind, row.id, !hidden)}
              >
                <span className="dsh-railist-settings-eyeGlyph" aria-hidden="true">
                  {hidden ? EYE_OFF : EYE_ON}
                </span>
              </button>
            )}
        </div>
        {isGroup && members.length > 0
          ? (
            <ul
              className="dsh-panellist-settings-members"
              data-drop-scope="members"
              data-drop-active={dragScope === 'members' && draggingKey?.startsWith(`${row.railId}/`) === true ? 'true' : undefined}
              onDragOver={event => {
                allowDrop(event)
                // The blank space below the last member is part of the group:
                // dropping there appends, like dropping below the list appends
                // at the top level.
                if (dragScope !== 'members') return
                const payload = payloadOf(event)
                if (payload === null || payload.fromGroupId !== row.id) return
                setDropAtEnd(false)
              }}
              onDrop={event => {
                event.preventDefault()
                event.stopPropagation()
                const payload = payloadOf(event)
                if (payload === null || payload.kind !== 'panel') {
                  endDrag()
                  return
                }
                const own = payload.fromGroupId === row.id
                endDrag()
                if (own) {
                  applyStructural(profile => moveMemberTo(profile, row.id, payload.id, members.length))
                  return
                }
                applyStructural(profile => addToGroup(profile, row.id, payload.id, members.length))
              }}
            >
              {members.map((member, memberIndex) => (
                <li
                  key={member.id}
                  className="dsh-panellist-settings-member"
                  data-member-id={member.id}
                  data-selected={selected !== null && selected.kind === 'panel' && selected.id === member.id ? 'true' : 'false'}
                  data-dragging={draggingKey === `${row.railId}/${member.id}` ? 'true' : 'false'}
                  data-drop-target={
                    dropTarget !== null && dropTarget.key === `${row.railId}/${member.id}` ? dropTarget.edge : undefined
                  }
                  onDragOver={event => {
                    allowDrop(event)
                    if (dragScope === null) return
                    const payload = payloadOf(event)
                    const key = `${row.railId}/${member.id}`
                    if (payload === null || payload.kind !== 'panel' || payload.id === member.id) {
                      setDropTarget(null)
                      return
                    }
                    setDropAtEnd(false)
                    const next = { key, edge: edgeOf(event, false) }
                    setDropTarget(current =>
                      current !== null && current.key === next.key && current.edge === next.edge ? current : next)
                  }}
                  onDragLeave={event => {
                    const to = event.relatedTarget as Node | null
                    if (to !== null && event.currentTarget.contains(to)) return
                    const key = `${row.railId}/${member.id}`
                    setDropTarget(current => (current !== null && current.key === key ? null : current))
                  }}
                  onDrop={event => dropOnMember(
                    event,
                    row.id,
                    memberIndex,
                    memberIds,
                    dropTarget !== null && dropTarget.key === `${row.railId}/${member.id}` ? dropTarget.edge : 'before',
                  )}
                >
                  {handle({
                    key: `${row.railId}/${member.id}`,
                    label: member.label,
                    kind: 'panel',
                    id: member.id,
                    groupId: row.id,
                    memberIds,
                    index: memberIndex,
                  })}
                  {/* A member is a panel like any other row, so its name opens the
                      same editor: without this the entries folded into a group
                      could not be renamed, re-iconed or inspected at all. */}
                  <button
                    type="button"
                    className="dsh-panellist-settings-rowSelect"
                    data-action="select"
                    aria-pressed={selected !== null && selected.kind === 'panel' && selected.id === member.id}
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
                  {/* A member's row is "glyph, name, badges", then the two
                      controls it alone keeps: leaving the group (`−`) and its
                      own visibility switch, which is what "hidden inside a
                      group" means. Neither repeats the row's name as a word —
                      the row is already named, so the icon says it. */}
                  <button
                    type="button"
                    className="dsh-railist-settings-eye"
                    data-action="memberRemove"
                    aria-label={t('settings.sequence.removeFromGroup')}
                    title={t('settings.sequence.removeFromGroup')}
                    onClick={() => applyStructural(profile => removeFromGroup(profile, row.id, member.id))}
                  >
                    <span className="dsh-railist-settings-eyeGlyph" aria-hidden="true">−</span>
                  </button>
                  <button
                    type="button"
                    className="dsh-railist-settings-eye"
                    data-action="memberToggleHidden"
                    data-state={member.hidden ? 'hidden' : 'shown'}
                    aria-label={member.hidden ? t('settings.sequence.show') : t('settings.sequence.hide')}
                    title={t('settings.appearance.hiddenHint')}
                    onClick={() => toggleHidden('panel', member.id, !member.hidden)}
                  >
                    <span className="dsh-railist-settings-eyeGlyph" aria-hidden="true">
                      {member.hidden ? EYE_OFF : EYE_ON}
                    </span>
                  </button>
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

      {rows.length === 0
        ? (
          <p className="dsh-panellist-settings-hint">
            {t('settings.sequence.empty')}
          </p>
        )
        : (
          <div
            className="dsh-panellist-settings-dropZone"
            data-testid="dsh-panellist-settings-dropZone"
            data-drop-scope="rows"
            data-drop-active={dragScope === 'rows' ? 'true' : undefined}
            onDragOver={allowDrop}
            onDrop={dropOnList}
          >
            <ol className="dsh-panellist-settings-rows">
              {sections.map(section => [
                <li
                  key={`seat:${section.seat}`}
                  className="dsh-railist-settings-seat"
                  data-seat={section.seat}
                >
                  <span className="dsh-railist-settings-seatTitle">
                    {t(`settings.sequence.seat.${section.seat}` as I18nKey)}
                  </span>
                  <span className="dsh-railist-settings-seatHint">
                    {t(`settings.sequence.seatHint.${section.seat}` as I18nKey)}
                  </span>
                </li>,
                ...section.rows.map(entry => renderRow(entry.index, section.seat === 'pinned')),
              ])}
            </ol>
            {/* The gap under the last row: without it "put this last" is only
                reachable by aiming at the lower half of the final row, and an
                empty list has no target at all. */}
            <div
              className="dsh-railist-settings-listEnd"
              data-testid="dsh-panellist-settings-listEnd"
              data-drop-target={dropAtEnd ? 'after' : undefined}
              onDragOver={event => {
                allowDrop(event)
                if (dragScope !== 'rows') return
                setDropTarget(null)
                setDropAtEnd(true)
              }}
              onDragLeave={() => setDropAtEnd(false)}
              onDrop={dropAtListEnd}
            />
          </div>
        )}

      {/* Grouping is the list's one *structural* verb, and it needs a target:
          the action belongs to the row you selected, not to every row on
          screen. Putting it on a strip under the list keeps every row to an
          icon and a name, and keeps the verb in reach without hunting that
          row's buttons. */}
      {selected === null
        ? null
        : (
          <div className="dsh-railist-settings-rowActions" data-testid="dsh-railist-settings-rowActions">
            <button
              type="button"
              className="dsh-railist-settings-stripAction"
              data-action={selected.kind === 'group' ? 'ungroup' : 'groupWithNext'}
              disabled={selected.kind === 'panel' && !canGroupSelected}
              onClick={() => {
                if (selected.kind === 'group') {
                  ungroup(selected.id)
                  return
                }
                groupWithNext(rows.findIndex(entry => entry.kind === 'panel' && entry.id === selected.id))
              }}
            >
              {selected.kind === 'group' ? t('settings.sequence.ungroup') : t('settings.sequence.groupWithNext')}
            </button>
          </div>
        )}
    </section>
  )
}
