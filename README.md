# dsh-panellist

The management plugin for the Panellist in the DSH (DeepSeek Harness) client.

The Panellist is the column on the left of the session UI: the global entries contributed by individual plugins — plugins, automation tasks, skill center, memory system, SSH, MCP connectors… They come from different plugins, each declares its own order, and each decides its own icon and name.

This plugin lets the **user** take over: which Panel entries appear on the rail, in what order they appear, what they are called, what icon they use, and which entries are folded into a Group. All configuration is done in a new tab in Settings, and changes take effect immediately.

> Status: **implemented** (milestones 2–5 complete, milestone 6 partially complete). This document is the behavior spec confirmed by both sides; implementation trade-offs are recorded in [docs/adr/0001](docs/adr/0001-registry-rewrite-plus-minimal-dom.md), technical details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the configuration format in [docs/config.schema.json](docs/config.schema.json). Term definitions are in [GLOSSARY.md](GLOSSARY.md).
>
> Three refinements to the original design (all discovered during implementation and backfilled into this document): the rail id of a Group is `dsh-panellist:<groupId>`; unconfigured Panel entries are always listed on the rail, but an `order` is written only once the Sequence is non-empty (i.e. after your first structural change); and the `/panellist/api/reveal` endpoint was added to implement "Open config file".

---

## 1. Why it is needed

The DSH Panellist is a **read-only projection**: the shell enumerates the registrations in the `sidebar.panellist` slot and renders them sorted by the order **each item reported at registration time**. No official API is provided for rewriting someone else's registration:

- Order is read-only — a plugin can only decide the `order` of its own item;
- There is no concept of a "Group" — one row is one Panel entry;
- The icon is decided by the component the contributor provides, and the name is decided by the contributor's `label`;
- The icon of the Settings navigation tab can only be picked from a list built into the kernel.

So this plugin has to use two levers at the same time, and keep DOM intervention to a minimum:

1. **Registry rewrite** — rewrite the order, name, and icon component on the registration at runtime (the registration object is not frozen, and rewriting was measured to work at runtime); this plugin's changes do not touch any plugin's own page.
2. **Minimal DOM/CSS reprojection** — only one thing cannot be done through the registry: taking a row off the rail. Group rows are registrations too (registered by this plugin), so their row box, highlight, tooltip and collapsed-state behavior still come from the shell; the popup menu is an overlay and does not modify native rows.

The trade-offs and costs of this path are recorded in [ADR-0001](docs/adr/0001-registry-rewrite-plus-minimal-dom.md).

---

## 2. Behavior spec (confirmed)

### 2.1 What it manages

- **All** registrations in the Panellist are treated alike: kernel-shipped items (plugins, automation tasks, skill center, memory system, SSH, MCP connectors) and items registered by third-party plugins can all be managed.
- This plugin's own settings tab is not in the Panellist, so it is not managed.
- Real Panel entry ids are discovered at runtime and are not hard-coded; the ids in this document's examples are illustrative only.

### 2.2 Sequence model

The Sequence is a series of **ordered items**, each of which is either a **single Panel entry** or a **Group**:

- Each Panel entry appears **exactly once** in the whole Sequence (the Sequence is a partition of the set of Panel entries, with no duplicates);
- A Group itself occupies one position in the Sequence and contains an **ordered** subset of Panel entries;
- **Only one level** of nesting is allowed (a Group cannot contain another Group);
- An empty Group is invalid; a Group with only 1 item is allowed, but the management panel warns about it.

The six examples you gave are interpreted under this model as follows (`G{…}` = one Group):

| Your notation | Interpretation |
| --- | --- |
| `a c b d e` | `[a][c][b][d][e]` |
| `a b c` | `[a][b][c]` |
| `a dropdown(b c d e)` | `[a][G{b,c,d,e}]` |
| `a dropdown(b d e c)` | `[a][G{b,d,e,c}]` |
| `a dropdown(b e c)d` | `[a][G{b,e,c}][d]` |
| `dropdown(a b c)d e` | `[G{a,b,c}][d][e]` |

### 2.3 Shown / Hidden

- There are only two states: **Shown** / **Hidden** (there is no third "disabled" state).
- Hidden = it no longer appears on the rail, but the Panel entry itself still exists and is still usable (it can be selected from the management panel, and activated by other plugins or keyboard shortcuts), and the functionality of the plugin it belongs to is unaffected.
- Exception: **if a Hidden Panel entry is currently active, its row is shown temporarily** — avoiding the case where "the user is still on this page, but the rail has no entry for it".

### 2.4 Label override

