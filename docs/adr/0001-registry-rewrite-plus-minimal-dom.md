# Registry rewrite plus a minimum of DOM re-projection

**Status**: accepted

DSH's panel list is a read-only projection: the shell sorts the registered entries by the `order` each contributor declared, and offers no API to change another plugin's entry, hide a row, or nest entries into a group. We therefore manage the rail by (1) rewriting the registered entries at runtime — the stored options object is unfrozen and the entry's icon component is swappable, so order, label and icon need no DOM work at all — and (2) injecting one narrow CSS layer that removes a row from the rail, the only change the registry cannot express. Group rows are ordinary registrations of our own, so the shell still owns their box, highlight, tooltip and collapsed-rail behaviour.

## Considered Options

- **Fully self-rendered rail** — hide every native row and draw the whole rail ourselves. Rejected: we would have to re-implement row geometry, the collapsed 56 px rail, active highlighting, tooltips, theming and the Windows-titlebar cases, and a single DSH release could break all of them at once.
- **Pure DOM rewriting (no registry access)** — leave the registry alone, match rows by their visible text and edit the DOM. Rejected: the shell stamps no per-entry hook on a row, so row identity would rest on label-text matching, and order, label and icon would each need DOM surgery instead of one field write.
- **Read-only inspector** — list the entries and report what is wrong with them without changing anything. Rejected as a product: the point of the plugin is to change the rail.
- **Intercepting `slots.register` before our peers run** — rewrite each registration as it happens. Rejected: `dsh plugin add` appends a new bundle to `dsh.profile.bundles`, so our bundle mounts after the plugins it would intercept; rewriting after the fact is the ordering-independent path.

## Consequences

- The plugin depends on internal facts of DSH that are not contracts: the stored options object not being frozen, the icon component being reachable through the entry, the rail's DOM shape (plus `:has()` support), and the settings navigation being locatable by its visible text. A startup self-check probes each one, and any failure degrades the plugin to read-only instead of half-working.
- CSS-module class names are build hashes that DSH re-rolls per release, so every selector matches on its stable suffix and is re-probed once per mount. A drift probe warns instead of failing silently.
- Raw mutation of an entry bumps no slot version and fires no subscriber, so after each change we nudge the slot (a throwaway registration that is disposed immediately) to make the shell re-read order and label. The nudge is coalesced to at most one per change batch.
- Our own group rows consume real panel ids of the form `dsh-panellist:group:<groupId>` and a matching `main` key. That id space is ours to keep free of collisions, and a group id must never equal a plugin's panel id.
