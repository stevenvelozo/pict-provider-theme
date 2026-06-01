# Theme Bundles & the theme-build command

A theme bundle is a single self-contained JSON object that `registerTheme()` accepts. You can hand-write one, or author a theme as an **unrolled folder** and compile it with `theme-build`. This page documents both the bundle shape and the compiler.

## The bundle shape

```json
{
	"Hash": "my-theme",
	"Name": "My Theme",
	"Version": "1.0.0",
	"Description": "...",
	"Comprehensive": true,
	"BasedOn": "pict-default",
	"Modes": { "Strategy": "system", "Default": "light" },
	"Tokens": {
		"Color": {
			"Background": { "Primary": { "Light": "#ffffff", "Dark": "#1a1a1a" } },
			"Brand":      { "Primary": "#3357c7" }
		},
		"Spacing": { "MD": "12px" }
	},
	"Brand":   { "Name": "My App", "Tagline": "..." },
	"Aliases": { "--pict-modal-bg": "Color.Background.Panel" },
	"CSS":     [ { "Hash": "my-theme-aux", "Content": ".demo { ... }", "Priority": 600 } ],
	"SVG":     { "Logo": "<svg>...</svg>", "Icons": { "Foo": "<svg>...</svg>" } },
	"Image":   { "Hero": "data:image/png;base64,..." }
}
```

### Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `Hash` | **yes** | Unique key. The provider rejects a bundle without a string `Hash`. Registration is idempotent on it. |
| `Name` | no | Human-readable label (falls back to `Hash` in `listThemes()`). |
| `Version` | no | Surfaced in `listThemes()`. |
| `Description` | no | Free text. |
| `Comprehensive` | no | Metadata flag (defaults to `true`); marks whether the bundle stands alone or is a partial override. Surfaced in `listThemes()`. |
| `BasedOn` | no | Hash of a registered bundle to inherit from. The provider deep-merges the chain at apply time. See [Architecture](architecture.md). |
| `Modes.Strategy` | no | `single`, `paired`, or `system`. Defaults to `single`. |
| `Modes.Default` | no | The mode used when `applyTheme` is called without one. Defaults to `light`. |
| `Tokens` | yes (effectively) | The nested token map. Only values here become `--theme-*` custom properties. |
| `Brand` | no | Arbitrary brand metadata (name, tagline, ...). Reachable via `token('Brand....')`. |
| `Aliases` | no | Map of `{ "--legacy-name": "Token.Path" }`. Each becomes a `--legacy-name: var(--theme-...)` line. |
| `CSS` | no | Array of `{ Hash, Content, Priority }` CSS riders registered through Pict's CSS cascade. |
| `SVG` | no | Named SVG assets; may be nested. Reachable via `svg()` / `{~ThemeAsset:SVG....~}`. |
| `Image` | no | Named images (URLs or base64 data URLs). Reachable via `image()` / `{~ThemeImage:...~}`. |

### Tokens and paired values

A token leaf is either a primitive value (one mode) or a `{ Light, Dark }` pair. Paired leaves are what make a theme switch between light and dark; the provider picks the side matching the resolved mode. Non-paired tokens (spacing, typography, radii, durations, z-indices) apply to all modes.

You can nest tokens however you like - the path becomes the custom-property name. The bundled `pict-default` theme uses these top-level groups under `Tokens` as a reference vocabulary: `Color`, `Typography`, `Spacing`, `Radius`, `Shadow`, `ZIndex`, `Duration`. These are conventions of that theme, not requirements of the provider; author whatever structure your application needs.

## Authoring an unrolled theme folder

Hand-maintaining a large JSON bundle - especially one with embedded SVG and base64 images - is awkward. The `theme-build` compiler lets you author a theme as a folder and compile it to a single bundle:

```
themes/
  my-theme/
    manifest.json     required - { Hash, Name, Modes, Tokens, ... }
    css/              optional - each .css file becomes a CSS rider entry
    svg/              optional - each .svg becomes an SVG entry; subfolders nest
    image/            optional - each file becomes a base64 data URL
```