- A pure display-layer override, affecting only three places: the text of the rail row, the tooltip text in the collapsed state, and the accessible name.
- It does not change same-name displays elsewhere in DSH (Settings, command palette, etc.), and does not change the original name declared by the contributor.
- The first version is a **single string**, effective for all languages.

### 2.5 Icon override

Three sources, and you can switch back to the original icon at any time:

1. **Keep the original icon** (default);
2. **Built-in icon set** — a small set of inline vector icons shipped with this plugin (zero dependencies, 24 generic glyphs), usable offline. They are drawn to **DSH's own icon spec** — the canvas, weight and construction `@deepseek-ai/dsh-client-ui-primitives` draws its product icons to: `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"` at the **Medium 1.3px** weight (`Icon*OutlineMedium`, the weight the rail rows and the settings navigation already use), geometry on the 16 grid at half-step coordinates with one unit of clearance from the edge, round caps and joins, `aria-hidden` and no ids or external references. The settings tab's own icon is one of these glyphs (`list`), painted as a masked `currentColor` shape where the shell would otherwise draw its fallback gear;
3. **User-uploaded icon** — paste SVG source;
   - Allowlist sanitization: removes `script`, `foreignObject`, event attributes, and external references (cases where `href`/`xlink:href` point outside);
   - A single SVG is capped at **64 KB**;
   - Inline rendering (not `<img>`), so it follows the theme's colors.

### 2.6 Groups and Group triggers

- A Group trigger has its **own** icon and name; by default they are pre-filled from the icon and name of the "first item in the Group" (a common name is "More"), and the user can change them.
- The Group trigger's **whole row is clickable**, and clicking it expands the Group menu; a whole-row click is always used to expand the menu and never navigates to a page. The menu lists the Group's members and nothing else: an "Overview" link to the Group's own page used to sit in its title row and was removed on user feedback. That page still exists as the Group's `main` fallback (so selecting the Group id programmatically cannot error) but has no entry point of its own.
- When any item in the Group is active, the **Group trigger is highlighted**, so the user can tell which Group the current page is in without expanding the menu.
- When a Group is created, it is inserted at **the original position of its topmost member** — that is, the Group "grows" where its members already were. The model guarantees this (`createGroup` anchors on the *identity* of the row above the topmost member), so it holds for any gesture.

### 2.7 Group menu

- **Opens on click** (not on hover, to avoid accidental activation).
- Keyboard accessible: `Enter`/`Space` expands, `Esc` closes, and the up/down arrow keys move within the Group.
- When the sidebar is collapsed into the 56 px rail, the menu always **flies out to the right** (flyout).
- The menu scrolls when the number of items in the Group exceeds the visible height; the first version does **not** do an in-Group search box.

### 2.8 Unconfigured items and Orphans

- A newly installed plugin registers a Panel entry you have not touched yet → it is **listed in the sequence straight away** (after the configured entries, arranged by its own order); there is nothing to opt into first.
- The contributor of a Panel entry is uninstalled while the config still holds it → the config is **kept**, the management panel marks it "missing", and offers a "Clean up orphans" button.
- Until you make a STRUCTURAL change (a drag, creating or dissolving a group), this plugin writes **no order at all**: the rail keeps the order its contributors chose. A rename, a re-icon or a hide only overrides that one entry and leaves the order alone — which is what "we do not touch what you did not ask us to touch" means in practice.

### 2.9 How a change takes effect

Config changes **take effect immediately**: no need to restart DSH, no need to reload any plugin, and no need to reload the page. That holds for *every* edit, including the ones that write nothing at all: the rewrite pass compares a digest of everything the rail renders (order, name, icon, visible/hidden) and re-projects when it moves, so a second icon pick or a second rename lands on the rail just like the first one did (ARCHITECTURE §4.5).

### 2.10 Scope of takeover

The management panel **lists the whole rail from the first time it is opened**: there is nothing to "adopt" before you can touch a Panel entry, and there is no "not taken over yet" list. (An earlier design had a "not configured" list with per-item take-over / release buttons; it was removed on user feedback — it only added a step.)

What still holds is the **minimal-intervention property in what gets WRITTEN**, not in the UI:

- The config's `sequence` is **partially authoritative**: it records only what you actually changed.
- A `sequence` that is empty means **no `order` is written at all** (the state right after installation, a pure no-op), and an unconfigured Panel's name/icon/hidden state is left entirely alone; it keeps the contributor's own order.
- Your first structural change (a drag, a merge into a Group) writes the current order out as an explicit sequence; unconfigured entries stay after the configured block in their own native order (README §2.8).

