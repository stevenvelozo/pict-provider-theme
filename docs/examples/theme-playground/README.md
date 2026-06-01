# Theme Playground - Interactive Theme Builder

<!-- docuserve:example-launch:start -->
> **[Launch the live app](examples/theme-playground/index.html)** - runs in your browser, opens in a new tab.
<!-- docuserve:example-launch:end -->

The Theme Playground is the reference application for **everything**
`pict-provider-theme` exposes - token editing, mode switching, scale
selection, custom CSS injection, imagery uploads, and theme bundle
export - wired up against a representative gallery of every
`pict-section-*` view. Edit a token on the right; **every section
re-paints instantly** because nothing in the gallery uses hardcoded
colors. The whole flow from bundle -> CSS variables -> DOM repaint is
visible on one screen.

It is not a single-purpose demo. It is the playground we use to
prototype new themes and to verify that every Pict section honours
the theme variable cascade. If you are building a new Pict
application and want to see what "theme-aware" looks like before you
commit, this is the page to open.

## What it demonstrates

| Capability | Where you see it |
|------------|------------------|
| Theme bundle registration via the Catalog | `_loadStarterThemes()` calls `provider.registerTheme(bundle)` for each JSON file |
| Active theme + mode application | `provider.applyTheme(hash, mode)` repaints all `--theme-*` CSS vars |
| Paired light/dark tokens | Token rows render two inputs (`Light`/`Dark`) when value is `{ Light, Dark }` |
| Live token editing | Every input writes back through `_setAtPath` then re-calls `applyTheme` |
| Native `<input type="color">` swatches | Tokens that parse as a CSS color render a color picker beside the text input |
| Auxiliary CSS rider | The bundle's `CSS[0].Content` is editable in a `<textarea>`; edits re-register the bundle |
| Drag-and-drop image bundling | Drop a PNG on the dropzone -> `FileReader.readAsDataURL` -> bundle `Image[Key]` |
| Compiled-bundle export | "Export bundle" downloads the current bundle as JSON, ready for compilation |
| External bundle injection via `?themeUrl=` | A query param fetches and registers a third-party bundle on boot |
| Section-aware nav with deep-link routing | `pict-router` `/section/<id>` routes; nav rebuilds from `SectionRegistry` |
| Real `pict-section-*` views inside the gallery | 20+ sections register through the Pict view lifecycle (not iframes) |
| Mode strategy: `light`, `dark`, `system` | Header mode buttons call `provider.setMode(mode)`; system follows `prefers-color-scheme` |

## Key files

- `src/Pict-Application-Playground.js` - application class. Registers
  the `Theme` provider, the section registry, and the layout view.
  Every section's setup function and view registration happens here.
- `src/views/PictView-Playground-Layout.js` - the shell. Hosts the
  three-column shell + chrome, wires the routes, builds the nav from
  the section registry, runs the token editor, the CSS textarea, the
  imagery dropzone, and the export button.
- `src/sections/_registry.js` - array of section descriptors. The
  order here is the nav order. Each entry exports either a plain
  section (welcome, base-components) or a wrapped `pict-section-*`
  view built via `_wrapper.buildSection({...})`.
- `src/sections/_wrapper.js` - `buildSection({...})` returns a
  section descriptor whose wrapper view paints title/blurb/container
  chrome and then calls the inner pict-section-* view's `render()`.
- `src/themes/playground-starter.json` - the seed theme. Paired
  Light/Dark tokens, system-strategy mode, brand block, and a curated
  set of `Aliases` so other section modules' legacy `--pict-*` custom
  properties resolve to the theme's tokens.
- `src/themes/playground-corp.json` - second seed theme, same shape,
  different palette. Demonstrates that switching is purely "pick a
  different hash".
- `src/index.html` - HTML shell. Pulls Pict, vendor libs, and the
  Playground bundle; calls `Pict.safeLoadPictApplication`.

---

## Feature 1 - Theme bundles and the provider

The Theme provider is registered like any other provider. The
playground adds it directly with `new libPictProviderTheme(...)`
rather than `pict.addProvider(...)` because it wants explicit control
over the instance to call lifecycle methods early:

