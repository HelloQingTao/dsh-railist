/**
 * Plugin-local copy. Two languages, one flat key space, `{name}` placeholders.
 *
 * This plugin deliberately does NOT register into the DSH locale namespace
 * registry: a namespace registration requires a complete dictionary for every
 * shipped locale (`LocaleRuntime.register(ns, locale, dict)` enforces bilingual
 * balance), which would mean shipping 30+ dictionaries for a settings page.
 * Instead the active language is read from the shell's locale service when it
 * exists, and falls back to the browser's language.
 */

/** Languages this plugin ships. */
export type Lang = 'zh' | 'en'

/** The reference dictionary: every key must exist here. */
export const en = {
  'common.loading': 'Loading…',
  'common.save': 'Save',

  'settings.nav': 'Panel list',
  'settings.title': 'Panel list',
  'settings.subtitle': 'Order, rename, re-icon, hide and group the entries of the left rail. Changes apply immediately.',

  'settings.sequence.title': 'Sequence',
  'settings.sequence.hint': 'Drag the handle to reorder. To group, use “Group with next” or drop a row onto a group. Focus a handle and use ↑ / ↓ to move it.',
  'settings.sequence.pendingHint': 'Your order is only on screen for now — save it to keep it after a reload.',
  'settings.sequence.save': 'Save changes',
  'settings.sequence.discard': 'Discard',
  'settings.sequence.empty': 'No panel is registered on this profile yet.',
  'settings.sequence.groupWithNext': 'Group with next',
  'settings.sequence.moveUp': 'Move up',
  'settings.sequence.moveDown': 'Move down',
  'settings.sequence.handle': 'Reorder {name}',
  'settings.sequence.handleHint': 'Drag to reorder, or press the arrow keys to move this row one step.',
  'settings.sequence.ungroup': 'Ungroup',
  'settings.sequence.removeFromGroup': 'Take out of group',
  'settings.sequence.members': '{count} panels',
  'settings.sequence.show': 'Show',
  'settings.sequence.hide': 'Hide',
  // The contributor label: package and version, next to the row. Kept as two
  // keys because a panel can resolve its package without resolving a version
  // (a git dependency names no release), and the separator must not survive
  // that case as a dangling dot.
  'settings.sequence.source': '{name} · v{version}',
  'settings.sequence.sourceNoVersion': '{name}',
  // The two physical seats the sequence spans. The list is one sequence, but its
  // rows land in two separate parts of the rail, so the editor groups them under
  // these headings — otherwise a row carries no visible clue about which part of
  // the sidebar it will occupy.
  'settings.sequence.seat.top': 'Top left · global panels',
  'settings.sequence.seat.footer': 'Bottom left · actions',
  'settings.sequence.seatHint.top': 'These rows sit in the panel list under the logo.',
  'settings.sequence.seatHint.footer': 'These rows sit in the action row below the panel list.',
  // The shell's own settings row is shown, never dragged: it lives in a slot this
  // plugin does not take over, so it is pinned to the bottom of the bottom-left
  // seat and rendered as a fixed row there.
  'settings.sequence.seat.pinned': 'Bottom left · fixed',
  'settings.sequence.seatHint.pinned': 'The shell’s own settings row always sits at the very bottom.',
  'settings.sequence.pinned': 'Always last',
  'settings.sequence.pinnedHint': 'This row belongs to the shell itself, so it always sits at the bottom of the bottom-left seat.',

  'settings.group.rename': 'Group name',
  'settings.group.icon': 'Group icon',
  'settings.group.members': 'Members',

  'settings.appearance.title': 'Appearance',
  'settings.appearance.name': 'Name',
  'settings.appearance.namePlaceholder': 'Original name',
  'settings.appearance.icon': 'Icon',
  'settings.appearance.iconOriginal': 'Keep original',
  'settings.appearance.iconBuiltin': 'Built-in set',
  'settings.appearance.iconCustom': 'Paste SVG',
  'settings.appearance.iconCustomPlaceholder': '<svg viewBox="0 0 24 24">…</svg>',
  'settings.appearance.iconCustomInvalid': 'That SVG was rejected: {reason}',
  'settings.appearance.iconReason.size': 'The icon source is outside the accepted size (16 bytes … 64 KB).',
  'settings.appearance.iconReason.malformed': 'The icon source is not a well-formed SVG document.',
  'settings.appearance.iconReason.forbidden': 'The icon source contains an element or attribute that is not allowed.',
  'settings.appearance.iconReason.reference': 'The icon source refers to something outside itself; icons must be self-contained.',
  'settings.appearance.iconCustomTooBig': 'SVG is larger than 64 KB.',
  'settings.appearance.preview': 'Preview',
  'settings.appearance.groupedHint': 'This panel is shown inside a group, represented by the group trigger. Take it out of the group to give it its own row.',
  'settings.appearance.hidden': 'Hidden',
  'settings.appearance.hiddenHint': 'A hidden panel does not appear on the rail, but stays selectable and keeps working. If it is the active panel, its row is shown anyway.',

  'settings.io.title': 'Configuration',
  'settings.io.filePath': 'File: {path}',

  'warning.single-member-group': 'Group “{groupId}” holds a single panel. Consider dropping the group.',
  'warning.empty-group': 'Group “{groupId}” has no live member and is not rendered.',
  'warning.group-id-collision': 'Group id “{groupId}” collides with a panel id and was ignored.',
  'warning.duplicate-in-sequence': '“{panelId}” appears more than once; the first placement wins.',

  'rail.group.open': 'Open group {name}',
  'rail.group.menuTitle': 'Group: {name}',
  'rail.group.missing': 'missing',
  'rail.group.emptyMenu': 'No panel is shown in this group.',
  'rail.group.overviewTitle': 'Group “{name}”',
  'rail.group.overviewIntro': 'This page lists the panels collected in this group.',
  'rail.group.unrendered': 'not shown',
  'rail.group.unrenderedHint': 'This panel is registered but its own component renders nothing on the rail right now, so no row appears. It is kept in the list so you can still reach it; its setting is usually what turns it on.',

  'error.load': 'Could not read the configuration: {reason}',
  'error.save': 'Could not save: {reason}',
} as const

