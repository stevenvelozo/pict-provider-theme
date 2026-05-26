/**
 * Theme-Diagram-Adapter — Unit Tests
 *
 * Exercises the canonical mermaid token map, the fresh-read CSS variable
 * helper, the initialize-and-subscribe handle, and the refresh path that
 * restores diagram source + clears data-processed.
 *
 * Mermaid is stubbed (no real diagram rendering).  document/window are
 * stubbed so the adapter's DOM paths exercise without a real browser.
 */
const libAssert = require('assert');
const libFable = require('fable');

const libPictProviderTheme = require('../source/Pict-Provider-Theme.js');
const libDiagramAdapter = require('../source/Theme-Diagram-Adapter.js');

const _ThemeDefault = require('../source/themes/pict-default.json');

function createStubElement(pTextContent)
{
	let tmpAttrs = {};
	let tmpClasses = new Set();
	return {
		textContent: pTextContent,
		_attrs: tmpAttrs,
		classList:
		{
			add: function (pCls) { tmpClasses.add(pCls); },
			remove: function (pCls) { tmpClasses.delete(pCls); },
			contains: function (pCls) { return tmpClasses.has(pCls); }
		},
		getAttribute: function (pName) { return Object.prototype.hasOwnProperty.call(tmpAttrs, pName) ? tmpAttrs[pName] : null; },
		setAttribute: function (pName, pValue) { tmpAttrs[pName] = String(pValue); },
		removeAttribute: function (pName) { delete tmpAttrs[pName]; },
		hasAttribute: function (pName) { return Object.prototype.hasOwnProperty.call(tmpAttrs, pName); }
	};
}

function createStubDocument(pComputedStyleVars, pPreElements)
{
	let tmpStyleEl = null;
	let tmpHTMLClasses = new Set();
	let tmpDocumentElement =
	{
		classList:
		{
			add: function (pCls) { tmpHTMLClasses.add(pCls); },
			remove: function (pCls) { tmpHTMLClasses.delete(pCls); },
			contains: function (pCls) { return tmpHTMLClasses.has(pCls); }
		}
	};

	let tmpDoc =
	{
		documentElement: tmpDocumentElement,
		head:
		{
			appendChild: function (pEl) { tmpStyleEl = pEl; }
		},
		getElementById: function (pId)
		{
			return (tmpStyleEl && tmpStyleEl.id === pId) ? tmpStyleEl : null;
		},
		createElement: function (pTag)
		{
			return { tagName: pTag, id: '', textContent: '', parentNode: null };
		},
		querySelectorAll: function (pSelector)
		{
			// The adapter only queries 'pre.mermaid[data-mermaid-source]';
			// the stub returns whatever the test seeded.
			return pPreElements || [];
		},
		querySelector: function () { return null; },
		_getStyleEl: function () { return tmpStyleEl; },
		_getHTMLClasses: function () { return Array.from(tmpHTMLClasses); }
	};

	global.document = tmpDoc;
	global.window = global.window || {};
	global.getComputedStyle = function (pEl)
	{
		return {
			getPropertyValue: function (pName) { return pComputedStyleVars[pName] || ''; }
		};
	};
	return tmpDoc;
}

function tearDownDocument()
{
	delete global.document;
	delete global.getComputedStyle;
	if (global.mermaid) { delete global.mermaid; }
}

function createMermaidStub()
{
	let tmpCalls =
	{
		initialize: [],
		run: []
	};
	let tmpStub =
	{
		initialize: function (pConfig) { tmpCalls.initialize.push(pConfig); },
		run: function (pOpts) { tmpCalls.run.push(pOpts); return Promise.resolve(); }
	};
	global.mermaid = tmpStub;
	return { mermaid: tmpStub, calls: tmpCalls };
}

function createProvider()
{
	let tmpFable = new libFable(
	{
		Product: 'DiagramAdapterTest',
		LogStreams: [{ streamtype: 'console', level: 'fatal' }]
	});
	let tmpProvider = new libPictProviderTheme(tmpFable, {}, 'TestTheme');
	tmpProvider.pict = { AppData: {}, providers: { Theme: tmpProvider }, CSSMap: null };
	tmpProvider.log = tmpFable.log;
	return tmpProvider;
}