```js
this.pict.providers['Theme'] = new libPictProviderTheme(this.pict, {}, 'PlaygroundTheme');
this.pict.providers['Theme'].pict = this.pict;
```

A theme **bundle** is the JSON shape defined in
`docs/examples/theme-playground/themes/playground-starter.json`. The
shape any host can use is:

```json
{
    "Hash": "playground-starter",
    "Name": "Playground Starter",
    "Modes": { "Strategy": "system", "Default": "light" },
    "Tokens": {
        "Color": { "Background": { "Primary": { "Light": "#ffffff", "Dark": "#1a1a1a" } } },
        "Typography": { "Size": { "MD": "1rem" } },
        "Spacing": { "MD": "12px" }
    },
    "Brand": { "Name": "Playground" },
    "Aliases": {
        "--pict-modal-bg": "Color.Background.Panel"
    }
}
```

Once registered, the bundle becomes addressable by its `Hash`. The
playground stores a working copy on the layout view so token edits
do not mutate the registered original:

```js
this._activeBundle = JSON.parse(JSON.stringify(tmpProvider.getTheme(pHash)));
tmpProvider.registerTheme(this._activeBundle);
tmpProvider.applyTheme(pHash, pMode);
```

`registerTheme` is **idempotent on Hash** - passing in a modified
bundle with the same hash replaces the entry. That is what enables
the entire "live edit, immediate repaint" loop.

---

## Feature 2 - Paired light/dark tokens, live-editable

Tokens are arbitrary nested objects. A leaf is either a primitive
value (a single mode) or an object whose only keys are `Light` and
`Dark` (a paired token). The playground walks the bundle, detects
paired leaves with the `_isPaired` predicate, and emits two inputs
per paired row:

```js
_isPaired(pValue)
{
    return pValue !== null
        && typeof pValue === 'object'
        && !Array.isArray(pValue)
        && Object.keys(pValue).length > 0
        && Object.keys(pValue).every((k) => k === 'Light' || k === 'Dark');
}
```

When the user edits one mode, only that side of the pair changes.
The other half is preserved:

```js
function commit(pNew)
{
    if (pModeKey)
    {
        let tmpExisting = tmpSelf._walkPath(tmpSelf._activeBundle.Tokens, pPath);
        if (!tmpSelf._isPaired(tmpExisting))
        {
            tmpExisting = { Light: tmpExisting, Dark: tmpExisting };
        }
        tmpExisting[pModeKey] = pNew;
        tmpSelf._setAtPath(tmpSelf._activeBundle.Tokens, pPath, tmpExisting);
    }
    else
    {
        tmpSelf._setAtPath(tmpSelf._activeBundle.Tokens, pPath, pNew);
    }
    tmpSelf._reapply();
}
```

`_reapply` re-registers the (now-mutated) working bundle and calls
`applyTheme` again. The provider rebuilds the `--theme-*` block,
writes it into the single `<style id="pict-theme">` element, and
every consumer that reads from those custom properties repaints on
the next style recalc. **No JavaScript layout pass, no React-style
diff** - the browser does the work via CSS variable cascade.

---

## Feature 3 - Color-aware token inputs

Token values are stringly-typed but the editor sniffs each one. A
value that looks like a CSS hex or `rgb*` literal gets a native
`<input type="color">` swatch beside its text field; everything else
gets a plain text input:

```js
let tmpText = document.createElement('input');
tmpText.type = 'text';
tmpText.className = 'pg-token-input';
tmpText.value = pValue == null ? '' : String(pValue);

if (this._looksLikeColor(pValue))
{
    let tmpColor = document.createElement('input');
    tmpColor.type = 'color';
    tmpColor.className = 'pg-token-color';
    tmpColor.value = this._normalizeColorForPicker(pValue);
    tmpColor.addEventListener('input', () =>
    {
        tmpText.value = tmpColor.value;
        commit(tmpText.value);
    });
    tmpWrap.appendChild(tmpColor);
}
```

