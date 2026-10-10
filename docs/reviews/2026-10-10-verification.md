# Independent verification — dsh-panellist (2026-10-10)

Verifier: `verifier2` (independent; wrote none of this code).
Scope: the 9 items of the verification brief against `README.zh-CN.md` §2–§5/§8,
`docs/ARCHITECTURE.md` and `docs/adr/0001-registry-rewrite-plus-minimal-dom.md`.
Environment: Windows, `node v24.21.0`, `vitest 3.2.7`, pnpm workspace `E:\ai-code-space\dsh-panellist`.

Method note: findings 1–17 were derived by reading the source and by running the real
modules — `src/shared/*.ts` directly through Node type-stripping, and `src/client/registry/rail.tsx`
through an in-memory esbuild bundle (`data:` URL import, no files written) driven by a fake
slot ledger. The Lead edited `src/shared/edit.ts` and `src/shared/model.ts` during the review;
everything below was re-checked against the post-fix tree.

## Measured baselines (item 1)

| when | command | result |
| --- | --- | --- |
| first pass | `pnpm exec tsc -p tsconfig.json --noEmit` | exit 0, no diagnostics |
| first pass | `pnpm exec vitest run` | exit 0 — `Test Files 18 passed (18)`, `Tests 243 passed (243)` |
| after the Lead's F2/F3 fixes | `pnpm exec tsc -p tsconfig.json --noEmit` | exit 0, no diagnostics |
| after the Lead's F2/F3 fixes | `pnpm exec vitest run` | exit 0 — `Test Files 18 passed (18)`, `Tests 247 passed (247)` |

No test failed because a file changed under me; the count moved only because the Lead added
regression cases. (The Lead's message said 246; I measure 247 twice in a row on the post-fix tree —
the extra case is `shared-model.spec.ts` going 19 → 20. Treat the exact number as informational.)

## Summary

| # | claim | verdict | evidence |
| --- | --- | --- | --- |
| 1 | typecheck and the full suite are green | VERIFIED | `tsc` exit 0; `vitest` 18 files / 243 then 247 tests |
| 2 | the six README §2.2 examples match `buildPlan` | VERIFIED | real-`buildPlan` probe reproduced all six row orders |
| 2b | README §2.2 row `a b c` → `[a][b][c]` is unambiguous | REFUTED (doc) | only true when nothing else is registered; real output is `a b c d e` |
| 3 | `buildPlan` core invariants (once each, members take no slot, locked untouched, order gated on live rows, unmanaged appended in native order) | VERIFIED | `model.ts:183-361` + probes; see 3a |
| 3a | a fresh install is a strict no-op on the rail | REFUTED / **MAJOR** | a label-less registration gets `options.label` written and the ledger nudged |
| 3b | `Plan.groups` doc comment ("only groups with ≥1 live member") | REFUTED (doc) | dormant groups are in the map (`model.ts:316-332` over `groupItems`, which includes `model.ts:254`) |
| 3c | `PlanPanel.managed` doc ("anything beyond `order`") | REFUTED (doc/NIT) | `model.ts:311`; `managed` is set but never read anywhere in `src/` |
| 3d | a group whose **rail** id is taken is rejected | VERIFIED after fix | `model.ts:207`; both identities now warn and render no row |
| 4 | every structural settings edit materializes first | REFUTED / MINOR | `AppearanceEditor.tsx:313` runs `setPanelLocked` (a sequence edit) through `apply` |
| 4b | a drag-and-drop path can duplicate or lose a panel id | VERIFIED (none found) | all four handlers in `SequenceEditor.tsx:160-209` funnel into `addToGroup`/`removeFromGroup`/`moveRowTo`/`moveMemberTo`, each of which re-places rather than inserts |
| 4c | `createGroup` lands at the topmost member's position | VERIFIED after fix | all five probe cases, including the three new specs' cases |
| 4d | README §2.6 "拖拽新建分组" exists in the UI | REFUTED (doc) | no drag gesture creates a group; only the "Group with next" button calls `createGroup` |
| 5 | `sanitizeSvg` cannot execute script, load an external resource or escape the SVG | REFUTED / **BLOCKER** | CDATA payload → live `<img src>`/`onerror` in the consumer's `innerHTML` |
| 5b | `xmlns` cannot be re-bound | REFUTED (NIT) | root/nested `xmlns` is in the allow-list and survives (`sanitize.ts:135`, `:304`) |
| 6 | no request reaches a disk write without both fences; `?profile=` cannot traverse | VERIFIED | `routes.ts:264-267` then `:289-293` precede every `store.write`/`resetProfile`; `PROFILE_ID_RE` has no path separator |
| 6b | the `Host` fence parses authorities strictly | REFUTED (NIT) | `hostnameOf('[::1]evil.com')` → `::1` |
| 7 | `applyOverrides` is idempotent and non-nudging on a repeat | VERIFIED | executed probe: 0 nudges on repeated passes; wrapper object identity stable |
| 8 | no user-visible string outside `i18n`; no key used but missing | VERIFIED (NIT residue) | 75 literal keys used in `groups/**`+`settings/**`, all present; only the sanitizer's English `reason` strings leak |
| 9 | `settings/harness.tsx` cannot reach the shipped output | REFUTED (partial / MINOR) | absent from `lib/client.js`, but published as `lib/types/client/settings/harness.d.ts` |

