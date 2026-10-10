# Architecture

Design of `dsh-panellist`. Behaviour is specified in [README.zh-CN.md](../README.zh-CN.md) (and [README.md](../README.md)); the decision behind this shape is [ADR-0001](adr/0001-registry-rewrite-plus-minimal-dom.md); vocabulary is defined in [GLOSSARY.md](../GLOSSARY.md).

Line references point at the JavaScript bundles shipped inside `D:\Soft\DeepSeekHarness\resources\app.asar` for **DSH 0.2.0-rc.2**, written as `/dsh/node_modules/@deepseek-ai/<package>/lib/<file>`. They are valid for that build only and are the reason the plugin ships a self-check (see §7).

---

## 1. Shape

Three actors:

| Actor | Owns |
| --- | --- |
| The shell (`dsh-client-ui-sidebar`, `dsh-client-ui-layout`, `dsh-client-ui-settings-general`) | The rail, the row boxes, active highlighting, the collapsed 56 px rail, selection, the settings dialog |
| Our host half | The config file, schema validation, migration, corruption recovery, one loopback HTTP route |
| Our client half | Display overrides, the group registrations and flyout, the settings page, the self-check |

The client half never renders the rail. It changes what the shell renders, and adds exactly one CSS rule and one overlay.

```
settings page ──PUT──▶ host route ──validate → migrate → atomic write──▶ $DSH_HOME/panellist.json
      ▲                     │
      └───────GET───────────┘
      │  plan
      ▼
registry pass ──▶ entry.options.order / entry.options.label / entry.component   (order, name, icon)
              └─▶ our own group registrations                                   (group rows)
CSS layer     ──▶ nav[class*="_panelList"] > button[class*="_panelRow"]:has([data-dsh-panellist-hidden]) { display: none }
flyout        ──▶ ctx.layout.selectPanel(memberId)                                 (selection)
```

---

## 2. Facts this design rests on

All verified by reading the shipped bundles (and, where marked, by executing the extracted `SlotCore`).