The reference folder lives at [`examples/themes/sample-theme/`](https://fable-retold.github.io/pict-provider-theme/), which exercises every input: manifest tokens, two CSS files, a nested SVG folder, and an image folder.

### manifest.json

The manifest carries everything except the file-derived assets. Fields passed through verbatim into the compiled bundle:

`Hash`, `Name`, `Version`, `Description`, `Comprehensive`, `BasedOn`, `Modes`, `Tokens`, `Brand`, `Aliases` (and any other non-structural field you add - arbitrary metadata is preserved).

Fields the compiler reads to control compilation (not emitted verbatim):

- **`CSSManifest`** - optional array of `{ File, Priority, Hash? }` controlling which CSS files (under `css/`) are emitted, in what order, and with what priorities. When present, files in `css/` **not** listed are skipped, and a referenced file that does not exist is an error.
- **`SVG`** / **`Image`** - optional pre-set maps. Entries here are deep-merged over filesystem discovery, so a manifest entry overrides a same-keyed file.

### css/

Each `.css` file becomes a `{ Hash, Content, Priority }` entry in the bundle's `CSS` array. Without a `CSSManifest`, files are taken in alphabetical order with `Hash = "<theme-hash>-<basename>"` and `Priority = 500 + index * 10`. With a `CSSManifest`, ordering and priorities come from that array (default priority `500`).

### svg/

Each `.svg` file becomes an entry under the bundle's `SVG` map. The filename (minus extension) is **PascalCased** to form the key, and subfolders produce nested objects:

| File | Bundle path |
|------|-------------|
| `svg/logo.svg` | `SVG.Logo` |
| `svg/icons/foo-bar.svg` | `SVG.Icons.FooBar` |

PascalCasing splits on spaces, hyphens, and underscores: `icon-foo`, `icon_foo`, and `icon foo` all become `IconFoo`.

### image/

Each file becomes a base64 **data URL** under the bundle's `Image` map, with the same PascalCased-key / nested-folder rules as `svg/`. The MIME type is inferred from the extension (`.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.ico`, `.svg`; anything else falls back to `application/octet-stream`). Embedding images as data URLs is what makes the compiled bundle fully self-contained - no separate asset pipeline at runtime.

## The compiled output

`theme-build` writes `<outDir>/<Hash>.json`. Alongside the passed-through manifest fields and the collected `CSS` / `SVG` / `Image`, the compiler stamps two fields:

- `CompiledAt` - an ISO timestamp.
- `CompilerVersion` - the compiler version integer (currently `1`).

The result is ready for `registerTheme()` with no further transformation.

## Running theme-build

### As a quackage command

`theme-build` is registered into the [quackage](https://fable-retold.github.io/quackage/) CLI, so `quack` exposes it wherever quackage is installed (aliases: `theme`, `build-themes`):

```bash
npx quack theme-build
```

Configuration is read from `.quackage.json` under a `ThemeBuild` key:

```json
{
	"ThemeBuild": {
		"Source": "themes",
		"Output": "theme",
		"All": true
	}
}
```

When the config is absent, it defaults to `{ Source: "themes", Output: "theme", All: true }`. With `All: true` the command compiles every immediate subfolder of `Source` that contains a `manifest.json`; with `All: false` it compiles `Source` itself as a single theme folder. Paths resolve relative to the working directory.

### As a standalone CLI

The module also ships a dependency-light `pict-theme-build` binary that needs no quackage - suitable for CI / GitHub Actions:

```bash
# Compile one theme folder; output defaults to a sibling "theme" folder:
npx pict-theme-build themes/my-theme
npx pict-theme-build themes/my-theme dist/themes

# Compile every theme folder under a root:
npx pict-theme-build --all themes
npx pict-theme-build --all themes dist/themes
```

It exits `0` on success and `1` on any failure.

### As a Node module

Both functions are plain Node - no Pict, no DOM:

```javascript
const libThemeCompiler = require('pict-provider-theme/source/Theme-Compiler.js');

// Compile one folder -> bundle object (and write it if an out dir is given):
let tmpBundle = libThemeCompiler.compileTheme('themes/my-theme', 'theme');

// Compile every theme folder under a root -> [ { Hash, Path, Bundle }, ... ]:
let tmpResults = libThemeCompiler.compileAllThemes('themes', 'theme');

// Pass { Pretty: false } as the third argument to minify the written JSON.
```

`compileTheme` returns the bundle object even when no output directory is given, so you can compile in-memory.

## Previewing a bundle

The module ships a companion `theme-screenshot` command (a quackage command and a `pict-theme-screenshot` binary) that drives the Theme Playground with a given bundle and captures a folder of screenshots - every section in every mode. It requires the optional `puppeteer` peer dependency. Point it at a compiled JSON bundle or an unrolled folder via `.quackage.json` `ThemeScreenshot.ThemePath` or as a command argument.

## See also

- [Quickstart](quickstart.md) - registering and applying a bundle.
- [Architecture](architecture.md) - how `Tokens`, `Aliases`, and `CSS` are turned into the live stylesheet.
- The [Theme Playground](examples/theme-playground/README.md) - author a bundle interactively and export it ready for compilation.