Implementation (`src/shared/model.ts`): `rows` is always the whole rail (an unconfigured row's `order` is `null`, meaning "do not write"), while `reordering` decides whether an `order` is written at all.

---

## 3. Settings tab

Adds one item to the left side of the Settings dialog:

- Name: **Panellist**; position: near the end of the settings navigation;
- Icon: uses the same marking approach as the rest of the ecosystem to replace this row's font icon with this plugin's own icon; if probing fails, it falls back to the kernel's native gear icon (without reporting an error).

Page content:

1. **Sequence editor** — lists the whole rail (every Panel entry from the start, with nothing to adopt first). **Drag and drop** is the main channel (reordering, dragging into an existing Group, dragging a member back out); each row's "Group with next" button creates a Group and "Ungroup" dissolves one; **Move up/Move down** are the keyboard fallback; and every row carries a **"Hide"/"Show"** button that toggles that row's visibility in place (Group rows included). "Nothing is configured yet" is deliberately invisible: the list is the rail either way, and the first drag or grouping writes the order out on its way in — there is no banner and no "starting point" button to click first;
2. **Appearance override for an item** — name, icon (keep the original icon / built-in icon set / paste SVG), opened by clicking that row's name in the list — including a Group's members, which have no row of their own and are otherwise unreachable; visibility is the **"Hide"/"Show"** button on each sequence row (one entry point, not two);
3. **Group editing** — Group trigger name, Group trigger icon, member order;
4. **Config import / export** (JSON);
5. **Open config file** — opens `$DSH_HOME/panellist.json` directly;
6. **Clean up orphans**;
7. **Self-check status** — shows the results of the four self-checks and a "Re-run self-check" button (see section 5).

---

## 4. Config and interfaces (draft)

### 4.1 Location and scope

- File: `$DSH_HOME/panellist.json` (permissions `0600`, written as "temp file + atomic rename", falling back to a direct write when a Windows file lock conflicts);
- Scope: **separated per profile** inside the same file, because different profiles have different plugins installed;
- Migration: the config carries a `schemaVersion`, and an older version is migrated as needed when read;
- Corruption: on a parse failure the **original file is backed up** and defaults are restored, without silently discarding content the user has hand-edited.

### 4.2 Config shape (illustrative)

```json
{
  "schemaVersion": 2,
  "profiles": {
    "desktop": {
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

The authoritative definition is in [docs/config.schema.json](docs/config.schema.json). `sequence` is a **partial** authority: the items it lists follow this order, and items it does not list are appended to the end by the program.

### 4.3 Interfaces this plugin occupies

| Purpose | Identifier |
| --- | --- |
| Settings navigation tab | `settings.section` id = `dsh-panellist` |
| Group row (rail) | `sidebar.panellist` id = `dsh-panellist:<groupId>`, for example `dsh-panellist:group:work` |
| Group overview page (fallback page in the center column, to prevent an error when selecting it) | `main` key = same as above |
| Host-half local route | `/panellist/api` |

Host-half routes (reachable only via local loopback, with a trusted-host fence):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/panellist/api/config?profile=<id>` | Read the config for that profile |
| `PUT` | `/panellist/api/config?profile=<id>` | Write the whole thing (server-side validation + atomic write to disk) |
| `POST` | `/panellist/api/config/reset?profile=<id>` | Revert to defaults |
| `POST` | `/panellist/api/reveal` | Reveal the config file in the system file manager (the "Open config file" button) |
| `GET` | `/panellist/api/health` | Config storage and field-level self-check status |

`?profile=` only accepts ids that actually exist under `$DSH_HOME/profiles/<id>`; without the parameter, the config is written to the host's own profile (`DSH_PROFILE`). `/health` and `/reveal` are whole-file level and ignore the parameter.

Export contracts of the two halves (consistent with the ecosystem):

- Host half: `name`, `inject`, `apply(ctx, config?)`
- Browser half: `apply(ctx)`, `inject`
- Manifest: `dsh.bundle.patch` (auto-mount) + `dsh.client.{inject,platform}`

---

## 5. Compatibility, self-checks, and degradation

**Version floor**: `engines.dsh: ">=0.2.0-rc.2 <0.3.0-0"` (matches the kernel version used for development; the type packages are available on npm at the same version, so contract drift is caught at compile time).

This plugin depends on four **internal** facts about DSH (none of them a public contract), so it self-checks each one at startup:

| Internal fact relied on | Consequence when it breaks | How it is probed (`src/client/rail/probe.ts`) | Degradation |
| --- | --- | --- | --- |
| The slot registration object is not frozen, so `order`/`label`/icon component can be rewritten afterwards | Order, name, and icon cannot be changed | Temporarily register a probe row, rewrite its `order`, and read it back through `entriesOfSlot`; also check that neither the object nor its `options` is frozen | Disable rewriting, read-only |
| The DOM structure of a rail row can be located, and CSS supports the `:has()` selector | The "hidden" state stops working | `CSS.supports('selector(:has(*))')`, plus counting rows with **exactly the same** selector as the hiding rule and comparing the count against the number of rail registrations (when the rail is not mounted, this counts as a pass with the reason stated) | Disable hiding (keep the other rewriting), show a read-only notice |
| The shell still passes "is active" to the icon component (a hidden active Panel entry needs it) | A hidden active Panel entry cannot show its row temporarily | Temporarily register a probe row and wait two frames to confirm that its icon component really is rendered and that the `active` it receives is a boolean | That rule fails: hiding becomes unconditional hiding |
| The settings navigation button can be located by visible text | The settings tab icon cannot be replaced | When the dialog is open, match this plugin's own row by text; when it is not open, this counts as a pass with a note (marking is re-run by a `MutationObserver` on every open) | Keep the native gear icon |

- If any self-check fails → **degrade to read-only**: no further rewriting is done, the top of the management panel gives a clear notice (which item failed, what it affects, and how to report it), and the "Re-run self-check" button is kept.
- It never silently half-breaks, and never blocks plugin loading (the UI is still usable after a DSH upgrade).
- Known uncertainty: DSH's style class names are **build hashes** and are re-rolled at release time. So selectors always match on a "stable suffix" (for example `[class*="_panelRow"]`, measured to work; `[class$="_panelRow"]` fails on the active row), and probing is repeated on every mount.

---

## 6. Installation and development

### User installation (after release)

```bash
dsh plugin --profile desktop add dsh-panellist
```

The package manifest declares the auto-mount layer, so there is no need to hand-edit the profile config.

### Local development (current stage)

```bash
# In the root of this repository
pnpm install
pnpm build

# Mount this repository into the desktop profile via link (DSH must be fully closed first)
dsh plugin --profile desktop add link:E:/ai-code-space/dsh-panellist

# Development loop
pnpm watch      # tsdown --watch, rebuilds the browser half, hot-loaded by client HMR, no page refresh needed
```

Note: `link:` does not install this repository's own dependencies, so run `pnpm install` first; the desktop build requires the profile to be initialized and the app to be closed.

**Rollback** (taking the plugin out of the profile):

```bash
dsh plugin --profile desktop remove dsh-panellist
```

If the uninstall is not clean, edit `~/.dsh/profiles/desktop/package.json` directly: delete `dsh-panellist` from `dependencies` and the same-named string from `dsh.profile.bundles`, then delete `node_modules/dsh-panellist`. The config file `$DSH_HOME/panellist.json` is the only external state, and deleting it restores the factory state.

Disabling or uninstalling the plugin leaves no residue: the order/`label`/component of registrations are restored, Group rows are released, the injected stylesheet is removed, and all marker attributes are cleared (`dispose` in `src/client/registry/rail.tsx`).

### Quality gates

```bash
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run (jsdom)
pnpm build      # tsc (declarations only) + tsdown (host half + browser half)
pnpm check      # all of the above
```

Tests cover three areas: the **model** (normalization, serialization, migration, and corruption fallback for Sequence/Groups/overrides), the **management panel interactions** (drag and drop, move up/down, icon selection, SVG sanitization, import and export), and the **degradation paths** (read-only behavior after each of the four self-checks fails). No E2E against the real DSH UI is introduced.

---

## 7. Directory structure

```
dsh-panellist/
├─ src/
│  ├─ index.ts                # host half entry (re-exports plugin/index)
│  ├─ plugin/                 # host half: config storage, local routes, migration and corruption fallback
│  │  ├─ index.ts             # name / inject / apply
│  │  ├─ store.ts             # file storage: ajv validation, 0600 atomic write, corruption isolation
│  │  └─ routes.ts            # /panellist/api handlers (loopback fence, four endpoints + reveal)
│  ├─ shared/                 # types and config model shared by the two halves (side-effect free)
│  │  ├─ config.ts            # document shape, built-in icon names, id prefixes
│  │  ├─ model.ts             # buildPlan: Sequence → what each row should write (pure function)
│  │  ├─ edit.ts              # Sequence/Group edit operators (pure functions, keeping the "exactly once" invariant)
│  │  ├─ migrate.ts           # schemaVersion migration framework
│  │  ├─ validate.ts           # lenient reading on the browser half
│  │  └─ protocol.ts          # route paths and cross-half JSON shapes
│  └─ client/                 # browser half
│     ├─ index.tsx            # apply(ctx): assembly order, styles, self-checks, language
│     ├─ controller.ts        # the single loop of config -> plan -> rewrite / Group rows
│     ├─ contracts.ts         # frozen interfaces between units
│     ├─ ctx.ts               # type augmentation only: ctx.slots / ctx.layout / slot declarations
│     ├─ styles.ts            # the single injected stylesheet (aggregates each unit's CSS block by id)
│     ├─ mount.ts             # one live mount per page: a second apply retires the previous one
│     ├─ service.ts           # fault-tolerant reading of optional cordis services
│     ├─ config/store.ts      # config state: optimistic apply, rollback on failure, import/export
│     ├─ i18n/index.ts        # Chinese and English entries (the key set is closed)
│     ├─ registry/rail.tsx    # registry discovery + rewrite + sync jitter + our own rows
│     ├─ rail/css.ts          # the one and only DOM rule (hiding) + Group highlight + settings nav icon marking
│     ├─ rail/probe.ts        # the four self-checks and the degradation decision
│     ├─ groups/              # Group trigger rows, capture-phase click interception, popup menu, overview page
│     ├─ settings/            # settings tab: Sequence editing, appearance overrides, config, self-checks
│     └─ icons/               # 24 built-in icons + SVG allowlist sanitization
├─ tests/                     # 21 specs (model, host half, rewriting, mount guard, probe, groups, settings, icons, copy consistency, packaging contract)
├─ docs/
│  ├─ adr/0001-registry-rewrite-plus-minimal-dom.md
│  ├─ ARCHITECTURE.md
│  └─ config.schema.json
├─ GLOSSARY.md
├─ README.md             # English
└─ README.zh-CN.md       # this file
```

---

## 8. First-version scope and non-goals

**First version includes**: Sequence editing (drag and drop + keyboard fallback), Groups, Shown/Hidden, Label and Icon override (original icon / built-in icon set / paste SVG), config import/export, Orphan retention and cleanup, a Chinese and English UI, self-checks and read-only degradation, a bilingual README + screenshots.

**Not in the first version** (left for v1.1): search within a Group, a right-click context menu on the rail, per-language names, and E2E against the real DSH UI.

**Non-goals**: managing the right-column card tabs; managing the tab order of the Settings dialog itself; changing the content of any plugin page; replacing the DSH built-in Panellist.

---

## 9. Milestones

1. ✅ **Design documents**;
2. ✅ **Skeleton** — tsdown + tsc + vitest, manifest and auto-mount layer;
3. ✅ **Minimal closed loop** — registry rewrite (order/name/icon/hidden flag) → hiding → settings tab → persistence;
4. ✅ **Groups** — Group trigger rows, popup menus, drag-and-drop editing, the Group overview fallback page;
5. ✅ **Hardening** — the four self-checks and read-only degradation, SVG sanitization, import/export, Orphan cleanup, bilingual;
6. ⏳ **Verification and release** — tests are complete (21 specs / 285 cases, `pnpm check` all green); **TODO: on-device verification (mount into the desktop profile via `link:` and restart DSH) and screenshots, then decide whether to publish to npm**.

On-device verification must happen with DSH fully closed (see the link install and rollback in §6), because it modifies the profile's `node_modules`.

### Static checks that need no application start

The mount layer can be verified offline: point the CLI at any **non-desktop** profile with this repository's patch layered on top.

```bash
# Create a throwaway profile (derived from the shipped web template), layer this
# repository's mount patch onto it, and print the composed tree only.
dsh panellist-dryrun --from-default-profile web \
  --patch E:/ai-code-space/dsh-panellist/cordis.patch.yml --dump-config
```

The composed tree contains (measured on this machine):

```
# == E:/ai-code-space/dsh-panellist/cordis.patch.yml
- id: panellist
  name: dsh-panellist
```

Nothing is served and nothing is installed; delete `$DSH_HOME/profiles/panellist-dryrun` afterwards. `desktop` itself is managed exclusively by the Electron application and the CLI refuses it outright — deliberate, and the reason this recipe uses a throwaway profile. `tests/manifest.spec.ts` turns the consistency invariants (package name = the plugin's `name` export = the patch's `name`, every runtime-read file listed in `files`, one source of truth for the schema version and the route prefix) into cases that run on every `pnpm check`.

---

## License

MIT
