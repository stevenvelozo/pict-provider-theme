# Architecture

How `pict-provider-theme` turns a theme bundle into a live, mode-aware set of CSS custom properties - and why mode switching needs no JavaScript event handler.

## The big picture

<!-- bespoke diagram: edit diagrams/the-big-picture.mmd or .hints.json, then: npx pict-renderer-graph build modules/pict/pict-provider-theme/docs -->
![The big picture](diagrams/the-big-picture.svg)

The provider holds two things in memory: the registered bundles (and their registration order) and the currently active hash + mode. It persists nothing.

## Tokens become CSS custom properties

`Tokens` is an arbitrary nested object. The provider walks it depth-first and produces a flat list of `{ Path, Value }` leaves. A leaf is either a primitive (`"#ffffff"`, `"12px"`, `400`) or a **paired** object whose only keys are `Light` and `Dark`.

Each leaf path is turned into a custom-property name: lowercased, dots replaced with hyphens, prefixed with `--theme-`.

| Token path | Custom property |
|------------|-----------------|
| `Color.Background.Primary` | `--theme-color-background-primary` |
| `Spacing.MD` | `--theme-spacing-md` |
| `Typography.Family.Sans` | `--theme-typography-family-sans` |

Only values under `Tokens` become custom properties. Everything else in the bundle (`Brand`, `SVG`, `Image`, arbitrary metadata) is reachable through the accessors and template tags but is not emitted into the stylesheet.

## Single-mode vs. paired themes

The `Modes.Strategy` field selects how the CSS is built:

- **`single`** - one mode. The provider emits a single `:root { ... }` block. If any token happens to carry a `{ Light, Dark }` pair, the `Light` side is used. No mode class is meaningful.
- **`paired`** - explicit light/dark, switched by class on `<html>`.
- **`system`** - paired tokens, but the initial mode follows the OS `prefers-color-scheme`.

`paired` and `system` produce the same stylesheet; they differ only in what `applyTheme` does with the `<html>` class. (Both are referred to below as "paired themes".)

## The four-block cascade

For a paired theme, `applyTheme` emits **one stylesheet with four blocks**, ordered so the CSS cascade alone resolves to the correct mode:

```css
/* 1. Baseline: light values + every non-paired token + aliases */
:root {
	--theme-color-background-primary: #ffffff;   /* light */
	--theme-spacing-md: 12px;                      /* non-paired: lives here only */
	--legacy-bg: var(--theme-color-background-primary);  /* alias */
}

/* 2. OS-driven dark override (only the paired tokens flip) */
@media (prefers-color-scheme: dark) {
	:root {
		--theme-color-background-primary: #1a1a1a;
	}
}

/* 3. Explicit light override - wins over @media when the class is present */
.theme-light {
	--theme-color-background-primary: #ffffff;
}

/* 4. Explicit dark override - wins over @media when the class is present */
.theme-dark {
	--theme-color-background-primary: #1a1a1a;
}
```

The ordering is the whole trick:

- With **no class** on `<html>` (system mode), the `@media` rule decides: light by default, dark when the OS prefers dark.
- With **`theme-light`** or **`theme-dark`** on `<html>` (explicit mode), block 3 or 4 wins. They have the same specificity as `:root` but come later in the source, so on a tie the class wins - locking the page to that mode regardless of OS preference.

The consequences:

- **The OS toggle moves the page through CSS alone.** No DOM listener, no class flipping, no re-render. (The test suite asserts the provider attaches zero `matchMedia` listeners under any mode.)
- **Non-paired tokens are emitted only once, in `:root`.** Spacing, typography, radii, and the like are not duplicated into the dark blocks.
- **Aliases live only in `:root`.** Because an alias is `var()` indirection to a paired token, it automatically resolves to the active mode without being duplicated.

For a single-mode theme, only the `:root` block (plus aliases) is emitted - no `@media`, no `.theme-dark`.

## How modes are applied

`_applyMode` is what `applyTheme` and `setMode` call:

- **`light` / `dark`** - writes the matching `theme-light` / `theme-dark` class onto `document.documentElement` (and removes the other). The resolved mode is snapshotted so synchronous reads via `token()` / `getActiveTheme()` are consistent.
- **`system`** - clears both classes so the `@media` rule drives the cascade. The resolved mode is read from `window.matchMedia('(prefers-color-scheme: dark)')`.

In system mode, `token()` and `getActiveTheme().ResolvedMode` re-read the OS preference on each call, so they never report a stale value if the OS toggles between calls - without the provider subscribing to any media-query change.