/** Every translatable key. */
export type I18nKey = keyof typeof en

/** The Chinese dictionary; a total map, so a missing key is a type error. */
export const zh: Record<I18nKey, string> = {
  'common.loading': '加载中…',
  'common.save': '保存',

  'settings.nav': '面板列表',
  'settings.title': '面板列表',
  'settings.subtitle': '管理左侧轨道上的页签：排序、改名、换图标、显示或隐藏、收进分组。改动即时生效。',

  'settings.sequence.title': '序列',
  'settings.sequence.hint': '拖动把手排序。建组用「与下一项合并为分组」，或把面板拖到某个分组行上。把手聚焦后按 ↑ / ↓ 可上下移动。',
  'settings.sequence.pendingHint': '当前顺序只是预览，保存后才会在刷新后保留。',
  'settings.sequence.save': '保存更改',
  'settings.sequence.discard': '放弃更改',
  'settings.sequence.empty': '这个 profile 还没有注册任何面板。',
  // 待保存提示条。拖动现在只改界面显示，所以必须告知用户「界面比配置文件快一步」，
  // 并给出两条出路：保存写入，或丢弃还原。
  'settings.sequence.groupWithNext': '与下一项合并为分组',
  'settings.sequence.moveUp': '上移',
  'settings.sequence.moveDown': '下移',
  'settings.sequence.handle': '拖动排序：{name}',
  'settings.sequence.handleHint': '拖动可排序；或按方向键让这一行上下移动一格。',
  'settings.sequence.ungroup': '解散分组',
  'settings.sequence.removeFromGroup': '移出分组',
  'settings.sequence.members': '{count} 个面板',
  'settings.sequence.show': '显示',
  'settings.sequence.hide': '隐藏',
  'settings.sequence.source': '{name} · v{version}',
  'settings.sequence.sourceNoVersion': '{name}',
  // The two physical seats the sequence spans. The list is one sequence, but its
  // rows land in two separate parts of the rail, so the editor groups them under
  // these headings — otherwise a row carries no visible clue about which part of
  // the sidebar it will occupy.
  'settings.sequence.seat.top': '左上角 · 全局面板',
  'settings.sequence.seat.footer': '左下角 · 动作区',
  'settings.sequence.seatHint.top': '这些行位于 Logo 下方的面板列表里。',
  'settings.sequence.seatHint.footer': '这些行位于面板列表下方的动作区里。',
  // 外壳自带的设置行只展示、不可拖动：它属于本插件不接管的槽位，因此固定在
  // 左下角分区最底部，并作为只读行渲染在那里。
  'settings.sequence.seat.pinned': '左下角 · 固定',
  'settings.sequence.seatHint.pinned': '外壳自带的设置行始终位于最底部。',
  'settings.sequence.pinned': '永远最后',
  'settings.sequence.pinnedHint': '这一行属于外壳本身，因此它始终排在左下角分区的最底部。',

  'settings.group.rename': '分组名称',
  'settings.group.icon': '分组图标',
  'settings.group.members': '成员',

  'settings.appearance.title': '外观',
  'settings.appearance.name': '名称',
  'settings.appearance.namePlaceholder': '原始名称',
  'settings.appearance.icon': '图标',
  'settings.appearance.iconOriginal': '保留原图标',
  'settings.appearance.iconBuiltin': '内置图标集',
  'settings.appearance.iconCustom': '粘贴 SVG',
  'settings.appearance.iconCustomPlaceholder': '<svg viewBox="0 0 24 24">…</svg>',
  'settings.appearance.iconCustomInvalid': '这个 SVG 被拒绝：{reason}',
  'settings.appearance.iconReason.size': '图标源码的长度不在允许范围内（16 字节 ~ 64 KB）。',
  'settings.appearance.iconReason.malformed': '图标源码不是一份格式正确的 SVG 文档。',
  'settings.appearance.iconReason.forbidden': '图标源码里含有不允许的元素或属性。',
  'settings.appearance.iconReason.reference': '图标源码引用了自身之外的东西；图标必须是自包含的。',
  'settings.appearance.iconCustomTooBig': 'SVG 超过 64 KB。',
  'settings.appearance.preview': '预览',
  'settings.appearance.groupedHint': '这个页签在分组里，由组头代表。把它移出分组，它才会有自己的一行。',
  'settings.appearance.hidden': '隐藏',
  'settings.appearance.hiddenHint': '隐藏的页签不出现在轨道上，但仍然可用、可被选中。它正处于激活态时，那一行会临时显示。',

  'settings.io.title': '配置',
  'settings.io.filePath': '文件：{path}',

  'warning.single-member-group': '分组「{groupId}」只有一个面板，建议解散。',
  'warning.empty-group': '分组「{groupId}」没有可用成员，不渲染。',
  'warning.group-id-collision': '分组 id「{groupId}」与某个面板 id 冲突，已忽略。',
  'warning.duplicate-in-sequence': '「{panelId}」出现了多次，以第一次为准。',

  'rail.group.open': '展开分组 {name}',
  'rail.group.menuTitle': '分组：{name}',
  'rail.group.missing': '已缺失',
  'rail.group.emptyMenu': '该分组内没有显示的页签。',
  'rail.group.overviewTitle': '分组「{name}」',
  'rail.group.overviewIntro': '这个页面列出收进该分组的面板。',
  'rail.group.unrendered': '当前未显示',
  'rail.group.unrenderedHint': '这个面板已注册，但它的组件当前没有在轨道上渲染出任何东西，所以看不到对应的行。它仍保留在列表里，以便你还能找到它；通常要打开它自己的设置才会显示出来。',

  'error.load': '读取配置失败：{reason}',
  'error.save': '保存失败：{reason}',
}

