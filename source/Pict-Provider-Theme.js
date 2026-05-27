/**
 * Pict Provider: Theme
 *
 * Runtime theme manager for Pict applications.  Registers theme bundles
 * (token maps + CSS + SVG + image assets) and applies them by injecting
 * CSS custom properties into a single <style id="pict-theme"> element.
 *
 * Themes can be:
 *   - Single-mode (Modes.Strategy = "single")
 *   - Paired light/dark (Modes.Strategy = "paired")
 *   - System-aware (Modes.Strategy = "system" — paired + auto-pick)
 *
 * Mode is reflected as `theme-light` / `theme-dark` class on <html>.
 *
 * Token resolution path examples:
 *   provider.token('Tokens.Color.Background.Primary') -> raw current value
 *   provider.cssVar('Color.Background.Primary')       -> 'var(--theme-color-background-primary)'
 *   provider.asset('SVG', 'Logo')                     -> SVG string
 *   provider.image('Hero')                            -> image URL / data URL
 *
 * Template expressions registered (when pict has addTemplate):
 *   {~Theme:Tokens.Color.Background.Primary~}    raw value
 *   {~ThemeVar:Color.Background.Primary~}        var(--theme-...) reference
 *   {~ThemeAsset:SVG.Logo~}                      asset content
 *   {~ThemeImage:Hero~}                          image URL
 *
 * Stateless: this provider does not persist anything.  Host applications
 * decide what to apply at boot (from localStorage, server config, etc.).
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */
const libPictProvider = require('pict-provider');
const libDiagramAdapter = require('./Theme-Diagram-Adapter.js');

const _ProviderConfiguration =
{
	ProviderIdentifier: 'Theme',
	AutoInitialize: true,
	AutoInitializeOrdinal: 0
};

const STYLE_ELEMENT_ID = 'pict-theme';
const HTML_CLASS_LIGHT = 'theme-light';
const HTML_CLASS_DARK = 'theme-dark';
const CSS_VAR_PREFIX = '--theme-';