All DOM access is guarded (`typeof document === 'undefined'` / `typeof window === 'undefined'`), so the provider is safe to construct and exercise server-side or in tests. The bundled tests run against a stubbed `document`.

## Theme inheritance: `BasedOn`

A bundle may declare `BasedOn: '<another-registered-hash>'`. At apply time the provider walks the chain, deep-merges each bundle onto its base (base first, this bundle last), and produces a single **effective** bundle. The merge is cycle-safe: a hash already seen in the chain stops the walk.

This lets a brand variant ship only the tokens it changes:

```javascript
tmpTheme.registerTheme(require('pict-provider-theme/source/themes/pict-default.json'));
tmpTheme.registerTheme({
	Hash: 'acme-brand',
	Comprehensive: false,
	BasedOn: 'pict-default',
	Modes: { Strategy: 'system', Default: 'light' },
	Tokens: { Color: { Brand: { Primary: { Light: '#ff3399', Dark: '#ff66bb' } } } },
	Brand: { Name: 'Acme' }
});

tmpTheme.applyTheme('acme-brand', 'light');
// Color.Brand.Primary -> #ff3399 (overridden)
// Color.Background.Primary -> #ffffff (inherited from pict-default)
// Brand.Name -> 'Acme' (overridden); Brand.Tagline -> inherited
```

The `Comprehensive` flag is metadata surfaced through `listThemes()` (it defaults to `true`). It signals whether a bundle stands alone or is a partial override layered on a base; the provider does not change its merge behaviour based on it.

## Aliases: keeping legacy custom properties theme-aware

Older modules may emit their own CSS custom properties (e.g. `--pict-modal-bg`). The `Aliases` block remaps those onto theme tokens so they get themed for free:

```json
"Aliases": {
	"--pict-modal-bg": "Color.Background.Panel"
}
```

Each alias becomes a line in `:root`:

```css
--pict-modal-bg: var(--theme-color-background-panel);
```

Because the alias points at the token through `var()`, the paired-mode swap propagates automatically - the alias does not need to be duplicated in the dark block. Alias targets that are not non-empty strings are skipped silently.

## Auxiliary CSS riders

A bundle can carry a `CSS` array of `{ Hash, Content, Priority }` entries - rules that ride with the theme but cannot be expressed as a token (theme-specific component tweaks). On every `applyTheme`, the provider:

1. Removes any auxiliary CSS it registered for the previous theme (so the cascade does not accumulate across switches).
2. Registers each new entry through `pict.CSSMap.addCSS(Hash, Content, Priority)`.

`Priority` defaults to `500` when absent. A common choice is `600` - above provider/view defaults (`500`) and below per-application overrides (`1000`). This step only runs when the host exposes `pict.CSSMap`; in a bare context it is skipped.

These riders are distinct from the injected `<style id="pict-theme">` element, which holds only the token custom properties and is managed directly by the provider (not through `CSSMap`).

## The apply lifecycle and listeners

`onApply(callback)` registers a listener and returns a dispose function; `offApply(callback)` removes one. Listeners fire with the **effective bundle** and a context object `{ Hash, Mode, ResolvedMode }` on:

- every `applyTheme()`, and
- every successful `setMode()`.

This is the seam for consumers that cannot rely on the CSS cascade - canvas/WebGL surfaces, chart palettes, and especially diagram engines that bake colors into SVG at render time. A listener that throws is caught and logged so it cannot break siblings.

### Diagram adapter

The provider exposes a `diagram` helper (`provider.diagram.*`) for plugging color-baking diagram engines into the theme lifecycle. Mermaid is the engine supported today: `provider.diagram.adaptMermaid(mermaid, options)` initializes Mermaid with a `themeVariables` block built from the current `--theme-*` tokens, subscribes to `onApply`, and re-renders diagrams when the theme or mode changes. The same functions are available as a standalone require via `require('pict-provider-theme').DiagramAdapter`. This is an optional add-on, separate from the core token/mode machinery above.

## Teardown

`unapplyTheme()` reverses an apply: it removes the `<style id="pict-theme">` element, clears the mode class from `<html>`, unregisters the auxiliary CSS riders, and resets the active hash / mode / resolved-mode to `null`. It returns `true`.

## Exported constants

For consumers that need the literals (e.g. CSS that keys on the mode class), the module re-exports them:

```javascript
const libTheme = require('pict-provider-theme');
libTheme.STYLE_ELEMENT_ID;  // 'pict-theme'
libTheme.HTML_CLASS_LIGHT;  // 'theme-light'
libTheme.HTML_CLASS_DARK;   // 'theme-dark'
libTheme.CSS_VAR_PREFIX;    // '--theme-'
```