const DICTS: Record<Lang, Record<I18nKey, string>> = { en, zh }

/** Minimal structural view of the shell's locale service. */
export interface LocaleLike {
  getLocale(): { active: string }
  subscribe(listener: () => void): () => void
}

/** Translator surface handed to every UI unit. */
export interface Translator {
  /** Active language, recomputed per call. */
  lang(): Lang
  /** Translate one key; `{name}` placeholders are filled from `params`. */
  t(key: I18nKey, params?: Record<string, string | number>): string
  /** Notified on every language change. */
  subscribe(listener: () => void): () => void
  /**
   * Bind the shell's locale service once it exists.
   *
   * This plugin's browser half may mount before the bundle that provides the
   * locale service, so the service is looked up first and bound here when it
   * turns up; without this a late locale bundle would leave the page in English
   * until the next reload.
   */
  attach(locale: LocaleLike): void
  dispose(): void
}

function langOf(localeId: string | undefined): Lang {
  if (localeId === undefined) return 'en'
  return localeId.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function browserLang(): Lang {
  if (typeof navigator === 'undefined') return 'en'
  return langOf(navigator.language)
}

/**
 * Build the translator over the shell's locale service when available.
 * @param locale - the service, or `undefined` on a shell that ships none.
 */
export function createTranslator(locale: LocaleLike | undefined): Translator {
  const listeners = new Set<() => void>()
  let source = locale
  let unsubscribe: (() => void) | undefined
  /**
   * The language the last notification went out for.
   *
   * The shell's locale service publishes on every `register`, not only when the
   * LANGUAGE changes — so a page whose language never moves still wakes every
   * subscriber, and a subscriber that recomputes work ends up looping: the
   * recompute writes rows, the shell registers another locale contribution,
   * which publishes again. Comparing the resolved language here is what makes a
   * notification mean "the language moved", which is the only thing a listener
   * can act on.
   */
  let announced = langOf(locale?.getLocale().active)
  const notify = (): void => {
    const next = source === undefined ? browserLang() : langOf(source.getLocale().active)
    if (next === announced) return
    announced = next
    for (const listener of listeners) listener()
  }
  const bind = (service: LocaleLike | undefined): void => {
    unsubscribe?.()
    unsubscribe = undefined
    source = service
    if (service === undefined) return
    try {
      unsubscribe = service.subscribe(notify)
    } catch {
      unsubscribe = undefined
    }
  }
  bind(locale)
  const current = (): Lang => (source === undefined ? browserLang() : langOf(source.getLocale().active))
  return {
    lang: current,
    t: (key, params) => {
      const template = DICTS[current()][key] ?? en[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    attach: (service) => {
      bind(service)
      notify()
    },
    dispose: () => {
      listeners.clear()
      unsubscribe?.()
      unsubscribe = undefined
      source = undefined
    },
  }
}
