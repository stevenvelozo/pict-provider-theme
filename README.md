# Pict Provider: Theme

> **[Read the Pict-Provider-Theme Documentation](https://fable-retold.github.io/pict-provider-theme/)** - interactive docs with quickstart, architecture, and the bundle format.

A runtime theme manager for [Pict](https://fable-retold.github.io/pict/) applications. Register theme bundles (token maps + CSS + SVG + image assets) and apply them at runtime by injecting CSS custom properties into a single `<style>` element. Supports dark / light / system modes via a class on `<html>`, and ships a `quack theme-build` command that compiles unrolled theme folders into single self-contained JSON bundles.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Theme bundles** - A theme is a single JSON object: a nested `Tokens` map, plus optional `CSS`, `SVG`, `Image`, `Brand`, and `Aliases` blocks. Register as many as you like; switch between them by `Hash`.
- **Runtime CSS custom properties** - `applyTheme()` flattens `Tokens` into `--theme-*` custom properties and writes them into one `<style id="pict-theme">` element. Every consumer that reads those properties repaints on the next style recalc - no per-component JavaScript.
- **Dark / light / system modes** - Paired tokens (`{ Light, Dark }`) drive three strategies. System mode is CSS-only: an `@media (prefers-color-scheme: dark)` block flips the page with no JavaScript listener. Explicit light / dark adds a `theme-light` / `theme-dark` class on `<html>` that overrides the media query.
- **Token & asset accessors** - `token()`, `cssVar()`, `svg()`, `image()`, and `asset()` resolve values from the active bundle for JavaScript consumers (canvas, charts, diagram engines) that cannot read CSS variables.
- **Template expressions** - `{~Theme:~}`, `{~ThemeVar:~}`, `{~ThemeAsset:~}`, and `{~ThemeImage:~}` resolve tokens and assets directly inside Pict templates.
- **Theme inheritance** - A bundle can declare `BasedOn` another registered hash; the provider deep-merges the chain into one effective bundle, so a brand override can ship only the tokens it changes.
- **Apply listeners** - `onApply()` notifies subscribers (with the effective bundle and resolved mode) whenever a theme or mode changes, for consumers that bake colors at render time.
- **`quack theme-build` command** - Compile an unrolled theme folder (`manifest.json` + `css/` + `svg/` + `image/`) into a single self-contained JSON bundle. Available as a quackage command, a standalone `pict-theme-build` CLI, and a plain Node module for CI.
- **Stateless** - The provider does not persist anything. Host applications decide what to register and apply at boot (from `localStorage`, server config, a query parameter, etc.).

## Installation

```bash
npm install pict-provider-theme
```

`pict-provider` and `pict-template` are runtime dependencies. `puppeteer` is an optional peer dependency, used only by the `theme-screenshot` tooling.

## Quick Start

Register the provider on a Pict application, register one or more bundles, then apply one:

```javascript
const libPictProviderTheme = require('pict-provider-theme');

// Register the provider (ProviderIdentifier is 'Theme').
this.pict.addProvider('Theme', libPictProviderTheme.default_configuration, libPictProviderTheme);

let tmpTheme = this.pict.providers['Theme'];

// Register a compiled bundle (here, one shipped with the module).
tmpTheme.registerTheme(require('pict-provider-theme/source/themes/pict-default.json'));

// Apply it. Second argument is the mode: 'light' | 'dark' | 'system'.
tmpTheme.applyTheme('pict-default', 'system');
```

After `applyTheme`, every `--theme-*` custom property is live in the document. Reference them from any CSS:

```css
.my-panel
{
	background: var(--theme-color-background-panel);
	color: var(--theme-color-text-primary);
	padding: var(--theme-spacing-md);
}
```

Switch modes at runtime without re-registering:

```javascript
tmpTheme.setMode('dark');     // lock dark
tmpTheme.setMode('light');    // lock light
tmpTheme.setMode('system');   // follow the OS preference
```

See [the Quickstart](https://fable-retold.github.io/pict-provider-theme/#/quickstart) for a fuller walkthrough.

## Building theme bundles

Author a theme as an unrolled folder and compile it to a single JSON file:

```
themes/
  my-theme/
    manifest.json     # { Hash, Name, Modes, Tokens, ... }
    css/              # optional auxiliary CSS, one entry per .css file
    svg/              # optional SVG assets (nested folders allowed)
    image/            # optional raster images, embedded as base64 data URLs
```

```bash
# As a quackage command (compiles every theme folder under ./themes by default):
npx quack theme-build

# As a standalone CLI:
npx pict-theme-build themes/my-theme theme
npx pict-theme-build --all themes theme
```

The output is a self-contained `theme/<Hash>.json` ready for `registerTheme()`. See [Theme Bundles & the theme-build command](https://fable-retold.github.io/pict-provider-theme/#/theme-bundles).

## Example

The **Theme Playground** is the reference application - live-edit tokens and CSS, switch modes, upload imagery, and export a compiled bundle, all against a gallery of real `pict-section-*` views that repaint instantly. See [`docs/examples/theme-playground/README.md`](docs/examples/theme-playground/README.md).

## Testing

```bash
npm test
```

Runs the Mocha (TDD) suites for the provider, the compiler, the diagram adapter, and a parity check. The provider tests use a stubbed `document`, so they run headless.

## Related Modules

- [pict](https://fable-retold.github.io/pict/) - The MVC framework. Supplies the application, the CSS cascade (`CSSMap`), and the template engine the provider integrates with.
- [pict-provider](https://fable-retold.github.io/pict-provider/) - The base provider class this extends.
- [pict-template](https://fable-retold.github.io/pict-template/) - The base class for the four `{~Theme*:~}` template expressions.
- [pict-section-theme](https://fable-retold.github.io/pict-section-theme/) - Chrome views (theme picker, mode toggle, scale select) that drive this provider in a real application.
- [quackage](https://fable-retold.github.io/quackage/) - The build tool that hosts the `theme-build` and `theme-screenshot` commands.

## License

MIT
