/**
 * Theme Diagram Adapter
 *
 * Helper utilities for plugging diagram renderers (Mermaid today,
 * Excalidraw / chart libraries next) into the pict-provider-theme
 * lifecycle.
 *
 * Why this exists:
 *   Diagram engines like Mermaid bake colors into the SVG at render
 *   time. Once rendered, CSS alone cannot recolor node fills, cluster
 *   backgrounds, or edge stroke ends — those are inline attributes on
 *   <rect>, <path>, <polygon>, etc.  Switching light/dark requires
 *   the engine to re-render with a fresh themeVariables block.
 *
 *   Pre-adapter, every view that hosted a Mermaid block had to:
 *     - read every CSS custom property by hand
 *     - mirror a 20+ key themeVariables object
 *     - wire its own onApply subscription
 *     - stash diagram source on the DOM
 *     - clear data-processed + re-run on theme change
 *
 *   The adapter centralizes all of that.  Section views call
 *   `adapter.adaptMermaid(mermaid, options)` and stop caring about the
 *   token list, the listener, and the refresh dance.
 *
 *  Public API:
 *     buildMermaidThemeVariables(pOverrides)        - read fresh tokens, return mermaid themeVariables
 *     getMermaidTokenMap()                          - canonical {mermaidKey: cssVarName} map
 *     initializeMermaid(mermaid, pOverrides)        - mermaid.initialize() with the right base + themeVariables
 *     refreshMermaidDiagrams(pSelectorOrRoot)       - restore source, clear data-processed, re-run mermaid.run
 *     stashMermaidSource(pNodes)                    - cache source on data-mermaid-source before first run
 *     adaptMermaid(provider, mermaid, pOptions)     - one-shot: initialize + subscribe + return handle
 *     readCSSVar(pName, pFallback, pRoot)           - fresh getComputedStyle read with fallback
 *
 *  All helpers are stateless and safe to call repeatedly.  Subscriptions
 *  return a dispose function the caller can hold onto for teardown.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

// Canonical mapping: mermaid themeVariables key -> CSS custom property name -> fallback.
// Fallbacks match the pict-default LIGHT palette so unthemed apps look like
// the default theme rather than a third unrelated palette.
const MERMAID_TOKEN_MAP =
[
	// Primary surfaces (node fills + cluster background)
	{ Key: 'primaryColor',         Var: '--theme-color-background-panel',     Fallback: '#ffffff' },
	{ Key: 'primaryTextColor',     Var: '--theme-color-text-primary',         Fallback: '#1a1a1a' },
	{ Key: 'primaryBorderColor',   Var: '--theme-color-brand-primary',        Fallback: '#3357c7' },
	// Secondary (alt rows, alternate nodes, sequence actor bg)
	{ Key: 'secondaryColor',       Var: '--theme-color-background-secondary', Fallback: '#f5f5f5' },
	{ Key: 'secondaryTextColor',   Var: '--theme-color-text-secondary',       Fallback: '#454545' },
	{ Key: 'secondaryBorderColor', Var: '--theme-color-border-default',       Fallback: '#d6d6d6' },
	// Tertiary (clusters, accent groups)
	{ Key: 'tertiaryColor',        Var: '--theme-color-background-tertiary',  Fallback: '#ebebeb' },
	{ Key: 'tertiaryTextColor',    Var: '--theme-color-text-secondary',       Fallback: '#454545' },
	{ Key: 'tertiaryBorderColor',  Var: '--theme-color-border-light',         Fallback: '#e9e9e9' },
	// Page-level + line + note
	{ Key: 'background',           Var: '--theme-color-background-panel',     Fallback: '#ffffff' },
	{ Key: 'mainBkg',              Var: '--theme-color-background-panel',     Fallback: '#ffffff' },
	{ Key: 'secondBkg',            Var: '--theme-color-background-secondary', Fallback: '#f5f5f5' },
	{ Key: 'lineColor',            Var: '--theme-color-text-secondary',       Fallback: '#454545' },
	{ Key: 'textColor',            Var: '--theme-color-text-primary',         Fallback: '#1a1a1a' },
	{ Key: 'noteBkgColor',         Var: '--theme-color-background-tertiary',  Fallback: '#ebebeb' },
	{ Key: 'noteTextColor',        Var: '--theme-color-text-primary',         Fallback: '#1a1a1a' },
	{ Key: 'noteBorderColor',      Var: '--theme-color-border-default',       Fallback: '#d6d6d6' },
	// Status (Mermaid uses these for error/warning highlights)
	{ Key: 'errorBkgColor',        Var: '--theme-color-status-error',         Fallback: '#b62828' },
	{ Key: 'errorTextColor',       Var: '--theme-color-text-on-brand',        Fallback: '#ffffff' },
	// Typography
	{ Key: 'fontFamily',           Var: '--theme-typography-family-sans',     Fallback: 'inherit' }
];

/**
 * Read a CSS custom property off pRoot (default: documentElement).
 * Always issues a fresh getComputedStyle so the value reflects the
 * current class state on <html> (theme-light / theme-dark).
 *
 * @param {string} pName     - variable name including '--' prefix
 * @param {string} [pFallback] - returned when the variable is unset/empty
 * @param {Element} [pRoot]  - element to compute style against
 * @returns {string}
 */