---

## BLOCKER

### F1 — the SVG allow-list can be escaped with a CDATA section (item 5)

`sanitize.ts:298` only strips comments and processing instructions; it never inspects text
nodes. `XMLSerializer` re-emits a CDATA text node as a raw `<![CDATA[…]]>` section, and
`icons/index.tsx:62` hands that string to `dangerouslySetInnerHTML` on an HTML `<span>` — where
the HTML parser treats `<![CDATA[` as a **bogus comment** and parses everything after the first
`>` as live markup. `sanitizeSvg` returns `ok: true` for all of these.

Minimal reproduction (real module, jsdom globals):

```
input:  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><desc><![CDATA[</desc>
        <img src="http://evil.example/beacon.png?a=1">]]></desc><path d="M0 0h1 1z"/></svg>
=> sanitizeSvg: { ok: true, svg: '…<desc><![CDATA[</desc><img src="http://evil.example/beacon.png?a=1">]]></desc>…' }
=> span.innerHTML = svg  →  querySelector('img')  = img[src=http://evil.example/beacon.png?a=1]
```

Same with `<iframe src="http://evil.example/frame.html">` → a live `iframe` node. With an event
attribute the payload becomes script execution:

```
input:  …<![CDATA[</desc><img src="x" onerror="window.__pwned=1">]]>…
=> sanitize ok: true; injected node: img[src=x][onerror=window.__pwned=1]
```

`<img src=x onerror=…>` is the textbook `innerHTML` XSS: the handler runs when the image fails
to load. (`<script>` also lands in the DOM as a real element; it does not run there, which is why
the `onerror` form is the one that matters.) `icons/index.tsx` deliberately re-sanitises on every
render because `panellist.json` is hand-editable, so this is reachable from a config file, not only
from a paste.

**Impact** — arbitrary network requests from the DSH renderer (beacons/CSRF against anything
listening on loopback) and arbitrary script execution in the renderer origin; the module's central
guarantee ("`<script>` … rejected outright", README §2.5) does not hold for the serialized string
that is actually injected.

**Suggested fix (cheapest first)**
1. Reject any source containing `<![CDATA[` (and `]]>`) before parsing.
2. Or neutralise CDATA before serializing: walk the tree, replace every `CDATA_SECTION_NODE`
   with an escaped text node, and only then `XMLSerializer`.
3. Belt-and-braces: after serializing, re-parse the result as XML and assert the element set
   equals the sanitized set and that the string contains no `<` inside a text position.
4. Best long-term: stop routing through `dangerouslySetInnerHTML` — build the glyph by importing
   the sanitized nodes into an SVG-namespaced element (`document.importNode`) instead of parsing a
   string as HTML.

---

## MAJOR

### F2 — a fresh install is not a no-op for a registration without a label (items 3, 4)