| # | Fact | Provenance | What we do with it |
| --- | --- | --- | --- |
| 1 | The rail is a root-scoped `list` slot named `sidebar.panellist`, declared by ui-sidebar; each entry's `id` addresses its page in the layout's root-scoped `keyed` slot `main`. | ui-sidebar `lib/client.js:487-521` (declaration), `503-506` (the slot) | One registration per rail item; group rows are registrations too |
| 2 | The shell projects metadata read-only: it maps `entriesOfSlot("sidebar.panellist")` to `{id, order ?? 0, label ?? id}`, sorts by `order`, and re-syncs on slot subscription and on locale change. | ui-sidebar `lib/client.js:453-470` | Order and label are ours to write; the re-sync trigger is known |
| 3 | `register()` copies the options into a fresh object (keeping `key`/`id`/`order`/`label`/`priority` plus declared `children`/`locale`/`registrant`), stores it plainly, does **not** freeze it, and `entriesOfSlot()` hands that stored entry back. | ui-slots `lib/index.js:163, 204-219, 278`; executed | Post-hoc rewriting works: `entry.options.order`, `entry.options.label`, `entry.component` |
| 4 | Mutating an entry bumps no version and fires no subscriber; `subscribe` is microtask-batched and driven by ledger mutations. | ui-slots `lib/index.js:393, 423, 433`; executed | Changes need a sync nudge (§4.5) |
| 5 | `ctx.slots` is the Cordis `SlotRegistry` service; a read returns a fresh traceable proxy over the instance, whose `set` trap forwards to the real instance. | ui-renderer `lib/client.js:1788, 1343`; cordis `service.ts`/`utils.ts`; executed | Not needed by the chosen path — recorded because it was the rejected alternative (ADR-0001) |
| 6 | `ctx.layout.selectPanel(id)` throws unless an entry in `main` carries that key; the guard probes `ctx.slots.entries("main")`. | ui-layout `lib/client.js:462-466, 595` | Group members are selected through it, each guarded by the same probe |
| 7 | Row markup: `nav[class*="_panelList"]` (flex column, `gap: 4px`) → `button[class*="_panelRow"][aria-label][aria-current]` → `span[class*="_panelGlyph"]` + (only when wide) `span[class*="_panelTitle"]`. | ui-sidebar `lib/client.js:173-200, 378-389` plus the inlined CSS at `:91` | The single CSS rule in §5, and the row geometry our group rows inherit for free |
| 8 | CSS-module class names are `_<buildHash>_<stableKey>`; the keys are `panelList`, `panelRow`, `panelActive`, `panelGlyph`, `panelTitle`. `[class*="_panelRow"]` matches; `[class$="_panelRow"]` fails on an active row because `_panelActive` is appended. | ui-sidebar `lib/client.js:91` (rules), `120-125` (key map) | Selector form; re-probed per mount because the hash is re-rolled per release |
| 9 | Rows stay mounted while at least one entry exists. When not wide the label span is not rendered at all (labels leave the DOM) while `aria-label` remains. A Windows-titlebar collapse hides the whole nav with `display: none`. | ui-sidebar `lib/client.js:378-389, 182, 194-197`, CSS `:91` | Nothing to do: our CSS hide and the shell's rail handling compose |
| 10 | Rail geometry we must not fight: `panelRow` is `min-height: 36px`, `gap: 8px`, `padding: 7px 8px`, `display: flex`; collapsed it becomes `36px × 36px`, centered, and the list `gap` grows to `12px`. | ui-sidebar `lib/client.js:91` | Group rows are native rows, so this is inherited rather than reproduced |
| 11 | The settings nav is built from `ctx.slots.entries("settings.section")` sorted by `order`; its glyph comes from a closed id list (`account`, `models`, `agent-presets`, `plugins`, `archived-sessions`) and otherwise falls back to the settings gear; the section component renders through `renderSlot("settings.section", { close }, { only: active })`. | ui-settings-general `lib/client.js:1023-1028, 244-267, 313, 337` | Explains why our settings tab gets a gear by default, and why the icon needs the marker pass (§6) |
| 12 | Settings nav rows are `button` elements with `navCell` / `navIcon` / `navLabel` classes inside `[role="dialog"] nav`; two shipped plugins locate their own row by matching `textContent` against their section label. | ui-settings-general `lib/client.js:60, 79, 313`; `dsh-better-sidebar/src/client/settings-nav-icon.ts:21-44`; `dsh-dream-skin/lib/client.js:8066, 8167-8185` | The marker pass copies the ecosystem's proven technique |
| 13 | No semantic-attribute contract ships with DSH: `data-dsh-panel-entry` is stamped by plugins themselves, and the shell stamps no per-entry hook on a rail row. The only stable per-row attributes are `aria-label` (the resolved label) and `aria-current="page"`. | whole-asar search (`contracts/semantic-attrs-v1.md`, `data-dsh-panel-entry`: zero hits in `@deepseek-ai/*`) | Row identity comes from a marker **we** stamp inside the row, never from text matching |
| 14 | Layout: the sidebar auto-collapses below a 1024 px viewport; the collapsed track is 56 px on plain web and 0 on darwin / Windows-titlebar. | ui-layout `lib/client.js:10-11, 236-241` | Flyout placement reads the row's rect, not a viewport assumption |
| 15 | `register()` accepts `priority` (lowest renders; same id + same priority throws), `sidebar.panellist` is declared `list` so `chain` election is unreachable, and re-declaring a slot throws (`"declaring a slot is claiming it"`). | ui-slots `lib/index.js:167, 176-194`; ui-slots `README.md:46` | We do not take over the slot; we register into it |

---

## 3. Client half: modules

```
src/client/
├─ index.tsx            apply(ctx): wires the units, one ctx.effect per unit
├─ controller.ts        the single loop: config × ledger → plan → rewrite + group rows
├─ contracts.ts         the frozen seams between units (types only)
├─ ctx.ts               type-only imports that merge ctx.slots / ctx.layout / slot declarations
├─ styles.ts            one aggregated `<style>` element, adopted by document id
├─ mount.ts             one live mount per document (retires a previous `apply`)
├─ service.ts           tolerant reads of optional cordis services
├─ config/store.ts      plan state; reads/writes the host route; optimistic apply + rollback
├─ i18n/index.ts        zh/en dictionaries; the key set is closed
├─ model input          src/shared/model.ts (pure normalise/plan) + src/shared/edit.ts (pure edits)
├─ registry/
│   └─ rail.tsx         discovery, the rewrite pass (§4), the nudge (§4.5), our own rows
├─ groups/
│   ├─ index.ts         createGroupUnit: reconciling our rail rows + main pages
│   ├─ Row.tsx          the trigger glyph and the capture-phase click interception
│   ├─ Flyout.tsx       the overlay menu (portal, keyboard, positioning)
│   ├─ Overview.tsx     the group's `main` page
│   └─ groups.css.ts    the group CSS chunk
├─ rail/
│   ├─ css.ts           the one injected rule (hide), the group highlight, the nav marker
│   └─ probe.ts         self-check probes (§7)
├─ settings/            the settings.section page (sequence editor, overrides, config, self-check)
└─ icons/               builtin glyph set + SVG sanitiser + inline renderer
```

