# Quickstart

This walks through registering the Theme provider, registering a bundle, applying it, switching modes, and reading tokens from both templates and JavaScript.

## Install

```bash
npm install pict-provider-theme
```

## 1. Register the provider

The provider's `ProviderIdentifier` is `Theme`, so once registered it lives at `pict.providers['Theme']`. Register it like any other Pict provider:

```javascript
const libPictProviderTheme = require('pict-provider-theme');

// Inside your application's initialization:
this.pict.addProvider('Theme', libPictProviderTheme.default_configuration, libPictProviderTheme);

let tmpTheme = this.pict.providers['Theme'];
```

The default configuration sets `AutoInitialize: true` and `AutoInitializeOrdinal: 0`, so the provider initializes early in the application lifecycle.

When the host Pict instance supports `addTemplate`, the provider auto-registers the four `{~Theme*:~}` template expressions on construction. In a bare-Fable or test context (no `addTemplate`), that step is skipped silently.

## 2. Register one or more theme bundles

A bundle is a single JSON object. The module ships two ready to use:

| Bundle | Hash | Strategy |
|--------|------|----------|
| `source/themes/pict-default.json` | `pict-default` | `system` (paired light/dark) |
| `source/themes/retold-mono.json` | `retold-mono` | `single` (one mode) |

```javascript
tmpTheme.registerTheme(require('pict-provider-theme/source/themes/pict-default.json'));
tmpTheme.registerTheme(require('pict-provider-theme/source/themes/retold-mono.json'));
```

`registerTheme(pBundle)` returns `true` on success, or `false` if the bundle is not an object or is missing a string `Hash`. Registration is **idempotent on `Hash`**: registering a bundle with a hash that already exists replaces the stored entry (and keeps its position in the list). That is what enables a live "edit, re-register, re-apply" loop.

To enumerate what is registered - for example to build a theme picker - use `listThemes()`:

```javascript
let tmpList = tmpTheme.listThemes();
// [ { Hash, Name, Version, Strategy, DefaultMode, Comprehensive }, ... ]
```

## 3. Apply a theme

```javascript
tmpTheme.applyTheme('pict-default', 'system');
```

`applyTheme(pHash, pMode)`:

- Resolves the bundle (following any `BasedOn` inheritance chain).
- Builds the `--theme-*` CSS custom properties from `Tokens` and writes them into a single `<style id="pict-theme">` element in `<head>`.
- Registers any auxiliary `CSS` entries from the bundle through Pict's CSS cascade.
- Sets the mode class on `<html>` (or clears it, for system mode).
- Fires any `onApply` listeners.

It returns `true`, or `false` if the hash is unknown. `pMode` is optional - when omitted, the theme's `Modes.Default` is used. For a `single`-strategy theme, the mode argument is ignored (clamped to the default).

Now any CSS in your application can read the tokens:

```css
.my-panel
{
	background: var(--theme-color-background-panel);
	color: var(--theme-color-text-primary);
	border: 1px solid var(--theme-color-border-default);
	padding: var(--theme-spacing-md);
	border-radius: var(--theme-radius-md);
}
```

The custom-property name is derived from the dot path under `Tokens`, lowercased with dots replaced by hyphens and prefixed with `--theme-`. So `Tokens.Color.Background.Panel` becomes `--theme-color-background-panel`.

## 4. Switch modes

For a paired (`system` or `paired`) theme, change the mode without re-applying:

```javascript
tmpTheme.setMode('dark');     // lock to dark, regardless of OS
tmpTheme.setMode('light');    // lock to light, regardless of OS
tmpTheme.setMode('system');   // follow the OS prefers-color-scheme
```

`setMode(pMode)` returns `true` on success, or `false` if there is no active theme or the active theme is `single`-strategy. It adjusts the class on `<html>` and re-fires `onApply` listeners; it does not rebuild the CSS (the injected stylesheet already carries both light and dark blocks).

- **`light` / `dark`** add a `theme-light` / `theme-dark` class on `<html>`.
- **`system`** clears both classes and lets the `@media (prefers-color-scheme: dark)` rule in the injected stylesheet drive the page. The OS toggle moves the page through CSS alone - the provider attaches no media-query listener.

See [Architecture](architecture.md) for why this works without any JavaScript event handler.