README §2.11 and `model.ts:13` promise "序列为空 = 本插件对轨道只读（新装即如此，纯 no-op）" /
"a fresh install is a strict no-op on the rail", and `model.ts:10` says an unmanaged panel gets
"no name/icon/hide write". Both are false for a contributor that registers a panel **without** a
`label`: `model.ts:306` substitutes the raw id (`effectiveLabel(...) || panel.id`), so
`PlanPanel.label` is never empty; `rail.tsx:243-251` compares it against `resolveLabel(captured.label)`
(which *is* `undefined`) and writes our label thunk.

Minimal reproduction (real `rail.tsx` via esbuild + a fake ledger, empty profile):

```
registrations: {id:'labelled', order:5, label:'Native L'}, {id:'bare', order:15}      # no label
profile:       { sequence: [], entries: {}, locked: [] }
plan:          reordering = false, panels.get('bare').managed = false
after applyOverrides():
  bare.options.label === undefined  ->  function -> "bare"      # WRITTEN
  ledger nudges = 1
```

**Impact** — on every fresh install (or any profile whose sequence is empty), each label-less row
gets a label written and the shell is nudged to re-project the rail. The row text changes from
whatever the shell rendered for an absent label to the raw panel id, and the plugin performs rail
writes with zero user configuration — exactly the "最小冲突面" guarantee other plugins rely on.

**Suggested fix** — carry the "did the user ask for a name" bit on the panel the way groups already
do (`PlanGroup.labelExplicit`, `model.ts:325`): add `PlanPanel.labelExplicit` (or let `label` stay
`''`) and have `rail.tsx` write a label only when it is true; keep the id fallback for rendering.

---

## MINOR

### F3 — one structural edit path skips `materializeSequence` (item 4)

`SequenceEditor.tsx` routes every drag, move, group and ungroup through `applyStructural`
(`Section.tsx:85-88`), which materializes first. But the locked switch in the appearance editor is a
sequence edit — `setPanelLocked` calls `withoutPanel` (`edit.ts:107-116`) — and it goes through the
non-materializing `apply`:

`src/client/settings/AppearanceEditor.tsx:313`
```ts
onChange={event => apply(edit => setPanelLocked(edit, panelId, event.target.checked))}
```

That contradicts the file's own doc comment (`AppearanceEditor.tsx:9`, "structural edits … are
materialized first by the caller") and README §3.1.

**Minimal reproduction (reasoning on the real functions)** — sequence `[a]` (partial),
registered `a,b,c`, so `plan.rows = [a,b,c]`. Locking `a` through this path gives
`withoutPanel([{entry:a}], 'a') = []` → sequence empty → `reordering = false` → `plan.rows = []`:
the editor empties and the explicit order taken over for `b`/`c` is dropped back to native.
Through `applyStructural` the sequence would have become `[b,c]` and kept managing them.

**Suggested fix** — pass `applyStructural` here (locking/unlocking is a sequence edit), or
document why locking is exempt.

### F4 — `Plan.groups` contradicts its doc comment (item 3)

`model.ts:116-119` documents `groups` as "Every group with at least one live member", but
`model.ts:316-332` iterates `groupItems`, which also receives dormant groups (`model.ts:250-254`).

```
profile: sequence [G{ghost1,ghost2}], registry [a,b]
=> dormantGroups = ["group:g1"], groups.keys() = ["group:g1"],
   groups.get('group:g1').order = null   (while PlanGroup.order says "never null for a rendered group"),
   groups.get('group:g1').label = "group:g1"   (raw id, no live member to borrow from)
```

The behaviour is arguably useful (the settings page can still reach a dormant group), but the type's
contract as written is not the code's. Also `groupUnit.sync()` (`groups/index.ts:77`) already skips
`liveMembers.length === 0`, so the two units disagree about what the map means. Fix: update the
comment to "every configured group, including dormant ones", or filter the map and expose dormant
groups only through `dormantGroups`.

### F5 — README §2.6's drag-to-create-group gesture does not exist, and the group name deviates

README §2.6 specifies where a **drag-created** group lands and that the header defaults to the first
member's icon and name. The UI has no drag-to-create gesture (`SequenceEditor.tsx:160-209`: dropping
onto a row either reorders, joins an existing group, or leaves a group), and the one creator,
`groupWithNext` (`SequenceEditor.tsx:145-154`), passes an explicit label:

