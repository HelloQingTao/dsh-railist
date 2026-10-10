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
  'common.applied': 'Saved',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.copy': 'Copy',
  'common.done': 'Done',
  'common.failed': 'Failed',
  'common.loading': 'Loading…',
  'common.reset': 'Reset',
  'common.retry': 'Retry',
  'common.save': 'Save',

  'settings.nav': 'Panel list',
  'settings.title': 'Panel list',
  'settings.subtitle': 'Order, rename, re-icon, hide and group the entries of the left rail. Changes apply immediately.',

  'settings.sequence.title': 'Sequence',
  'settings.sequence.hint': 'Drag to reorder, or drop one row onto another to create a group. Move-up / move-down and “Group with next” are the keyboard-accessible fallbacks.',
  'settings.sequence.empty': 'No panel is registered on this profile yet.',
  'settings.sequence.materialize': 'Use the current rail order as a starting point',
  'settings.sequence.gatedHint': 'Nothing is configured yet, so the rail keeps its native order. Move any row to take over the order of the panels you touch.',
  'settings.sequence.groupWithNext': 'Group with next',
  'settings.sequence.moveUp': 'Move up',
  'settings.sequence.moveDown': 'Move down',
  'settings.sequence.ungroup': 'Ungroup',
  'settings.sequence.removeFromGroup': 'Take out of group',
  'settings.sequence.members': '{count} panels',
  'settings.sequence.groupHidden': 'This group is hidden.',
  'settings.sequence.unmanagedSection': 'Not configured ({count})',
  'settings.sequence.unmanagedHint': 'These panels are never reordered, renamed, re-iconed or hidden — this plugin only takes over what you configure. Take one over on its own, or leave it entirely alone.',
  'settings.sequence.adopt': 'Take over',
  'settings.sequence.adoptHint': 'Add this panel to the sequence, leaving every other panel untouched.',
  'settings.sequence.release': 'Release to original',
  'settings.sequence.releaseHint': 'Drop this panel from the sequence and clear its name, icon, hidden and locked overrides: its contributor owns it again.',

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
  'settings.appearance.hidden': 'Hidden',
  'settings.appearance.hiddenHint': 'A hidden panel does not appear on the rail, but stays selectable and keeps working. If it is the active panel, its row is shown anyway.',
  'settings.appearance.locked': 'Locked',
  'settings.appearance.lockedHint': 'A locked panel is left exactly as registered: no reorder, no rename, no re-icon, no hiding.',
  'settings.appearance.lockedInGroup': 'Unlocking is required first: a group member cannot be locked.',

  'settings.io.title': 'Configuration',
  'settings.io.import': 'Import JSON',
  'settings.io.export': 'Export JSON',
  'settings.io.importPlaceholder': 'Paste a panellist.json document…',
  'settings.io.importInvalid': 'Import rejected: {reason}',
  'settings.io.imported': 'Imported.',
  'settings.io.openFile': 'Open config file',
  'settings.io.filePath': 'File: {path}',
  'settings.io.reset': 'Reset to defaults',
  'settings.io.resetConfirm': 'Reset this profile’s configuration to defaults? Panels stay where they are until you configure them again.',
  'settings.io.resetDone': 'Configuration reset.',

  'settings.orphans.title': 'Missing panels',
  'settings.orphans.none': 'Nothing is missing.',
  'settings.orphans.clean': 'Clean up missing',
  'settings.orphans.cleanConfirm': 'Remove every configuration entry whose panel no longer exists? Reinstalling the plugin will not bring them back.',
  'settings.orphans.body': '{count} configured panel(s) are no longer registered. Their configuration is kept so reinstalling the plugin restores everything.',

  'settings.selfcheck.title': 'Compatibility',
  'settings.selfcheck.rerun': 'Re-run self-check',
  'settings.selfcheck.ok': 'All checks passed.',
  'settings.selfcheck.degraded': 'Degraded: {count} check(s) failed.',
  'settings.selfcheck.version': 'Measured on DSH {version}.',
  'settings.selfcheck.readOnly': 'Read-only: rewriting is disabled, so nothing on the rail is modified.',
  'probe.registry': 'Registration rewriting',
  'probe.registry.impact': 'Order, names and icons cannot be written.',
  'probe.rail': 'Rail rows are locatable (:has() supported)',
  'probe.rail.impact': 'Hiding is disabled; everything else still applies.',
  'probe.active': 'The shell passes “active” to rail glyphs',
  'probe.active.impact': 'A hidden panel that is active no longer shows its row.',
  'probe.settingsNav': 'Settings navigation row is locatable',
  'probe.settingsNav.impact': 'The settings tab keeps the default gear icon.',
  'probe.ok': 'ok',
  'probe.failed': 'failed',

  'warning.single-member-group': 'Group “{groupId}” holds a single panel. Consider dropping the group.',
  'warning.empty-group': 'Group “{groupId}” has no live member and is not rendered.',
  'warning.group-id-collision': 'Group id “{groupId}” collides with a panel id and was ignored.',
  'warning.locked-member': '“{panelId}” is locked and was taken out of group “{groupId}”.',
  'warning.locked-in-sequence': '“{panelId}” is locked; its position in the sequence is ignored.',
  'warning.duplicate-in-sequence': '“{panelId}” appears more than once; the first placement wins.',

  'rail.group.open': 'Open group {name}',
  'rail.group.menuTitle': 'Group: {name}',
  'rail.group.missing': 'missing',
  'rail.group.overview': 'Overview',
  'rail.group.overviewTitle': 'Group “{name}”',
  'rail.group.overviewIntro': 'This page lists the panels collected in this group.',

  'error.load': 'Could not read the configuration: {reason}',
  'error.save': 'Could not save: {reason}',
  'error.route': 'The plugin’s host route is unreachable. Configuration changes are kept in this page only.',
  'error.health': 'Storage problem: {reason}',
} as const