The picker writes through the text input so the user sees both the
swatch and the literal value at the same time, and the literal is
what lands in the bundle JSON. Three-digit shorthand colors get
expanded to six digits because `<input type="color">` only accepts
the long form:

```js
_normalizeColorForPicker(pValue)
{
    if (typeof pValue !== 'string') return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(pValue)) return pValue;
    if (/^#[0-9a-f]{3}$/i.test(pValue))
    {
        return '#' + pValue[1] + pValue[1] + pValue[2] + pValue[2] + pValue[3] + pValue[3];
    }
    return '#000000';
}
```

Non-color tokens (font families, sizes, spacings, radii) get only
the text input.

---

## Feature 4 - Auxiliary CSS travels with the theme

A theme bundle can carry a `CSS` array of `{ Hash, Content, Priority }`
entries. The Pict CSS cascade picks these up on every `registerTheme`
call, so a theme can ship rules that ride with its tokens - useful
for theme-specific component tweaks that cannot be expressed as a
token alone. The playground exposes this as a textarea below the
token editor:

```js
_renderCSSEditor()
{
    let tmpTA = document.getElementById('pg-css-editor');
    let tmpCSS = (this._activeBundle.CSS && this._activeBundle.CSS[0] && this._activeBundle.CSS[0].Content) || '';
    tmpTA.value = tmpCSS;

    tmpTA.oninput = () =>
    {
        if (!this._activeBundle.CSS || this._activeBundle.CSS.length === 0)
        {
            this._activeBundle.CSS = [{ Hash: this._activeBundle.Hash + '-aux', Content: '', Priority: 600 }];
        }
        this._activeBundle.CSS[0].Content = tmpTA.value;
        this._reapply();
    };
}
```

Type a selector + rule into the textarea - `.demo-btn { transform:
rotate(2deg); }` - and every demo button across every section
tilts immediately. When the user switches themes, the previous
auxiliary block is replaced with the new theme's; the cascade does
not accumulate.

The `Priority: 600` value places the auxiliary block above
provider/view default CSS (`500`) and below per-application
overrides (`1000`), which is the right slot for "the theme says so".

---

## Feature 5 - Imagery uploads -> data-URL `Image` slot

Themes can carry binary imagery - logos, marks, hero shots - in
the `Image` block. The playground accepts drops or clicks on a
dropzone, base64-encodes each file with `FileReader.readAsDataURL`,
and writes it into the bundle as a data URL:

```js
_acceptFiles(pFileList)
{
    if (!pFileList || pFileList.length === 0) return;
    let tmpSelf = this;
    for (let i = 0; i < pFileList.length; i++)
    {
        let tmpFile = pFileList[i];
        let tmpReader = new FileReader();
        tmpReader.onload = () =>
        {
            let tmpKey = tmpSelf._pascalize(tmpSelf._stripExt(tmpFile.name));
            if (!tmpSelf._activeBundle.Image) tmpSelf._activeBundle.Image = {};
            tmpSelf._activeBundle.Image[tmpKey] = tmpReader.result;
            tmpSelf._renderImagePreviews();
            tmpSelf._updateBrandUI();
        };
        tmpReader.readAsDataURL(tmpFile);
    }
}
```

The filename becomes the key - `logo.png` -> `Image.Logo`,
`favicon-32.png` -> `Image.Favicon32`. The brand block on the Base
Components page picks up `Image.Logo` automatically and swaps the
initial-letter avatar for the uploaded image. The data URL is
embedded directly in the exported bundle JSON, so the resulting
file is fully self-contained - no separate asset pipeline.

---

## Feature 6 - Bundle export, ready for compilation

The "Export bundle" button serializes the current working bundle as
indented JSON and triggers a browser download:

```js
_exportBundle()
{
    let tmpJSON = JSON.stringify(this._activeBundle, null, '\t');
    let tmpBlob = new Blob([tmpJSON], { type: 'application/json' });
    let tmpURL = URL.createObjectURL(tmpBlob);
    let tmpA = document.createElement('a');
    tmpA.href = tmpURL;
    tmpA.download = (this._activeBundle.Hash || 'theme') + '.json';
    document.body.appendChild(tmpA);
    tmpA.click();
    document.body.removeChild(tmpA);
    setTimeout(() => URL.revokeObjectURL(tmpURL), 0);
}
```