suite
(
	'Theme-Diagram-Adapter',
	() =>
	{
		suite
		(
			'token map',
			() =>
			{
				test
				(
					'getMermaidTokenMap returns a defensive copy with every mermaid theme variable',
					(fDone) =>
					{
						let tmpMap = libDiagramAdapter.getMermaidTokenMap();
						libAssert.ok(Array.isArray(tmpMap) && tmpMap.length > 0, 'map should be a non-empty array');
						// Mutating the returned copy must not affect canonical map.
						tmpMap[0].Key = 'mutated';
						let tmpAgain = libDiagramAdapter.getMermaidTokenMap();
						libAssert.notStrictEqual(tmpAgain[0].Key, 'mutated', 'token map should be defensively copied');
						// Spot-check core keys.
						let tmpKeys = libDiagramAdapter.getMermaidTokenMap().map((e) => e.Key);
						['primaryColor', 'primaryTextColor', 'lineColor', 'errorBkgColor', 'fontFamily']
							.forEach((pKey) => libAssert.ok(tmpKeys.indexOf(pKey) >= 0, 'missing token key: ' + pKey));
						fDone();
					}
				);
			}
		);

		suite
		(
			'buildMermaidThemeVariables',
			() =>
			{
				test
				(
					'reads CSS variables off documentElement with fallbacks',
					(fDone) =>
					{
						createStubDocument(
						{
							'--theme-color-background-panel': '#111111',
							'--theme-color-text-primary':     '#eeeeee'
							// other tokens left empty -> fallback kicks in
						},
							[]
						);
						let tmpVars = libDiagramAdapter.buildMermaidThemeVariables();
						libAssert.strictEqual(tmpVars.primaryColor,     '#111111', 'should read --theme-color-background-panel');
						libAssert.strictEqual(tmpVars.primaryTextColor, '#eeeeee', 'should read --theme-color-text-primary');
						// Missing var should fall back to the canonical default
						libAssert.ok(tmpVars.lineColor && tmpVars.lineColor.length > 0, 'fallback should fill empty');
						libAssert.strictEqual(tmpVars.fontFamily, 'inherit', 'font family fallback should be "inherit"');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'overrides win over CSS-derived values',
					(fDone) =>
					{
						createStubDocument({ '--theme-color-background-panel': '#aaaaaa' }, []);
						let tmpVars = libDiagramAdapter.buildMermaidThemeVariables({ primaryColor: '#ff00ff' });
						libAssert.strictEqual(tmpVars.primaryColor, '#ff00ff', 'override should beat CSS read');
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'initializeMermaid',
			() =>
			{
				test
				(
					'calls mermaid.initialize with base theme + themeVariables',
					(fDone) =>
					{
						createStubDocument({ '--theme-color-background-panel': '#222222' }, []);
						let tmpHarness = createMermaidStub();
						let tmpOk = libDiagramAdapter.initializeMermaid(tmpHarness.mermaid);
						libAssert.strictEqual(tmpOk, true, 'should return true when mermaid available');
						libAssert.strictEqual(tmpHarness.calls.initialize.length, 1, 'initialize called once');
						let tmpCfg = tmpHarness.calls.initialize[0];
						libAssert.strictEqual(tmpCfg.theme, 'base');
						libAssert.strictEqual(tmpCfg.startOnLoad, false);
						libAssert.strictEqual(tmpCfg.themeVariables.primaryColor, '#222222');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'returns false when mermaid is absent',
					(fDone) =>
					{
						libAssert.strictEqual(libDiagramAdapter.initializeMermaid(null), false);
						libAssert.strictEqual(libDiagramAdapter.initializeMermaid({}), false);
						fDone();
					}
				);
			}
		);

		suite
		(
			'stash + refresh',
			() =>
			{
				test
				(
					'stashMermaidSource saves textContent once',
					(fDone) =>
					{
						let tmpEl = createStubElement('graph LR; A-->B');
						libDiagramAdapter.stashMermaidSource([tmpEl]);
						libAssert.strictEqual(tmpEl.getAttribute('data-mermaid-source'), 'graph LR; A-->B');
						// Mutate textContent (mermaid replaced it with SVG)
						tmpEl.textContent = '<svg>rendered</svg>';
						libDiagramAdapter.stashMermaidSource([tmpEl]);
						// Should NOT overwrite the cached source
						libAssert.strictEqual(tmpEl.getAttribute('data-mermaid-source'), 'graph LR; A-->B');
						fDone();
					}
				);

				test
				(
					'refreshMermaidDiagrams restores source, clears data-processed, calls mermaid.run',
					(fDone) =>
					{
						let tmpEl = createStubElement('original');
						tmpEl.setAttribute('data-mermaid-source', 'original');
						tmpEl.setAttribute('data-processed', 'true');
						tmpEl.textContent = '<svg>rendered</svg>';
						tmpEl.classList.add('mermaid-rendered');

						createStubDocument({ '--theme-color-background-panel': '#fff' }, [tmpEl]);
						let tmpHarness = createMermaidStub();

						let tmpResult = libDiagramAdapter.refreshMermaidDiagrams();
						libAssert.ok(tmpResult && typeof tmpResult.then === 'function', 'returns the mermaid.run promise');
						libAssert.strictEqual(tmpEl.textContent, 'original', 'source restored');
						libAssert.strictEqual(tmpEl.hasAttribute('data-processed'), false, 'data-processed cleared');
						libAssert.strictEqual(tmpEl.classList.contains('mermaid-rendered'), false, 'helper class cleared');
						libAssert.strictEqual(tmpHarness.calls.run.length, 1, 'mermaid.run called once');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'refreshMermaidDiagrams is a no-op when nothing matches',
					(fDone) =>
					{
						createStubDocument({}, []);
						let tmpHarness = createMermaidStub();
						let tmpResult = libDiagramAdapter.refreshMermaidDiagrams();
						libAssert.strictEqual(tmpResult, null);
						libAssert.strictEqual(tmpHarness.calls.run.length, 0);
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'adaptMermaid',
			() =>
			{
				test
				(
					'initializes mermaid and subscribes to onApply; refresh fires on setMode',
					(fDone) =>
					{
						let tmpEl = createStubElement('graph TD; A-->B');
						tmpEl.setAttribute('data-mermaid-source', 'graph TD; A-->B');
						createStubDocument({ '--theme-color-background-panel': '#222' }, [tmpEl]);
						let tmpHarness = createMermaidStub();
						let tmpProvider = createProvider();
						tmpProvider.registerTheme(_ThemeDefault);
						tmpProvider.applyTheme('pict-default', 'light');

						let tmpHandle = libDiagramAdapter.adaptMermaid(tmpProvider, tmpHarness.mermaid, {});
						libAssert.strictEqual(tmpHandle.subscribed, true, 'should subscribe when provider available');

						// First initialize() fired during adaptMermaid.
						let tmpInitCountAfterBind = tmpHarness.calls.initialize.length;
						libAssert.ok(tmpInitCountAfterBind >= 1, 'initialize fires during adapt');

						// Toggle mode -> onApply -> adapter re-inits + refreshes.
						tmpProvider.setMode('dark');

						libAssert.ok(tmpHarness.calls.initialize.length > tmpInitCountAfterBind,
							'initialize re-fires after setMode');
						libAssert.strictEqual(tmpHarness.calls.run.length, 1,
							'refresh runs mermaid.run on the stashed nodes');

						tmpHandle.dispose();
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'returns subscribed: false when no provider, but still initializes mermaid',
					(fDone) =>
					{
						createStubDocument({}, []);
						let tmpHarness = createMermaidStub();
						let tmpHandle = libDiagramAdapter.adaptMermaid(null, tmpHarness.mermaid, {});
						libAssert.strictEqual(tmpHandle.subscribed, false);
						libAssert.ok(tmpHarness.calls.initialize.length >= 1, 'mermaid still initialized');
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'provider integration',
			() =>
			{
				test
				(
					'provider.diagram exposes the adapter helpers',
					(fDone) =>
					{
						let tmpProvider = createProvider();
						libAssert.ok(tmpProvider.diagram, 'provider.diagram should exist');
						libAssert.strictEqual(typeof tmpProvider.diagram.adaptMermaid, 'function');
						libAssert.strictEqual(typeof tmpProvider.diagram.refreshMermaidDiagrams, 'function');
						libAssert.strictEqual(typeof tmpProvider.diagram.buildMermaidThemeVariables, 'function');
						libAssert.strictEqual(typeof tmpProvider.diagram.stashMermaidSource, 'function');
						libAssert.ok(Array.isArray(tmpProvider.diagram.MERMAID_TOKEN_MAP));
						fDone();
					}
				);

				test
				(
					'static export PictProviderTheme.DiagramAdapter mirrors the adapter module',
					(fDone) =>
					{
						libAssert.strictEqual(
							libPictProviderTheme.DiagramAdapter.adaptMermaid,
							libDiagramAdapter.adaptMermaid,
							'static export should be the same function');
						fDone();
					}
				);
			}
		);
	}
);