`src/shared/` holds the config types, the plan model, the pure edit operators and the migration steps, imported by both halves; it stays free of side effects and of any `@deepseek-ai/*` value import (the build's purity gate forbids cross-plugin value imports; type-only imports are fine).

---

## 4. The rewrite pass

### 4.1 What it writes

For every entry in `sidebar.panellist`, with `original` captured the first time we see the entry:

| Field | Written value |
| --- | --- |
| `entry.options.order` | position computed by the model; `original.order` when the panel is unconfigured |
| `entry.options.label` | `() => override ?? originalLabel` when a name override exists, else `original.label` |
| `entry.component` | our wrapper when we need a marker or an icon override, else `original.component` |

Panels the user has not configured are left exactly as registered — writes are gated by the plan (§4.3), not by a per-panel opt-in.

### 4.2 The wrapper

```tsx
function railGlyph(Original: ComponentType<{ size: number; active: boolean }>, id: string, plan: Plan) {
  return function RailGlyph({ size, active }: { size: number; active: boolean }) {
    const panel = plan.panels.get(id)
    const suppressed = panel?.suppressed === true                       // shown inside a group instead
    const hidden = !suppressed && panel?.hidden === true && !active     // active keeps its row
    return (
      <>
        <span
          {...(suppressed ? { 'data-dsh-panellist-suppressed': '' }
            : hidden ? { 'data-dsh-panellist-hidden': '' } : {})}
        />
        {suppressed || hidden ? null : <Original size={size} active={active} />}
      </>
    )
  }
}
```

Notes:
- The `active` prop is supplied by the shell (`renderSlot("sidebar.panellist", { size, active }, { only: id })`), which is what makes the "hidden but active" rule declarative.
- The zero-size `<span>` carries EXACTLY the two state hooks the hide rule matches on (`:has([data-dsh-panellist-hidden])` / `:has([data-dsh-panellist-suppressed])`), and nothing else — a per-row identity attribute with no reader would be a hook waiting to rot. The row is matched as a whole, so the marker owns no layout.
- The original component is rendered in the same React position, so any state it keeps survives.
- **A wrapper is recognisable, and never mistaken for a contributor's component.** The contributor's component lives only in the wrapper's closure, so anything that reads `entry.component` back can pick up our own wrapper: `nativeGlyph` feeds the settings previews from it, and a capture meeting an entry it has not seen adopts it. A wrapper renders the marker instead of a glyph whenever its panel is suppressed (group member) or hidden, so a preview fed our own wrapper was an empty box — the icons of every group member vanished from the settings page. Every wrapper is therefore registered in a page-global `WeakMap` (wrapper → getter for the captured component), `capture` unwraps what it finds and claims the slot, and `nativeGlyph` unwraps its answer. The map is page-global, like the mount guard, because a re-evaluated bundle must still recognise the previous evaluation's wrapper.
- **One live mount per document** (`mount.ts`). The shell may apply the bundle twice on one page (a re-evaluated bundle, an HMR pass); two controllers over one ledger write the same entries and cannot tell each other's wrappers from the contributors' components. `apply` retires the previous mount before building its own, and every disposer here is idempotent: a late call from a retired mount releases nothing.

### 4.3 Order and label

Both are plain field writes on the entry (§2 facts 2-3). The sequence contributes explicit `order` values with gaps (10, 20, 30, …) so that a later manual insert needs no renumbering pass; unconfigured panels keep their registered `order` and therefore land after the configured block only if their own value happens to be higher — the model instead assigns unconfigured panels orders above the configured block, preserving their relative order (confirmed: unconfigured entries append at the end).

**Nothing is written until something is configured.** `buildPlan` always returns the whole rail in `rows` (that is what the settings page edits), but a row's `order` stays `null` — "leave the native order alone" — while the user's sequence holds no live row. That is the one place where "the list you see" and "what we write" deliberately differ, and it is what keeps a fresh install inert on a rail other plugins also touch. `Plan.reordering` is the flag a consumer checks to know which mode it is in.

### 4.4 The CSS layer

One stylesheet, injected once per page and adopted by a document id so a re-evaluated bundle cannot produce a second copy:

```css
nav[class*="_panelList"] > button[class*="_panelRow"]:has([data-dsh-panellist-hidden]) { display: none; }
```

`:has()` support is probed by the self-check. This is the entire DOM requirement for hiding; no node is moved, removed or re-parented.

### 4.5 The sync nudge

Raw mutation bumps no version (§2 fact 4), so after a batch of writes we register a throwaway entry into `sidebar.panellist` and dispose it immediately. Both operations mutate the ledger and notify subscribers, so the shell re-reads `order` and `label`. The nudge is coalesced to at most one per microtask-batch of changes. It uses only public service methods; calling the ledger's internal mutation hook directly would be shorter but strictly more fragile.

**A nudge is owed by the plan, not by the write.** The pass compares a digest of everything the shell renders a row from — `order`, `label`, `icon`, `hidden`, `suppressed`, per panel and per group (`renderingDigest` in `registry/rail.tsx`) — and nudges whenever that digest moved, even if the pass had no field to write. Otherwise an edit that only changes what our own wrapper reads (a second built-in icon on a panel that already has one, a rename resolved by the already-installed label thunk) would leave the ledger untouched: no mutation, no re-render, and the rail would keep the previous glyph or text while the settings preview showed the new one. The FIRST pass of a mount is the exception — the digest is only remembered, never acted on, because a fresh install must stay a strict no-op (README §2.10).

---

## 5. Group rows and the flyout

A group is a **real registration of ours** into `sidebar.panellist`:

- `id` and `main` key: `dsh-panellist:group:<groupId>`;
- `order`: the group's position in the sequence, so the shell's own sort places it — no portal, no flex `order`, no insertion logic;
- `label`: the group trigger name (empty override → the first member's effective name), which the shell renders into the row and reuses as the accessible name and the collapsed tooltip;
- glyph component: our `GroupGlyph`.

Because the row is a native row, box geometry, hover background, `aria-current` styling, the collapsed 56 px rail and the Windows-titlebar cases all come from the shell (§2 facts 7, 9, 10).

**Whole-row click.** The row is a single `button`, so we must not nest another interactive element inside it. `GroupGlyph` therefore installs a capture-phase `click` and `keydown` listener on its ancestor button (`ref.current.closest('button')`), calls `preventDefault()` + `stopPropagation()`, and opens the flyout. Running in the capture phase on the row itself means our handler wins before React's delegated handler at the root. `aria-haspopup="menu"` is set on the row while mounted and removed on dispose.

**The `main` page is insurance.** Click interception means `selectPanel(groupId)` should never run; if it does (a programmatic path, a shortcut), the shell would throw without a `main` entry. We therefore register a group overview page under the same key: a simple list of the group's members. It is also reachable deliberately from the flyout's header.

**The flyout** is a body-portal overlay (the ecosystem's `AnchoredPopover` pattern), positioned from the row's `getBoundingClientRect()`:

- opens to the right of the row when the rail is collapsed, below it otherwise; flips on viewport edges;
- keyboard: `Esc` closes and restores focus to the row, `↑`/`↓` move, `Enter` selects; outside click closes;
- each item shows the member's effective icon and name; a member whose `main` key is absent is rendered disabled and labelled as missing;
- selecting a member calls `ctx.layout.selectPanel(memberId)` behind the same `entries("main")` probe the layout uses, so a stale config can never throw across the shell.

**Group highlight.** The shell highlights a row only when `activePanelId === id`, and a group row is never selected, so the trigger would never highlight on its own. Active membership therefore comes from the layout's own public source — `ctx.layout.panelInfo` is a `HostObservable<{ activePanelId }>` (ui-layout `lib/types/client/service.d.ts:26`), read with `getSnapshot()` and followed with `subscribe()` — and the trigger gets `data-dsh-panellist-group-active` while any member is active. The stylesheet styles the row through `:has()` (`button[class*="_panelRow"]:has([data-dsh-panellist-group-active])`), so nothing is written to the shell's own row element. No `aria-current` observer is needed; the layout service is a public reader.

---

## 6. Settings page and its nav marker

The section registers into `settings.section` with id `dsh-panellist`, a late `order`, and the label 「面板列表」/ "Panel list". The shell projects only `id`, `order` and `label` and picks the glyph from its closed list (§2 fact 11), so a `MutationObserver` on `document.body` matches `[role="dialog"] nav button` by `textContent` against our own label, stamps `data-dsh-panellist-settings-nav`, and our stylesheet supplies the plugin glyph. Markers are removed and the observer is disconnected on dispose. If no row matches within a bounded time, the plugin keeps the native gear and reports the failure in its own self-check panel — never an error.

The page itself: sequence editor, per-item overrides (name and icon), group editing, import/export, open-config-file, orphan cleanup, and the self-check status with a re-run button. Its header is text only — an earlier revision rendered a "Done" button there, removed because the shell's settings dialog already owns that action (the X beside the page), and a second control for it was one more thing to keep in sync.

**The sequence editor lists the whole rail, always.** `plan.rows` is every row the rail shows — the configured block first, then the rest in the contributors' own order — and a row's `order` is `null` until something is configured, which is what makes a fresh install write nothing at all (§4.3). Editing the list therefore needs no "adopt this one first" step: the first structural edit materializes the current order, and the per-item actions (move, group, ungroup, hide/show) work on any row from the first open. Hide/show is also available per row in the list, not only inside the appearance editor, because it is the action users reach for most often. The gate itself is invisible: an earlier revision showed a banner plus a "use the current rail order as a starting point" button while nothing was configured, and both were removed on user feedback — the list is the rail in either mode, so the banner only described an implementation detail and the button duplicated what the first drag already does.

**A group member is selectable wherever it is listed.** A member has no top-level row, so the member list inside a group row (and the same list inside the group's appearance editor) is the only way to reach that panel's own name and icon: each member's name is the same select affordance a top-level row carries, and selecting it opens the member's own editor — where the `groupedHint` line says the row is shown inside a group. Before that, everything folded into a group was uneditable.

---

## 7. Self-check and degradation

Four probes, run once per mount and on demand (`src/client/rail/probe.ts`):

| Probe | Method as implemented | On failure |
| --- | --- | --- |
| Registry rewriting is effective | Register a throwaway rail entry, assert the stored entry is not frozen, write `order = 777001` onto it, read it back through `entriesOfSlot`, restore, dispose | Stop all rewriting; plugin becomes read-only |
| Rail rows are locatable and `:has()` is supported | `CSS.supports('selector(:has(*))')` plus a row count using the *same selector the hide rule uses* (`nav[class*="_panelList"] > button[class*="_panelRow"]`) against the ledger's entry count; a rail that is not mounted (hidden sidebar) passes with a stated reason | Keep order/name/icon rewriting, drop hiding, and say so |
| The shell still passes `active` to glyphs | Register a throwaway rail entry whose glyph records its props, wait two animation frames, assert a boolean `active` and a numeric `size` arrived; the throwaway row hides itself with a suppressed marker | Drop the "hidden but active stays visible" rule (a hidden row becomes unconditionally hidden), say so |
| The settings nav row is locatable by label text | When a `[role="dialog"] nav` is open, match a button by our own resolved label; when the dialog is closed, pass with a stated reason (the marker pass re-runs on every open) | Keep the native gear icon, say so |

Any failure sets a degraded state: the settings page shows which probe failed, what is therefore disabled, and the DSH version the plugin measured. Nothing is thrown into the shell's boot path, and no failure is silent.

---

## 8. Host half

| Concern | Approach |
| --- | --- |
| Home resolution | Honour `DSH_HOME`, default `~/.dsh`; a blank value counts as unset |
| Config file | `$DSH_HOME/panellist.json`, written `0600`, via temp file + atomic rename, with a direct-write fallback when Windows holds a lock |
| Profile scope | `DSH_PROFILE` by default; an explicit `?profile=<id>` is honoured only when `$DSH_HOME/profiles/<id>` exists, so a crafted id can never address another profile's section. Reads and writes are confined to that one section |
| Validation | The JSON Schema in [config.schema.json](config.schema.json) is the normative shape, compiled once per process with ajv 2020-12 + formats; the host validates the whole document before every write and after every read. The schema file is located from `import.meta.url` by trying `../docs/` then `../../docs/`, which covers both the source layout and `lib/` |
| Migration | `schemaVersion` steps applied in order on read (`src/shared/migrate.ts`) |
| Corruption | A parse or validation failure copies the file aside as `panellist.json.corrupt-<timestamp>` (once per distinct content, so polling cannot spam backups), serves defaults, and reports it through `/panellist/api/health`. `read()` never throws — even a missing schema file degrades to "serve the migrated document" and records the reason |
| Route | `ctx.webServer.register({ kind: 'prefix', path: '/panellist/api', handler })` behind a loopback + trusted-host fence (see `src/plugin/routes.ts`), registered through `ctx.inject(['webServer'], …)` + `ctx.effect` because the service is optional at this plugin's start |
| Manifest | `dsh.bundle.patch` mounts the row automatically; `dsh.client.{ inject, platform }` declares the client bundles that must load first (locale, ui-slots); `engines.dsh` pins `>=0.2.0-rc.2 <0.3.0-0` |

Endpoints: `GET /config`, `PUT /config`, `POST /config/reset`, `POST /reveal`, `GET /health`. `/reveal` opens the configuration file in the OS file manager (`explorer /select,`, `open -R`, `xdg-open`) and answers `204`; it is file-scoped, so it ignores `?profile=`.

---

## 9. Lifecycle

- Every unit is wired inside `ctx.effect(() => { …; return () => { /* undo */ } }, 'dsh-panellist: <unit>')`, matching the ecosystem's convention (better-sidebar, dream-skin).
- Disposal restores `entry.component`, `entry.options.label` and `entry.options.order` from the captured originals, disposes our group registrations and the group pages, removes the injected stylesheet, strips every marker attribute, unmounts the flyout root, disconnects observers and removes document listeners. Restoration is followed by one nudge, because a restore is a raw write like any other and the shell otherwise has no reason to re-read.
- The rewrite pass is idempotent per plan revision: recomputing from a new plan overwrites the same fields rather than stacking wrappers, and the wrapper is rebuilt from the captured original component, never from a previous wrapper — a wrapper it does find is unwrapped through the page-global registry (§4.2) and claimed, so the pass that no longer needs one restores the contributor's own component instead of leaving ours installed.
- **Every writer compares before it writes, and every generated value is cached per captured registration.** That is not a style preference: an identity-fresh label thunk (or wrapper) would never compare equal, so the pass would report a change on every run, nudge the ledger, and re-enter itself forever. The controller additionally bounds a burst to `CASCADE_LIMIT` recomputations per task and logs a warning, so a future non-idempotent writer degrades to a visible console warning instead of a frozen page.
- The stylesheet is adopted by document id rather than a module-scope cache, because the client bundle can be evaluated twice under HMR (a lesson recorded by `dsh-dream-skin`).
- Config changes apply immediately: write → plan → rewrite pass → nudge → shell re-reads. No restart, no plugin reload, no page reload.
- Late-arriving services are resolved per call, never cached at construction: `ctx.layout` is read on each selection/active query, and the locale service is (re)bound through `ctx.inject(['locale'], …)` so a locale bundle that mounts after this one still drives the settings page's language.

---

## 10. Known risks

| Risk | Blast radius | Mitigation |
| --- | --- | --- |
| DSH re-rolls the CSS-module hash and renames a stable key | Hiding stops working | Stable-suffix matching + per-mount probe + degrade to "no hiding" with a visible notice |
| DSH stops passing `active` to rail glyphs | A hidden active panel loses its row | Probe; degrade that rule only |
| DSH freezes the stored options object | No rewriting at all | Probe; degrade to read-only |
| A writer stops being idempotent (a fresh closure compared per pass) | An endless recompute cascade: the page stops responding | Every generated value is cached per captured registration, every write is compare-first, and the controller cuts a burst at `CASCADE_LIMIT` passes with a console warning |
| Another plugin hides or moves the same rows (e.g. a mobile-adaptation plugin) | Conflicting presentation | We only write to rows the plan says to write (§4.3); a plugin row the user never touched is never modified |
| A member of a group is uninstalled | A dead menu item | Orphan detection marks it missing and disables selection; config is preserved |
| Two group ids collide, or a group id equals a plugin panel id | Selection lands on the wrong page | Group ids live in the reserved `group:` namespace, the schema enforces the pattern, and the model rejects a collision before writing |
| A user pastes a hostile SVG | Script execution inside the app | Allow-list sanitiser on write and on read, 64 KB cap, inline render with no external references |
