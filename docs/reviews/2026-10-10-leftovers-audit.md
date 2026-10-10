# Leftovers audit — dsh-panellist (2026-10-10)

Auditor: `cleaner-audit` (independent; wrote none of this code).
Tree: `E:\ai-code-space\dsh-panellist`, working tree clean at commit **`342e128`**
("refactor: list the whole rail from the start, drop the take-over/release concepts, add per-row hide/show").
Environment: Windows, `node v24.21.0`, `vitest 3.2.7`, pnpm workspace.

Method: read the current tree (`src/**`, `tests/**`, both READMEs, `GLOSSARY.md`,
`docs/ARCHITECTURE.md`); diffed `342e128` against its parent to see exactly what the redesign
removed; mechanical sweeps (every CSS selector in the three chunks, every dictionary key, every
`data-*` token, every exported symbol, every plan/state field) cross-checked against `src/` **and**
`tests/`; and three executed probes of the real model module through Node type-stripping
(`buildPlan` / `materializeSequence` / `moveRowTo`), nothing written to disk.

Nothing was fixed: every finding below is reported for the Lead to triage.

## Measured gates (item 1)

| command | result |
| --- | --- |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **exit 0, no diagnostics** |
| `pnpm exec vitest run` | **exit 0 — `Test Files 20 passed (20)`, `Tests 277 passed (277)`** (`Duration 12.61s`) |

Both numbers match `README.zh-CN.md:344` / `README.md:344` (20 specs / 277 cases) and
`README.zh-CN.md:315`. Test counts are *not* stale.

## Summary

| # | finding | severity | evidence |
| --- | --- | --- | --- |
| 1 | README §2.8 + `model.ts` comment + `gatedHint` copy claim rename/hide materialize the sequence — false; the "nothing is configured" banner never clears | **MAJOR** | `README.zh-CN.md:102`, `README.md:100`, `model.ts:295-296`, `i18n/index.ts:32,141`; executed probe |
| 2 | `Plan.unmanaged` and `Plan.dormantGroups` have no production consumer — leftovers of the deleted "not configured pool" | **MAJOR** | `model.ts:140,142,306,383-384`; only `tests/shared-model.spec.ts` reads them |
| 3 | `StoreSnapshot.saved` is dead and its doc names a consumer deleted in the same commit (`common.applied` / "Saved") | **MAJOR** | `store.ts:50-51,164,230`; `common.applied` removed by `342e128` |
| 4 | `PlanPanel.managed` is dead and mis-documented (set, never read in `src/`) | MINOR | `model.ts:67-68,321,336`; tests only |
| 5 | `PlanRow.order` has no production consumer (tests only) | MINOR | `model.ts:101-102,371`; `rail.tsx` reads `PlanPanel.order` |
| 6 | `Plan.rows` is documented as "EVERY rail row" but locked rows are excluded → all-locked shows the "nothing registered" copy, and the materialize fallback writes a locked panel into `sequence` | MINOR | `model.ts:126-134,287`; `SequenceEditor.tsx:433-434`; executed probe |
| 7 | `RailAdapter.railRowCount()` is dead, and the hide-row selector exists in three copies | MINOR | `rail.tsx:83-84,302-305,413` vs `probe.ts:27,129` vs `rail/css.ts:23-28` |
| 8 | `SequenceEditor.railRows()`'s fallback branch is unreachable in the normal path and mis-documented | MINOR | `SequenceEditor.tsx:104-112,425` |
| 9 | `SelfCheckState.hidingDisabled` / `settingsIconDisabled` / `checkedAt` are written but never read in `src/` | MINOR | `probe.ts:214-218`; `ConfigBlock.tsx:255-320` reads only `degraded`/`readOnly`/`results` |
| 10 | `data-*` hooks nothing queries (`data-dsh-panellist-entry`, `data-block`, `data-plugin-css`, `…-overview-member`, `…-overview-missing`, `…-flyout-missing`, `data-hidden`) | MINOR | producers only; `ARCHITECTURE.md:126,53` claims the CSS layer reads the `…-entry` marker |
| 11 | Probe 3's throwaway row does **not** hide itself; the documented "suppressed marker" is never stamped | MINOR | `probe.ts:161-166` returns `null`; `ARCHITECTURE.md:195` |
| 12 | Two stylesheets define the group-active highlight; the one in `rail/css.ts` is always overridden, and the direct-rule variant paints a zero-size span | MINOR | `rail/css.ts:35-39` (spec 0,2,1) vs `groups.css.ts:31-40` (spec 0,3,2) |
| 13 | Tautological assertions: two component identities that can never be equal, and `styles !== undefined` | MINOR | `tests/client-controller.spec.tsx:189,306` |
| 14 | The redesign's central "Hide/Show never materializes the sequence" property is not pinned by any spec | MINOR | `tests/settings-sequence.spec.tsx:177-204` uses an already-materialized profile |
| 15 | Stale comment referring to the deleted "not configured" list | MINOR | `tests/settings-appearance.spec.tsx:125-127` |
| 16 | Both README headers still describe the deleted model ("ordered and appended only when the Sequence is non-empty") | NIT | `README.zh-CN.md:11`, `README.md:11` |
| 17 | Symbols exported but never imported anywhere outside their own file | NIT | `config.ts:75,124`; `i18n/index.ts:13`; `model.ts:42,96`; `migrate.ts:13,23,26`; `validate.ts:29,55,74,93`; `store.ts:52`; `probe.ts:33` |
| 18 | `as never` double casts silence the slot contract at every registration boundary | NIT | `rail.tsx:163-164,374-375,382-383`; `probe.ts:77-78,170-171` |
| 19 | `src/shared/edit.ts` lost its trailing newline in `342e128` | NIT | `edit.ts:343` (`\ No newline at end of file`) |
| 20 | Orphaned duplicate doc comment whose subject was deleted by the redesign | NIT | `rail.tsx:62` |
| 21 | `GLOSSARY.md`'s **Sequence** ("the visible order") contradicts `ProfileConfig.sequence` being partial | NIT | `GLOSSARY.md:17-19` vs `README.zh-CN.md:118-123` |