## 5. Read tokens from templates

When the provider registered its template expressions (step 1), you can resolve theme values directly in Pict templates:

```html
<!-- Raw value at the current resolved mode -->
<div style="border-color: {~Theme:Tokens.Color.Border.Default~}">

<!-- A live var() reference (path is relative to Tokens) -->
<div style="background: {~ThemeVar:Color.Background.Panel~}">

<!-- An SVG asset by Category.Name -->
<span class="logo">{~ThemeAsset:SVG.Logo~}</span>

<!-- An image URL / data URL from the Image block -->
<img src="{~ThemeImage:Hero~}" alt="">
```

| Expression | Resolves to |
|------------|-------------|
| `{~Theme:Path~}` | The raw value at `Path` (walked from the bundle root, e.g. `Tokens.Color....` or `Brand.Name`), at the current resolved mode. Empty string if missing or no active theme. |
| `{~ThemeVar:Path~}` | `var(--theme-...)` for `Path` relative to `Tokens` (e.g. `Color.Background.Panel`). |
| `{~ThemeAsset:Category.Name~}` | The asset content at `bundle.<Category>.<Name>` (e.g. `SVG.Logo`, `SVG.Icons.Foo`). |
| `{~ThemeImage:Name~}` | `bundle.Image.<Name>` - convenience for `{~ThemeAsset:Image.Name~}`. |

Each expression renders the empty string when no theme is active, when the path is missing, or when no Theme provider is registered.

## 6. Read tokens from JavaScript

For consumers that cannot read CSS variables - canvas, WebGL, charting and diagram libraries - resolve values directly:

```javascript
tmpTheme.token('Tokens.Color.Background.Primary');  // raw value at the active mode
tmpTheme.cssVar('Color.Background.Primary');        // 'var(--theme-color-background-primary)'
tmpTheme.svg('Logo');                               // SVG string, or null
tmpTheme.image('Hero');                             // image URL / data URL, or null
tmpTheme.asset('SVG', 'Icons.Foo');                 // arbitrary nested asset, or null
```

- `token(pPath)` walks from the bundle root, so it takes the full path including the `Tokens.` prefix. For a paired value it returns the side matching the currently resolved mode. In system mode the resolved mode is read fresh on each call, so the value is never stale. Returns `null` for missing paths or when no theme is active.
- `cssVar(pTokenPath)` takes a path **relative to `Tokens`** and returns the `var(--theme-...)` reference.
- `svg(pName)` / `image(pName)` are shortcuts for `asset('SVG', ...)` / `asset('Image', ...)`.

To read the current state:

```javascript
let tmpActive = tmpTheme.getActiveTheme();
// { Hash, Mode, ResolvedMode }
//   Mode is what you asked for ('system'); ResolvedMode is what's live ('light' | 'dark').
```

## 7. React to theme changes

Consumers that bake colors at render time (e.g. a diagram engine that writes fills into SVG) can subscribe to apply / mode-change events:

```javascript
let tmpDispose = tmpTheme.onApply((pBundle, pContext) =>
{
	// pBundle    - the effective (BasedOn-resolved) bundle
	// pContext   - { Hash, Mode, ResolvedMode }
	repaintMyCanvas(pBundle);
});

// Later, to unsubscribe:
tmpDispose();
// or: tmpTheme.offApply(theCallback);
```

The callback fires on every `applyTheme()` and every successful `setMode()`. A throwing listener is caught and logged; it does not break sibling listeners.

## Persisting the choice

The provider stores nothing across reloads. To remember the user's selection, the **host application** saves and restores it:

```javascript
// On apply, persist:
tmpTheme.applyTheme(pHash, pMode);
window.localStorage.setItem('theme', JSON.stringify({ Hash: pHash, Mode: pMode }));

// At boot, restore:
let tmpSaved = JSON.parse(window.localStorage.getItem('theme') || 'null');
if (tmpSaved)
{
	tmpTheme.applyTheme(tmpSaved.Hash, tmpSaved.Mode);
}
```

## Next steps

- [Architecture](architecture.md) - the CSS cascade, theme inheritance, and the apply lifecycle.
- [Theme Bundles & theme-build](theme-bundles.md) - authoring and compiling your own bundles.