function readCSSVar(pName, pFallback, pRoot)
{
	if (typeof window === 'undefined' || typeof document === 'undefined')
	{
		return pFallback || '';
	}
	let tmpRoot = pRoot || document.documentElement;
	if (!tmpRoot)
	{
		return pFallback || '';
	}
	let tmpVal = (getComputedStyle(tmpRoot).getPropertyValue(pName) || '').trim();
	return tmpVal || pFallback || '';
}

/**
 * Returns the canonical {mermaidKey: cssVarName} mapping.  Useful for
 * apps that need to inspect or extend the token list (e.g. to add
 * gantt / sequence / pie-specific tokens for a custom diagram type).
 *
 * @returns {Array<{Key, Var, Fallback}>}
 */
function getMermaidTokenMap()
{
	// Defensive copy so callers can't mutate the canonical list.
	return MERMAID_TOKEN_MAP.map((tmpEntry) => ({ Key: tmpEntry.Key, Var: tmpEntry.Var, Fallback: tmpEntry.Fallback }));
}

/**
 * Read every token in the mermaid map off the current document and
 * return an object suitable for mermaid.initialize({themeVariables}).
 *
 * @param {object} [pOverrides] - extra themeVariables keys to merge on top
 * @returns {object}
 */
function buildMermaidThemeVariables(pOverrides)
{
	let tmpVars = {};
	for (let i = 0; i < MERMAID_TOKEN_MAP.length; i++)
	{
		let tmpEntry = MERMAID_TOKEN_MAP[i];
		tmpVars[tmpEntry.Key] = readCSSVar(tmpEntry.Var, tmpEntry.Fallback);
	}
	if (pOverrides && typeof pOverrides === 'object')
	{
		let tmpKeys = Object.keys(pOverrides);
		for (let j = 0; j < tmpKeys.length; j++)
		{
			tmpVars[tmpKeys[j]] = pOverrides[tmpKeys[j]];
		}
	}
	return tmpVars;
}

/**
 * Call mermaid.initialize() with the canonical pict theme bindings.
 * Safe to call repeatedly; mermaid simply merges new config.
 *
 * @param {object} mermaid - the mermaid module / global
 * @param {object} [pOverrides] - extra themeVariables keys, or { config: ... }
 *                                to override startOnLoad / securityLevel / theme
 * @returns {boolean} true if initialize ran, false if no mermaid available
 */
function initializeMermaid(mermaid, pOverrides)
{
	if (!mermaid || typeof mermaid.initialize !== 'function') { return false; }
	let tmpOverrides = pOverrides || {};
	let tmpThemeOverrides = tmpOverrides.themeVariables;
	let tmpConfigOverrides = tmpOverrides.config || {};
	let tmpVars = buildMermaidThemeVariables(tmpThemeOverrides);
	let tmpConfig = Object.assign(
	{
		startOnLoad: false,
		theme: 'base',
		securityLevel: 'loose'
	}, tmpConfigOverrides,
	{
		themeVariables: tmpVars
	});
	mermaid.initialize(tmpConfig);
	return true;
}

/**
 * Cache each diagram's source text on data-mermaid-source so a later
 * refresh can restore it.  Mermaid replaces textContent with the
 * rendered SVG during run(); without this stash there's no way to
 * re-run.
 *
 * @param {NodeList|Array<Element>} pNodes
 */
function stashMermaidSource(pNodes)
{
	if (!pNodes || pNodes.length < 1) { return; }
	for (let i = 0; i < pNodes.length; i++)
	{
		let tmpEl = pNodes[i];
		if (!tmpEl || typeof tmpEl.getAttribute !== 'function') { continue; }
		if (!tmpEl.hasAttribute('data-mermaid-source'))
		{
			tmpEl.setAttribute('data-mermaid-source', tmpEl.textContent);
		}
	}
}

/**
 * Restore each pre.mermaid[data-mermaid-source] element to its source
 * text, drop the data-processed flag (mermaid skips elements with that
 * flag set), strip the mermaid-rendered helper class if present, and
 * re-run mermaid against them.
 *
 * @param {string|Element|Document} [pSelectorOrRoot]
 *   - string: querySelectorAll target (defaults to whole document)
 *   - Element: scoped root to search inside
 *   - omitted: whole document
 * @returns {Promise|null} the mermaid.run() promise, or null if no work
 */