The exported file is the canonical theme bundle shape - paired
tokens, `Aliases`, optional `CSS` rider, embedded data-URL `Image`
block. It feeds directly into the `pict-provider-theme` compiler
CLI (`source/cli/`) and is ready to be registered by another host
with no transformation.

This is the playground's primary "Did I just author a real theme?"
sanity check: edit live, export, commit the JSON, ship it.

---

## Feature 7 - External bundle injection via `?themeUrl=`

The playground reads a `themeUrl` query parameter on boot and, if
present, fetches the referenced JSON, registers it as a new theme,
and makes it the initial active theme:

```js
let tmpExternal = this._readQueryParam('themeUrl');
if (tmpExternal)
{
    try
    {
        let tmpResp = await fetch(tmpExternal);
        let tmpBundle = await tmpResp.json();
        tmpProvider.registerTheme(tmpBundle);
        let tmpOpt = document.createElement('option');
        tmpOpt.value = tmpBundle.Hash;
        tmpOpt.textContent = (tmpBundle.Name || tmpBundle.Hash) + ' (external)';
        tmpSelect.appendChild(tmpOpt);
        tmpSelect.value = tmpBundle.Hash;
        tmpFirst = tmpBundle.Hash;
    }
    catch (pErr) { /* ... */ }
}
```

This is the integration seam used by `pict-theme-screenshot` and any
other tool that wants to preview a specific bundle against the
playground's gallery. The query-param hook means "show me what
`my-corp-theme.json` looks like" is a single shareable URL.

---

## Feature 8 - Section-aware nav with deep links

The left rail is rebuilt at boot from `AppData.Playground.SectionRegistry`.
Each registry entry contributes a nav button and a destination div in the
stage; clicking a button routes to `/section/<id>` via `pict-router`,
which shows the matching panel and renders the inner section view
exactly once (re-renders are cheap, but the first render needs the
DOM to exist):

```js
_buildNav()
{
    let tmpRegistry = this.pict.AppData.Playground.SectionRegistry;
    let tmpNav = document.getElementById('pg-nav');
    let tmpStage = document.getElementById('pg-stage');

    let tmpGroups = {};
    let tmpGroupOrder = [];
    for (let i = 0; i < tmpRegistry.length; i++)
    {
        let tmpEntry = tmpRegistry[i];
        if (!tmpGroups[tmpEntry.group])
        {
            tmpGroups[tmpEntry.group] = [];
            tmpGroupOrder.push(tmpEntry.group);
        }
        tmpGroups[tmpEntry.group].push(tmpEntry);

        let tmpPanel = document.createElement('div');
        tmpPanel.className = 'pg-section-panel';
        tmpPanel.id = 'pg-section-' + tmpEntry.id;
        tmpPanel.style.display = 'none';
        let tmpInner = document.createElement('div');
        tmpInner.id = tmpEntry.DestinationId || ('Playground-Section-' + tmpEntry.id + '-Destination');
        tmpPanel.appendChild(tmpInner);
        tmpStage.appendChild(tmpPanel);
    }
    /* ... build nav buttons grouped by tmpEntry.group ... */
}
```

The wrapper helper in `_wrapper.js` is what makes this so concise.
Each section's descriptor declares an inner `pict-section-*` view's
class and configuration; `buildSection` wraps it in a tiny pict-view
that paints title/blurb chrome and then defers to the inner view's
`render()`. The result is a registry where adding a new gallery
section is exactly one entry plus one require:

```js
module.exports = [
    require('./welcome.js'),
    require('./base-components.js'),
    require('./theme.js'),
    require('./logo.js'),
    require('./modal.js'),
    require('./code.js'),
    require('./content.js'),
    /* ... */
    require('./equation.js'),
    require('./openseadragon.js')
];
```

---

## Feature 9 - Mode strategy and `prefers-color-scheme`