**No BLOCKER found.** Items (a)–(f) of the brief were all checked against the code and are sound;
see the last section.

---

## MAJOR

### 1 — The "first change (drag, rename, hide)" claim is false, and the gate banner never clears

Evidence (four sites, one of them user-visible):

- `README.zh-CN.md:102` — *"第一次改动（拖动、改名、隐藏…）会把当前顺序写成显式序列，从此由你接管。"*
- `README.md:100` — *"The first change (a drag, a rename, a hide) turns the current order into an explicit sequence"*
- `src/shared/model.ts:295-296` — *"The first edit (a drag, a rename, a hide) turns the sequence into an explicit order and this switches on."*
- `src/client/i18n/index.ts:32` / `:141` — `settings.sequence.gatedHint`: *"Your first change turns this list into an explicit order."* / *"你做出第一处改动时，这份列表就变成显式顺序。"*

Why it is a leftover: `reordering` is `slots.length > 0` (`model.ts:298`), and `slots` is filled **only**
from `profile.sequence` (`model.ts:197-275`). A rename or a hide goes through `patchOverride`
(`edit.ts:68-88`), which touches `profile.entries` and never `profile.sequence`; the per-row Hide
button uses the non-materializing path (`SequenceEditor.tsx:177-181` → `apply`,
`Section.tsx:80-82`). Only drag/group/ungroup/lock go through `applyStructural`
(`Section.tsx:84-88`). Executed probe on the real module:

```
registered [a]; profile {sequence:[], entries:{}, locked:[]}
fresh       reordering=false  rows=[["a",null]]
rename-only reordering=false  rows=[["a",null]]     <-- README §2.8 says this materializes
hide-only   reordering=false  rows=[["a",null]]     <-- and this too
```

`README.zh-CN.md:120` / `README.md:120` (§2.11) and `docs/ARCHITECTURE.md:183` already say
"structural edit", so §2.8 and §2.11 are two sources of truth for one fact and §2.8 is wrong.

User-visible consequence: the banner's condition is `!plan.reordering` (`SequenceEditor.tsx:416-431`),
so after a user hides or renames a row the page **still** shows "还没有配置任何项 / Nothing is
configured yet … your first change turns this list into an explicit order" — copy that is now both
stale and self-contradicting (a change has already happened).

Minimal fix: in both READMEs §2.8 and the `model.ts` comment, replace "拖动、改名、隐藏" / "a drag, a
rename, a hide" with "结构性改动（拖动、建组/解散、锁定）" / "a structural change (drag, group/ungroup,
lock)". For the banner, either reword `gatedHint` to "before your first *structural* change" or gate
`!plan.reordering` on "no sequence **and** no entry overrides", so it stops claiming nothing has been
configured after a hide or rename.

### 2 — `Plan.unmanaged` and `Plan.dormantGroups` are dead fields left by the removed pool

