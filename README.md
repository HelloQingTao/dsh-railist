# dsh-railist

**English** | [中文](#中文)

---

## English

The left-column manager for the DSH (DeepSeek Harness) client — the whole left column, not just one seat of it.

The left column is where each plugin puts its own entry: the panel list (plugins, automation tasks, skill center, memory system, SSH, MCP connectors…), the footer action row above Settings, and the Settings seat itself. They come from different plugins, each declares its own `order`, and each decides its own icon and name.

This plugin lets the **user** take over: which rows appear, in what order, **which seat they sit in**, what they are called, what icon they use, and which entries are folded into a Group. All configuration is done in a new tab in Settings, and changes take effect immediately.

> Status: **implemented**. This README is the whole specification — there is no separate design document: behaviour is §2–§3, the configuration and the interfaces are §4, the compatibility contract is §5, how to install it is §6, and how it is built is §7. The normative configuration shape is [`docs/schema/config.schema.json`](docs/schema/config.schema.json).
>
> **`dsh-railist` is a fork of [`dsh-panellist`](https://github.com/qwq1999/dsh-panellist)**. Upstream manages the panel list (`sidebar.panellist`) alone; this fork extends it to a **unified sequence spanning more than one seat** (the panel list and the footer action row), drag-and-drop reordering, per-row plugin name and version, and a "not shown" annotation. See [Differences from upstream dsh-panellist](#differences-from-upstream-dsh-panellist).
>
> Three refinements to the original design (all discovered during implementation and backfilled into this document): the rail id of a Group is `dsh-railist:<groupId>`; unconfigured Panel entries are always listed on the rail, but an `order` is written only once the Sequence is non-empty (i.e. after your first structural change); and the `/railist/api/reveal` endpoint was added to implement "Open config file".

### Screenshots

| Settings → Panel list | A Group menu on the rail |
| :-: | :-: |
| ![Settings → Panel list](docs/images/settings-panel-list.png) | ![A Group menu on the rail](docs/images/rail-group-menu.png) |

---

### 1. Why it is needed

The DSH left column is a **read-only projection**: the shell enumerates the registrations in the `sidebar.panellist` slot and renders them sorted by the order **each item reported at registration time**. No official API is provided for rewriting someone else's registration:

- Order is read-only — a plugin can only decide the `order` of its own item;
- There is no concept of a "Group" — one row is one Panel entry;
- There is no concept of *moving* a row: the shell sorts **one slot at a time**, so no `order` value can carry a row from one seat (the panel list) into another (the footer action row);
- The icon is decided by the component the contributor provides, and the name is decided by the contributor's `label`;
- The icon of the Settings navigation tab can only be picked from a list built into the kernel.

So this plugin has to use **three** levers at the same time, and keep each of them as small as it can be:

1. **Registry rewrite** — rewrite the order, name and icon component on the registration at runtime (the registration object is not frozen and is handed back by the slot registry, so a post-hoc write is visible to the shell); this plugin's changes do not touch any plugin's own page.
2. **Minimal DOM/CSS reprojection** — two things cannot be done through the registry alone: taking a row off the rail, and moving it into another seat. Hiding is one declarative `:has()` rule (§7.3); the cross-seat move is a physical move of the row element (§7.6). Group rows are registrations too (registered by this plugin), so their row box, highlight, tooltip and collapsed-state behavior still come from the shell; the popup menu is an overlay and does not modify native rows.
3. **Native seats stay native** — the Settings seat is never taken over, because that row's own `children` table is what declares the `settings.section` slot every plugin's settings page registers into (§2.12).

---

### 2. Behavior spec (confirmed)

#### 2.1 What it manages

- **All** registrations in the managed seats are treated alike: kernel-shipped items (plugins, automation tasks, skill center, memory system, SSH, MCP connectors) and items registered by third-party plugins can all be managed.
- **Two seats are managed**: the panel list (`sidebar.panellist`) and the footer action row (`sidebar.footer.action`). The Settings seat (`sidebar.settings`) is never managed — see §2.12.
- This plugin's own settings tab is not in either managed seat, so it is not managed.
- Real Panel entry ids are discovered at runtime and are not hard-coded; the ids in this document's examples are illustrative only.

#### 2.2 Sequence model

The Sequence is a series of **ordered items**, each of which is either a **single Panel entry** or a **Group**:

- The Sequence is **one list spanning both managed seats**: a row's position in it is what decides the seat it ends up in (§2.11), so the list on the settings page reads top-to-bottom exactly as the left column does;
- Each Panel entry appears **exactly once** in the whole Sequence (the Sequence is a partition of the set of Panel entries, with no duplicates);
- A Group itself occupies one position in the Sequence and contains an **ordered** subset of Panel entries;
- **Only one level** of nesting is allowed (a Group cannot contain another Group);
- An empty Group is invalid; a Group with only 1 item is allowed, but the management panel warns about it.

The design conversation settled the notation this way (`G{…}` = one Group):

| Notation | Interpretation |
| --- | --- |
| `a c b d e` | `[a][c][b][d][e]` |
| `a b c` | `[a][b][c]` |
| `a dropdown(b c d e)` | `[a][G{b,c,d,e}]` |
| `a dropdown(b d e c)` | `[a][G{b,d,e,c}]` |
| `a dropdown(b e c)d` | `[a][G{b,e,c}][d]` |
| `dropdown(a b c)d e` | `[G{a,b,c}][d][e]` |

#### 2.3 Shown / Hidden

- There are only two states: **Shown** / **Hidden** (there is no third "disabled" state).
- Hidden = it no longer appears on the rail, but the Panel entry itself still exists and is still usable (it can be selected from the management panel, and activated by other plugins or keyboard shortcuts), and the functionality of the plugin it belongs to is unaffected.
- Exception: **if a Hidden Panel entry is currently active, its row is shown temporarily** — avoiding the case where "the user is still on this page, but the rail has no entry for it".
- **Members of a Group can be hidden too**, where "hidden" means "left out of the Group menu": a member's rail row is already suppressed by the Group, so for a member hiding only affects the flyout. The member stays in the Group — the count, the ordering and the Group trigger highlight all still see it.
- **A missing member is left out of the Group menu automatically** (its registration is gone, and a disabled "missing" row in the menu only took up room the user cannot act on). It stays in the configuration and in the settings page's "missing panels" list, waiting to be cleaned up.

#### 2.4 Label override

- A pure display-layer override, affecting only three places: the text of the rail row, the tooltip text in the collapsed state, and the accessible name.
- It does not change same-name displays elsewhere in DSH (Settings, command palette, etc.), and does not change the original name declared by the contributor.
- The first version is a **single string**, effective for all languages.

#### 2.5 Icon override

Three sources, and you can switch back to the original icon at any time:

1. **Keep the original icon** (default);
2. **Built-in icon set** — 24 inline vector glyphs shipped with this plugin (zero dependencies, usable offline). They are drawn to the spec the icons beside them in the rail are drawn to — the **`Icon*OutlineRegular`** weight: `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"` at **1px**, geometry on the 16 grid at half-step coordinates inside roughly 2…14, round caps and joins, `aria-hidden`, no ids and no external references. Three of them are the shipped artworks of the rail's own defaults, so a panel given one of them looks identical to the entry it replaces: `puzzle` is the plugin pinwheel (`IconPluginPinwheelOutline`), `clock` the clock (`IconClockOutline`), `more` the ellipsis (`IconEllipsisOutline`). The set is checked mechanically at 16px next to those shipped artworks, and its ink extents are measured against them;
3. **User-uploaded icon** — paste SVG source;
   - Allowlist sanitization: removes `script`, `foreignObject`, event attributes, and external references (cases where `href`/`xlink:href` point outside);
   - A single SVG is capped at **64 KB**;
   - Inline rendering (not `<img>`), so it follows the theme's colors.

The **settings navigation row has its own dedicated glyph** (a panel list, at the heavier `Icon*OutlineMedium` 1.3px weight that column is drawn at) — see §7.5.

#### 2.6 Groups and Group triggers

- A Group trigger has its **own** icon and name; by default they are pre-filled from the icon and name of the "first item in the Group" (a common name is "More"), and the user can change them. When no name is set, the trigger text is resolved from the first live member at render time — nothing is baked into the config.
- The Group trigger's **whole row is clickable**, and clicking it expands the Group menu; a whole-row click is always used to expand the menu and never navigates to a page. The menu lists the Group's members and nothing else: an "Overview" link to the Group's own page used to sit in its title row and was removed on user feedback. That page still exists as the Group's `main` fallback (so selecting the Group id programmatically cannot error) but has no entry point of its own.
- When any item in the Group is active, the **Group trigger is highlighted**, so the user can tell which Group the current page is in without expanding the menu.
- When a Group is created, it is inserted at **the original position of its topmost member** — that is, the Group "grows" where its members already were. The model guarantees this (`createGroup` anchors on the *identity* of the row above the topmost member), so it holds for any gesture.

#### 2.7 Group menu

- **Opens on click** (not on hover, to avoid accidental activation).
- Lists the members the user can act on: a member that is hidden (§2.3) or missing is left out, and a Group whose members are all hidden says so instead of showing an empty card.
- Keyboard accessible: `Enter`/`Space` expands, `Esc` closes, and the up/down arrow keys move within the Group.
- When the sidebar is collapsed into the 56 px rail, the menu always **flies out to the right** (flyout).
- The menu scrolls when the number of items in the Group exceeds the visible height; the first version does **not** do an in-Group search box.

#### 2.8 Unconfigured items, missing items and "not shown" rows

- A newly installed plugin registers a Panel entry you have not touched yet → it is **listed in the sequence straight away** (after the configured entries, arranged by its own order); there is nothing to opt into first.
- The contributor of a Panel entry is uninstalled while the config still holds it → the config is **kept**, the management panel marks it **`missing`**, and offers a "Clean up missing" button.
- A row that **is registered but currently renders no element at all** on the rail gets a **`not shown`** badge (Chinese UI: **`当前未显示`**). This is a *different* fact from `missing`: a missing row has no registration answering at all, while a not-shown row has a live registration whose own component happens to return nothing right now — a footer entry that only shows itself while its feature is switched on, for example. Such a row is **kept in the list and never filtered out**: a row the user cannot see is still a row the user has to be able to reach, and its own setting is usually what turns it back on.
- Until you make a STRUCTURAL change (a drag, creating or dissolving a group), this plugin writes **no order at all**: the rail keeps the order its contributors chose. A rename, a re-icon or a hide only overrides that one entry and leaves the order alone — which is what "we do not touch what you did not ask us to touch" means in practice.

#### 2.9 How a change takes effect

Config changes **take effect immediately**: no need to restart DSH, no need to reload any plugin, and no need to reload the page. That holds for *every* edit, including the ones that write nothing at all: the rewrite pass compares a digest of everything the rail renders (order, name, icon, shown/hidden, suppressed) and re-projects when it moves, so a second icon pick or a second rename lands on the rail just like the first one did. A change that moves a row into another seat is applied by the placement pass (§7.6), which runs after the registry writes settle.

#### 2.10 Scope of takeover

The management panel **lists the whole left column from the first time it is opened**: there is nothing to "adopt" before you can touch a Panel entry, and there is no "not taken over yet" list. (An earlier design had a "not configured" list with per-item take-over / release buttons; it was removed on user feedback — it only added a step. A banner plus a "use the current rail order as a starting point" button went the same way: the list is the rail either way, so the gate is invisible.)

What still holds is the **minimal-intervention property in what gets WRITTEN**, not in the UI:

- The config's `sequence` is **partially authoritative**: it records only what you actually changed.
- A `sequence` that is empty means **no `order` is written at all** (the state right after installation, a pure no-op — and no row changes seat either), and an unconfigured Panel's name/icon/hidden state is left entirely alone; it keeps the contributor's own order.
- Your first structural change (a drag, a merge into a Group) writes the current order out as an explicit sequence; unconfigured entries stay after the configured block in their own native order (§2.8).
- **Seat resolution is part of the same rule**: it only runs once the sequence is non-empty, so an untouched install never moves a row between seats.

Implementation (`src/shared/model.ts`): `rows` is always the whole rail (an unconfigured row's `order` is `null`, meaning "do not write"), while `reordering` decides whether an `order` is written at all — and whether the seat pass runs.

#### 2.11 Seat rule: which row ends up where

This fork's central extension. A row's seat is no longer fixed at registration: **a drag can move the row you dragged into the other seat**, resolved by one rule:

> **Only the row you drag changes seat. Every other row keeps the seat its contributor gave it.**

Details that matter in practice:

- **A drag only ever moves the row you dragged.** The dragged row takes the seat of the nearest row above it that did not move; if no such row has a seat, it keeps its own. Nothing below it is re-seated.
- **Seats are what a drag *decides*.** Dragging the capability panel directly under Usage statistics puts it in the **top** seat (because Usage statistics is a top row); dragging it above every row keeps it in its own **footer** seat. A Group dragged into the footer is placed in the footer too.
- **Why the rule is this narrow.** An earlier version applied "take the seat of the row above" to *every* row, so one drag re-seated the whole run below it: a footer row dropped at the top turned the first top row below it into a footer row, and so on down the list. Rows whose seat flipped like that were placed into a host the shell does not render and left the rail entirely — the sidebar went blank. Restricting the change to the dragged row makes that cascade impossible, because a row that did not move is never the reason the next row moves.
- **The model is told which row moved.** `buildPlan` takes the dragged row's id; it cannot infer it from the sequence, because a row can be dragged to a position its contributor seat already implied. With no id the sequence alone never re-seats anything, so loading a config or a plain reorder disturbs no seat.
- **Order within a seat is a separate, within-seat counter.** The `order` value written to the registry is a per-seat sequence (0, 10, 20 …), never the global list position: the shell sorts one slot at a time, and handing it global keys would leave gaps — and therefore odd spacing — in every seat.
- **Domain of the model**: the model still carries a `settings` container so a plan *can* express "the settings row belongs here", but that seat is never rewritten and never moved (§2.12).

#### 2.12 `sidebar.settings` is never taken over

The Settings seat is deliberately **not** managed — not by the sequence, not by the placement pass, not by the rewrite pass. The reason is structural rather than aesthetic: `sidebar.settings` holds the shell's own Settings row, and **that row is what declares `settings.section`** (the settings dialog's content slot) through its own `children` table. Managing it as just another movable row breaks that declaration — the slot becomes "not declared", every plugin's settings page fails to register, and the dialog's whole content column renders empty.

So: the settings row stays native, keeps its own position and its own gear glyph, and a plan that mentions the `settings` container is simply never applied to it. A registration aimed at that seat is refused outright.

#### 2.13 One live mount per page

The shell may apply a client bundle more than once on one page (it re-evaluates a bundle whose file changed, an HMR pass re-applies it). Two controllers over one ledger fight: the second one captures the first one's glyph wrappers as if the contributors had installed them, and both write the same entries. `apply` therefore retires the previous mount before building its own (`src/client/mount.ts`), and every wrapper this plugin installs is recognisable, so an entry still holding one is unwrapped rather than adopted (§7.2).

---

### 3. Settings tab

Adds one item to the left side of the Settings dialog:

- Name: **Panel list** (`面板列表`); position: near the end of the settings navigation (order 100);
- Icon: **its own glyph** — a panel list drawn at the `Icon*OutlineMedium` (1.3px) weight every other row in that column is drawn at, painted over the kernel's fallback gear as a `currentColor` mask. The settings navigation has no icon field in its contract, so the row is located by its visible text and marked; if that probe fails, the native gear stays (without reporting an error). See §7.5.
- The page has **no "Done" button**: the dialog already owns that affordance (the X beside the page).

Page content:

#### 3.1 Sequence editor

- Lists the whole left column — every Panel entry of both managed seats from the first open, with nothing to adopt first. The list order **is** the column order, so the top of the list is the top seat and a row dragged past a seat boundary changes seat (§2.11).
- **Drag and drop is the primary channel.** Drag a row **onto another row** to reorder it (the top/bottom third of the target places it before/after), **onto a Group row** to join that Group (its middle band), **out of a Group onto the list** to leave it, and **onto the gap under the last row** to send it to the end.
- The **grab handle** (`⠿`, on the left of every row and every member) is the **only draggable node** — the row itself is not draggable, so Select / Hide / Ungroup stay mis-touch-proof — and it is also the **keyboard control**: focus it and press `↑` / `↓` to step the row one position (the member list inside a Group behaves the same). There are **deliberately no Move up / Move down buttons**: the handle carries the same capability, and a button pair per row was two more tab stops per entry for an action the arrow keys already cover.
- Each row's **"Group with next"** creates a Group; a Group row's **"Ungroup"** dissolves one.
- Every row carries a **"Hide"/"Show"** button that toggles that row in place — Group rows included, and the **member rows inside a Group** too (a hidden member leaves the Group menu, §2.3).
- Each row shows **badges** for its state: `Hidden`, the member count of a Group, `missing` (§2.8) and **`not shown` / `当前未显示`** (§2.8) — a registered row that currently renders nothing.
- Each panel row shows a **contributor subtitle** next to its name — the plugin's package name and version (§3.8). A row nothing is known about renders nothing at all: no dash, no "unknown".
- Clicking a row's name opens that row's appearance editor (§3.2), including a Group's members, which have no row of their own.

#### 3.2 Appearance override for an item

- **Name**: a single string override (§2.4).
- **Icon**: keep the original / the built-in set / paste SVG (§2.5), with a live preview. Picking a built-in icon previews it at the row's own size, and the preview for "keep the original" shows the contributor's real component.
- Visibility is the per-row **"Hide"/"Show"** button in the sequence list — one entry point, not two.
- A panel shown inside a Group says so here, so it is obvious why its rail row is not on the rail.

#### 3.3 Group editing

- The Group trigger's name and icon.
- The ordered member list: move a member up/down, take it out of the Group, hide or show it.

#### 3.4 Config import / export

Import validates the document before writing it; export serialises the whole file (all profiles) to the clipboard. A failed import reports the field-level reason and changes nothing.

#### 3.5 Open config file

`POST /railist/api/reveal` opens `$DSH_HOME/railist.json` in the system file manager. The path is also printed next to the button. **Reset to defaults** reverts this profile's configuration after an inline confirmation.

#### 3.6 Missing panels

Configured ids with no registration are collected here with a count, and **"Clean up missing"** removes them — after an explicit confirmation, never automatically.

#### 3.7 Self-check status

The result of the **five** startup probes (§5) with a **"Re-run self-check"** button. A failed probe shows what it measured, what is therefore disabled, and the DSH version the plugin measured.

#### 3.8 Contributor subtitle (plugin name and version per row)

Each panel row shows which package contributed it and at which version (`name · v1.2.3`).

- **Where the answer comes from**: the host half reads **the profile's own files** — `$DSH_HOME/profiles/<id>/cordis.patch.yml` for the composition row id → package name, and the same directory's `package.json` for `dependencies` → version — and serves them on `GET /railist/api/plugins` (`src/plugin/plugins.ts`). Nothing is fetched from the network.
- **Version normalization**: a tarball URL or `#<sha>` fragment becomes its 7-character sha; `git+` / `github:` / `https:` dependencies have no release version and report none; `workspace:` / `link:` / `file:` / `portal:` / `npm:` dependencies are local paths, not versions, and report none; a plain range drops its operator (`^0.1.6` → `0.1.6`).
- **Formatting** (`src/client/settings/sourceLabel.ts`): the npm scope is dropped (`@scope/name` → `name`), names over 32 characters are middle-truncated, and a version longer than 24 characters is dropped. The full, untruncated text is in the element's `title`.
- **Fault tolerance** (`src/client/settings/pluginInfo.ts`): one read per page mount, no polling, and *no* failure mode — a non-2xx answer, a malformed body, a network error or a shell without `fetch` all mean "nothing is known about any panel", and the rows render exactly what they rendered before the feature existed.

---

### 4. Config and interfaces

#### 4.1 Location and scope

- File: `$DSH_HOME/railist.json` (permissions `0600`, written as "temp file + atomic rename", falling back to a direct write when a Windows file lock conflicts);
- Scope: **separated per profile** inside the same file, because different profiles have different plugins installed;
- Migration: the config carries a `schemaVersion` (currently **2**), and an older version is migrated as needed when read;
- Corruption: on a parse failure the **original file is backed up** as `railist.json.corrupt-<timestamp>` and defaults are restored, without silently discarding content the user has hand-edited.

#### 4.2 Config shape (illustrative)

```json
{
  "schemaVersion": 2,
  "profiles": {
    "web": {
      "sequence": [
        { "type": "entry", "id": "plugins" },
        {
          "type": "group",
          "id": "group:work",
          "label": "更多",
          "icon": { "kind": "original" },
          "members": ["schedules", "skills", "memory"]
        },
        { "type": "entry", "id": "ssh" }
      ],
      "entries": {
        "plugins": { "label": "插件市场", "icon": { "kind": "builtin", "name": "puzzle" } },
        "mcp-connector": { "hidden": true }
      },
      "meta": { "updatedAt": "2026-10-10T03:00:00.000Z" }
    }
  }
}
```

The authoritative definition is [`docs/schema/config.schema.json`](docs/schema/config.schema.json) (JSON Schema 2020-12; the host validates the whole document with ajv before every write and after every read, and `tests/shared-schema.spec.ts` runs this very example through it). `sequence` is a **partial** authority: the items it lists follow this order, and items it does not list are appended to the end by the program. A row's **seat** is not stored anywhere — it is derived from the row above it (§2.11), so it is a consequence of the sequence rather than a field of it.

#### 4.3 Interfaces this plugin occupies

| Purpose | Identifier |
| --- | --- |
| Settings navigation tab | `settings.section` id = `dsh-railist` |
| Group row (rail) | `sidebar.panellist` id = `dsh-railist:<groupId>`, for example `dsh-railist:group:work` |
| Group page (`main` fallback, so selecting the Group id cannot error) | `main` key = the same string |
| Host-half local route | `/railist/api` |

Host-half routes (reachable only via local loopback, with a trusted-host fence):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/railist/api/config?profile=<id>` | Read the config for that profile |
| `PUT` | `/railist/api/config?profile=<id>` | Write the whole thing (server-side validation + atomic write to disk) |
| `POST` | `/railist/api/config/reset?profile=<id>` | Revert to defaults |
| `POST` | `/railist/api/reveal` | Reveal the config file in the system file manager (the "Open config file" button) |
| `GET` | `/railist/api/health` | Config storage and field-level self-check status |
| `GET` | `/railist/api/plugins` | Which package and version contributed each panel (§3.8) |

`?profile=` only accepts ids that actually exist under `$DSH_HOME/profiles/<id>`; without the parameter, the config is written to the host's own profile (`DSH_PROFILE`, else `default`). `/health`, `/reveal` and `/plugins` are whole-file level and ignore the parameter. Request bodies are capped at 2 MB.

Export contracts of the two halves (consistent with the ecosystem):

- Host half: `name`, `inject`, `apply(ctx, config?)`
- Browser half: `apply(ctx)`, `inject`
- Manifest: `dsh.bundle.patch` (auto-mount) + `dsh.client.{inject,platform}`

#### 4.4 Shell facts this plugin is built on

None of these is a public contract, so each one is measured at startup (§5) — but they are what the implementation assumes:

| Fact | Where it comes from |
| --- | --- |
| `sidebar.panellist` is a `list` slot, declared by the **sidebar entry's `children` table**; registering into an undeclared slot throws | the sidebar's own registration; the slot registry's `register()` |
| A stored entry is a plain object (`{component, options}`), never frozen; `entries`/`entriesOfSlot` hand that object back | the slot registry's `register()` |
| A raw field write on a stored entry (**including `entry.component`**) is visible to the next projection, but bumps no ledger version and notifies nobody | the registry + the batch notification channel |
| `register`/dispose *do* mutate the ledger and notify subscribers — that is what the nudge (§7.2) rides on | the registry's mutation channel |
| The shell renders a row's text as `resolveSlotLabel(options.label) ?? id`, so a label-less registration already shows its id | the sidebar's renderer |
| The row glyph is rendered with `{size, active}`; `size` is 16 (18 when the rail is collapsed) | the sidebar's `renderSlot("sidebar.panellist", {size, active})` |
| **Each seat is its own container**, and the shell sorts one slot at a time — so only a physical move can carry a row between seats | the sidebar's per-slot rendering |
| The seat containers are findable by a **stable class-name suffix** (`_panelList`, `_footerActions`) and carry a `data-slot` anchor of their own; the `top` seat's anchors sit INSIDE each row, the `footer`'s sit AROUND theirs | the sidebar's own markup |
| An element moved **out of** the subtree a component owns is no longer touched by React reconciliation; moving one between siblings of the SAME container *is* undone | React reconciliation |
| The shell stamps **no id** on a rail row: the registration id has to be read off the React fiber chain (`PanelRow.props.id`, or a `RootEntry` fiber's `entry.options.id`) | the sidebar's row components |
| CSS-module class names are `_<buildHash>_<stableKey>`; an active row appends `_panelActive`, so `[class*="_panelRow"]` matches but `[class$="_panelRow"]` does not | the sidebar's stylesheet |
| `ctx.layout.panelInfo` is a `HostObservable<{activePanelId}>`, and `ctx.layout.selectPanel(id)` throws for an id with no `main` entry | the layout service's public reader |
| The `settings.section` contract has **no icon field**; the shell picks the nav glyph from a closed list by section id (`Icon*OutlineMedium` at size 16) | `dsh-client-ui-settings-general`'s `navIcon(id)` |

---

### 5. Compatibility, self-checks, and degradation

**Version floor**: `engines.dsh: ">=0.2.0-rc.2 <0.3.0-0"` (matches the kernel version used for development; the type packages are available on npm at the same version, so contract drift is caught at compile time).

This plugin depends on several **internal** facts about DSH (none of them a public contract), so it self-checks each one at startup — **five** probes:

| Internal fact relied on | Consequence when it breaks | How it is probed (`src/client/rail/probe.ts`) | Degradation |
| --- | --- | --- | --- |
| The slot registration object is not frozen, so `order`/`label`/icon component can be rewritten afterwards | Order, name, and icon cannot be changed | Temporarily register a probe row, rewrite its `order`, and read it back through `entriesOfSlot`; also check that neither the object nor its `options` is frozen | Disable rewriting, read-only |
| The DOM structure of a rail row can be located, and CSS supports the `:has()` selector | The "hidden" state stops working | `CSS.supports('selector(:has(*))')`, plus counting rows with **exactly the same** selector as the hiding rule and comparing the count against the number of rail registrations (when the rail is not mounted, this counts as a pass with the reason stated) | Disable hiding (keep the other rewriting), show a read-only notice |
| The shell still passes "is active" to the icon component (a hidden active Panel entry needs it) | A hidden active Panel entry cannot show its row temporarily | Temporarily register a probe row and wait two frames to confirm that its icon component really is rendered and that the `active` it receives is a boolean | That rule fails: hiding becomes unconditional hiding |
| The settings navigation button can be located by visible text | The settings tab icon cannot be replaced | When the dialog is open, match this plugin's own row by text; when it is not open, this counts as a pass with a note (marking is re-run by a `MutationObserver` on every open) | Keep the native gear icon |
| **The two managed seat containers can be found in the DOM** (`seats`) | Rows cannot be moved between the panel list and the footer; ordering inside a seat still applies | Ask the DOM half whether it can locate a container for each managed seat; report which ones are missing and which were found (a build with no DOM half at all skips this probe and passes) | Rows stay in the seat their contributor registered them into |

- **The probes wait for the rail slot to exist before measuring.** `sidebar.panellist` is declared by the sidebar entry's children table and this plugin can mount before it; registering a probe row then is refused, and that one refusal is what read-only keys off. The run waits on the shell's own "run this when the seat exists" seam (`slots.inject`) first, bounded at 5 s, so a boot-order race can never park the plugin in read-only. A shell that never declares the slot is reported honestly after the wait.
- If any self-check fails → **degrade to read-only**: no further rewriting is done, the top of the management panel gives a clear notice (which item failed, what it affects, and how to report it), and the "Re-run self-check" button is kept.
- It never silently half-breaks, and never blocks plugin loading (the UI is still usable after a DSH upgrade).
- Known uncertainty: DSH's style class names are **build hashes** and are re-rolled at release time. So selectors always match on a "stable suffix" (for example `[class*="_panelRow"]`, measured to work; `[class$="_panelRow"]` fails on the active row), and probing is repeated on every mount.

---

### 6. Installation and development

#### User installation (after release)

```bash
dsh plugin --profile web add dsh-railist
```

The package manifest declares the auto-mount layer, so there is no need to hand-edit the profile config.

#### Local development (current stage)

```bash
# In the root of this repository
pnpm install
pnpm build

# Mount this repository into the web profile via link (DSH must be fully closed first)
dsh plugin --profile web add link:D:/Documents/Projects/usableProjects/github_use/dsh-railist

# Development loop
pnpm watch      # tsdown --watch, rebuilds the browser half, hot-loaded by client HMR, no page refresh needed
```

Note: `link:` does not install this repository's own dependencies, so run `pnpm install` first; DSH must be fully closed while the profile is being edited.

**Rollback** (taking the plugin out of the profile):

```bash
dsh plugin --profile web remove dsh-railist
```

If the uninstall is not clean, edit `$DSH_HOME/profiles/web/package.json` directly: delete `dsh-railist` from `dependencies` and the same-named string from `dsh.profile.bundles`, then delete `node_modules/dsh-railist`. The config file `$DSH_HOME/railist.json` is the only external state, and deleting it restores the factory state.

Disabling or uninstalling the plugin leaves no residue: the order/`label`/component of registrations are restored, every row this plugin moved between seats is put back where it came from, Group rows are released, the injected stylesheet is removed, and all marker attributes are cleared (`dispose` in `src/client/controller.ts`).

#### Quality gates

```bash
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run (jsdom)
pnpm build      # tsc (declarations only) + tsdown (host half + browser half)
pnpm check      # all of the above
```

Tests cover four areas: the **model** (normalization, serialization, migration, and corruption fallback for Sequence/Groups/overrides, **seat placement under the "nearest row above" rule**, and the unconfigured case that must move nothing), the **management panel interactions** (drag-and-drop reordering, the grab handle's arrow keys, icon selection, SVG sanitization, import and export, member hiding, the `not shown` annotation, and the contributor subtitle), the **DOM half** (placing rows into the right seat container, moving a row between the panel list and the footer, restoring every moved element on dispose, and the `/plugins` answer being parsed from `cordis.patch.yml` + `package.json`), the **degradation paths** (read-only behavior after each of the five self-checks fails, including the boot-order wait), and the **packaging contract** (the manifest, the mount layer, one source of truth for the schema version and the route prefix). No E2E against the real DSH UI is introduced.

#### Releases (maintainers)

A tag publishes the package, and no machine holds a credential to do it: `.github/workflows/release.yml` authenticates with npm trusted publishing (OIDC) — GitHub mints an OIDC token for that run, the registry trades it for a short-lived publish token, and provenance is attached automatically, so there is no long-lived secret to leak or rotate. The loop is: bump `version` in `package.json`, `pnpm check`, `git tag -a vX.Y.Z`, `git push origin main vX.Y.Z`. CI checks the tag against `package.json` and calls `npm publish` (`lib/` is not committed, so that step is also what produces the published files).

The one-time configuration (the trusted-publisher fields on npmjs.com), the post-release verification checklist, the failure table, and the manual fallback for when OIDC is unavailable are all in **[docs/RELEASING.md](https://github.com/HelloQingTao/dsh-railist/blob/main/docs/RELEASING.md)**.

---

### 7. How it works

#### 7.1 Module layout

```
dsh-railist/
├─ src/
│  ├─ index.ts                # host half entry (re-exports plugin/index)
│  ├─ plugin/                 # host half: config storage, local routes, migration and corruption fallback
│  │  ├─ index.ts             # name / inject / apply
│  │  ├─ store.ts             # file storage: ajv validation, 0600 atomic write, corruption isolation
│  │  ├─ plugins.ts           # /railist/api/plugins: package + version per panel, from the profile's own files
│  │  └─ routes.ts            # /railist/api handlers (loopback fence, five endpoints + reveal)
│  ├─ shared/                 # types and config model shared by the two halves (side-effect free)
│  │  ├─ config.ts            # document shape, containers, built-in icon names, id prefixes
│  │  ├─ model.ts             # buildPlan: Sequence → what each row should write, and which seat (pure function)
│  │  ├─ edit.ts              # Sequence/Group edit operators (pure functions, keeping the "exactly once" invariant)
│  │  ├─ migrate.ts           # schemaVersion migration framework
│  │  ├─ validate.ts          # lenient reading on the browser half
│  │  └─ protocol.ts          # route paths and cross-half JSON shapes
│  └─ client/                 # browser half
│     ├─ index.tsx            # apply(ctx): assembly order, styles, self-checks, language
│     ├─ controller.ts        # the single loop of config → plan → rewrite / place / Group rows
│     ├─ contracts.ts         # frozen interfaces between units
│     ├─ ctx.ts               # type augmentation only: ctx.slots / ctx.layout / slot declarations
│     ├─ styles.ts            # the single injected stylesheet (aggregates each unit's CSS block by id)
│     ├─ mount.ts             # one live mount per page: a second apply retires the previous one
│     ├─ service.ts           # fault-tolerant reading of optional cordis services
│     ├─ config/store.ts      # config state: optimistic apply, rollback on failure, import/export
│     ├─ i18n/index.ts        # Chinese and English entries (the key set is closed)
│     ├─ registry/rail.tsx    # registry discovery + rewrite + sync nudge + our own rows + the seat map
│     ├─ rail/css.ts          # the DOM rules (hiding, settings-nav mask) in one place
│     ├─ rail/dom.ts          # the placement half: moving a row element into the seat the plan gives it
│     ├─ rail/probe.ts        # the five self-checks and the degradation decision
│     ├─ groups/              # Group trigger rows, capture-phase click interception, menu, group page
│     ├─ settings/            # settings tab: sequence editing, appearance, plugin info, config, self-checks
│     └─ icons/               # 24 built-in glyphs + the settings-nav glyph + SVG allow-list sanitization
├─ docs/                      # documentation assets
│  ├─ images/                 # README screenshots
│  ├─ RELEASING.md            # the release runbook (tag → CI)
│  └─ schema/config.schema.json  # normative config shape (read by the host at runtime)
├─ tests/                     # the suite: model, host half, rewriting and placement, mount guard, probes, groups, settings, icons, copy consistency, packaging contract
├─ cordis.patch.yml           # auto-mount layer
├─ .github/workflows/release.yml  # a tag publishes (npm trusted publishing / OIDC)
└─ README.md                  # English and Chinese (this file)
```

#### 7.2 The rewrite pass and the nudge

`registry/rail.tsx` reads the rail slots, captures each entry's original `order`/`label`/component the first time it sees it, and writes only what differs. Three consequences are worth knowing:

- **Compare before write, always.** Every writer compares first and every generated value (the label thunk, the glyph wrapper) is cached per captured registration. That is not a style preference: a fresh identity on every pass would never compare equal, so the pass would report a change, nudge, and re-enter itself forever. The controller additionally bounds a burst at `CASCADE_LIMIT` (60) passes and logs a warning.
- **A nudge is owed by the plan, not by the write.** A raw field write bumps no ledger version, so nothing re-renders. After a batch of writes the pass registers a throwaway row and disposes it in the same task, which mutates the ledger twice and makes the shell re-read `order`/`label`. An edit that changes only what our own wrapper paints (a second built-in icon on a panel that already has one, a rename resolved by the already-installed thunk) writes no field at all — so the pass also compares a **digest of everything the rail renders** (order, label, icon, hidden, suppressed; panels and groups) and nudges when it moves, even with nothing to write. The first pass of a mount only remembers the digest, so a fresh install stays a strict no-op.
- **Our wrappers are recognisable.** A wrapper renders the hide marker instead of a glyph, and the contributor's component lives only in its closure — so anything reading `entry.component` back can pick up our own wrapper. Every wrapper is registered in a page-global `WeakMap` (wrapper → getter for the captured component); the capture pass unwraps what it finds and claims the slot, and `nativeGlyph` unwraps its answer. Without that, the settings previews of hidden panels and group members showed an empty box.

#### 7.3 The DOM footprint

One stylesheet, injected once and adopted by a document id (`dsh-railist-styles`) so a re-evaluated bundle cannot produce a second copy. Hiding is a single `:has()` rule over `nav[class*="_panelList"] > button[class*="_panelRow"]` — a row whose glyph rendered a marker span disappears. Because the marker is rendered by React, the rule is declarative: no observer, no re-parenting, no layout thrash. `hidden` = "hide unless this row is the active panel"; `suppressed` = "always hide, it is shown inside a Group instead".

#### 7.4 Group rows and their menu

A Group row is a **genuine registration** of ours into `sidebar.panellist`, with its own `main` page under the same key: the shell places it by `order`, renders its `label`, and reuses both as the accessible name and the collapsed tooltip. `sync()` is idempotent — it re-registers only rows whose order or resolved label actually changed, because a needless re-registration would remount a row the user may be interacting with. (A Group the sequence puts in the footer is registered into the footer seat, and the placement pass keeps it there.)

The row is a single `<button>` owned by the shell, so the trigger glyph installs **capture-phase** `click`/`keydown` listeners on its ancestor button: capture runs before React's delegated handler at the root, so one `stopPropagation()` keeps the shell's own `selectPanel` from ever running, and `preventDefault()` cancels the row's default activation. The menu itself is a body-portal overlay positioned from the row's `getBoundingClientRect()`, so it can escape the sidebar's overflow; it is measured before being shown, and it closes on `Esc` or an outside click.

The Group highlight comes from the layout's own public reader (`ctx.layout.panelInfo`), not from the shell's `aria-current`: the shell highlights a row only when the row *is* the active panel, and a Group row never is, so membership drives the highlight instead.

#### 7.5 The settings navigation marker

The `settings.section` contract has no icon field and the shell picks the nav glyph from a closed list by section id, so the row is located by its **visible text**: a `MutationObserver` on `document.body` matches `[role="dialog"] nav button` against our own localized label and stamps the row, and the stylesheet hides the shell's own `<svg>` in that row and paints our masked glyph in front of it. All of it is removed on dispose, and if nothing matches, the native gear stays and the failure is reported through the self-check — never an error.

#### 7.6 The placement pass: moving a row between seats

The registry half can order rows *within* one slot, but the shell renders the seats as separate containers, so no `order` value can carry a row from the footer up into the panel list. That move is physical (`src/client/rail/dom.ts`): the module takes the element rendering a row and puts it into the container of the seat the sequence assigned.

Three facts make it safe (all three verified against a live shell):

1. **A cross-container move survives React.** Reconciliation only corrects positions inside the subtree a component owns; once an element is moved out of that subtree the shell no longer touches it. Moving a node between siblings of the *same* container **is** undone — which is why this module never does that, and why same-seat ordering is left to the registry (doing both would also make the plugin's own observer fire, re-run the pass and move again: the endless loop the shell reports as "recomputation did not settle").
2. **The seat anchors are stable by suffix.** Every class name carries a build hash (`hHd-Xa_footerActions`), so selectors match a stable suffix (`[class*="_footerActions"]`), and the candidate has to contain the seat's own `data-slot` anchor — a plugin that happens to name a class after ours cannot be mistaken for it.
3. **A moved element can be put back exactly.** Every move records the parent and the following sibling it came from, so disposal restores the shell's own layout rather than an approximation of it.

Rows are matched to registrations by walking the **React fiber chain**, because the shell stamps no id on the DOM; the element then carries a `data-dsh-railist-row` stamp, which is what the next pass (and the "not shown" reading, §3.8) reads back. The two managed row shapes need different anchors (both read off a live shell): in the `top` seat the rows are the panel list nav's own `button` children and the id lives in the `PanelRow` fiber's `props.id`; in the `footer` seat the seat's anchor is *around* its rows, so they are the anchor's element children, and the id lives in a `RootEntry` fiber's `props.entry.options.id`.

The pass is deliberately tolerant — an unmounted sidebar, a renamed class or a row that has not rendered yet all mean "nothing to do this pass" rather than an error — and a `MutationObserver` replays it when the shell re-renders. Because the observer callback runs as a microtask *after* the synchronous pass that moved the nodes, the pass **counts the mutations it makes** and the observer drops exactly those, so one placement is never mistaken for a change worth reacting to. A throw can never escape a pass: it would take the whole sidebar's layout down with it, so a failed pass leaves the rows where they are.

#### 7.7 The "not shown" reading and the rail observer

"Does this registered row actually render anything?" is a question only the DOM can answer — a registration is a *promise* to render (a footer entry whose component returns `null` while its feature is off still holds one). The controller therefore reads back the `data-dsh-railist-row` stamps and hands that set to `buildPlan`, which marks every row it does not find as `unrendered`; *no answer at all* (no document, or a sidebar that has not painted yet) means "assume everything renders", so a transient empty rail cannot label every row as not shown. A registered row that is merely hidden still counts as rendered: the shell mounts it and CSS takes it out of the flow, and "hidden" is its own badge.

The rows arrive strictly *after* the page mounts, so a single read cannot be right: guessing from an empty document would claim every row is unrendered, and treating the first empty read as final would never notice the rows that appear later. A `MutationObserver` therefore asks for a recomputation whenever the stamped set **gained** a row — and only then, which is what terminates the loop: a set that merely re-lists the same ids is not news.

#### 7.8 Visual polish: a second, token-only CSS chunk

The settings page's bytes are split into three chunks registered in a fixed order — `settings.css.ts` (base layout), `drag.css.ts` (the sequence editor's own affordances: the grab handle, the drop indicators, the lifted-row state) and `polish.css.ts` (spacing, alignment and state feedback), which is registered last so its rules win where they overlap.

`polish.css.ts` is deliberately colourless: it introduces no colour of its own, no font the shell does not already use, and no shadow the page did not already have. **Every value comes from a shell design token** (`--dsw-alias-*`, `--dsw-radius-*`), each read through a `var(…, <theme-neutral fallback>)` whose fallbacks are `currentColor` mixes and transparent fills — never a light-only or dark-only literal. That is also why the file contains no `@media (prefers-color-scheme)` block: the tokens *are* the theme, and a hand-rolled second palette is exactly what breaks when the shell changes. It respects `prefers-reduced-motion`, draws row actions only on hover/focus-visible (always on with `hover: none`), and tags the `not shown` badge with the shell's *warning* colour rather than its error colour — a switched-off footer entry is informational, not broken.

---

### 8. Differences from upstream dsh-panellist

This repository began as a fork of [`dsh-panellist`](https://github.com/qwq1999/dsh-panellist) and extends it from "manage the top rail" to "manage the left column".

| | upstream `dsh-panellist` | this fork, `dsh-railist` |
| --- | --- | --- |
| Managed seats | the panel list only | the panel list **and** the footer action row |
| Reordering | move up / move down buttons | **drag and drop**, plus arrow keys on the grab handle |
| Seat of a row | wherever its contributor registered it | derived from the row above it (§2.11) |
| Rows that render nothing | not distinguished | `not shown` / `当前未显示` badge (§2.8) |
| Rows that are gone | `missing` | `missing` (unchanged) |
| Contributor info per row | — | package name + version from `GET /railist/api/plugins` (§3.8) |
| Settings seat | not a concern (one seat) | **explicitly never taken over**, and why is documented (§2.12) |
| Self-checks | four probes | **five** (the fifth is seat locatability, §5) |
| Config file | `panellist.json` | `railist.json` (same shape, `schemaVersion` 2) |
| Route prefix | `/panellist/api` | `/railist/api` |
| Group rail id prefix | `dsh-panellist:<groupId>` | `dsh-railist:<groupId>` |
| Settings section id | `dsh-panellist` | `dsh-railist` |

What is **unchanged** from upstream: the two-lever reasoning behind the plugin (§1), the Sequence/Group model (§2.2), shown/hidden semantics (§2.3), label and icon override (§2.4–§2.5), Group triggers and their menu (§2.6–§2.7), the partial-authority config and immediate-apply contract (§2.9–§2.10), the compatibility and degradation contract (§5), and the packaging-manifest contract (§6).

The upstream slot names are still the real ones in the shell, so they are used verbatim here: the rail slot is `sidebar.panellist`, and a number of settings-page class names are kept as `dsh-panellist-settings-*` for continuity. Those are shell/class identifiers, not the product name.

---

### 9. First-version scope and non-goals

**First version includes**: Sequence editing across both managed seats (drag and drop + keyboard fallback), Groups, Shown/Hidden (including inside a Group), Label and Icon override (original icon / built-in icon set / paste SVG), the `not shown` annotation, per-row contributor name and version, config import/export, orphan retention and cleanup, a Chinese and English UI, self-checks and read-only degradation, and this bilingual README.

**Not in the first version** (left for a later one): search within a Group, a right-click context menu on the rail, per-language names, and E2E against the real DSH UI.

**Non-goals**: managing the right-column card tabs; managing the tab order of the Settings dialog itself; **taking over the `sidebar.settings` seat** (§2.12); changing the content of any plugin page; replacing the DSH built-in left column.

---

### 10. Milestones

1. ✅ **Design** — the behavior spec settled with the user;
2. ✅ **Skeleton** — tsdown + tsc + vitest, manifest and auto-mount layer;
3. ✅ **Minimal closed loop** — registry rewrite (order/name/icon/hidden flag) → hiding → settings tab → persistence;
4. ✅ **Groups** — Group trigger rows, the menu, drag-and-drop editing, the Group page;
5. ✅ **Hardening** — the self-checks and read-only degradation, SVG sanitization, import/export, orphan cleanup, bilingual copy;
6. ✅ **On-device iteration (upstream)** — the plugin ran in a real profile through several feedback rounds: the settings page lists the whole rail, hidden rows and Groups behave, the icon set was redrawn against the shell's own artworks, member hiding landed, and the self-check's boot-order race was fixed;
7. ✅ **Release (upstream)** — `dsh-panellist` `v0.1.0` on GitHub and npm, submitted to `awesome-dsh-plugin`;
8. ✅ **The fork** — renamed to **`dsh-railist`**, its own config file, route prefix and rail id prefix; the sequence extended to a second seat with the "nearest row above" rule and a physical placement pass; the up/down buttons replaced by drag-and-drop; the `not shown` annotation, the per-row contributor name and version, the token-only polish chunk, and the fifth self-check added.

#### Static checks that need no application start

The mount layer can be verified offline: point the CLI at a **throwaway** profile with this repository's patch layered on top.

```bash
# Create a throwaway profile (derived from the shipped web template), layer this
# repository's mount patch onto it, and print the composed tree only.
dsh plugin-dryrun --from-default-profile web \
  --patch D:/Documents/Projects/usableProjects/github_use/dsh-railist/cordis.patch.yml --dump-config
```

The composed tree contains (measured on this machine):

```
# == D:/Documents/Projects/usableProjects/github_use/dsh-railist/cordis.patch.yml
- id: railist
  name: dsh-railist
```

Nothing is served and nothing is installed; delete `$DSH_HOME/profiles/<throwaway-id>` afterwards. `web` itself is managed by the running harness and the CLI refuses a profile in use — deliberate, and the reason this recipe uses a throwaway profile. `tests/manifest.spec.ts` turns the consistency invariants (package name = the plugin's `name` export = the patch's `name`, every runtime-read file listed in `files`, one source of truth for the schema version and the route prefix) into cases that run on every `pnpm check`.

---

### License

MIT

---
---

## 中文

[English](#english) | **中文**

左侧栏管理器，面向 DSH（DeepSeek Harness）客户端——管的是**整列**，而不是其中一格。

左侧栏是各个插件放自己入口的地方：面板列表（插件、自动化任务、技能中心、记忆系统、SSH、MCP 连接器……）、设置上方那一行操作卡片，以及设置本身那一格。这些入口来自不同的插件，每个插件自己声明 `order`，自己决定图标和名字。

本插件让**用户**接管：哪些行出现、以什么顺序出现、**落在哪一格**、叫什么名字、用什么图标，以及哪些入口收进分组。所有配置都在设置的「面板列表」页里完成，改动即时生效。

> 状态：**已实现**。本 README 就是完整规格，没有单独的设计文档：行为在 §2–§3，配置与接口在 §4，兼容性契约在 §5，安装方式在 §6，实现原理在 §7。配置的规范定义在 [`docs/schema/config.schema.json`](docs/schema/config.schema.json)。
>
> **`dsh-railist` 是 [`dsh-panellist`](https://github.com/qwq1999/dsh-panellist) 的 fork。** 上游只管面板列表（`sidebar.panellist`）这一格；本 fork 把它扩展成**一条跨越多格（seat）的统一序列**（面板列表 + 设置上方那一行），并加入拖拽排序、每行显示所属插件名与版本、以及「当前未显示」标注。差异见 [与原上游 dsh-panellist 的差异](#与原上游-dsh-panellist-的差异)。
>
> 相对最初设计的三处修正（均为实现过程中发现并回填到本文档）：分组的轨道 id 是 `dsh-railist:<groupId>`；未配置的面板条目始终列在轨道上，但只有序列非空（即你做出第一次结构性改动）之后才会写入 `order`；`/railist/api/reveal` 端点是为实现「打开配置文件」而新增的。

### 截图

| 设置 → 面板列表 | 轨道上的分组菜单 |
| :-: | :-: |
| ![设置 → 面板列表](docs/images/settings-panel-list.png) | ![轨道上的分组菜单](docs/images/rail-group-menu.png) |

---

### 1. 为什么需要它

DSH 左侧栏是一份**只读投影**：shell 枚举 `sidebar.panellist` 槽位里的注册项，并按**每个条目在注册时申报的 order** 排序渲染。官方没有提供改写别人注册项的 API：

- order 只读——插件只能决定自己条目的 `order`；
- 没有「分组」这个概念——一行就是一个面板条目；
- 没有「把一行搬到别处」这个概念：shell 是**逐槽位**排序的，因此任何 `order` 取值都无法把一行从一格（面板列表）搬到另一格（设置上方的操作行）；
- 图标由贡献者提供的组件决定，名字由贡献者的 `label` 决定；
- 设置导航页签的图标只能从内核内置的列表里挑。

所以本插件必须同时用**三根杠杆**，并且每一根都尽量做小：

1. **改写注册**——在运行时改写注册对象上的 order、名字与图标组件（注册对象没有被冻结，并且由槽位注册表交还，因此事后写入对 shell 可见）；本插件的改动不触碰任何插件自己的页面。
2. **极少的 DOM/CSS 重投影**——有两件事单靠注册表做不到：把一行从轨道上拿掉，以及把它搬进另一格。隐藏是一条声明式的 `:has()` 规则（§7.3）；跨格搬运则是把行元素物理移动（§7.6）。分组行也是注册项（由本插件注册），因此它的行框、高亮、提示与折叠态行为仍来自 shell；弹出菜单是浮层，不改动原生行。
3. **原生格子保持原生**——设置那一格永不接管，因为那一行自己的 `children` 表正是声明 `settings.section` 的地方，所有插件的设置页都要注册进这个槽位（§2.12）。

---

### 2. 行为规格（已确认）

#### 2.1 管什么

- 被管理格子里的**所有**注册项一视同仁：内核自带的条目（插件、自动化任务、技能中心、记忆系统、SSH、MCP 连接器）和第三方插件注册的条目都能管。
- **管理两个格子**：面板列表（`sidebar.panellist`）和设置上方的操作行（`sidebar.footer.action`）。设置那一格（`sidebar.settings`）永不受管理——见 §2.12。
- 本插件自己的设置页签不在被管理的格子里，因此不参与管理。
- 真实的面板条目 id 在运行时发现，不写死；本文档示例中的 id 仅作示意。

#### 2.2 序列模型

序列是一串**有序条目**，每一项要么是**单个面板条目**，要么是一个**分组**：

- 序列是**跨越两个被管理格子的一条列表**：一行在序列中的位置决定了它最终落在哪一格（§2.11），因此设置页上的列表自上而下读起来，与左侧栏完全一致；
- 每个面板条目在整条序列中**恰好出现一次**（序列是面板条目集合的一个划分，不重复）；
- 分组本身占据序列中的一个位置，内部装着一个**有序**的面板条目子集；
- **只允许一层嵌套**（分组里不能再放分组）；
- 空分组非法；只有 1 个成员的分组合法，但管理面板会给出警告。

设计讨论把记法定为下面这样（`G{…}` 表示一个分组）：

| 记法 | 含义 |
| --- | --- |
| `a c b d e` | `[a][c][b][d][e]` |
| `a b c` | `[a][b][c]` |
| `a dropdown(b c d e)` | `[a][G{b,c,d,e}]` |
| `a dropdown(b d e c)` | `[a][G{b,d,e,c}]` |
| `a dropdown(b e c)d` | `[a][G{b,e,c}][d]` |
| `dropdown(a b c)d e` | `[G{a,b,c}][d][e]` |

#### 2.3 显示 / 隐藏

- 只有两种状态：**显示** / **隐藏**（没有第三种「禁用」状态）。
- 隐藏 = 不再出现在轨道上，但面板条目本身仍然存在、仍然可用（可以在管理面板里选中，也可以由其他插件或快捷键激活），它所属插件的功能不受影响。
- 例外：**如果被隐藏的面板条目当前处于激活态，它那一行会临时显示**——避免出现「用户还在这个页面上，轨道上却没有它的入口」这种情况。
- **分组里的成员也可以隐藏**，此时「隐藏」的含义是「不进分组菜单」：成员的轨道行本来就被分组压制了，所以对成员来说，隐藏只影响浮出菜单。成员仍然留在分组里——计数、排序和分组触发按钮的高亮都还看得见它。
- **已缺失的成员会自动不进分组菜单**（注册已经没了，菜单里留一个点不动的「缺失」行，只是占掉用户无法操作的位置）。它仍然留在配置里，也在设置页的「已缺失的面板」列表里，等着被清理。

#### 2.4 名称覆盖

- 纯展示层的覆盖，只影响三处：轨道行的文字、折叠状态下的提示文字、无障碍名称。
- 它不改变 DSH 其他地方的同名展示（设置、命令面板等），也不改变贡献者申报的原始名称。
- 第一版是**单个字符串**，对所有语言生效。

#### 2.5 图标覆盖

三个来源，随时可以切回原图标：

1. **保留原图标**（默认）；
2. **内置图标集**——随插件附带的 24 个内联矢量字形（零依赖、离线可用）。它们按轨道上相邻图标的同一套规范绘制——即 **`Icon*OutlineRegular`** 字重：`viewBox="0 0 16 16"`、`fill="none"`、`stroke="currentColor"` 且线宽 **1px**、几何落在 16 网格的半格坐标上、范围大致在 2…14、圆头圆角连接、`aria-hidden`、不含 id 也不含外部引用。其中三个就是轨道自带默认图标的原稿，因此把某个面板换成它们，看起来与它替换掉的那个条目一模一样：`puzzle` 是插件风车（`IconPluginPinwheelOutline`），`clock` 是时钟（`IconClockOutline`），`more` 是省略号（`IconEllipsisOutline`）。整套图标会在 16px 下与这些原稿并排做机械比对，并测量各自的墨迹范围；
3. **用户上传图标**——粘贴 SVG 源码；
   - 白名单净化：移除 `script`、`foreignObject`、事件属性，以及外部引用（`href`/`xlink:href` 指向外部的情况）；
   - 单个 SVG 上限 **64 KB**；
   - 内联渲染（不是 `<img>`），因此跟随主题颜色。

**设置导航行有自己专用的字形**（一个面板列表，用该列自己的 `Icon*OutlineMedium` 1.3px 字重绘制）——见 §7.5。

#### 2.6 分组与分组触发按钮

- 分组触发按钮有**自己的**图标和名字；默认从「分组内第一个条目」的图标和名字预填（常见的名字是「更多」），用户可以改。没有设置名字时，触发按钮的文字在渲染时从第一个存活成员解析——配置里不写死。
- 分组触发按钮的**整行可点**，点击展开分组菜单；整行点击永远用于展开菜单，绝不用于跳转页面。菜单里只列分组成员：指向分组自身页面的「概览」链接原本在标题行里，因用户反馈已移除。那个页面仍作为分组的 `main` 兜底存在（因此以编程方式选中分组 id 不会报错），但它没有自己的入口。
- 分组中有任意条目处于激活态时，**分组触发按钮会高亮**，用户不必展开菜单就能看出当前页面属于哪个分组。
- 新建分组时，它插入到**其最上面那个成员原本的位置**——也就是说，分组在它成员原本所在的地方「长出来」。模型保证这一点（`createGroup` 锚定在最上面那个成员之上那一行的*身份*上），因此对任何手势都成立。

#### 2.7 分组菜单

- **点击打开**（不是悬停，避免误触）。
- 只列用户可以操作的成员：被隐藏（§2.3）或已缺失的成员不出现；成员全被隐藏的分组会明说，而不是显示一张空卡片。
- 键盘可用：`Enter`/`Space` 展开，`Esc` 关闭，上下方向键在分组内移动。
- 侧边栏折叠成 56px 轨道时，菜单始终**向右浮出**（flyout）。
- 分组内条目数超过可见高度时菜单可滚动；第一版**不做**组内搜索框。

#### 2.8 未配置项、缺失项与「当前未显示」

- 新装的插件注册了一个你还没碰过的面板条目 → 它**立刻列进序列里**（排在已配置条目之后，按它自己的 order 排）；不需要先「认领」什么。
- 面板条目的贡献者被卸载、而配置里还留着它 → 配置**保留**，管理面板给它标上 **`missing`（缺失）**，并提供「清理缺失项」按钮。
- 一个**已注册、但当前在轨道上什么都没渲染出来**的行，会得到 **`当前未显示`** 徽标（英文界面：**`not shown`**）。这与 `missing` 是**两件不同的事**：缺失意味着根本没有注册项回应，而未显示意味着注册是活的，只是它自己的组件此刻什么都没渲染——比如一个只在功能打开时才出现的底部操作入口。这样的行**保留在列表里、绝不滤掉**：用户看不见的行，仍然是用户必须能操作到的行，而它的设置通常正是把它打开的地方。
- 在你做出**结构性**改动（拖拽、建组或解散分组）之前，本插件**完全不写 order**：轨道保持贡献者自己选择的顺序。改名、换图标或隐藏只是覆盖那一个条目，不动顺序——这就是「没让你动的东西我们不碰」在实际中的含义。

#### 2.9 改动如何生效

配置改动**即时生效**：不用重启 DSH，不用重载任何插件，也不用刷新页面。这对*每一次*编辑都成立，包括那些什么都没写的编辑：改写过程会比较「轨道所渲染的一切」的摘要（顺序、名字、图标、显示/隐藏、被压制），只要它变了就重新投影，所以第二次换图标、第二次改名，和第一次一样会落到轨道上。会把某一行搬进另一格的改动，由放置过程执行（§7.6），它在注册表写入稳定之后运行。

#### 2.10 接管范围

管理面板**从第一次打开就列出整个左侧栏**：在动某个面板条目之前没有需要先「认领」的东西，也没有「尚未接管」列表。（早期设计里有一个「未配置」列表，带逐项的接管/释放按钮；因用户反馈去掉了——它只是多一步。另有横幅加「以当前轨道顺序为起点」按钮，同样被去掉：无论哪种方式列表就是轨道，那道门在感官上是看不见的。）

仍然成立的是**「写什么」上的最小干预**，而不是 UI 上的：

- 配置的 `sequence` 是**部分权威**：它只记录你确实改过的东西。
- `sequence` 为空意味着**完全不写 `order`**（刚装好的状态，纯 no-op——也不会让任何行换格），未配置面板的名字/图标/隐藏状态完全不动，保持贡献者自己的顺序。
- 你第一次结构性改动（拖拽、并入分组）会把当前顺序物化成一条显式序列；未配置的条目按自己的原生顺序留在已配置块之后（§2.8）。
- **格子解析遵循同一条规则**：只有序列非空之后才会运行，因此刚装好的状态永远不会把行在格子之间搬来搬去。

实现（`src/shared/model.ts`）：`rows` 始终是整条轨道（未配置行的 `order` 为 `null`，表示「不写」），而 `reordering` 决定要不要写 `order`——以及要不要跑格子解析那一趟。

#### 2.11 格子规则：哪一行落在哪里

这是本 fork 的核心扩展。一行不再「属于」它注册时所在的那一格，而是属于序列把它放进去的那一格，由一条规则决定：

> **一行取的，是它上方最近那个有格子的行的格子。**

实践中重要的细节：

- **只有你真正摆过的行才是锚点。** 分组行自己没有格子，配置里从未提及的行（追加在末尾的）也不参与——所以「上方那一行」指的是它上方*由序列摆放、并且有格子*的最近一行。锚点在有序行列表上解析；上方没有任何带格子的行时，这一行**保持贡献者注册时所在的格子**。
- **格子也决定 shell 能在那里渲染多少行。** 把「能力面板」直接拖到「用量统计」下面，它就进入**上面那一格**（因为用量统计是上格的行）；再把「电源卡片」直接拖到能力面板下面，它就进入**下面那一格**。被拖到底部格的分组同样落在下格。
- **规则只向上读。** 一行自己的注册信息压不过它上方那一行，因此移动一行可能会把它下面所有行一起换格——这正是「设置页上的列表就是左侧栏」的含义。
- **格内顺序是另一套「格内计数」。** 写进注册表的 `order` 是**每格各自**递增的序列（0、10、20……），永远不是全局列表位置：shell 是逐槽位排序的，给它全局 key 会在每一格里留下空档，也就留下奇怪的间距。
- **模型的边界**：模型里仍然保留 `settings` 这个容器，好让计划*可以*表达「设置那一行属于这里」，但那一格永远不会被改写、也不会被移动（§2.12）。

#### 2.12 `sidebar.settings` 永不被接管

设置那一格是**故意**不管的——序列不管、放置过程不管、改写过程也不管。原因是结构性的，而不是审美问题：`sidebar.settings` 装的是 shell 自己的「设置」行，而**正是那一行通过自己的 `children` 表声明了 `settings.section`**（设置对话框的内容槽位）。把它当成一个普通可移动的行来管，会破坏这份声明——槽位变成「未声明」，所有插件的设置页都注册不上，对话框整列内容会渲染成空。

所以：设置那一行保持原生，保持自己的位置和自己的齿轮图标；计划里即便提到 `settings` 容器，也不会作用到它身上。注册到那一格的注册项会被直接拒绝。

#### 2.13 一个页面只有一个活动挂载

shell 可能在同一个页面上多次应用同一个客户端 bundle（文件变更后重新求值 bundle、HMR 再应用一次）。两个控制器共用一个账本会互相打架：第二个会把第一个安装的字形包装器当成贡献者的组件捕获下来，而且两边都会写同样的条目。因此 `apply` 在构建自己的挂载之前先退休上一个（`src/client/mount.ts`），并且本插件安装的每个包装器都可识别，所以仍然持有包装器的条目会被解开而不是被领养（§7.2）。

---

### 3. 设置页

在设置对话框左侧新增一项：

- 名称：**面板列表**（`settings.nav`）；位置：设置导航靠后（order 100）；
- 图标：**它自己的字形**——一个按该列其他行所用 `Icon*OutlineMedium`（1.3px）字重绘制的面板列表，以 `currentColor` 蒙版画在内核兜底齿轮之上。设置导航的契约里没有图标字段，因此这一行按可见文字定位并标记；如果该探测失败，就保留原生齿轮（不报错）。见 §7.5。
- 页面**没有「完成」按钮**：对话框已经拥有这个能力（页面旁边的 X）。

页面内容：

#### 3.1 序列编辑器

- 列出整个左侧栏——从第一次打开起，两个被管理格子的所有面板条目都在，不需要先认领。列表顺序**就是**这一列的顺序，因此列表顶部就是上格，一行被拖过格子边界就会换格（§2.11）。
- **拖拽是主要通道。** 把一行拖**到另一行上**完成排序（目标的上/下三分之一分别表示放在它之前/之后）、拖**到分组行上**加入该分组（中间那条带）、**从分组里拖到列表上**离开分组、**拖到最后一行之下的空档**送到末尾。
- **拖拽把手**（`⠿`，在每一行和每个成员左侧）是**唯一可拖的节点**——行本身不可拖，这样「选中 / 隐藏 / 解散」不会被轻微移动的点击误触——同时也是**键盘控件**：聚焦它按 `↑` / `↓` 让该行上下移动一格（分组内的成员列表同理）。**故意没有上移/下移按钮**：把手已经承载同样的能力，而每行一对按钮等于每个条目多两个 Tab 停留点，只为做方向键已经覆盖的事。
- 每行的 **「与下一项合并为分组」** 建一个分组；分组行的 **「解散分组」** 解散一个。
- 每行都有 **「隐藏」/「显示」** 按钮，就地切换该行——分组行也有，**分组内的成员行也有**（被隐藏的成员不进分组菜单，§2.3）。
- 每行用**徽标**标示状态：`隐藏`、分组的成员数、`缺失`（§2.8），以及 **`当前未显示` / `not shown`**（§2.8）——已注册但当前什么都没渲染的行。
- 每个面板行在名字旁显示**贡献者副标题**——插件包名与版本（§3.8）。什么都不知道的行什么都不渲染：没有短横线，没有「未知」。
- 点击某一行的名字打开该行的外观编辑器（§3.2），分组内的成员也一样——它们没有自己的行。

#### 3.2 条目的外观覆盖

- **名称**：单字符串覆盖（§2.4）。
- **图标**：保留原图标 / 内置图标集 / 粘贴 SVG（§2.5），带实时预览。选中内置图标会按行自身尺寸预览；「保留原图标」的预览显示贡献者真实的组件。
- 显示/隐藏就是序列列表里每行的 **「隐藏」/「显示」** 按钮——只有一个入口，不要两处。
- 位于分组内的面板会在这里说明这一点，因此它在轨道上没有自己的行是显而易见的。

#### 3.3 分组编辑

- 分组触发按钮的名字与图标。
- 有序成员列表：上移/下移成员、移出分组、隐藏或显示。

#### 3.4 配置导入 / 导出

导入会先校验文档再写入；导出把整个文件（所有 profile）序列化到剪贴板。导入失败会报出字段级原因，且什么都不改。

#### 3.5 打开配置文件

`POST /railist/api/reveal` 会在系统文件管理器里打开 `$DSH_HOME/railist.json`。路径也打印在按钮旁边。**恢复默认** 会在行内确认后回退该 profile 的配置。

#### 3.6 已缺失的面板

没有对应注册项的已配置 id 会连同计数一起收集在这里，**「清理缺失项」** 会删掉它们——先显式确认，绝不自动执行。

#### 3.7 自检状态

**五个**启动探测（§5）的结果，外加一个 **「重跑自检」** 按钮。失败的探测会显示它测了什么、因此禁用了什么，以及插件测到的 DSH 版本。

#### 3.8 贡献者副标题（每行显示插件名与版本）

每个面板行都会显示它是哪个包提供的、以及哪个版本（`name · v1.2.3`）。

- **答案来自哪里**：宿主半边读取**该 profile 自己的文件**——`$DSH_HOME/profiles/<id>/cordis.patch.yml` 提供「组合行 id → 包名」，同目录的 `package.json` 提供 `dependencies` → 版本——并通过 `GET /railist/api/plugins` 提供出去（`src/plugin/plugins.ts`）。不走网络。
- **版本归一化**：tarball URL 或 `#<sha>` 片段归一化为 7 位 sha；`git+` / `github:` / `https:` 依赖没有发行版本，因此不报版本；`workspace:` / `link:` / `file:` / `portal:` / `npm:` 是本地路径而不是版本，同样不报；普通范围会去掉操作符（`^0.1.6` → `0.1.6`）。
- **格式化**（`src/client/settings/sourceLabel.ts`）：去掉 npm scope（`@scope/name` → `name`），超过 32 字符的名字做中间截断，超过 24 字符的版本直接丢弃。未截断的完整文本放在元素的 `title` 里。
- **容错**（`src/client/settings/pluginInfo.ts`）：每次打开页面只读一次，不轮询，而且**没有失败态**——非 2xx、格式错误、网络错误、或 shell 没有 `fetch`，都只意味着「不知道任何面板的信息」，此时各行渲染的内容与这个功能存在之前完全一样。

---

### 4. 配置与接口

#### 4.1 位置与范围

- 文件：`$DSH_HOME/railist.json`（权限 `0600`，以「临时文件 + 原子重命名」写入；Windows 文件锁冲突时回退为直接写入）；
- 范围：同一个文件里**按 profile 分开**，因为不同 profile 装的插件不同；
- 迁移：配置带 `schemaVersion`（当前为 **2**），读取时按需要迁移旧版本；
- 损坏：解析失败时**备份原文件**为 `railist.json.corrupt-<时间戳>` 并恢复默认，不会静默丢掉用户手改过的内容。

#### 4.2 配置形态（示意）

```json
{
  "schemaVersion": 2,
  "profiles": {
    "web": {
      "sequence": [
        { "type": "entry", "id": "plugins" },
        {
          "type": "group",
          "id": "group:work",
          "label": "更多",
          "icon": { "kind": "original" },
          "members": ["schedules", "skills", "memory"]
        },
        { "type": "entry", "id": "ssh" }
      ],
      "entries": {
        "plugins": { "label": "插件市场", "icon": { "kind": "builtin", "name": "puzzle" } },
        "mcp-connector": { "hidden": true }
      },
      "meta": { "updatedAt": "2026-10-10T03:00:00.000Z" }
    }
  }
}
```

权威定义见 [`docs/schema/config.schema.json`](docs/schema/config.schema.json)（JSON Schema 2020-12；宿主在每次写入之前、每次读取之后都会用 ajv 校验整份文档，`tests/shared-schema.spec.ts` 会把上面这个例子跑一遍）。`sequence` 是**部分**权威：它列出的条目按此顺序，未列出的条目由程序追加到末尾。一行的**格子**不存在配置里——它由上方那一行推导而来（§2.11），因此它是序列的结果，而不是它的字段。

#### 4.3 本插件占用的接口

| 用途 | 标识 |
| --- | --- |
| 设置导航页签 | `settings.section` id = `dsh-railist` |
| 分组行（轨道） | `sidebar.panellist` id = `dsh-railist:<groupId>`，例如 `dsh-railist:group:work` |
| 分组页面（`main` 兜底，因此选中分组 id 不会报错） | `main` key = 同一个字符串 |
| 宿主半边本地路由 | `/railist/api` |

宿主半边路由（仅本机回环可达，带受信主机围栏）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/railist/api/config?profile=<id>` | 读取该 profile 的配置 |
| `PUT` | `/railist/api/config?profile=<id>` | 写入整份配置（服务端校验 + 原子落盘） |
| `POST` | `/railist/api/config/reset?profile=<id>` | 恢复默认 |
| `POST` | `/railist/api/reveal` | 在系统文件管理器中定位配置文件（「打开配置文件」按钮） |
| `GET` | `/railist/api/health` | 配置存储与字段级自检状态 |
| `GET` | `/railist/api/plugins` | 每个面板由哪个包、哪个版本提供（§3.8） |

`?profile=` 只接受 `$DSH_HOME/profiles/<id>` 下确实存在的 id；不带该参数时，配置写入宿主自己的 profile（`DSH_PROFILE`，否则 `default`）。`/health`、`/reveal`、`/plugins` 是整文件级别的，忽略该参数。请求体上限 2 MB。

两半的导出契约（与生态一致）：

- 宿主半边：`name`、`inject`、`apply(ctx, config?)`
- 浏览器半边：`apply(ctx)`、`inject`
- Manifest：`dsh.bundle.patch`（自动挂载）+ `dsh.client.{inject,platform}`

#### 4.4 本插件依赖的 shell 事实

这些都不是公开契约，因此每一条都在启动时被探测（§5）——但实现确实假设了它们：

| 事实 | 出处 |
| --- | --- |
| `sidebar.panellist` 是一个 `list` 槽位，由**侧边栏条目自己的 `children` 表**声明；向未声明的槽位注册会抛错 | 侧边栏自身的注册；槽位注册表的 `register()` |
| 存下来的条目是普通对象（`{component, options}`），从不冻结；`entries`/`entriesOfSlot` 把这个对象交还 | 槽位注册表的 `register()` |
| 直接写存储条目上的字段（**包括 `entry.component`**）对下一次投影可见，但不提升账本版本、也不通知任何人 | 注册表 + 批量通知通道 |
| `register`/dispose *确实*会改动账本并通知订阅者——这正是 nudge（§7.2）所依赖的 | 注册表的变更通道 |
| shell 把一行文字渲染为 `resolveSlotLabel(options.label) ?? id`，所以没有 label 的注册项本来就会显示 id | 侧边栏的渲染器 |
| 行字形以 `{size, active}` 渲染；`size` 为 16（折叠时为 18） | 侧边栏的 `renderSlot("sidebar.panellist", {size, active})` |
| **每个格子是各自的容器**，shell 逐槽位排序——因此只有物理移动才能把一行搬到另一格 | 侧边栏的逐槽位渲染 |
| 格子容器可以按**稳定的类名后缀**定位（`_panelList`、`_footerActions`），并且各自带一个 `data-slot` 锚点；`top` 格的锚点在每行**内部**，`footer` 格的锚点在行**外面** | 侧边栏自身标记 |
| 被移出组件所拥有子树的元素不再被 React 协调触碰；而在同一容器内兄弟之间移动*会*被撤销 | React 协调 |
| shell 不给轨道行打 id：注册 id 必须从 React fiber 链上读（`PanelRow.props.id`，或 `RootEntry` fiber 的 `entry.options.id`） | 侧边栏的行组件 |
| CSS module 类名形如 `_<buildHash>_<stableKey>`；激活行会追加 `_panelActive`，所以 `[class*="_panelRow"]` 能匹配，`[class$="_panelRow"]` 不能 | 侧边栏样式表 |
| `ctx.layout.panelInfo` 是 `HostObservable<{activePanelId}>`，而 `ctx.layout.selectPanel(id)` 对没有 `main` 条目的 id 会抛错 | 布局服务的公开读取器 |
| `settings.section` 契约**没有图标字段**；shell 按 section id 从闭集里挑导航字形（`Icon*OutlineMedium`，尺寸 16） | `dsh-client-ui-settings-general` 的 `navIcon(id)` |

---

### 5. 兼容性、自检与降级

**版本下限**：`engines.dsh: ">=0.2.0-rc.2 <0.3.0-0"`（与开发所用内核版本一致；类型包在 npm 上同版本可用，因此契约漂移会在编译期被抓到）。

本插件依赖 DSH 的若干**内部**事实（都不是公开契约），因此启动时逐条自检——共**五个**探测：

| 依赖的内部事实 | 失效后果 | 探测方式（`src/client/rail/probe.ts`） | 降级 |
| --- | --- | --- | --- |
| 槽位注册对象没有被冻结，因此事后可以改写 `order`/`label`/图标组件 | 顺序、名字、图标都改不了 | 临时注册一个探测行，改写它的 `order`，再通过 `entriesOfSlot` 读回来；同时确认对象本身与其 `options` 都没被冻结 | 关闭改写，只读 |
| 轨道行的 DOM 结构可以定位，且 CSS 支持 `:has()` 选择器 | 「隐藏」失效 | `CSS.supports('selector(:has(*))')`，并用与隐藏规则**完全相同**的选择器数行数，与轨道注册数比对（轨道未挂载时视为通过并说明理由） | 关闭隐藏（保留其他改写），显示只读提示 |
| shell 仍把「是否激活」传给图标组件（被隐藏的激活面板条目需要它） | 被隐藏的激活面板条目无法临时显示自己那一行 | 临时注册一个探测行，等两帧，确认它的图标组件确实渲染了，且拿到的 `active` 是布尔值 | 该规则失效：隐藏变成无条件隐藏 |
| 设置导航按钮可以按可见文字定位 | 设置页签图标无法替换 | 对话框打开时，按文字匹配本插件自己那一行；未打开时视为通过并加注（每次打开都由 `MutationObserver` 重新标记） | 保留原生齿轮图标 |
| **两个被管理格子的容器在 DOM 里能找到**（`seats`） | 行无法在面板列表与底部操作行之间移动；格内排序仍然生效 | 询问 DOM 半边能否为每个被管理格子找到容器；报出哪些没找到、哪些找到了（完全没有 DOM 半边的构建会跳过该探测并通过） | 行留在贡献者注册时所在的格子 |

- **探测会先等轨道槽位出现再测量。** `sidebar.panellist` 由侧边栏条目的 children 表声明，而本插件可能先于它挂载；此时注册探测行会被拒绝，而正是这一次拒绝决定了只读状态。运行会先等 shell 自己的「等这个位置存在再跑」接缝（`slots.inject`），上限 5 秒，因此启动顺序竞争永远不会把插件锁进只读。始终不声明该槽位的 shell 会在等待结束后如实上报。
- 任何自检失败 → **降级为只读**：不再做后续改写，管理面板顶部给出清晰提示（哪一项失败、影响什么、如何上报），并保留「重跑自检」按钮。
- 它绝不静默地半坏，也绝不阻塞插件加载（DSH 升级后 UI 仍然可用）。
- 已知不确定性：DSH 的样式类名是**构建哈希**，发布时会重掷。因此选择器一律匹配「稳定后缀」（例如 `[class*="_panelRow"]`，实测可用；`[class$="_panelRow"]` 在激活行上会失败），并且在每次挂载时重跑探测。

---

### 6. 安装与开发

#### 用户安装（发布后）

```bash
dsh plugin --profile web add dsh-railist
```

包 manifest 声明了自动挂载层，因此不需要手动改 profile 配置。

#### 本地开发（当前阶段）

```bash
# 在本仓库根目录
pnpm install
pnpm build

# 通过 link 把本仓库挂进 web profile（必须完全关闭 DSH）
dsh plugin --profile web add link:D:/Documents/Projects/usableProjects/github_use/dsh-railist

# 开发循环
pnpm watch      # tsdown --watch，重建浏览器半边，由客户端 HMR 热加载，无需刷新页面
```

注意：`link:` 不会安装本仓库自己的依赖，所以要先跑 `pnpm install`；改动 profile 期间必须完全关闭 DSH。

**回滚**（把插件从 profile 里拿掉）：

```bash
dsh plugin --profile web remove dsh-railist
```

如果卸载不干净，直接编辑 `$DSH_HOME/profiles/web/package.json`：从 `dependencies` 删掉 `dsh-railist`，从 `dsh.profile.bundles` 删掉同名字符串，然后删掉 `node_modules/dsh-railist`。配置文件 `$DSH_HOME/railist.json` 是唯一的外部状态，删掉它就回到出厂状态。

禁用或卸载插件不留残留：注册项的 order/`label`/组件被还原，本插件在格子之间搬过的每一行都放回原处，分组行被释放，注入的样式表被移除，所有标记属性被清除（`src/client/controller.ts` 的 `dispose`）。

#### 质量闸门

```bash
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run（jsdom）
pnpm build      # tsc（仅声明）+ tsdown（宿主半边 + 浏览器半边）
pnpm check      # 以上全部
```

测试覆盖四个方面：**模型**（序列/分组/覆盖的归一化、序列化、迁移与损坏回退，**「上方最近有格子的行」规则下的格子归属**，以及未配置时必须什么都不搬的情况）、**管理面板交互**（拖拽排序、把手的方向键、图标选择、SVG 净化、导入导出、成员隐藏、`当前未显示` 标注、贡献者副标题）、**DOM 半边**（把行放进正确的格子容器、在面板列表与底部操作行之间搬运、释放时还原每个被移动的元素、以及从 `cordis.patch.yml` + `package.json` 解析出 `/plugins` 的答案）、**降级路径**（五个自检各自失败后的只读行为，包括启动顺序等待），以及**打包契约**（manifest、挂载层、schema 版本与路由前缀的唯一来源）。不引入针对真实 DSH UI 的 E2E。

#### 发布（维护者）

打一个 tag 就会发布，而且没有任何机器持有凭据：`.github/workflows/release.yml` 使用 npm trusted publishing（OIDC）认证——GitHub 为该次运行签发一个 OIDC token，注册表把它换成短期发布 token，同时自动附带 provenance，因此没有长效密钥可泄露或轮换。流程是：改 `package.json` 里的 `version` → `pnpm check` → `git tag -a vX.Y.Z` → `git push origin main vX.Y.Z`。CI 会核对 tag 与 `package.json`，然后调用 `npm publish`（`lib/` 不入库，所以这一步同时也是产出发布文件的地方）。

一次性配置（npmjs.com 上的 trusted publisher 字段）、发布后验证清单、失败对照表，以及 OIDC 不可用时的兜底做法，都在 **[docs/RELEASING.md](https://github.com/HelloQingTao/dsh-railist/blob/main/docs/RELEASING.md)**。

---

### 7. 实现原理

#### 7.1 模块结构

```
dsh-railist/
├─ src/
│  ├─ index.ts                # 宿主半边入口（再导出 plugin/index）
│  ├─ plugin/                 # 宿主半边：配置存储、本地路由、迁移与损坏回退
│  │  ├─ index.ts             # name / inject / apply
│  │  ├─ store.ts             # 文件存储：ajv 校验、0600 原子写入、损坏隔离
│  │  ├─ plugins.ts           # /railist/api/plugins：每个面板的包名与版本，取自 profile 自己的文件
│  │  └─ routes.ts            # /railist/api 处理器（回环围栏，五个端点 + reveal）
│  ├─ shared/                 # 两半共享的类型与配置模型（无副作用）
│  │  ├─ config.ts            # 文档形态、容器、内置图标名、id 前缀
│  │  ├─ model.ts             # buildPlan：序列 → 每行该写什么、该落哪一格（纯函数）
│  │  ├─ edit.ts              # 序列/分组编辑算子（纯函数，维持「恰好一次」不变量）
│  │  ├─ migrate.ts           # schemaVersion 迁移框架
│  │  ├─ validate.ts          # 浏览器半边的宽松读取
│  │  └─ protocol.ts          # 路由路径与跨半边 JSON 形态
│  └─ client/                 # 浏览器半边
│     ├─ index.tsx            # apply(ctx)：组装顺序、样式、自检、语言
│     ├─ controller.ts        # 唯一的主循环：配置 → 计划 → 改写 / 放置 / 分组行
│     ├─ contracts.ts         # 单元之间冻结的接口
│     ├─ ctx.ts               # 仅类型增强：ctx.slots / ctx.layout / 槽位声明
│     ├─ styles.ts            # 唯一的注入样式表（按 id 聚合各单元的 CSS 块）
│     ├─ mount.ts             # 每页一个活动挂载：第二次 apply 会退休上一个
│     ├─ service.ts           # 对可选 cordis 服务的容错读取
│     ├─ config/store.ts      # 配置状态：乐观应用、失败回滚、导入导出
│     ├─ i18n/index.ts        # 中英文词条（key 集合是封闭的）
│     ├─ registry/rail.tsx    # 注册表发现 + 改写 + 同步 nudge + 自己的行 + 格子映射
│     ├─ rail/css.ts          # DOM 规则（隐藏、设置导航蒙版）集中在一处
│     ├─ rail/dom.ts          # 放置半边：把行元素搬进计划指定的格子
│     ├─ rail/probe.ts        # 五个自检与降级决策
│     ├─ groups/              # 分组触发行、捕获阶段点击拦截、菜单、分组页
│     ├─ settings/            # 设置页：序列编辑、外观、插件信息、配置、自检
│     └─ icons/               # 24 个内置字形 + 设置导航字形 + SVG 白名单净化
├─ docs/                      # 文档资源
│  ├─ images/                 # README 截图
│  ├─ RELEASING.md            # 发布手册（tag → CI）
│  └─ schema/config.schema.json  # 规范配置形态（宿主运行时读取）
├─ tests/                     # 测试：模型、宿主半边、改写与放置、挂载守卫、探测、分组、设置、图标、文案一致性、打包契约
├─ cordis.patch.yml           # 自动挂载层
├─ .github/workflows/release.yml  # 打 tag 即发布（npm trusted publishing / OIDC）
└─ README.md                  # 英文与中文（本文件）
```

#### 7.2 改写过程与 nudge

`registry/rail.tsx` 读取轨道槽位，第一次看到某个条目时记下它原始的 `order`/`label`/组件，之后只写有差异的部分。有三点值得知道：

- **永远先比较再写。** 每个写入者都先比较，每个生成物（label thunk、字形包装器）都按捕获到的注册项缓存。这不是风格偏好：每次都是新身份就永远比较不相等，于是这一趟会报告变化、nudge、再进入自己，无限循环。控制器另外把一次爆发限制在 `CASCADE_LIMIT`（60）趟，并打警告日志。
- **nudge 是计划的义务，而不是写入的义务。** 直接写字段不提升账本版本，因此没有任何东西会重渲染。一批写入之后，这一趟会注册一个一次性行并在同一个任务里释放它——这会改动账本两次，让 shell 重读 `order`/`label`。而只改变我们自己包装器绘制内容（已内置图标的行再换一个内置图标、由已装好的 thunk 解析的改名）的编辑根本不写字段——所以这一趟还会比较**轨道所渲染一切的摘要**（order、label、图标、隐藏、被压制；面板与分组），只要它变了就 nudge，即使无字段可写。挂载的第一趟只记住摘要，因此新装状态是严格的 no-op。
- **我们的包装器可识别。** 包装器渲染的是隐藏标记而不是字形，贡献者的组件只活在它的闭包里——因此任何把 `entry.component` 读回去的人可能拿到我们自己的包装器。每个包装器都登记在页面级 `WeakMap`（包装器 → 捕获组件的 getter）里；捕获过程会拆开它发现的东西并占住该槽位，`nativeGlyph` 也会拆开自己的答案。没有这一步，设置页里被隐藏面板和分组成员的预览会显示空框。

#### 7.3 DOM 足迹

一份样式表，只注入一次，并按文档 id（`dsh-railist-styles`）认领，因此重新求值的 bundle 不会产出第二份。隐藏是 `nav[class*="_panelList"] > button[class*="_panelRow"]` 上的一条 `:has()` 规则——字形渲染了标记 span 的那一行会消失。因为标记由 React 渲染，这条规则是声明式的：没有 observer、没有搬父节点、没有布局抖动。`hidden` = 「除非这一行是当前激活面板，否则隐藏」；`suppressed` = 「始终隐藏，它改在分组里显示」。

#### 7.4 分组行与其菜单

分组行是我们向 `sidebar.panellist` 注册的**真实注册项**，同一个 key 下还有它自己的 `main` 页面：shell 按 `order` 摆它、渲染它的 `label`，并把二者同时用作无障碍名称和折叠提示。`sync()` 是幂等的——只重新注册 order 或解析后 label 真的变了的行，因为多余的重新注册会重挂载用户可能正在交互的那一行。（被序列放进底部格的分组会注册进底部格，放置过程会让它待在那里。）

这一行是 shell 拥有的单个 `<button>`，因此触发字形在它的祖先按钮上安装**捕获阶段**的 `click`/`keydown` 监听：捕获早于根节点上 React 的委托处理器，所以一次 `stopPropagation()` 就能让 shell 自己的 `selectPanel` 永不执行，`preventDefault()` 取消该行的默认激活。菜单本身是 body 传送门浮层，按行的 `getBoundingClientRect()` 定位，因此能逃出侧边栏的溢出裁剪；显示之前先测量，`Esc` 或点击外部关闭。

分组高亮来自布局自己的公开读取器（`ctx.layout.panelInfo`），而不是 shell 的 `aria-current`：shell 只在那一行*就是*激活面板时高亮它，而分组行永远不会是，所以改由成员关系驱动高亮。

#### 7.5 设置导航标记

`settings.section` 契约没有图标字段，shell 按 section id 从闭集里挑导航字形，因此这一行按其**可见文字**定位：`document.body` 上的 `MutationObserver` 用我们自己的本地化 label 匹配 `[role="dialog"] nav button` 并给该行打标记，样式表再把这一行里 shell 自己的 `<svg>` 隐藏掉，并在它前面画出我们的蒙版字形。释放时这一切都会被移除；如果什么都匹配不上，就保留原生齿轮，并通过自检上报失败——绝不报错。

#### 7.6 放置过程：把一行在格子之间搬动

注册表半边只能在一个槽位*之内*排序，而 shell 把各格子渲染成彼此独立的容器，因此没有任何 `order` 取值能把一行从底部操作行搬到面板列表。这个移动是物理的（`src/client/rail/dom.ts`）：该模块取出渲染某一行的元素，把它放进序列指定格子的容器里。

三条事实让这件事安全（都在真实 shell 上验证过）：

1. **跨容器移动能扛过 React。** 协调只修正组件所拥有子树内部的位置；元素一旦被移出该子树，shell 就不再碰它。在同一容器的兄弟之间移动节点*确实*会被撤销——所以本模块从不这么做，格内排序交给注册表（两件都做还会让插件自己的 observer 触发、再跑一趟、再移动一次，也就是 shell 报的「recomputation did not settle」那种死循环）。
2. **格子锚点可按后缀稳定匹配。** 每个类名都带构建哈希（`hHd-Xa_footerActions`），因此选择器匹配稳定后缀（`[class*="_footerActions"]`），并且候选元素里必须包含该格子自己的 `data-slot` 锚点——正好把类名起得和我们一样的插件不会被误认成格子。
3. **移动过的元素可以精确放回。** 每次移动都记下它原来的父节点和它后面的兄弟节点，因此释放时还原的是 shell 自己的布局，而不是它的近似。

行与注册项的对应关系靠走 **React fiber 链**建立，因为 shell 不给 DOM 打 id；随后元素会带上 `data-dsh-railist-row` 标记，下一趟（以及「当前未显示」的读取，§3.8）就靠它读回来。两种被管理的行形态需要不同的锚点（都读自真实 shell）：`top` 格里，行是面板列表 nav 自己的 `button` 子节点，id 在 `PanelRow` fiber 的 `props.id` 上；`footer` 格里，格子锚点包在行的**外面**，所以行是锚点的元素子节点，id 在 `RootEntry` fiber 的 `props.entry.options.id` 上。

这一趟刻意宽容——侧边栏未挂载、类名被改、行还没渲染，都只是「这一趟无事可做」而不是报错——并由 `MutationObserver` 在 shell 重渲染时重放。因为 observer 回调是在搬动节点的同步趟*之后*作为微任务运行的，这一趟会**统计自己做了多少次改动**，observer 就正好丢掉这些回调，于是一次放置不会被误判成值得反应的变化。异常绝不会逃出一趟放置：那会把整个侧边栏布局一起带崩，所以失败的趟就让行停在原地。

#### 7.7 「当前未显示」的读取与轨道观察器

「这个已注册的行到底有没有渲染出东西」只有 DOM 能回答——注册是一份渲染的*承诺*（一个功能关闭时组件返回 `null` 的底部操作条目仍然持有注册）。因此控制器读回 `data-dsh-railist-row` 标记，把这个集合交给 `buildPlan`，凡是没找到的行都被标为 `unrendered`；完全**读不到答案**（没有 document，或侧边栏还没绘制）则意味着「假定一切都在渲染」，这样一个短暂的空白轨道不会把所有行都标成未显示。只是被隐藏的已注册行仍算已渲染：shell 挂载了它，是 CSS 把它移出了流，而「隐藏」有它自己的徽标。

行严格地在页面挂载*之后*才出现，所以单次读取不可能正确：从空文档猜测会宣称所有行都未渲染，而把第一次空读取当成最终答案则永远注意不到后来出现的行。因此一个 `MutationObserver` 在带标记的集合**增加了**行时请求重算——并且只在此时，这正是循环终止的原因：只是把同样的 id 再列一遍不是新信息。

#### 7.8 视觉打磨：第二份只用 token 的 CSS 块

设置页的字节被拆成三个按固定顺序注册的块——`settings.css.ts`（基础布局）、`drag.css.ts`（序列编辑器自己的载体：拖拽把手、落点指示、被拿起行的状态）和 `polish.css.ts`（间距、对齐与状态反馈），后者最后注册，因此在重叠处胜出。

`polish.css.ts` 刻意无色：它不引入自己的颜色、不用 shell 没有的字体、也不加页面原本没有的阴影。**每个取值都来自 shell 的设计 token**（`--dsw-alias-*`、`--dsw-radius-*`），并且都通过 `var(…, <主题中立兜底>)` 读取，兜底值是 `currentColor` 混色与透明填充——绝不是只适用于浅色或只适用于深色的字面量。这也是该文件里没有 `@media (prefers-color-scheme)` 的原因：token *就是*主题，而手搓的第二套配色恰恰是 shell 一变就坏掉的东西。它尊重 `prefers-reduced-motion`，行内操作只在悬停/键盘聚焦时绘制（`hover: none` 时始终可见），并给「当前未显示」徽标用 shell 的*警告*色而不是错误色——被关掉的底部操作条目是提示信息，不是坏掉了。

---

### 8. 与原上游 dsh-panellist 的差异

本仓库起初是 [`dsh-panellist`](https://github.com/qwq1999/dsh-panellist) 的 fork，并把它从「管顶部轨道」扩展成「管整列」。

| | 上游 `dsh-panellist` | 本 fork `dsh-railist` |
| --- | --- | --- |
| 管理的格子 | 只有面板列表 | 面板列表 **和** 底部操作行 |
| 排序方式 | 上移/下移按钮 | **拖拽**，外加把手上的方向键 |
| 一行的格子 | 贡献者注册在哪就是哪 | 由上方那一行推导（§2.11） |
| 什么都不渲染的行 | 不作区分 | `当前未显示` / `not shown` 徽标（§2.8） |
| 已经不存在的行 | `缺失` | `缺失`（不变） |
| 每行显示贡献者信息 | — | 由 `GET /railist/api/plugins` 提供包名 + 版本（§3.8） |
| 设置那一格 | 不涉及（只有一格） | **明确永不接管**，并写明了原因（§2.12） |
| 自检数量 | 四个探测 | **五个**（第五个是格子可定位性，§5） |
| 配置文件 | `panellist.json` | `railist.json`（形态相同，`schemaVersion` 2） |
| 路由前缀 | `/panellist/api` | `/railist/api` |
| 分组轨道 id 前缀 | `dsh-panellist:<groupId>` | `dsh-railist:<groupId>` |
| 设置 section id | `dsh-panellist` | `dsh-railist` |

**保持不变**的部分：插件背后的两根杠杆推理（§1）、序列/分组模型（§2.2）、显示/隐藏语义（§2.3）、名称与图标覆盖（§2.4–§2.5）、分组触发按钮及其菜单（§2.6–§2.7）、部分权威配置与即时生效契约（§2.9–§2.10）、兼容性与降级契约（§5）、以及打包 manifest 契约（§6）。

上游的槽位名在 shell 里仍然是真实的名字，因此这里照用：轨道槽位是 `sidebar.panellist`，另外设置页的一些类名为了延续性仍保留 `dsh-panellist-settings-*`。它们是 shell/类的标识符，不是产品名。

---

### 9. 第一版范围与非目标

**第一版包含**：跨两个被管理格子的序列编辑（拖拽 + 键盘兜底）、分组、显示/隐藏（分组内同样支持）、名称与图标覆盖（原图标 / 内置图标集 / 粘贴 SVG）、`当前未显示` 标注、每行的贡献者包名与版本、配置导入导出、孤儿保留与清理、中英文界面、自检与只读降级，以及这份双语 README。

**第一版不含**（留给后续）：分组内搜索、轨道上的右键上下文菜单、按语言分别取名、针对真实 DSH UI 的 E2E。

**非目标**：管理右栏卡片页签；管理设置对话框自身的页签顺序；**接管 `sidebar.settings` 那一格**（§2.12）；改变任何插件页面的内容；取代 DSH 内置的左侧栏。

---

### 10. 里程碑

1. ✅ **设计** —— 与用户敲定行为规格；
2. ✅ **骨架** —— tsdown + tsc + vitest、manifest 与自动挂载层；
3. ✅ **最小闭环** —— 改写注册（order/名字/图标/隐藏标记）→ 隐藏 → 设置页 → 持久化；
4. ✅ **分组** —— 分组触发行、菜单、拖拽编辑、分组页面；
5. ✅ **加固** —— 自检与只读降级、SVG 净化、导入导出、孤儿清理、双语文案；
6. ✅ **真机迭代（上游）** —— 插件在真实 profile 里跑过若干轮反馈：设置页列出整条轨道、隐藏行与分组行为正确、图标集按 shell 自己的原稿重绘、成员隐藏落地、自检的启动顺序竞争被修掉；
7. ✅ **发布（上游）** —— `dsh-panellist` `v0.1.0` 上到 GitHub 与 npm，并提交到 `awesome-dsh-plugin`；
8. ✅ **本 fork** —— 更名 **`dsh-railist`**，拥有自己的配置文件、路由前缀与轨道 id 前缀；序列扩展到第二格，配「上方最近有格子的行」规则与物理放置过程；上移/下移按钮改为拖拽；加入 `当前未显示` 标注、每行的贡献者包名与版本、只用 token 的打磨 CSS 块，以及第五个自检。

#### 无需启动应用的静态检查

挂载层可以离线验证：让 CLI 指向一个**一次性** profile，并把本仓库的 patch 叠加上去。

```bash
# 建一个一次性 profile（派生自随包发布的 web 模板），把本仓库的挂载
# patch 叠上去，只打印组合后的树。
dsh plugin-dryrun --from-default-profile web \
  --patch D:/Documents/Projects/usableProjects/github_use/dsh-railist/cordis.patch.yml --dump-config
```

组合出来的树里含有（本机实测）：

```
# == D:/Documents/Projects/usableProjects/github_use/dsh-railist/cordis.patch.yml
- id: railist
  name: dsh-railist
```

不提供任何服务、也不安装任何东西；完事后删掉 `$DSH_HOME/profiles/<一次性 profile id>`。`web` 本身由正在运行的 harness 管理，CLI 会拒绝占用中的 profile——这是刻意的，也正是这个配方要用一次性 profile 的原因。`tests/manifest.spec.ts` 把一致性不变量（包名 = 插件导出的 `name` = patch 的 `name`、每个运行时读取的文件都在 `files` 里、schema 版本与路由前缀各只有一个来源）变成每次 `pnpm check` 都会跑的用例。

---

### 许可证

MIT
