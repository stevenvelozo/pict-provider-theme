# Pict Provider: Theme

A runtime theme manager for [Pict](https://fable-retold.github.io/pict/) applications. Register theme bundles, apply them by injecting CSS custom properties, and switch dark / light / system modes at runtime - plus a `quack theme-build` command that compiles unrolled theme folders into single self-contained JSON bundles.

The provider is **stateless**: it holds the registered bundles and the active theme in memory, but persists nothing. Host applications decide what to register and apply at boot.

## What it does

- **Registers theme bundles.** A bundle is a single JSON object - a nested `Tokens` map plus optional `CSS`, `SVG`, `Image`, `Brand`, and `Aliases` blocks. Each bundle is addressed by its `Hash`.
- **Applies tokens as CSS custom properties.** `applyTheme()` flattens `Tokens` into `--theme-*` properties and writes them into a single `<style id="pict-theme">` element. Consumers read `var(--theme-...)`; the browser repaints on the next style recalc.
- **Switches modes.** Paired `{ Light, Dark }` token values drive light, dark, and system modes. System mode is CSS-only (via `@media (prefers-color-scheme: dark)`); explicit modes add a `theme-light` / `theme-dark` class on `<html>`.
- **Exposes accessors and template tags.** `token()`, `cssVar()`, `svg()`, `image()` for JavaScript; `{~Theme:~}`, `{~ThemeVar:~}`, `{~ThemeAsset:~}`, `{~ThemeImage:~}` for templates.
- **Compiles bundles.** The `theme-build` command turns an unrolled folder (`manifest.json` + `css/` + `svg/` + `image/`) into one self-contained JSON file.

## Documentation

- **[Quickstart](quickstart.md)** - Register the provider, register a bundle, apply it, switch modes, read tokens from templates and JavaScript.
- **[Architecture](architecture.md)** - How tokens become CSS, the four-block cascade that powers system mode, theme inheritance, and the apply lifecycle.
- **[Theme Bundles & theme-build](theme-bundles.md)** - The bundle JSON shape and the `quack theme-build` compiler that produces it.

## Example Applications

<!-- docuserve:examples:start -->
*Live, runnable example applications - each opens in a new browser tab:*

- **[Theme Playground](examples/theme-playground/README.md)** - Interactive theme builder - live-edit tokens and CSS, upload imagery, watch a representative pict-section component gallery reflow instantly, and export a compiled JSON bundle. - [Launch live app](examples/theme-playground/index.html)
<!-- docuserve:examples:end -->

## Related Modules

- [pict](https://fable-retold.github.io/pict/) - The MVC framework supplying the application, CSS cascade, and template engine.
- [pict-provider](https://fable-retold.github.io/pict-provider/) - The base provider class this extends.
- [pict-template](https://fable-retold.github.io/pict-template/) - The base class for the `{~Theme*:~}` template expressions.
- [pict-section-theme](https://fable-retold.github.io/pict-section-theme/) - Chrome views (picker, mode toggle, scale select) that drive this provider.
- [quackage](https://fable-retold.github.io/quackage/) - The build tool that hosts the `theme-build` command.