`src/shared/model.ts:140` (`unmanaged`) and `:142` (`dormantGroups`), computed at `:306` and
`:188/267/384`. A grep of `src/**` finds the declarations, the local computation and the return
object — **no reader**; `.unmanaged` / `.dormantGroups` appear only in `tests/shared-model.spec.ts`
(`:39,97,107,123,143,152,179` and `:212`). `dormantGroups` is additionally referenced by a
`{@link}` in its own doc comment (`model.ts:123`).

Why it is a leftover: the redesign deleted `Plan.appendix` (the other half of the "not configured
pool" trio, see the `342e128` diff of `model.ts`) but kept these two. Their only purpose in the old
model was to feed the removed per-item adopt/release UI and the removed "not in the sequence" list;
the new editor reads `plan.rows` and `plan.orphans` only (`SequenceEditor.tsx:101,248`,
`ConfigBlock.tsx:126`). Each is still computed and still pinned by its own spec, so deleting the UI
did not delete its data.

Minimal fix: delete both fields, the `dormantGroups` accumulator, and the `unmanaged` filter
(`model.ts:306`) together with the spec cases that assert them — or, if they are wanted as
diagnostics, surface them (e.g. an orphan/dormant row in `ConfigBlock`) so something reads them.

### 3 — `StoreSnapshot.saved` is dead, and its doc names a consumer the redesign deleted

`src/client/config/store.ts:50-51` — *"Increments on every successful write (drives the transient
'Saved')."* Written at `:164` and `:230`; read only by `tests/client-store.spec.ts:108,125`. No
component in `src/` reads `snapshot.saved`.