```ts
createGroup(profile, groupId, [row.id, next.id], { label: t('settings.sequence.newGroupName') })
```

so every new group is persisted with an explicit "More"/"更多" instead of the first member's name,
and the stored name is frozen in the language that was active at creation. Fix: either implement the
drag gesture and the first-member default, or narrow README §2.6 to describe the button.

### F6 — the sanitizer's rejection reasons are English-only

`sanitize.ts:213-285` builds user-facing English sentences that are interpolated into a translated
template (`settings.appearance.iconCustomInvalid`, `i18n/index.ts:62`). A Chinese user sees
`这个 SVG 被拒绝：<foreignObject> is not allowed`. README §8 claims a bilingual interface. Fix: return
a structured reason code plus parameters and translate at the render site.

### F7 — `harness.d.ts` ships in the published type surface (item 9)

`tsconfig.build.json` declares `"include": ["src"]` with `declarationDir: lib/types`, and
`package.json`'s `files` contains `lib/types`, so `lib/types/client/settings/harness.d.ts`
(2 579 bytes) is published even though nothing in `src/` imports it.

| check | result |
| --- | --- |
| `lib/client.js` contains harness-only symbols (`createHarness`, `dsh-panellist-harness-glyph`) | 0 matches — the code is not bundled |
| importers of `harness.tsx` | `tests/settings-*.spec.tsx` and `tests/groups-*.spec.tsx` only |
| what that d.ts imports | only shipped modules (`shared/config`, `shared/model`, `client/contracts`, `client/i18n`, …) — no devDependency leaks into the types, so it does not break consumers |

**Cost** — one dead declaration file and an unintended public API (`createHarness`, `Harness`,
`HarnessOptions`) that becomes part of the package's type contract and must keep compiling. Fix:
`"exclude": ["src/**/*.test.*", "src/client/settings/harness.tsx"]` in `tsconfig.build.json`, or move
the harness to `tests/helpers/`.

---

## NIT

### F8 — README §2.2 row `a b c` is under-specified

The row is only `[a][b][c]` when nothing else is registered. Measured with the real `buildPlan`
(registry `a…e`, sequence `[a,b,c]`): `=> a b c d e`, which is correct per §2.8/§2.11 but not what
the table alone conveys. The other five rows reproduce exactly.

### F9 — README §9 test counts are stale

`README.zh-CN.md:337` says "17 个 spec / 239 条用例"; `README.zh-CN.md:308` says 17 specs. Measured
`18` spec files and `243` (later `247`) tests. (The Lead is refreshing this.)

### F10 — identical branches in `materializeSequence`

`edit.ts:167-172`: `if (isEntryItem(item)) rebuilt.push(item) else rebuilt.push(item)` — the
distinction the comment promises ("Orphans and dormant groups keep their configuration") is not
made in code. Harmless today, but it reads like a lost intent.

### F11 — `managed` is dead and mis-documented

`model.ts:68` documents `managed` as "writes anything **beyond** `order`", but `model.ts:311` sets it
`true` for a panel that only gets an `order` write (an appended unmanaged panel). No production code
reads `managed` at all, which is part of why F2 went unnoticed. Either use it as the write gate in
`rail.tsx` or delete it.

### F12 — `Host` fence accepts a malformed authority

`routes.ts:74-84`: `hostnameOf('[::1]evil.com')` returns `::1`, which is in `LOOPBACK_HOSTNAMES`, so
the request passes the host half of the fence. Not reachable through a URL a browser will send
(`[::1]evil.com` is not a valid URL host), hence a nit: require the authority to end at `]` or `]:port`.

### F14 — `xmlns` is preserved and can be re-bound (item 5)

`xmlns` is in `ALLOWED_ATTRIBUTES` (`sanitize.ts:135`) and the normaliser only adds a missing one
(`sanitize.ts:304`), so a source can pin a different namespace:

```
in : <svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 24 24">…</svg>
out: <svg xmlns="http://www.w3.org/1999/xhtml" …>            (ok: true)
in : <h:svg xmlns:h="http://www.w3.org/1999/xhtml" …>…</h:svg>
out: <h:svg xmlns:h="http://www.w3.org/1999/xhtml" … xmlns="http://www.w3.org/2000/svg">…  (ok: true)
```

