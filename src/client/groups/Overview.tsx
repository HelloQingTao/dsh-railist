/**
 * The `main` page of a group row.
 *
 * Click interception means `selectPanel(groupRailId)` should never run from the
 * rail, but the layout throws when `main` has no entry for a key — so the group
 * registers a real, minimal page under the same key as insurance, and the flyout
 * It has no UI entry point of its own: the menu's job is its members.
 *
 * The page reads the group from the live plan, so it stays correct when a member
 * is uninstalled while the page is open.
 */
import { useGroupVersion } from './Row.tsx'
import type { GroupUnitRuntime } from './index.ts'
import type { ReactElement, ReactNode } from 'react'

/** One page renderer for `groupId`, in the shape `RailHost.registerRow` wants. */
export function createOverviewPage(runtime: GroupUnitRuntime, groupId: string): () => ReactNode {
  return () => <GroupOverview runtime={runtime} groupId={groupId} />
}

/** The overview body: the group's members, missing ones marked. */
export function GroupOverview(props: { runtime: GroupUnitRuntime; groupId: string }): ReactElement {
  const { runtime, groupId } = props
  const { deps } = runtime
  useGroupVersion(runtime)
  const group = deps.plan().groups.get(groupId)
  const translate = deps.translate
  if (group === undefined) return <div data-dsh-panellist-overview={groupId} />
  return (
    <div data-dsh-panellist-overview={groupId}>
      <h2>{translate.t('rail.group.overviewTitle', { name: group.label })}</h2>
      <p>{translate.t('rail.group.overviewIntro')}</p>
      <ul>
        {group.members.map(member => (
          <li key={member.id}>
            {member.missing
              ? `${member.label} (${translate.t('rail.group.missing')})`
              : member.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