class PictProviderTheme extends libPictProvider
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
		this.serviceType = 'PictProviderTheme';

		this._themes = {};
		this._themeOrder = [];
		this._activeHash = null;
		this._activeMode = null;
		this._resolvedMode = null;
		this._registeredCSSHashes = [];
		this._applyListeners = [];

		// Diagram adapter: helper API for plugging Mermaid (and any
		// future SVG-baking diagram engine) into the theme lifecycle.
		// Exposes the same functions as the standalone require, plus
		// `adaptMermaid(mermaid, options)` bound to this provider.
		let tmpSelf = this;
		this.diagram =
		{
			MERMAID_TOKEN_MAP:           libDiagramAdapter.MERMAID_TOKEN_MAP,
			readCSSVar:                  libDiagramAdapter.readCSSVar,
			getMermaidTokenMap:          libDiagramAdapter.getMermaidTokenMap,
			buildMermaidThemeVariables:  libDiagramAdapter.buildMermaidThemeVariables,
			initializeMermaid:           libDiagramAdapter.initializeMermaid,
			stashMermaidSource:          libDiagramAdapter.stashMermaidSource,
			refreshMermaidDiagrams:      libDiagramAdapter.refreshMermaidDiagrams,
			stripMermaidStyleImportance: libDiagramAdapter.stripMermaidStyleImportance,
			adaptMermaid: function (pMermaid, pOptions)
			{
				return libDiagramAdapter.adaptMermaid(tmpSelf, pMermaid, pOptions);
			}
		};

		// Auto-register the four theme template expressions if the host pict
		// supports addTemplate.  In bare-fable/test contexts this is skipped.
		if (this.pict && typeof this.pict.addTemplate === 'function')
		{
			try
			{
				this.pict.addTemplate(require('./templates/Pict-Template-Theme.js'));
				this.pict.addTemplate(require('./templates/Pict-Template-ThemeVar.js'));
				this.pict.addTemplate(require('./templates/Pict-Template-ThemeAsset.js'));
				this.pict.addTemplate(require('./templates/Pict-Template-ThemeImage.js'));
			}
			catch (pError)
			{
				if (this.log) this.log.warn('PictProviderTheme: template registration skipped: ' + pError.message);
			}
		}
	}

	// ================================================================
	// Theme registration
	// ================================================================

	/**
	 * Register a theme bundle.  Bundle is the compiled JSON shape (see
	 * the manifest schema documented in the module README and example themes).
	 *
	 * @param {object} pBundle - parsed manifest object
	 * @returns {boolean} true on success
	 */
	registerTheme(pBundle)
	{
		if (!pBundle || typeof pBundle !== 'object')
		{
			if (this.log) this.log.warn('PictProviderTheme.registerTheme: bundle is not an object');
			return false;
		}
		if (!pBundle.Hash || typeof pBundle.Hash !== 'string')
		{
			if (this.log) this.log.warn('PictProviderTheme.registerTheme: bundle missing required string Hash');
			return false;
		}

		if (!this._themes[pBundle.Hash])
		{
			this._themeOrder.push(pBundle.Hash);
		}
		this._themes[pBundle.Hash] = pBundle;
		return true;
	}

	/**
	 * Get an array of registered theme metadata for building UIs.
	 * @returns {Array<{Hash, Name, Version, Strategy, DefaultMode, Comprehensive}>}
	 */
	listThemes()
	{
		let tmpList = [];
		for (let i = 0; i < this._themeOrder.length; i++)
		{
			let tmpHash = this._themeOrder[i];
			let tmpTheme = this._themes[tmpHash];
			let tmpModes = tmpTheme.Modes || {};
			tmpList.push(
			{
				Hash: tmpTheme.Hash,
				Name: tmpTheme.Name || tmpTheme.Hash,
				Version: tmpTheme.Version || null,
				Strategy: tmpModes.Strategy || 'single',
				DefaultMode: tmpModes.Default || 'light',
				Comprehensive: tmpTheme.Comprehensive !== false
			});
		}
		return tmpList;
	}

	/**
	 * Get the raw stored bundle for a hash.
	 */
	getTheme(pHash)
	{
		return this._themes[pHash] || null;
	}

	// ================================================================
	// Apply / unapply
	// ================================================================

	/**
	 * Apply a theme by hash.  Optionally specify mode ('light', 'dark', 'system').
	 * If pMode is omitted, the theme's Modes.Default is used.
	 *
	 * @param {string} pHash
	 * @param {string} [pMode]
	 * @returns {boolean}
	 */
	applyTheme(pHash, pMode)
	{
		let tmpTheme = this._themes[pHash];
		if (!tmpTheme)
		{
			if (this.log) this.log.warn(`PictProviderTheme.applyTheme: unknown theme hash [${pHash}]`);
			return false;
		}

		// Resolve the effective theme bundle (handle BasedOn inheritance).
		let tmpEffective = this._resolveBundle(tmpTheme);

		let tmpStrategy = (tmpEffective.Modes && tmpEffective.Modes.Strategy) || 'single';
		let tmpDefaultMode = (tmpEffective.Modes && tmpEffective.Modes.Default) || 'light';

		let tmpMode = pMode || tmpDefaultMode;

		// Single-mode themes cannot be put into dark/light/system; clamp.
		if (tmpStrategy === 'single')
		{
			tmpMode = tmpDefaultMode;
		}

		this._activeHash = pHash;
		this._activeMode = tmpMode;

		// Build CSS once, regardless of mode (paired themes emit both blocks
		// and rely on the html class to switch between them).
		let tmpCSS = this._buildThemeCSS(tmpEffective);
		this._injectStyleElement(tmpCSS);

		// Register any auxiliary CSS files declared in the bundle through the
		// Pict CSS cascade so they participate in injectCSS().
		this._registerAuxiliaryCSS(tmpEffective);

		// Set the html class to drive paired-theme variable resolution.
		this._applyMode(tmpMode, tmpStrategy);

		// Notify subscribers (e.g. apps that need to re-color SVG icon palettes
		// from a bundle.IconColors block, swap chart palettes, etc.).
		this._fireApplyListeners(tmpEffective);

		return true;
	}

	/**
	 * Change mode without reapplying the theme.  No-op if no theme is active
	 * or active theme is single-mode.
	 *
	 * @param {string} pMode - 'light' | 'dark' | 'system'
	 */
	setMode(pMode)
	{
		if (!this._activeHash) return false;

		let tmpTheme = this._resolveBundle(this._themes[this._activeHash]);
		let tmpStrategy = (tmpTheme.Modes && tmpTheme.Modes.Strategy) || 'single';

		if (tmpStrategy === 'single') return false;

		this._activeMode = pMode;
		this._applyMode(pMode, tmpStrategy);
		this._fireApplyListeners(tmpTheme);
		return true;
	}

	// ================================================================
	// Listener subscription
	// ================================================================

	/**
	 * Subscribe to theme apply / mode-change events.  The callback is
	 * invoked with the effective (BasedOn-resolved) bundle and a context
	 * object: { Hash, Mode, ResolvedMode }.
	 *
	 * Apps use this to re-color SVG icon palettes, swap chart colors,
	 * push tokens into non-CSS consumers (canvas, WebGL), etc.
	 *
	 * Returns a dispose function for symmetry with offApply().
	 */
	onApply(fCallback)
	{
		if (typeof fCallback !== 'function') return function () {};
		this._applyListeners.push(fCallback);
		let tmpSelf = this;
		return function () { tmpSelf.offApply(fCallback); };
	}

	offApply(fCallback)
	{
		let tmpIdx = this._applyListeners.indexOf(fCallback);
		if (tmpIdx >= 0) this._applyListeners.splice(tmpIdx, 1);
	}

	_fireApplyListeners(pBundle)
	{
		if (this._applyListeners.length === 0) return;
		let tmpContext =
		{
			Hash: this._activeHash,
			Mode: this._activeMode,
			ResolvedMode: this._resolvedMode
		};
		for (let i = 0; i < this._applyListeners.length; i++)
		{
			try { this._applyListeners[i](pBundle, tmpContext); }
			catch (pError)
			{
				if (this.log) this.log.warn('PictProviderTheme: onApply listener threw: ' + pError.message);
			}
		}
	}

	/**
	 * Remove the injected style element, html class, and any auxiliary CSS.
	 */
	unapplyTheme()
	{
		if (typeof document !== 'undefined')
		{
			let tmpStyleEl = document.getElementById(STYLE_ELEMENT_ID);
			if (tmpStyleEl && tmpStyleEl.parentNode)
			{
				tmpStyleEl.parentNode.removeChild(tmpStyleEl);
			}
			if (document.documentElement && document.documentElement.classList)
			{
				document.documentElement.classList.remove(HTML_CLASS_LIGHT);
				document.documentElement.classList.remove(HTML_CLASS_DARK);
			}
		}

		// Unregister any auxiliary CSS we added.
		if (this.pict && this.pict.CSSMap && typeof this.pict.CSSMap.removeCSS === 'function')
		{
			for (let i = 0; i < this._registeredCSSHashes.length; i++)
			{
				this.pict.CSSMap.removeCSS(this._registeredCSSHashes[i]);
			}
		}
		this._registeredCSSHashes = [];

		this._activeHash = null;
		this._activeMode = null;
		this._resolvedMode = null;
		return true;
	}

	getActiveTheme()
	{
		// Live-read ResolvedMode so callers in system mode get the current OS
		// preference without the provider having to subscribe to media-query
		// changes.  Snapshot mode (explicit light/dark) returns as-is.
		return {
			Hash: this._activeHash,
			Mode: this._activeMode,
			ResolvedMode: this._activeHash ? this._currentResolvedMode() : null
		};
	}

	// ================================================================
	// Token / asset accessors
	// ================================================================

	/**
	 * Resolve a token by dot path against the active theme bundle.  Walks
	 * the entire bundle root, so paths can address Tokens, Brand, etc.
	 *
	 * If the value is paired ({Light, Dark}), returns the value at the
	 * currently resolved mode.
	 *
	 * @param {string} pPath - e.g. 'Tokens.Color.Background.Primary'
	 * @returns {string|number|null}
	 */
	token(pPath)
	{
		if (!this._activeHash) return null;
		let tmpTheme = this._resolveBundle(this._themes[this._activeHash]);
		let tmpValue = this._walkPath(tmpTheme, pPath);
		return this._resolveModedValue(tmpValue);
	}

	/**
	 * Returns a CSS `var(--theme-...)` reference for a token under Tokens.
	 * Path is given without the Tokens prefix:
	 *   cssVar('Color.Background.Primary') -> 'var(--theme-color-background-primary)'
	 *
	 * @param {string} pTokenPath
	 * @returns {string}
	 */
	cssVar(pTokenPath)
	{
		return 'var(' + this._cssVarName(pTokenPath) + ')';
	}

	/**
	 * Look up a named asset under SVG, optionally nested (e.g. 'Icons.Foo').
	 * @param {string} pCategory - 'SVG' | 'Image'
	 * @param {string} pName
	 */
	asset(pCategory, pName)
	{
		if (!this._activeHash) return null;
		let tmpTheme = this._resolveBundle(this._themes[this._activeHash]);
		let tmpRoot = tmpTheme[pCategory];
		if (!tmpRoot) return null;
		return this._walkPath(tmpRoot, pName);
	}

	image(pName)
	{
		return this.asset('Image', pName);
	}

	svg(pName)
	{
		return this.asset('SVG', pName);
	}

	// ================================================================
	// Internals
	// ================================================================

	/**
	 * Resolve a bundle's BasedOn chain into a single effective bundle by
	 * deep-merging this bundle onto its base.  Cycle-safe.
	 */
	_resolveBundle(pBundle)
	{
		let tmpChain = [];
		let tmpCurrent = pBundle;
		let tmpSeen = {};
		while (tmpCurrent)
		{
			if (tmpSeen[tmpCurrent.Hash]) break;
			tmpSeen[tmpCurrent.Hash] = true;
			tmpChain.unshift(tmpCurrent);
			let tmpBaseHash = tmpCurrent.BasedOn;
			tmpCurrent = tmpBaseHash ? this._themes[tmpBaseHash] : null;
		}
		if (tmpChain.length === 1) return tmpChain[0];

		let tmpResult = {};
		for (let i = 0; i < tmpChain.length; i++)
		{
			tmpResult = this._deepMerge(tmpResult, tmpChain[i]);
		}
		return tmpResult;
	}

	_deepMerge(pTarget, pSource)
	{
		let tmpResult = Object.assign({}, pTarget);
		let tmpKeys = Object.keys(pSource);
		for (let i = 0; i < tmpKeys.length; i++)
		{
			let tmpKey = tmpKeys[i];
			let tmpVal = pSource[tmpKey];
			if (tmpVal !== null
				&& typeof tmpVal === 'object'
				&& !Array.isArray(tmpVal)
				&& tmpResult[tmpKey] !== null
				&& typeof tmpResult[tmpKey] === 'object'
				&& !Array.isArray(tmpResult[tmpKey]))
			{
				tmpResult[tmpKey] = this._deepMerge(tmpResult[tmpKey], tmpVal);
			}
			else
			{
				tmpResult[tmpKey] = tmpVal;
			}
		}
		return tmpResult;
	}

	/**
	 * Walk a dot-path from a starting object.  Returns null if any segment
	 * is missing.  Path segments are matched case-sensitively as authored.
	 */
	_walkPath(pRoot, pPath)
	{
		if (!pRoot || !pPath) return null;
		let tmpSegments = pPath.split('.');
		let tmpNode = pRoot;
		for (let i = 0; i < tmpSegments.length; i++)
		{
			if (tmpNode === null || typeof tmpNode !== 'object') return null;
			tmpNode = tmpNode[tmpSegments[i]];
			if (typeof tmpNode === 'undefined') return null;
		}
		return tmpNode;
	}

	/**
	 * If pValue is a paired-mode object {Light, Dark}, pick the value matching
	 * the current resolved mode.  Otherwise return as-is.
	 *
	 * For system mode this re-reads the OS preference on every call so the
	 * value is always live-correct — no JS listener required to keep it in
	 * sync.  Explicit modes use the snapshotted `_resolvedMode`.
	 */
	_resolveModedValue(pValue)
	{
		if (this._isPairedValue(pValue))
		{
			let tmpMode = this._currentResolvedMode();
			let tmpKey = (tmpMode === 'dark') ? 'Dark' : 'Light';
			return pValue[tmpKey];
		}
		return pValue;
	}

	_isPairedValue(pValue)
	{
		return pValue !== null
			&& typeof pValue === 'object'
			&& !Array.isArray(pValue)
			&& Object.keys(pValue).length > 0
			&& Object.keys(pValue).every((k) => k === 'Light' || k === 'Dark');
	}

	/**
	 * Build the CSS string for a theme.
	 *
	 * Single-mode themes emit one `:root { ... }` block.
	 *
	 * Paired themes emit four blocks, ordered so the CSS cascade resolves
	 * to the right mode without any JS listeners:
	 *
	 *   1) `:root { ...light... }`                                — baseline
	 *   2) `@media (prefers-color-scheme: dark) { :root { ...dark... } }`
	 *                                                            — OS-driven
	 *   3) `.theme-light { ...light... }`                         — explicit override
	 *   4) `.theme-dark  { ...dark... }`                          — explicit override
	 *
	 * Mode = 'system' is "no class on <html>" — the @media rule drives.
	 * Mode = 'light'/'dark' adds the matching class which wins on tie via
	 * source order (same specificity as :root, but later in the file).
	 *
	 * The result: OS toggle moves the page via CSS alone, no DOM listener
	 * needed, no class flipping.  Explicit setMode() flips the class to
	 * lock the page to one mode regardless of OS preference.
	 *
	 * Only values under bundle.Tokens become CSS custom properties.
	 */
	_buildThemeCSS(pTheme)
	{
		let tmpTokens = pTheme.Tokens || {};
		let tmpFlat = this._flattenTokens(tmpTokens, '');

		let tmpStrategy = (pTheme.Modes && pTheme.Modes.Strategy) || 'single';
		let tmpHasPaired = tmpFlat.some((tmpEntry) => this._isPairedValue(tmpEntry.Value));

		let tmpAliasLines = this._buildAliasLines(pTheme.Aliases);

		if (tmpStrategy === 'single' || !tmpHasPaired)
		{
			let tmpCSS = ':root {\n';
			for (let i = 0; i < tmpFlat.length; i++)
			{
				let tmpEntry = tmpFlat[i];
				let tmpVal = this._isPairedValue(tmpEntry.Value)
					? tmpEntry.Value.Light
					: tmpEntry.Value;
				tmpCSS += '\t' + this._cssVarName(tmpEntry.Path) + ': ' + this._formatCSSValue(tmpVal) + ';\n';
			}
			tmpCSS += tmpAliasLines;
			tmpCSS += '}\n';
			return tmpCSS;
		}

		// Paired theme: emit the four-block cascade.
		let tmpLightLines = '';
		let tmpDarkLines = '';
		let tmpFixedLines = '';

		for (let i = 0; i < tmpFlat.length; i++)
		{
			let tmpEntry = tmpFlat[i];
			let tmpVarName = this._cssVarName(tmpEntry.Path);
			if (this._isPairedValue(tmpEntry.Value))
			{
				if (typeof tmpEntry.Value.Light !== 'undefined')
				{
					tmpLightLines += '\t' + tmpVarName + ': ' + this._formatCSSValue(tmpEntry.Value.Light) + ';\n';
				}
				if (typeof tmpEntry.Value.Dark !== 'undefined')
				{
					tmpDarkLines += '\t' + tmpVarName + ': ' + this._formatCSSValue(tmpEntry.Value.Dark) + ';\n';
				}
			}
			else
			{
				// Non-paired tokens (spacing, typography, etc.) live in :root only.
				tmpFixedLines += '\t' + tmpVarName + ': ' + this._formatCSSValue(tmpEntry.Value) + ';\n';
			}
		}

		// Block 1: :root holds light values + every non-paired token + aliases.
		// Aliases use var() indirection, so they resolve to the active mode
		// automatically without being duplicated in the dark blocks.
		let tmpCSS = ':root {\n' + tmpLightLines + tmpFixedLines + tmpAliasLines + '}\n';

		// Block 2: @media (prefers-color-scheme: dark) — OS-driven dark override.
		// Only the paired tokens need to flip; fixed tokens and aliases stay
		// the same.  Indented one level for readability.
		let tmpMediaInner = '';
		let tmpDarkLinesIndented = tmpDarkLines.replace(/^\t/gm, '\t\t');
		tmpMediaInner += '\t:root {\n' + tmpDarkLinesIndented + '\t}\n';
		tmpCSS += '@media (prefers-color-scheme: dark) {\n' + tmpMediaInner + '}\n';

		// Block 3: .theme-light — explicit override that locks light regardless of OS.
		tmpCSS += '.' + HTML_CLASS_LIGHT + ' {\n' + tmpLightLines + '}\n';

		// Block 4: .theme-dark — explicit override that locks dark regardless of OS.
		tmpCSS += '.' + HTML_CLASS_DARK + ' {\n' + tmpDarkLines + '}\n';

		return tmpCSS;
	}

	/**
	 * Emit alias lines for legacy CSS variable names that map to token paths
	 * under Tokens.  Each alias becomes:
	 *   --legacy-name: var(--theme-color-...);
	 * Indirection-via-var means paired-mode swap propagates without
	 * needing alias entries duplicated in the .theme-dark block.
	 *
	 * Authored as: { "--legacy-name": "Color.Background.Primary", ... }
	 */
	_buildAliasLines(pAliases)
	{
		if (!pAliases || typeof pAliases !== 'object') return '';
		let tmpKeys = Object.keys(pAliases);
		let tmpOut = '';
		for (let i = 0; i < tmpKeys.length; i++)
		{
			let tmpAlias = tmpKeys[i];
			let tmpTarget = pAliases[tmpAlias];
			if (typeof tmpTarget !== 'string' || tmpTarget.length === 0) continue;
			tmpOut += '\t' + tmpAlias + ': var(' + this._cssVarName(tmpTarget) + ');\n';
		}
		return tmpOut;
	}

	/**
	 * Walk an arbitrary nested token tree and produce a flat list of
	 * { Path: 'color.background.primary', Value: <leaf> } entries.
	 *
	 * Paired-mode objects ({Light, Dark}) and primitive values are leaves.
	 */
	_flattenTokens(pNode, pPathPrefix)
	{
		let tmpResults = [];
		if (pNode === null || typeof pNode !== 'object' || Array.isArray(pNode))
		{
			if (pPathPrefix)
			{
				tmpResults.push({ Path: pPathPrefix, Value: pNode });
			}
			return tmpResults;
		}
		if (this._isPairedValue(pNode))
		{
			tmpResults.push({ Path: pPathPrefix, Value: pNode });
			return tmpResults;
		}
		let tmpKeys = Object.keys(pNode);
		for (let i = 0; i < tmpKeys.length; i++)
		{
			let tmpKey = tmpKeys[i];
			let tmpChildPath = pPathPrefix ? (pPathPrefix + '.' + tmpKey) : tmpKey;
			let tmpChild = pNode[tmpKey];
			tmpResults = tmpResults.concat(this._flattenTokens(tmpChild, tmpChildPath));
		}
		return tmpResults;
	}

	/**
	 * 'Color.Background.Primary' -> '--theme-color-background-primary'
	 */
	_cssVarName(pTokenPath)
	{
		return CSS_VAR_PREFIX + pTokenPath.toLowerCase().replace(/\./g, '-');
	}

	_formatCSSValue(pValue)
	{
		if (pValue === null || typeof pValue === 'undefined') return '';
		if (typeof pValue === 'number') return String(pValue);
		return String(pValue);
	}

	_injectStyleElement(pCSS)
	{
		if (typeof document === 'undefined') return;
		let tmpStyleEl = document.getElementById(STYLE_ELEMENT_ID);
		if (!tmpStyleEl)
		{
			tmpStyleEl = document.createElement('style');
			tmpStyleEl.id = STYLE_ELEMENT_ID;
			document.head.appendChild(tmpStyleEl);
		}
		tmpStyleEl.textContent = pCSS;
	}

	_registerAuxiliaryCSS(pTheme)
	{
		// Clear previously registered auxiliary CSS so stale entries don't pile
		// up when switching themes.
		if (this.pict && this.pict.CSSMap && typeof this.pict.CSSMap.removeCSS === 'function')
		{
			for (let i = 0; i < this._registeredCSSHashes.length; i++)
			{
				this.pict.CSSMap.removeCSS(this._registeredCSSHashes[i]);
			}
		}
		this._registeredCSSHashes = [];

		if (!Array.isArray(pTheme.CSS)) return;
		if (!this.pict || !this.pict.CSSMap || typeof this.pict.CSSMap.addCSS !== 'function') return;

		for (let i = 0; i < pTheme.CSS.length; i++)
		{
			let tmpEntry = pTheme.CSS[i];
			if (!tmpEntry || !tmpEntry.Hash || typeof tmpEntry.Content !== 'string') continue;
			let tmpPriority = (typeof tmpEntry.Priority === 'number') ? tmpEntry.Priority : 500;
			this.pict.CSSMap.addCSS(tmpEntry.Hash, tmpEntry.Content, tmpPriority);
			this._registeredCSSHashes.push(tmpEntry.Hash);
		}
	}

	/**
	 * Apply the requested mode by adjusting the class on <html>.
	 *
	 *   - 'light' / 'dark': the matching class is added so the explicit
	 *     `.theme-light` / `.theme-dark` block in the injected stylesheet
	 *     overrides the @media (prefers-color-scheme) rule.
	 *   - 'system': both classes are cleared so the @media rule drives
	 *     the cascade from the OS preference, with no JS listener needed.
	 *
	 * `_resolvedMode` is snapshotted at apply time so synchronous reads
	 * via `token()` / `getActiveTheme()` return a consistent value.  In
	 * system mode it falls back to `_currentResolvedMode()` for callers
	 * that want a live read on each call.
	 */
	_applyMode(pMode, pStrategy)
	{
		if (pMode === 'system')
		{
			this._resolvedMode = this._readSystemPreference();
			this._clearHTMLClass();
		}
		else
		{
			this._resolvedMode = (pMode === 'dark') ? 'dark' : 'light';
			this._writeHTMLClass(this._resolvedMode);
		}
	}

	_writeHTMLClass(pResolvedMode)
	{
		if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.classList) return;
		let tmpList = document.documentElement.classList;
		if (pResolvedMode === 'dark')
		{
			tmpList.remove(HTML_CLASS_LIGHT);
			tmpList.add(HTML_CLASS_DARK);
		}
		else
		{
			tmpList.remove(HTML_CLASS_DARK);
			tmpList.add(HTML_CLASS_LIGHT);
		}
	}

	_clearHTMLClass()
	{
		if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.classList) return;
		let tmpList = document.documentElement.classList;
		tmpList.remove(HTML_CLASS_LIGHT);
		tmpList.remove(HTML_CLASS_DARK);
	}

	_readSystemPreference()
	{
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
		try
		{
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		catch (pError)
		{
			return 'light';
		}
	}

	/**
	 * The mode currently driving the page.  Mirrors what the user sees:
	 * explicit modes return their literal value; 'system' reads the OS
	 * preference fresh so token() / getActiveTheme() never report a
	 * stale value when the OS toggles between calls.
	 *
	 * @returns {'light'|'dark'}
	 */
	_currentResolvedMode()
	{
		if (this._activeMode === 'system')
		{
			return this._readSystemPreference();
		}
		return (this._resolvedMode === 'dark') ? 'dark' : 'light';
	}
}

PictProviderTheme.default_configuration = _ProviderConfiguration;

module.exports = PictProviderTheme;
module.exports.STYLE_ELEMENT_ID = STYLE_ELEMENT_ID;
module.exports.HTML_CLASS_LIGHT = HTML_CLASS_LIGHT;
module.exports.HTML_CLASS_DARK = HTML_CLASS_DARK;
module.exports.CSS_VAR_PREFIX = CSS_VAR_PREFIX;
module.exports.DiagramAdapter = libDiagramAdapter;