The mode buttons in the header dispatch to `setMode`:

```js
document.querySelectorAll('.pg-mode-button').forEach((pBtn) =>
{
    pBtn.addEventListener('click', () =>
    {
        let tmpMode = pBtn.dataset.mode;
        this.pict.providers['Theme'].setMode(tmpMode);
        this._updateModeButtons(tmpMode);
    });
});
```

A theme with `Modes.Strategy = "system"` honours
`prefers-color-scheme` automatically - `setMode('system')`
subscribes to the media query and flips between the bundle's `Light`
and `Dark` values whenever the OS toggles. Click `Light` or `Dark`
to override. The mode is **reflected as a class on the `<html>`
element** (`theme-light` / `theme-dark`), so any CSS that wants to
key on the resolved mode can do so without reading the provider.

The token editor displays both `Light` and `Dark` slots regardless
of which one is currently active - the bundle is the source of
truth, the resolved mode is just which leaf is read on this paint.

---

## Running the example

```bash
cd example_applications/theme-playground
npm install
npm run build
npm run serve
# opens http://localhost:8080 by default
```

The build step runs `npx quack build && npx quack copy` and emits
`dist/pict-provider-theme-playground.min.js` plus the static assets.
`serve.js` is a thin static server over `dist/`.

## Things to try in the running app

- **Switch themes** - the header `Theme` select toggles between
  Playground Starter and Playground Corp. The active theme key
  becomes the working copy; edits apply only to that copy.
- **Switch modes** - `Light`, `Dark`, `System`. With `System`,
  flip your OS dark mode and watch the gallery follow.
- **Edit a token** - try `Color.Brand.Primary`. Every brand-colored
  primitive in every section repaints in one frame.
- **Type into the CSS textarea** - add `.demo-btn { letter-spacing:
  0.2em; }`. Every button across every section spreads its
  letters; clear the textarea to revert.
- **Drop a logo** - drag a PNG named `logo.png` onto the dropzone.
  The Base Components brand block swaps to the uploaded image
  immediately.
- **Export bundle** - click Export bundle. Open the downloaded
  JSON in your editor - every edit is captured, including embedded
  data-URL imagery.
- **Deep-link** - append `?themeUrl=https://example.com/foo.json`
  to the URL to load an external theme on boot.
- **Navigate by URL** - visit `#/section/logo` or `#/section/form`
  directly. The router resolves it, the panel shows, the section
  renders.

## Takeaways

1. **One bundle, many views.** The theme provider sits between a
   single bundle JSON and dozens of unrelated views. Every section
   on this page is themed through `--theme-*` custom properties; no
   section knows about any other.
2. **Live editing is just `registerTheme(bundle); applyTheme(...)`.**
   Re-registering a bundle with the same hash replaces it; reapplying
   the same hash rewrites the CSS variable block. The whole "edit a
   token, repaint the gallery" loop is two provider calls.
3. **Paired tokens are first-class.** `{ Light, Dark }` is the
   shape; the provider picks the right side based on the active mode.
   Hosts do not need separate light/dark stylesheets - they need
   one theme bundle with two values per token.
4. **Theme bundles carry CSS and imagery.** Tokens cover the
   common case; the `CSS` rider and `Image` block handle the rest.
   A theme is **all of a brand's design system**, not just colors.
5. **Aliases keep legacy modules theme-aware.** The starter theme's
   `Aliases` block remaps `--pict-modal-bg`, `--pict-um-bg`, etc., to
   `Color.Background.Panel` (etc.). Older modules that emit their
   own custom properties get themed for free.

## Related documentation

- [pict-section-theme](https://fable-retold.github.io/pict-section-theme/) - the chrome
  views (TopBar, BottomBar, Picker, ModeToggle, ScaleSelect) that
  consume this provider in a real application.
- [pict-section-modal](https://fable-retold.github.io/pict-section-modal/) - modal /
  toast / tooltip surface; one of the gallery sections.
- [pict-section-form](https://fable-retold.github.io/pict-section-form/) - form builder
  surface; another gallery section.