function refreshMermaidDiagrams(pSelectorOrRoot)
{
	if (typeof document === 'undefined') { return null; }
	let tmpMermaid = (typeof mermaid !== 'undefined') ? mermaid : null;
	if (!tmpMermaid || typeof tmpMermaid.run !== 'function') { return null; }

	let tmpRendered = _resolveMermaidNodes(pSelectorOrRoot);
	if (!tmpRendered || tmpRendered.length < 1) { return null; }

	for (let i = 0; i < tmpRendered.length; i++)
	{
		let tmpEl = tmpRendered[i];
		let tmpSrc = tmpEl.getAttribute('data-mermaid-source');
		if (tmpSrc !== null) { tmpEl.textContent = tmpSrc; }
		tmpEl.removeAttribute('data-processed');
		if (tmpEl.classList && typeof tmpEl.classList.remove === 'function')
		{
			tmpEl.classList.remove('mermaid-rendered');
		}
	}

	try
	{
		return tmpMermaid.run({ nodes: tmpRendered });
	}
	catch (pError)
	{
		// Surface to the caller; they're already wrapping in try/catch in
		// most cases.  Return a rejected promise so .catch() consumers fire.
		return Promise.reject(pError);
	}
}

function _resolveMermaidNodes(pSelectorOrRoot)
{
	let tmpSelector = 'pre.mermaid[data-mermaid-source]';
	if (!pSelectorOrRoot)
	{
		return document.querySelectorAll(tmpSelector);
	}
	if (typeof pSelectorOrRoot === 'string')
	{
		// Treat the string as a scope selector; collect mermaid nodes inside it.
		let tmpScope = document.querySelector(pSelectorOrRoot);
		if (!tmpScope) { return []; }
		return tmpScope.querySelectorAll(tmpSelector);
	}
	if (pSelectorOrRoot.querySelectorAll)
	{
		return pSelectorOrRoot.querySelectorAll(tmpSelector);
	}
	return [];
}

/**
 * One-shot: initialize mermaid against the active theme, subscribe to
 * theme apply events, and return a handle the caller can use for
 * teardown / manual refresh.
 *
 *   let tmpHandle = adaptMermaid(pict.providers.Theme, mermaid, {
 *       refreshScope: '#Pict-Content-Body'
 *   });
 *   // ... later, on unload:
 *   tmpHandle.dispose();
 *
 * @param {object} pProvider - pict-provider-theme instance
 * @param {object} pMermaid  - the mermaid module / global
 * @param {object} [pOptions]
 *   @param {string|Element} [pOptions.refreshScope] - passed to refreshMermaidDiagrams
 *   @param {object} [pOptions.themeOverrides]       - extra themeVariables keys
 *   @param {object} [pOptions.configOverrides]      - extra mermaid.initialize() top-level keys
 *   @param {function} [pOptions.onBeforeRefresh]    - called before each refresh; signature (pContext)
 *   @param {function} [pOptions.onAfterRefresh]     - called after each refresh resolves; signature (pContext)
 * @returns {{ dispose: function, refresh: function, reinitialize: function, subscribed: boolean }}
 */
function adaptMermaid(pProvider, pMermaid, pOptions)
{
	let tmpOptions = pOptions || {};
	let tmpInitOverrides =
	{
		themeVariables: tmpOptions.themeOverrides,
		config: tmpOptions.configOverrides
	};

	// Always initialize, even if no provider — the static base theme should
	// still pick up whatever CSS variables the page does have.
	initializeMermaid(pMermaid, tmpInitOverrides);

	let tmpRefresh = function (pContext)
	{
		if (typeof tmpOptions.onBeforeRefresh === 'function')
		{
			try { tmpOptions.onBeforeRefresh(pContext || {}); }
			catch (e) { /* swallow; refresh must not be gated on listener errors */ }
		}
		initializeMermaid(pMermaid, tmpInitOverrides);
		let tmpResult = refreshMermaidDiagrams(tmpOptions.refreshScope);
		if (tmpResult && typeof tmpResult.then === 'function' && typeof tmpOptions.onAfterRefresh === 'function')
		{
			tmpResult.then(
				() => { try { tmpOptions.onAfterRefresh(pContext || {}); } catch (e) { /* swallow */ } },
				() => { /* error path: onAfterRefresh still fires so the UI can drop spinners */
					try { tmpOptions.onAfterRefresh(pContext || {}); } catch (e) { /* swallow */ }
				}
			);
		}
		return tmpResult;
	};

	let tmpDispose = function () {};
	let tmpSubscribed = false;
	if (pProvider && typeof pProvider.onApply === 'function')
	{
		tmpDispose = pProvider.onApply(function (pBundle, pContext)
		{
			tmpRefresh(pContext || {});
		});
		tmpSubscribed = true;
	}

	return {
		dispose: function ()
		{
			if (typeof tmpDispose === 'function') { tmpDispose(); }
		},
		refresh: tmpRefresh,
		reinitialize: function () { initializeMermaid(pMermaid, tmpInitOverrides); },
		subscribed: tmpSubscribed
	};
}

module.exports =
{
	MERMAID_TOKEN_MAP: MERMAID_TOKEN_MAP,
	readCSSVar: readCSSVar,
	getMermaidTokenMap: getMermaidTokenMap,
	buildMermaidThemeVariables: buildMermaidThemeVariables,
	initializeMermaid: initializeMermaid,
	stashMermaidSource: stashMermaidSource,
	refreshMermaidDiagrams: refreshMermaidDiagrams,
	adaptMermaid: adaptMermaid
};