No escape follows from it on the real consumer path: the HTML fragment parser creates an SVG element
for an `<svg>` start tag and ignores `xmlns` as a foreign attribute, and the prefixed form becomes an
`HTMLUnknownElement` (a silently blank glyph, not script). Reported as a nit because it shows the
allow-list is validating XML namespace syntax it does not control — fix by dropping any `xmlns`
attribute from the output and always writing the SVG namespace, or by rejecting a root whose
namespace is neither SVG nor absent.

### F13 — literal glyphs and unused keys

The move buttons render `↑`/`↓`/`−` as text with translated `aria-label`/`title`
(`SequenceEditor.tsx:276-355`, `AppearanceEditor.tsx:237-254`) — acceptable, but they are untranslated
visible glyphs. Unused dictionary keys: `common.applied`, `common.close`, `common.copy`,
`common.reset`, `common.retry`, `settings.sequence.orphanSection`, `error.route`, `error.health`.

---

## VERIFIED in detail

### Item 6 — the two fences and `?profile=` (no bypass found)

`createApiHandler` checks `isLoopbackRequest` first (`routes.ts:264-267`, before any parsing) and
`resolveProfile` second (`routes.ts:289-293`, `:330-334`) before `store.write` / `store.resetProfile`.
Every write path in the host half goes through those two cases; `reveal` runs `explorer /select,<configPath>`
with a path derived from `$DSH_HOME`, never from the request. Traversal: `PROFILE_ID_RE` (`routes.ts:42`,
mirrored at `store.ts:49`) admits no `/`, `\` or `:`; `profileId` reaches the filesystem in exactly one
place, `store.ts:370` (`join(home, 'profiles', profileId)`), and only as a JSON key inside the document
everywhere else (`withProfile`, `store.ts:180-188`), so `?profile=../../x` is a 400 and a reserved
device name such as `NUL` cannot select another profile's file.

One caveat I cannot settle from inside this workspace (**UNVERIFIABLE**): the fence trusts
`req.socket.remoteAddress`. If the DSH web server ever sits behind a same-host reverse proxy, every
peer is loopback and the fence collapses to the `Host` check alone. Whether that deployment exists is a
DSH-level fact, not visible here.

### Item 7 — `applyOverrides` idempotence

Executed against a fake ledger (0 nudges expected on a repeat pass):

```
pass1:                                     a.order=10  b.labelType=function  nudges=1
pass2 identical plan                       nudge delta = 0
pass3+4 identical plan                     nudge delta = 0
plan cleared (label restored)              nudge delta = 1
pass after clear                           nudge delta = 0
wrapper object stable across repeats       true
```

Every value that feeds a comparison is cached per capture — `captured.labelThunk ??=`
(`rail.tsx:247`) and `captured.wrapper ??= wrapperFor(...)` (`rail.tsx:263`) — and the write branches
(`:229-273`) all compare against the captured state before writing, so the second pass is a pure read.
The `nudged` latch (`rail.tsx:160-177`) coalesces one nudge per batch. No uncached generated value
that feeds a comparison was found. `groups/index.ts:82` has the same shape (order+label comparison
before re-registering).

### Item 8 — strings and keys

Across the 12 files in `src/client/groups/**` + `src/client/settings/**`: 75 distinct literal i18n keys
are used and all 75 exist in both dictionaries; the only dynamic keys are `` `warning.${code}` `` and
`` `probe.${id}` ``/`` `probe.${id}.impact` ``, whose code/id sets are exactly the six `PlanWarning`
codes and the four probe ids (`rail/probe.ts`) listed by `tests/i18n-coverage.spec.ts`. No literal
user-visible copy was found in either directory (the residue is F6 and the F13 glyphs).

## Not checkable from inside this workspace

- Real-DSH behaviour: the DOM shape of a rail row, `:has()` support, whether `entriesOfSlot` returns
  unfrozen objects, and whether the shell forwards `active` — the four probe facts of README §5 are only
  exercised against fakes here. The README's own §9 notes the on-device run is still pending.
- The renderer's real HTML insertion path: F1 is proven under jsdom's HTML fragment parser, which
  follows the same spec rule (`innerHTML` creates live elements, and does not run `parser-inserted`
  scripts); the `onerror` execution claim itself is standard browser behaviour, not something jsdom
  demonstrates without resource loading.
- Node cannot import `.tsx`, so the rail probes above bundle `rail.tsx` with the workspace's esbuild;
  they exercise `applyOverrides`/`registerRow` but no React rendering.

---

## Lead resolution (appended by the Lead after the report was closed)

Every REFUTED finding above was triaged; all of them are resolved or explicitly accepted. The code
state these resolutions describe was re-measured after the last edit.

| finding | severity | resolution |
| --- | --- | --- |
| F1 CDATA smuggling escapes the allow-list | BLOCKER | **Fixed.** `sanitize.ts` refuses any source containing `<![CDATA[` or `]]>`, converts surviving CDATA nodes to text before serialising, always pins the root `xmlns`, and refuses to return a string that still carries a marker. `tests/icons-hardening.spec.tsx` (7 cases) asserts the security property on the rendered DOM, and reproduction of the original payload is now refused. |
| F2 fresh install writes a label + nudges | MAJOR | **Fixed.** The label comparison now uses the shell's effective value (`resolveLabel(label) ?? id`), so a label-less registration is left untouched. `tests/client-rail.spec.tsx` asserts zero field writes and zero ledger mutations on a fresh install. |
| `createGroup` index-vs-identity | MAJOR | **Fixed** (reported mid-review, re-verified by the verifier). The operator anchors on the identity of the row above the topmost member, and finds members that live inside another group. 3 regression cases in `tests/shared-edit.spec.ts`. |
| group/rail id collision identity | MINOR | **Fixed.** Both the bare id and `groupRailId(id)` are rejected; regression case in `tests/shared-model.spec.ts`. Kept at MINOR because `rail.panels()` filters our namespace, as the verifier established. |
| `setPanelLocked` bypassed `materializeSequence` | MINOR | **Fixed.** The lock switch goes through the materialising path; `tests/settings-appearance.spec.tsx` pins it. |
| `Plan.groups` doc claimed "≥1 live member" | MINOR | **Fixed.** The doc comment now states that dormant groups are present with `order: null` and are listed in `dormantGroups`. |
| new groups hard-coded "More"/"更多" | MINOR | **Fixed.** The trigger name is no longer written at creation, so the default is the first member's own name resolved at render time (README §2.6), which also follows a language switch. The two dead dictionary keys were removed. |
| README §2.6 implied drag-to-create | MINOR | **Fixed in the docs.** Both READMEs now describe the real gestures (drag to reorder / into a group / out of a group; "Group with next" to create) while keeping the position rule, which the model guarantees. |
| English-only sanitiser reasons in translated copy | MINOR | **Fixed.** Refusals carry a closed-set `code`; 4 new dictionary keys map them to a sentence in the user's language, and the raw English reason remains only as the fallback and tooltip text. |
| `harness.d.ts` shipped in the published types | MINOR | **Fixed.** The settings test harness moved to `tests/helpers/settings-harness.tsx`; `src/` is production-only again. |
| stale README test counts | NIT | **Fixed.** Both READMEs now state the measured 19 specs / 255 cases. |
| `managed` documentation, `materializeSequence` duplicate branch, `Host: [::1]evil.com`, xmlns re-binding, literal arrow glyphs, unused keys | NIT | Triaged: the `xmlns` re-binding is closed (the root namespace is now pinned), the two dead keys were removed, and the rest are accepted as-is with no behavioural impact. |

Final measured state, by the Lead, after every fix above:

| command | result |
| --- | --- |
| `pnpm exec tsc -p tsconfig.json --noEmit` | exit 0, no diagnostics |
| `pnpm exec vitest run` | 20 files, 279 tests, all passing |
| `pnpm build` | `lib/index.js` 34.93 kB, `lib/client.js` 96.12 kB, no purity-gate violation |

Standing reminder for the release: the four probe facts in README §5 can only be confirmed against a
real DSH window, which is the on-device step still pending in §9.