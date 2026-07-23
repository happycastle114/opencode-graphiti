# opencode-graphiti Dashboard Design System

## 0. Research Log
- Embedded refs: shortlisted Linear, GitHub Primer, and Supabase patterns → picked the operational dashboard guidance plus a restrained developer-tool aesthetic because the viewer is a localhost-only memory inspector, not a marketing page.
- Lazyweb: skipped — the task has no public visual reference and no external product screen is needed to define an operational local tool.
- Imagen drafts: skipped — the dashboard must render live memory data; an image-first contract would not improve this functional surface.

## 1. Atmosphere & Identity
A calm local control surface for durable agent memory. It is compact enough to scan during development but uses layered neutral surfaces to distinguish profile, current knowledge, and replay history. The signature is a thin temporal rail that makes replay data feel ordered without turning the inspector into a decorative dashboard.

## 2. Color

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Surface primary | `--surface-primary` | `#0b1020` | Page background |
| Surface secondary | `--surface-secondary` | `#121a2c` | Panels |
| Surface elevated | `--surface-elevated` | `#19233a` | Timeline rows and cards |
| Text primary | `--text-primary` | `#eef4ff` | Headings and body |
| Text secondary | `--text-secondary` | `#aab8d2` | Context and metadata |
| Text tertiary | `--text-tertiary` | `#71809b` | Muted labels |
| Border | `--border-default` | `#2b3853` | Separation and focus bounds |
| Accent | `--accent-primary` | `#6ee7c7` | Active controls and status |
| Accent hover | `--accent-hover` | `#9af5dd` | Hover states |
| Success | `--status-success` | `#6ee7c7` | Healthy status |
| Warning | `--status-warning` | `#f4c97b` | Partial data |
| Error | `--status-error` | `#ff9b9b` | Failed backend state |

Rules: depth comes from the surface ramp, accent is reserved for state and interaction, and no colors outside this table are used.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|------|------|--------|-------------|-------|
| H1 | 28px | 700 | 1.2 | Dashboard title |
| H2 | 18px | 650 | 1.3 | Panel title |
| Body | 14px | 400 | 1.55 | Memory content |
| Caption | 12px | 500 | 1.4 | Labels and timestamps |
| Mono | 12px | 500 | 1.45 | Session identifiers |

- Primary: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Body text never drops below 14px; captions are only for metadata.

## 4. Spacing & Layout
- Base unit: 4px.
- Tokens: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`.
- Layout: a responsive shell with a maximum content width of 1200px. Desktop uses a two-column detail grid; under 768px it collapses to one column.
- Panels own their internal scrolling only when content exceeds their visible region; the document remains the default scroll owner.

## 5. Components

### Status pill
- Structure: text label in a compact rounded indicator.
- Variants: healthy, warning, error.
- States: static only; status is conveyed by text and color.
- Accessibility: status text remains explicit, not color-only.

### Memory panel
- Structure: heading, optional contextual text, stacked memory rows.
- States: loading skeleton, populated, empty, error.
- Accessibility: semantic heading and list structure.

### Replay timeline
- Structure: session picker, ordered event list with role label, timestamp, and sanitized content.
- States: empty, selected, loading, error.
- Accessibility: keyboard-accessible session buttons with visible focus and no auto-playing behavior.

### Search filter
- Structure: labelled text input filtering visible memory rows client-side.
- States: default, focus, empty result.
- Accessibility: explicit label and live result count.

## 6. Motion & Interaction
- Standard transitions use 150ms ease-out for color and opacity only.
- Session selection and filter updates do not animate layout.
- `prefers-reduced-motion` removes all non-essential transitions.

## 7. Depth & Surface
- Strategy: tonal shift with a subtle 1px border.
- Primary background, secondary panels, and elevated list rows use the surface ramp in Section 2. There are no decorative shadows or glass effects.

## 8. Accessibility Constraints & Accepted Debt
- Target: WCAG 2.2 AA; minimum 4.5:1 contrast for body text; all interactive elements have visible keyboard focus.
- The dashboard is loopback-only and exposes sanitized replay text. It does not provide mutation controls.
- Accepted debt: no graph-force visualization, because the REST client does not expose node topology in a backend-neutral way. The dashboard shows temporal facts and relationships returned by Graphiti instead.