Why it is a leftover: the dictionary key this comment refers to (`common.applied`: "Saved"/"已保存")
was **removed by `342e128` itself** (see that commit's `src/client/i18n/index.ts` diff), and
`ConfigBlock.tsx` renders no transient "Saved" affordance — the write-status affordances it does
render are built from local `useState` (`exported`, `imported`, `revealed`, `resetDone`). The field
and the comment survived the removal of their only intended consumer.

Minimal fix: delete `saved` from `StoreSnapshot`, `emptySnapshot()` and the two `publish` calls, and
drop the two spec assertions — or wire it back to a real status indicator.

---

## MINOR

### 4 — `PlanPanel.managed` is dead and mis-documented

`model.ts:67-68` documents it as *"Whether this plugin writes anything for this panel beyond
`order`"*, but `model.ts:336` sets `managed: true` for a tail panel that only ever receives an
`order` write. Nothing in `src/` reads it (grep: declaration, two assignments, no reader); only
`tests/shared-model.spec.ts:121,142,175` do.

This was reported as F11 in `docs/reviews/2026-10-10-verification.md:240-245` and triaged
"accepted as-is". Re-reported because the same commit that removed the adopt/release pool left it
behind, and because its doc is what made the *old* fresh-install bug (F2) invisible for so long: a
reader trusts `managed` as the write gate, and `rail.tsx:205-279` does not use it.

Minimal fix: delete the field (and its spec assertions), or make `rail.tsx` actually gate the
name/icon/hidden writes on it and fix the doc to say "anything at all".

### 5 — `PlanRow.order` has no production consumer

`model.ts:101-102` and the mapping at `:371` produce it; the only readers are
`tests/shared-model.spec.ts:32,118,134,151,160,210,227`. The rewrite pass reads
`PlanPanel.order` (`rail.tsx:216-235`) and the editor reads `row.kind/id/label/railId` only
(`SequenceEditor.tsx:241-292`).

It is not harmful (it documents the "list vs write" split), but it is a second, unread source of
truth for "what order will be written" next to `PlanPanel.order`, which is the field that actually
drives the write.

Minimal fix: either drop it and keep the invariant in the `Plan.rows` doc, or have a consumer use it
(e.g. a debug column in the settings page).

### 6 — `Plan.rows` is not "EVERY rail row": locked rows are missing

`model.ts:126-134` — *"EVERY rail row, in the order the rail shows them"*. But `model.ts:287` filters
locked panels out of the tail, and `:312-322` builds `PlanPanel` entries for them without ever
pushing a slot. A locked panel is still a row the shell renders (its own native registration), so the
editor cannot reach it; `Section.tsx:98-101` compensates with a separate `lockedPanels` list.

Two observable consequences (executed probe):

```
registered [a]; profile {sequence:[], entries:{}, locked:['a']}
=> plan.rows = []            # an empty rail list although one row is on the rail
=> SequenceEditor renders "No panel is registered on this profile yet."
   (i18n: settings.sequence.empty) — false, the profile has a registration
=> "Use the current rail order as a starting point" is enabled (registered.length !== 0),
   and its railRows() fallback returns the locked panel:
   materialize -> sequence [{entry a}] -> plan.warnings [{code:'locked-in-sequence'}]
```

So the one path that matters here writes a locked panel into `sequence` as inert config junk, and
the empty-state copy is wrong. This also contradicts `README.zh-CN.md:114` / `:136` ("lists the
whole rail") and `ARCHITECTURE.md:183`.

Minimal fix: correct the `Plan.rows` doc to "every *unlocked* rail row" and have `SequenceEditor`
render its empty state only when `registered.length === 0`; make `railRows()` skip locked panels
(drop the fallback branch, see #8) so materialize can never take one over.

### 7 — `RailAdapter.railRowCount()` is dead, and the hide-row selector exists in three copies

`rail.tsx:83-84` declares it, `:302-305` implements it with a hard-coded
`'nav[class*="_panelList"] > button[class*="_panelRow"]'`, `:413` exposes it. No caller: probe 2
re-implements the same query with its own constant (`probe.ts:27`, used at `:129,147,150`), and the
hide rule spells it out a third time (`rail/css.ts:24-25`).

Why it is a leftover: nothing ever needed the adapter's copy — the probe owns the measurement (which
is correct, ARCHITECTURE §7 requires the probe to use *the same selector the hide rule uses*), so the
adapter method is a stale duplicate of a fact that is now in three places and will drift when the
shell re-rolls its class hash.

Minimal fix: delete `RailAdapter.railRowCount` (interface, implementation, property) and have
`probe.ts` be the single owner of the row selector string; if the adapter is meant to own it, import
it into the probe instead.

### 8 — `SequenceEditor.railRows()`'s fallback branch is unreachable in the normal path

`SequenceEditor.tsx:104-112`: *"Nothing is registered-but-unsorted yet, so the rail order IS the
registration order: sort by the declared order only"*. That branch was correct before the redesign,
when `plan.rows` was empty while `reordering` was false. `342e128` made the tail unconditional
(`model.ts:300-304`), so `plan.rows` is now always the whole (unlocked) rail and the branch is dead
for every ordinary fresh install; its comment is wrong too.

It is not strictly unreachable: it fires exactly when `plan.rows.length === 0` and
`registered.length > 0` — i.e. the all-locked case of #6, where it produces the locked-panel write
described there. So the branch is either dead or wrong, never both-right.

Minimal fix: delete the branch and use `plan.rows` unconditionally (it is by contract the same
list), and drop or repair the `railRows()` indirection.

### 9 — `SelfCheckState.hidingDisabled` / `settingsIconDisabled` / `checkedAt` are unread

Set at `probe.ts:214-218` (and initialised at `:234-238`), declared at `contracts.ts:122,126,130`.
The only readers are `tests/client-probe.spec.tsx:67,77,157,253,276,293` and the test harness
(`tests/helpers/settings-harness.tsx:108,110,112`).

`ConfigBlock.CompatibilityBlock` (`:252-333`) renders `degraded`, `readOnly`, `results` and `version`
— the per-probe verdicts come from `results`, so the three aggregate flags are dead weight. (They are
not in the same family as `readOnly`/`activeRuleDisabled`, which *are* read by
`controller.ts:153` and `controller.ts:75`.)

Minimal fix: delete the three fields (and the harness defaults / spec assertions), or render them in
the degraded banner as the reason strings the README §5 table promises.

### 10 — `data-*` hooks nothing queries

Mechanical sweep of every `data-*` token in `src/` against both `src/` and `tests/` (producer
occurrence = 1, no reader):

| attribute | producer | reader |
| --- | --- | --- |
| `data-dsh-panellist-entry` | `rail.tsx:181` | none (and `ARCHITECTURE.md:126`, `:53` claim the CSS layer reads it) |
| `data-dsh-panellist-overview-member` | `Overview.tsx:37` | none (`groups.css.ts` styles only `[data-dsh-panellist-overview]`) |
| `data-dsh-panellist-overview-missing` | `Overview.tsx:38` | none |
| `data-dsh-panellist-flyout-missing` | `Flyout.tsx:206` | none (styling comes from `:disabled`, `groups.css.ts:137-141`) |
| `data-hidden` | `SequenceEditor.tsx:340` | none (`data-dsh-panellist-hidden` is the real marker elsewhere) |
| `data-block` (5 sites) | `ConfigBlock.tsx:128,177,271,293`, `Section.tsx:150` | none |
| `data-plugin-css` | `styles.ts:36` | none (style reuse keys off the element id, `styles.ts:24-25`) |

`data-dsh-panellist-entry` is the notable one: the redesign commit's `rail.tsx` diff touched the
glyph wrapper, and `ARCHITECTURE.md:126` still advertises it as *"a per-row identity"* for the CSS
layer while both CSS rules actually key off `data-dsh-panellist-hidden` /
`data-dsh-panellist-suppressed` (`rail/css.ts:23-28`).

Minimal fix: delete the hooks with no reader (they cost a DOM attribute each) and fix
`ARCHITECTURE.md:126`/`:53` to name the real markers — or, if `…-entry` is meant as the documented
row-identity hook, use it in a rule/selector and add the spec.

### 11 — Probe 3's throwaway row does not hide itself

`probe.ts:163-165`: *"Suppressed marker: our own stylesheet hides the throwaway row while the probe
measures it, so the user never sees an extra rail row."* — but `ProbeGlyph` (`:161-166`) returns
`null` and stamps **no** attribute, so `HIDE_CSS` (`rail/css.ts:24-25`, which needs
`:has([data-dsh-panellist-suppressed])`) cannot match, and the rewrite pass never wraps it either
(own namespace ids are filtered at `rail.tsx:212,309`). `probeActive` waits two animation frames
(`:177`) before disposing, i.e. at least one paint of a phantom row appended at `order: 424243`.
`ARCHITECTURE.md:195` repeats the claim ("the throwaway row hides itself with a suppressed marker").

Minimal fix: return `<span data-dsh-panellist-suppressed="" />` instead of `null` from `ProbeGlyph`,
or delete the claim from `probe.ts` and `ARCHITECTURE.md:195`.

### 12 — Two stylesheets define the group-active highlight; one is always overridden

`rail/css.ts:35-39` (`GROUP_ACTIVE_CSS`, registered by `controller.ts:95`) sets
`background` on `button[class*="_panelRow"]:has([data-dsh-panellist-group-active])` — specificity
`(0,2,1)`. `groups.css.ts:37-40` sets `background`/`color` on
`nav[class*="_panelList"] button[class*="_panelRow"]:has([…])` — specificity `(0,3,2)`. Both live in
the same aggregated `<style>` (`styles.ts:44`), so the higher-specificity declaration wins whatever
the registration order, and the rail chunk's rule can never paint. The direct-rule variant next to it
(`groups.css.ts:31-33`) targets the marker span itself, which is `width: 0; height: 0; overflow:
hidden` (`groups.css.ts:22-28`), so it cannot paint either.

Why it is a leftover: one fact ("a group row highlights while a member is active") now has two
overrides with different colours (`color-mix(in srgb, currentColor 14%, transparent)` vs
`--dsw-alias-interactive-bg-hover`); a maintainer editing the rail chunk will see no effect.

Minimal fix: delete `GROUP_ACTIVE_CSS` and its `styles.register('rail-group-active', …)` call, and
keep the `groups.css.ts` nav-scoped rule as the single definition (deleting the zero-size direct rule
as well unless a real shell needs it).

### 13 — Tautological assertions in `tests/client-controller.spec.tsx`

- `:188-189` — `// Only the configured panel got a wrapper.` then
  `expect(entry(h.ledger, 'plugins').component).not.toBe(entry(h.ledger, 'skills').component)`. The
  harness registers every rail entry with its **own** `() => null` arrow (`:102-104`), so the two
  components are distinct object identities no matter what the wrapper pass does — and in this
  profile the wrapped panel is `schedules` (hidden, `:175`), not either of the compared ones. The
  assertion passes with the whole glyph-wrapper feature deleted.
- `:306` — `expect(h.styles !== undefined).toBe(true)`: `h.styles` is created three statements earlier
  in the same harness (`:129`), so this can never fail. The meaningful assertion is `:307`.

Minimal fix: compare against a per-entry captured original (the pattern already used at
`tests/client-rail.spec.tsx:83-94`), and drop `:306`.

### 14 — The "Hide/Show never materializes" guarantee is not pinned by any spec

The redesign's contract is that the per-row Hide/Show writes through `setPanelHidden` /
`setGroupHidden` and **does not** touch `sequence` (spec item (e)). The code is correct
(`SequenceEditor.tsx:177-181` uses `apply`; `Section.tsx:80-82` does not materialize). But both specs
that cover it use an already-complete sequence:
`tests/settings-sequence.spec.tsx:177-193` and `:195-204` start from
`profileWith(['plugins','schedules'])` / a profile whose sequence already holds the group, so
`materializeSequence` would be a no-op and the expectation is identical whether the handler used
`apply` or `applyStructural`. The property is therefore untested.

Minimal fix: add one case that renders `emptyProfileConfig()` with the default registrations, clicks
the row's Hide button, and asserts the accepted update is
`{ sequence: [], entries: { plugins: { hidden: true } }, locked: [] }` — i.e. the sequence is still
empty.

### 15 — Stale comment in `tests/settings-appearance.spec.tsx`

`:125-127` — *"the page materialises the live rail order first — including the unconfigured panel it
shows under 'not configured'."* There is no "not configured" list any more (it was deleted by
`342e128`; the row list is now `plan.rows`). The hard-coded row list on `:128-132` is also a
hand-copied duplicate of `plan.rows`.

Minimal fix: reword to "…including the panels it lists from the rest of the rail", and derive the
row list from `harness.plan().rows` instead of restating it.

---

## NIT

### 16 — Both README headers still describe the deleted model

`README.zh-CN.md:11` / `README.md:11`: *"未配置页签只在「序列非空」时才被追加排序"* / *"unconfigured
Panel entries are ordered and appended only when the Sequence is non-empty"*. In the current model
they are always listed (that is the point of §2.11) and only the `order` **write** is gated. The
sentence was written for the old `if (reordering)` append and is now ambiguous against §2.8/§2.11.
Minimal fix: reword to "unconfigured rows are always listed; their `order` is written only once the
sequence is non-empty".

### 17 — Exported but never imported outside its own file

`GROUP_ID_PREFIX` (`config.ts:124`), `EntryItem` (`config.ts:75`), `Lang` (`i18n/index.ts:13`),
`PlanMember`/`PlanRow` (`model.ts:42,96`), `MIGRATION_STEPS`/`MigrationStep`/`MigrationResult`
(`migrate.ts:13,23,26`), `asIconRef`/`asEntryOverride`/`normalizeProfileConfig`/`NormalizeResult`
(`validate.ts:29,55,74,93`), `StoreOptions` (`plugin/store.ts:52`), `SelfCheckOptions`
(`rail/probe.ts:33`). Each is used inside its own module, so nothing is dead — the exports are just
not part of any seam (no importer in `src/` or `tests/`). Minimal fix: drop the `export` keyword
where the symbol is module-private, or leave it; no behaviour is at stake.
(`BUILTIN_GLYPHS_ARE_EXHAUSTIVE` in `icons/builtin.tsx:321` is the same shape but is deliberately
exported as a compile-time witness and is documented as such — not a finding.)

### 18 — `as never` casts at the slot-registration boundary

`rail.tsx:163-164`, `:374-375`, `:382-383`; `probe.ts:77-78`, `:170-171`. Casting the whole options
object and the component through `as never` assigns them to *anything*, so a wrong key (e.g. `key`
vs `id`) or a component whose props no longer match the slot contract compiles silently. The typed
structural seam (`contracts.ts`) therefore does not actually guard registration. Minimal fix: type
the registration against the local `StoredEntry`-shaped interface once (or use the real
`SlotRegistry` type where available) instead of `as never`; leave a comment if the cast must stay.

### 19 — `src/shared/edit.ts` has no trailing newline

`edit.ts:343` — the `342e128` diff ends with `-}` / `+}` and `\ No newline at end of file`. Only
cosmetic, but it makes every later diff of this file noisier. Minimal fix: append a newline.

### 20 — Orphaned duplicate doc comment in `rail.tsx`

`rail.tsx:62-63`:

```ts
/** Read an optional cordis service without letting a missing one throw. */
/** Everything another unit may ask of the rail. */
export interface RailAdapter {
```

The first line documented the helper that `342e128` deleted from that spot (`isOwnRailId` moved to
`shared/config.ts`); it now reads as a second, wrong doc for `RailAdapter`. Minimal fix: delete the
first line.

### 21 — `GLOSSARY.md` "Sequence" no longer matches the field it names

`GLOSSARY.md:17-19` defines **Sequence** as *"Panellist 各项的可见顺序"* (the visible order of the
entries). Since the redesign, `ProfileConfig.sequence` is explicitly *partial*
(`README.zh-CN.md:118`, `config.ts:102-107`), while the visible order is `plan.rows`. The glossary has
no entry for the partial field or for `plan.rows`, so the one term now names two different things.
Minimal fix: add "the config array is partial; the visible order is `plan.rows`" to the entry.

---

## Verified sound (parts of item 4 with no finding)

Checked by reading the code and, where noted, by executing the real model module:

- **(a) A fresh install writes nothing and does not nudge.** `rail.tsx:224-235` writes `order` only
  when `PlanPanel.order !== null`; `:243-258` compares the label against the shell's effective value
  (`resolveLabel(captured.label) ?? id`); `:261-273` wraps only when `icon`/`hidden`/`suppressed` is
  set. Empty profile ⇒ `reordering = false`, every `PlanPanel.order === null` (executed). Pinned by
  `tests/client-rail.spec.tsx:165-193` (asserts zero field writes and `ledger.currentVersion`
  unchanged, including a label-less registration).
- **(b) `plan.rows` is the whole rail with `order: null` in that state.** Executed: `rows = [a]`,
  `order null`; pinned by `tests/shared-model.spec.ts:110-135`. The one exception is locked rows —
  that is finding #6.
- **(c) Drag/drop index math lands correctly.** `beforeIndex(from, target)` (`SequenceEditor.tsx:87-90`)
  is the correct insert-before index after the source is spliced out, and the list it indexes
  (`plan.rows`) is the same array `Section.applyStructural` materializes (`Section.tsx:85-88`), 1:1
  for every row (matrix below, executed on the real functions; orphans are appended after the row
  block by `materializeSequence` and cannot be landed on):
  `drop plugins@skills → schedules,plugins,skills`; `drop skills@plugins → skills,plugins,schedules`.
- **(d) Hidden-but-active and suppressed still hold.** `rail.tsx:179-183`: `suppressed` wins and
  stamps `data-dsh-panellist-suppressed` unconditionally; `hidden` is `true` only while
  `props.active !== true`. CSS is conditional on the marker only (`rail/css.ts:23-28`). Pinned by
  `tests/client-rail.spec.tsx:102-124` and `:126-148`.
- **(e) Hide/Show writes through `setPanelHidden`/`setGroupHidden` without materializing.**
  `SequenceEditor.tsx:177-181` selects the right pure function and calls `apply`;
  `Section.tsx:80-82` (`apply`) never calls `materializeSequence`, unlike `applyStructural`
  (`:84-88`). Also `setPanelHidden`/`setGroupHidden` (`edit.ts:101-103,140-147`) touch only
  `entries` / the group item. No materialize side effect exists — only the missing spec (#14).
- **(f) Nothing still reads a removed field.** `tsc --noEmit` is clean, and a grep of `src/` + `tests/`
  for `appendix`, `PlanRow.configured`, `isGroupRailId`, `adoptPanel`, `releasePanel`, `profileOf`,
  `cloneConfig`, `isEmptyOverride`, the removed i18n keys and `settings.sequence.newGroupName` finds
  no reference (only the historical mentions in `docs/reviews/2026-10-10-verification.md`, which is a
  dated record of the pre-redesign tree).

## Not checkable from inside this workspace

- Real-DSH behaviour: whether the shell renders a row for a `null`-returning glyph (finding #11's
  "phantom row" and finding #12's specificity claim are reasoned from the shipped selector/CSS
  rules and the ledger contract, not from a running DSH window — the on-device step in README §9 is
  still pending).
- CSS cascade on the real build: #12 is decided by selector specificity alone, which is
  engine-independent, but the token values (`--dsw-alias-interactive-bg-hover`) can only be seen on a
  real window.

---

## Lead resolution (appended after the audit was closed)

Measured on the fixed tree, by the Lead: `pnpm exec tsc -p tsconfig.json --noEmit` exit 0; `pnpm exec vitest run`
20 files / **278 tests** passed; `pnpm check` (typecheck + tests + declaration emit + both bundles) green.

| # | finding | resolution |
| --- | --- | --- |
| 1 | README §2.8 / `model.ts` / `gatedHint` claimed rename+hide materialize the sequence | **Fixed** in all four places: the docs and the banner now say a *structural* change (drag, group/ungroup) takes over the order, and that rename/re-icon/hide only override that row. The banner no longer claims nothing has been configured. |
| 2 | Dead `Plan.unmanaged` / `Plan.dormantGroups` | **Removed**, with their accumulators and the now-unused `isUntouched` helper. The specs assert the same properties through what the rewrite pass reads (a `rowOrders()` helper over `PlanPanel.order` / `PlanGroup.order`, plus `PlanGroup.liveMembers`). |
| 3 | Dead `StoreSnapshot.saved` whose doc named the deleted `common.applied` | **Removed** from the snapshot, `emptySnapshot()`, both publishes, both fakes and the two spec assertions. |
| 4 | Dead, mis-documented `PlanPanel.managed` | **Removed** (the field made the old fresh-install bug invisible by inviting readers to trust it as the write gate). |
| 5 | `PlanRow.order` as a second source of truth | **Removed**; `PlanRow` is now purely the display projection, and the model specs read the real order sources. |
| 6 | `Plan.rows` documented as "EVERY row" while locked rows are excluded | **Fixed**: the doc says every *unlocked* row; the editor distinguishes "nothing registered" from "everything is locked" (new `settings.sequence.allLocked` copy) and disables the materialize button when there is no unlocked row to snapshot. |
| 7 | Dead `railRowCount` + the row selector in three copies | **Fixed**: `PANEL_ROW_SELECTOR` lives in `rail/css.ts`, the hide rule is built from it, and `rail/probe.ts` imports it; the adapter method is gone. |
| 8 | `railRows()`'s unreachable/wrong fallback branch | **Removed** with the indirection: "use the current rail order" reads `plan.rows`, which by contract is the same list and can never contain a locked panel. |
| 9 | Unread `SelfCheckState.hidingDisabled` / `settingsIconDisabled` / `checkedAt` | **Removed**; the per-probe `results` (which carry the detail and the impact copy the page renders) are the single source. |
| 10 | `data-*` hooks with no reader | **Fixed**: `data-dsh-panellist-entry`, `data-hidden`, `data-block` (5 sites), `-overview-member`, `-overview-missing` and `data-plugin-css` were deleted. `-flyout-missing` was **kept** — `groups.css.ts` styles it, which a sweep over TS alone cannot see. ARCHITECTURE §4.2 now documents the two markers that actually drive the CSS. |
| 11 | Probe 3's throwaway row did not hide itself | **Fixed in the code, not the doc**: `ProbeGlyph` returns the suppressed marker span (via `createElement`, so `probe.ts` stays a `.ts` module), which is what `HIDE_CSS` matches. |
| 12 | Group-active CSS defined twice, one rule unreachable | **Fixed**: the rail chunk's copy and its registration are gone; the group unit's nav-scoped rule (with the real theme token) is the single definition. |
| 13 | Tautological assertions in `client-controller.spec.tsx` | **Fixed**: the harness registers one *named* glyph per panel and exposes them, so the wrapper assertions compare against the same entry's captured original; the `styles !== undefined` line is gone. |
| 14 | "Hide/Show never materializes" unpinned | **Pinned**: a case starts from an empty profile, clicks Hide and asserts `{ sequence: [], entries: { plugins: { hidden: true } }, locked: [] }` — with an already-materialized profile the two code paths are indistinguishable. |
| 15 | Stale comment + hand-copied row list in `settings-appearance.spec.tsx` | **Fixed**: the comment describes the current model and the expectation is derived from `harness.plan().rows`. |
| 16 | README headers described the deleted append model | **Fixed** in both languages: unconfigured entries are always listed; only the `order` write is gated. |
| 17 | Exports used only inside their own module | **Partly fixed**: the implementation details (`asIconRef`, `asEntryOverride`, `normalizeProfileConfig`, `ensurePortalContainer`, `PORTAL_CONTAINER_ATTRIBUTE`) lost the keyword. Props interfaces and the type surface of the two halves stay exported on purpose — they are the seam, and declaration emit needs a nameable type for an exported value (`BuiltinGlyphRenderer` is that case). |
| 18 | `as never` at the registration boundary | **Fixed**: the rail adapter and the probes register through small wrappers typed against local option shapes, so a wrong key or a drifted component is a compile error at the caller. They call *through* `slots` — extracting the method loses its receiver, which the first attempt did and the suite caught. |
| 19 | `edit.ts` missing its trailing newline | **Fixed**. |
| 20 | Orphaned duplicate doc comment in `rail.tsx` | **Deleted**. |
| 21 | GLOSSARY "Sequence" named two things | **Fixed**: the entry now states that `ProfileConfig.sequence` is partial while the visible order is `Plan.rows`. |

Not actioned, deliberately: props interfaces and API types keeping their `export` (see #17), and
`BUILTIN_GLYPHS_ARE_EXHAUSTIVE` — a documented compile-time witness whose value is meaningless and whose
type is the assertion.