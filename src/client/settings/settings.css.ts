/**
 * The settings page's CSS chunk (README §3, ARCHITECTURE §6).
 *
 * Every class is namespaced `dsh-panellist-settings-`. Colour comes from the
 * shell's own alias tokens (`--dsw-alias-*`, the names the shipped settings
 * sections use), each read through a `var(…, <theme-neutral fallback>)` so the
 * page still reads correctly when the tokens are absent (tests, a shell that
 * renamed them): the fallbacks are `currentColor` mixes and transparent fills,
 * never a light-only or dark-only literal.
 *
 * Registered once by `settings/index.tsx` through `deps.styles.register`.
 */
export const SETTINGS_CSS = `
.dsh-panellist-settings {
  --dsh-panellist-line: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  --dsh-panellist-hairline: var(--dsw-alias-hairline, color-mix(in srgb, currentColor 10%, transparent));
  --dsh-panellist-fill: color-mix(in srgb, currentColor 5%, transparent);
  --dsh-panellist-fill-strong: color-mix(in srgb, currentColor 11%, transparent);
  --dsh-panellist-muted: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
  --dsh-panellist-secondary: var(--dsw-alias-label-secondary, currentColor);
  --dsh-panellist-accent: var(--dsw-alias-accent, currentColor);
  --dsh-panellist-danger: var(--dsw-alias-state-error-primary, currentColor);
  --dsh-panellist-warn: var(--dsw-alias-state-warn-primary, currentColor);

  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.5;
}

.dsh-panellist-settings *,
.dsh-panellist-settings *::before,
.dsh-panellist-settings *::after {
  box-sizing: border-box;
}

.dsh-panellist-settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dsh-panellist-settings-headerText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsh-panellist-settings-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.dsh-panellist-settings-subtitle {
  margin: 0;
  color: var(--dsh-panellist-muted);
}

.dsh-panellist-settings-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--dsh-panellist-line);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3, transparent);
}

.dsh-panellist-settings-blockTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.dsh-panellist-settings-hint {
  margin: 0;
  color: var(--dsh-panellist-muted);
}

.dsh-panellist-settings-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsh-panellist-line);
  border-left-width: 3px;
  border-radius: 10px;
  background: var(--dsh-panellist-fill);
}

.dsh-panellist-settings-banner-warn {
  border-left-color: var(--dsh-panellist-warn);
}

.dsh-panellist-settings-banner-error {
  border-left-color: var(--dsh-panellist-danger);
}

.dsh-panellist-settings-action {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsh-panellist-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.dsh-panellist-settings-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-panellist-fill-strong));
}

.dsh-panellist-settings-action:disabled {
  color: var(--dsh-panellist-muted);
  cursor: default;
  opacity: 0.6;
}

.dsh-panellist-settings-actionRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.dsh-panellist-settings-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-panellist-settings-dropZone {
  min-height: 8px;
}

.dsh-panellist-settings-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--dsh-panellist-hairline);
  border-radius: 10px;
  background: var(--dsh-panellist-fill);
}

.dsh-panellist-settings-row[data-dragging='true'] {
  opacity: 0.5;
}

.dsh-panellist-settings-row[data-selected='true'] {
  border-color: var(--dsh-panellist-accent);
}

.dsh-panellist-settings-rowMain {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-panellist-settings-rowSelect {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-panellist-settings-rowSelect:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-panellist-fill-strong));
}

.dsh-panellist-settings-rowGlyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.dsh-panellist-settings-rowName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-panellist-settings-badges {
  flex: none;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dsh-panellist-settings-badge {
  padding: 0 6px;
  border: 1px solid var(--dsh-panellist-hairline);
  border-radius: 999px;
  background: transparent;
  color: var(--dsh-panellist-muted);
  font-size: 11px;
  line-height: 16px;
}

.dsh-panellist-settings-badge[data-badge='missing'] {
  border-color: var(--dsh-panellist-danger);
  color: var(--dsh-panellist-danger);
}

.dsh-panellist-settings-badge[data-badge='locked'] {
  border-color: var(--dsh-panellist-warn);
  color: var(--dsh-panellist-warn);
}

.dsh-panellist-settings-actions {
  flex: none;
}

.dsh-panellist-settings-members {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 0 0 24px;
  list-style: none;
}

.dsh-panellist-settings-member {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 8px;
}

.dsh-panellist-settings-member:hover {
  background: var(--dsh-panellist-fill-strong);
}

.dsh-panellist-settings-memberName {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-panellist-settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dsh-panellist-settings-fieldLabel {
  color: var(--dsh-panellist-secondary);
  font-weight: 600;
}

.dsh-panellist-settings-input,
.dsh-panellist-settings-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--dsh-panellist-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.dsh-panellist-settings-textarea {
  min-height: 64px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.dsh-panellist-settings-radioRow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.dsh-panellist-settings-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.dsh-panellist-settings-iconGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: 4px;
}

.dsh-panellist-settings-iconCell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--dsh-panellist-hairline);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dsh-panellist-settings-iconCell[aria-pressed='true'] {
  border-color: var(--dsh-panellist-accent);
  background: var(--dsh-panellist-fill-strong);
}

.dsh-panellist-settings-preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dsh-panellist-settings-switchRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.dsh-panellist-settings-switchRow input {
  margin: 2px 0 0;
}

.dsh-panellist-settings-error {
  margin: 0;
  color: var(--dsh-panellist-danger);
}

.dsh-panellist-settings-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsh-panellist-line);
  border-radius: 10px;
  background: var(--dsh-panellist-fill);
}

.dsh-panellist-settings-plainList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-panellist-settings-plainList li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsh-panellist-muted);
}

.dsh-panellist-settings-lockedRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dsh-panellist-settings-probeList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-panellist-settings-probe {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-panellist-settings-probeHead {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.dsh-panellist-settings-probeState {
  color: var(--dsh-panellist-muted);
  font-size: 11px;
}

.dsh-panellist-settings-probe[data-ok='false'] .dsh-panellist-settings-probeState {
  color: var(--dsh-panellist-danger);
}

.dsh-panellist-settings-probeImpact {
  margin: 0;
  color: var(--dsh-panellist-muted);
}

.dsh-panellist-settings-probeDetail {
  color: var(--dsh-panellist-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.dsh-panellist-settings-warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--dsh-panellist-muted);
}

.dsh-panellist-settings-unmanaged summary {
  cursor: pointer;
  font-weight: 600;
}
`.trim()