/** Every translatable key. */
export type I18nKey = keyof typeof en

/** The Chinese dictionary; a total map, so a missing key is a type error. */
export const zh: Record<I18nKey, string> = {
  'common.applied': '已保存',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.confirm': '确认',
  'common.copy': '复制',
  'common.done': '完成',
  'common.failed': '失败',
  'common.loading': '加载中…',
  'common.reset': '重置',
  'common.retry': '重试',
  'common.save': '保存',

  'settings.nav': '面板列表',
  'settings.title': '面板列表',
  'settings.subtitle': '管理左侧轨道上的页签：排序、改名、换图标、显示或隐藏、收进分组。改动即时生效。',

  'settings.sequence.title': '序列',
  'settings.sequence.hint': '拖拽排序；把一行拖到另一行上即可建组。上下移动与「与下一项合并为分组」是键盘可达的兜底操作。',
  'settings.sequence.empty': '这个 profile 还没有注册任何面板。',
  'settings.sequence.materialize': '以当前轨道顺序作为起点',
  'settings.sequence.gatedHint': '还没有配置任何项，轨道保持原生顺序。移动任意一行即表示你接管了所触及面板的顺序。',
  'settings.sequence.groupWithNext': '与下一项合并为分组',
  'settings.sequence.moveUp': '上移',
  'settings.sequence.moveDown': '下移',
  'settings.sequence.ungroup': '解散分组',
  'settings.sequence.removeFromGroup': '移出分组',
  'settings.sequence.members': '{count} 个面板',
  'settings.sequence.groupHidden': '该分组已隐藏。',
  'settings.sequence.unmanagedSection': '未配置（{count}）',
  'settings.sequence.unmanagedHint': '这些面板不会被排序、改名、换图标或隐藏——本插件只接管你配置过的东西。可以单独接管一项，也可以完全不碰。',
  'settings.sequence.adopt': '接管',
  'settings.sequence.adoptHint': '把这一项加进序列，其它面板一概不动。',
  'settings.sequence.release': '恢复原生',
  'settings.sequence.releaseHint': '把这一项移出序列，并清掉它的名称、图标、隐藏与锁定设置：它重新完全由贡献它的插件决定。',

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
  'settings.appearance.hidden': '隐藏',
  'settings.appearance.hiddenHint': '隐藏的页签不出现在轨道上，但仍然可用、可被选中。它正处于激活态时，那一行会临时显示。',
  'settings.appearance.locked': '锁定',
  'settings.appearance.lockedHint': '被锁定的页签完全保持原生行为：不排序、不改名、不换图标、不隐藏。',
  'settings.appearance.lockedInGroup': '需要先解除分组：分组内的页签不能被锁定。',

  'settings.io.title': '配置',
  'settings.io.import': '导入 JSON',
  'settings.io.export': '导出 JSON',
  'settings.io.importPlaceholder': '粘贴一份 panellist.json 文档…',
  'settings.io.importInvalid': '导入被拒绝：{reason}',
  'settings.io.imported': '已导入。',
  'settings.io.openFile': '打开配置文件',
  'settings.io.filePath': '文件：{path}',
  'settings.io.reset': '恢复默认',
  'settings.io.resetConfirm': '把这个 profile 的配置恢复为默认？在你重新配置之前，面板保持原位。',
  'settings.io.resetDone': '配置已重置。',

  'settings.orphans.title': '已缺失的面板',
  'settings.orphans.none': '没有缺失项。',
  'settings.orphans.clean': '清理缺失项',
  'settings.orphans.cleanConfirm': '删除所有找不到对应面板的配置？重装插件后这些配置不会恢复。',
  'settings.orphans.body': '有 {count} 个已配置的面板不再注册。配置被保留，重装插件后即可全部恢复。',

  'settings.selfcheck.title': '兼容性',
  'settings.selfcheck.rerun': '重新自检',
  'settings.selfcheck.ok': '全部自检通过。',
  'settings.selfcheck.degraded': '已降级：{count} 项自检失败。',
  'settings.selfcheck.version': '测量于 DSH {version}。',
  'settings.selfcheck.readOnly': '只读：改写已停用，轨道上不做任何修改。',
  'probe.registry': '注册项改写',
  'probe.registry.impact': '顺序、名称与图标都无法写入。',
  'probe.rail': '轨道行可定位（支持 :has()）',
  'probe.rail.impact': '隐藏失效，其余改写继续生效。',
  'probe.active': '外壳仍把「是否激活」传给轨道图标',
  'probe.active.impact': '隐藏中的激活页签不再临时显示。',
  'probe.settingsNav': '设置导航行可定位',
  'probe.settingsNav.impact': '设置页签保留原生齿轮图标。',
  'probe.ok': '通过',
  'probe.failed': '失败',

  'warning.single-member-group': '分组「{groupId}」只有一个面板，建议解散。',
  'warning.empty-group': '分组「{groupId}」没有可用成员，不渲染。',
  'warning.group-id-collision': '分组 id「{groupId}」与某个面板 id 冲突，已忽略。',
  'warning.locked-member': '「{panelId}」已锁定，已从分组「{groupId}」中移出。',
  'warning.locked-in-sequence': '「{panelId}」已锁定，序列里的位置被忽略。',
  'warning.duplicate-in-sequence': '「{panelId}」出现了多次，以第一次为准。',

  'rail.group.open': '展开分组 {name}',
  'rail.group.menuTitle': '分组：{name}',
  'rail.group.missing': '已缺失',
  'rail.group.overview': '概览',
  'rail.group.overviewTitle': '分组「{name}」',
  'rail.group.overviewIntro': '这个页面列出收进该分组的面板。',

  'error.load': '读取配置失败：{reason}',
  'error.save': '保存失败：{reason}',
  'error.route': '插件的宿主路由不可达。配置改动只保留在当前页面。',
  'error.health': '存储异常：{reason}',
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
  const notify = (): void => { for (const listener of listeners) listener() }
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
