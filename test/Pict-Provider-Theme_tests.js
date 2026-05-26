/**
 * pict-provider-theme — Unit Tests
 *
 * Exercises registration, paired/single mode CSS emission, mode switching,
 * token resolution (including BasedOn inheritance), and asset accessors.
 *
 * Uses a minimal stubbed `document` so the provider's DOM injection paths
 * are exercised without a real browser.
 */
const libAssert = require('assert');
const libFable = require('fable');

const libPictProviderTheme = require('../source/Pict-Provider-Theme.js');

const _ThemeDefault = require('../source/themes/pict-default.json');
const _ThemeMono = require('../source/themes/retold-mono.json');

function createStubDocument()
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
		_getStyleEl: function () { return tmpStyleEl; },
		_getHTMLClasses: function () { return Array.from(tmpHTMLClasses); }
	};

	return tmpDoc;
}

function createProvider(pStubDoc)
{
	let tmpFable = new libFable(
		{
			Product: 'ThemeTest',
			LogStreams: [{ streamtype: 'console', level: 'fatal' }]
		});

	let tmpProvider = new libPictProviderTheme(tmpFable, {}, 'TestTheme');
	tmpProvider.pict = { AppData: {}, providers: { Theme: tmpProvider }, CSSMap: null };
	tmpProvider.log = tmpFable.log;

	if (pStubDoc)
	{
		// Patch globals for the duration of the test.
		global.document = pStubDoc;
	}
	return tmpProvider;
}

function tearDownDocument()
{
	delete global.document;
}

suite
(
	'pict-provider-theme',
	() =>
	{
		suite
		(
			'Module exports',
			() =>
			{
				test
				(
					'should export the provider class with default_configuration',
					(fDone) =>
					{
						libAssert.strictEqual(typeof libPictProviderTheme, 'function');
						libAssert.ok(libPictProviderTheme.default_configuration);
						libAssert.strictEqual(libPictProviderTheme.default_configuration.ProviderIdentifier, 'Theme');
						fDone();
					}
				);

				test
				(
					'should export style + class constants',
					(fDone) =>
					{
						libAssert.strictEqual(libPictProviderTheme.STYLE_ELEMENT_ID, 'pict-theme');
						libAssert.strictEqual(libPictProviderTheme.HTML_CLASS_LIGHT, 'theme-light');
						libAssert.strictEqual(libPictProviderTheme.HTML_CLASS_DARK, 'theme-dark');
						libAssert.strictEqual(libPictProviderTheme.CSS_VAR_PREFIX, '--theme-');
						fDone();
					}
				);
			}
		);

		suite
		(
			'Registration',
			() =>
			{
				test
				(
					'registerTheme should accept a valid bundle and listThemes should return its metadata',
					(fDone) =>
					{
						let tmpProv = createProvider();
						libAssert.strictEqual(tmpProv.registerTheme(_ThemeDefault), true);
						libAssert.strictEqual(tmpProv.registerTheme(_ThemeMono), true);
						let tmpList = tmpProv.listThemes();
						libAssert.strictEqual(tmpList.length, 2);
						libAssert.strictEqual(tmpList[0].Hash, 'pict-default');
						libAssert.strictEqual(tmpList[0].Strategy, 'system');
						libAssert.strictEqual(tmpList[1].Hash, 'retold-mono');
						libAssert.strictEqual(tmpList[1].Strategy, 'single');
						fDone();
					}
				);

				test
				(
					'registerTheme should reject invalid bundles',
					(fDone) =>
					{
						let tmpProv = createProvider();
						libAssert.strictEqual(tmpProv.registerTheme(null), false);
						libAssert.strictEqual(tmpProv.registerTheme({}), false);
						libAssert.strictEqual(tmpProv.registerTheme({ Name: 'no hash' }), false);
						libAssert.strictEqual(tmpProv.listThemes().length, 0);
						fDone();
					}
				);

				test
				(
					'registerTheme should overwrite (not duplicate) when called twice with same hash',
					(fDone) =>
					{
						let tmpProv = createProvider();
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.registerTheme(_ThemeDefault);
						libAssert.strictEqual(tmpProv.listThemes().length, 1);
						fDone();
					}
				);
			}
		);

		suite
		(
			'CSS emission for paired themes',
			() =>
			{
				test
				(
					'applyTheme on paired theme should emit the four-block cascade (:root + @media + .theme-light + .theme-dark)',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						libAssert.strictEqual(tmpProv.applyTheme('pict-default', 'light'), true);

						let tmpEl = tmpDoc._getStyleEl();
						libAssert.ok(tmpEl, 'style element should be created');
						libAssert.strictEqual(tmpEl.id, 'pict-theme');

						let tmpCSS = tmpEl.textContent;
						// All four blocks present.
						libAssert.ok(tmpCSS.indexOf(':root {') >= 0,                              'should contain :root block');
						libAssert.ok(tmpCSS.indexOf('@media (prefers-color-scheme: dark) {') >= 0, 'should contain @media block — system mode is CSS-driven, no JS listener');
						libAssert.ok(tmpCSS.indexOf('.theme-light {') >= 0,                       'should contain .theme-light block — explicit light override');
						libAssert.ok(tmpCSS.indexOf('.theme-dark {') >= 0,                        'should contain .theme-dark block — explicit dark override');
						// Token values land in the right blocks.
						libAssert.ok(tmpCSS.indexOf('--theme-color-background-primary: #ffffff;') >= 0, 'light value present');
						libAssert.ok(tmpCSS.indexOf('--theme-color-background-primary: #1a1a1a;') >= 0, 'dark value present');
						// Cascade order: explicit overrides must come AFTER @media so they win on a class match.
						libAssert.ok(tmpCSS.indexOf('@media') < tmpCSS.indexOf('.theme-light'), '@media must precede .theme-light');
						libAssert.ok(tmpCSS.indexOf('.theme-light') < tmpCSS.indexOf('.theme-dark'), '.theme-light must precede .theme-dark');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'applyTheme with mode="system" should NOT set theme-light or theme-dark on <html> — CSS @media drives the cascade',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'system');

						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-light') < 0, 'no theme-light class in system mode');
						libAssert.ok(tmpClasses.indexOf('theme-dark') < 0,  'no theme-dark class in system mode');

						let tmpActive = tmpProv.getActiveTheme();
						libAssert.strictEqual(tmpActive.Mode, 'system');
						libAssert.ok(tmpActive.ResolvedMode === 'light' || tmpActive.ResolvedMode === 'dark',
							'ResolvedMode is live-read from the OS preference');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'switching from explicit dark back to system clears the html class',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'dark');
						libAssert.ok(tmpDoc._getHTMLClasses().indexOf('theme-dark') >= 0, 'precondition: theme-dark set');

						tmpProv.setMode('system');
						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-light') < 0, 'theme-light cleared');
						libAssert.ok(tmpClasses.indexOf('theme-dark') < 0,  'theme-dark cleared');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'provider never attaches a DOM listener — system mode is CSS-only',
					(fDone) =>
					{
						// Spy on matchMedia: track addEventListener/addListener calls.
						let tmpListenerCount = 0;
						let tmpRealWindow = global.window;
						global.window =
						{
							matchMedia: function ()
							{
								return {
									matches: false,
									addEventListener: function () { tmpListenerCount++; },
									addListener:      function () { tmpListenerCount++; },
									removeEventListener: function () {},
									removeListener:      function () {}
								};
							}
						};

						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						// Exercise all modes.
						tmpProv.applyTheme('pict-default', 'system');
						tmpProv.setMode('dark');
						tmpProv.setMode('system');
						tmpProv.setMode('light');
						tmpProv.unapplyTheme();

						libAssert.strictEqual(tmpListenerCount, 0,
							'provider must not attach any matchMedia listener under any mode');

						tearDownDocument();
						global.window = tmpRealWindow;
						fDone();
					}
				);

				test
				(
					'paired theme should emit non-paired tokens (e.g. spacing) only in :root',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');

						let tmpCSS = tmpDoc._getStyleEl().textContent;
						let tmpRootBlock = tmpCSS.split('.theme-dark {')[0];
						let tmpDarkBlock = tmpCSS.split('.theme-dark {')[1] || '';

						libAssert.ok(tmpRootBlock.indexOf('--theme-spacing-md: 12px;') >= 0, 'spacing in :root');
						libAssert.ok(tmpDarkBlock.indexOf('--theme-spacing-md') < 0, 'spacing should NOT be duplicated in dark block');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'applyTheme should set theme-light class on html documentElement when mode=light',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');

						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-light') >= 0, 'theme-light class set');
						libAssert.ok(tmpClasses.indexOf('theme-dark') < 0, 'theme-dark class NOT set');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'applyTheme + setMode("dark") should swap class to theme-dark',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpProv.setMode('dark'), true);

						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-dark') >= 0);
						libAssert.ok(tmpClasses.indexOf('theme-light') < 0);

						let tmpActive = tmpProv.getActiveTheme();
						libAssert.strictEqual(tmpActive.Mode, 'dark');
						libAssert.strictEqual(tmpActive.ResolvedMode, 'dark');
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'CSS emission for single-mode themes',
			() =>
			{
				test
				(
					'applyTheme on single-mode theme should NOT emit a .theme-dark block',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeMono);
						tmpProv.applyTheme('retold-mono');

						let tmpCSS = tmpDoc._getStyleEl().textContent;
						libAssert.ok(tmpCSS.indexOf(':root {') >= 0);
						libAssert.ok(tmpCSS.indexOf('.theme-dark {') < 0, 'single-mode should not emit a dark block');
						libAssert.ok(tmpCSS.indexOf('--theme-color-background-primary: #ffffff;') >= 0);
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'setMode on single-mode theme should be a no-op',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeMono);
						tmpProv.applyTheme('retold-mono');
						libAssert.strictEqual(tmpProv.setMode('dark'), false);
						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-light') >= 0);
						libAssert.ok(tmpClasses.indexOf('theme-dark') < 0);
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'Token & asset accessors',
			() =>
			{
				test
				(
					'token() should return the value at the active mode for paired tokens',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');

						libAssert.strictEqual(tmpProv.token('Tokens.Color.Background.Primary'), '#ffffff');
						tmpProv.setMode('dark');
						libAssert.strictEqual(tmpProv.token('Tokens.Color.Background.Primary'), '#1a1a1a');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'token() should return non-paired values directly',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpProv.token('Tokens.Spacing.MD'), '12px');
						libAssert.strictEqual(tmpProv.token('Brand.Name'), 'Pict');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'token() should return null for missing paths or no active theme',
					(fDone) =>
					{
						let tmpProv = createProvider();
						libAssert.strictEqual(tmpProv.token('Anything'), null);
						let tmpDoc = createStubDocument();
						global.document = tmpDoc;
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpProv.token('Tokens.Bogus.Path'), null);
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'cssVar() should produce var(--theme-...) references',
					(fDone) =>
					{
						let tmpProv = createProvider();
						libAssert.strictEqual(
							tmpProv.cssVar('Color.Background.Primary'),
							'var(--theme-color-background-primary)');
						libAssert.strictEqual(
							tmpProv.cssVar('Spacing.MD'),
							'var(--theme-spacing-md)');
						fDone();
					}
				);

				test
				(
					'asset()/svg()/image() should return null when not present',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpProv.svg('Logo'), null);
						libAssert.strictEqual(tmpProv.image('Hero'), null);
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'asset() should resolve nested paths under category',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme({
							Hash: 'asset-test',
							Modes: { Strategy: 'single', Default: 'light' },
							Tokens: {},
							SVG: {
								Logo: '<svg>logo</svg>',
								Icons: { Foo: '<svg>foo</svg>' }
							},
							Image: { Hero: 'data:image/png;base64,XYZ' }
						});
						tmpProv.applyTheme('asset-test');

						libAssert.strictEqual(tmpProv.svg('Logo'), '<svg>logo</svg>');
						libAssert.strictEqual(tmpProv.svg('Icons.Foo'), '<svg>foo</svg>');
						libAssert.strictEqual(tmpProv.image('Hero'), 'data:image/png;base64,XYZ');
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'BasedOn inheritance',
			() =>
			{
				test
				(
					'A non-comprehensive theme should deep-merge onto its base',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.registerTheme({
							Hash: 'retold-pinkbrand',
							Comprehensive: false,
							BasedOn: 'pict-default',
							Modes: { Strategy: 'system', Default: 'light' },
							Tokens: {
								Color: {
									Brand: {
										Primary: { Light: '#ff3399', Dark: '#ff66bb' }
									}
								}
							},
							Brand: { Name: 'Pink Retold' }
						});
						tmpProv.applyTheme('retold-pinkbrand', 'light');

						libAssert.strictEqual(tmpProv.token('Tokens.Color.Brand.Primary'), '#ff3399');
						libAssert.strictEqual(tmpProv.token('Tokens.Color.Background.Primary'), '#ffffff'); // inherited
						libAssert.strictEqual(tmpProv.token('Brand.Name'), 'Pink Retold');
						libAssert.strictEqual(tmpProv.token('Brand.Tagline'),
							'A JavaScript MVC framework for building web applications.'); // inherited
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'onApply listeners',
			() =>
			{
				test
				(
					'onApply callbacks fire on applyTheme and on setMode with the effective bundle',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);

						let tmpCalls = [];
						tmpProv.onApply((pBundle, pCtx) =>
						{
							tmpCalls.push({ Hash: pBundle.Hash, Mode: pCtx.Mode, Resolved: pCtx.ResolvedMode });
						});

						tmpProv.applyTheme('pict-default', 'light');
						tmpProv.setMode('dark');

						libAssert.strictEqual(tmpCalls.length, 2);
						libAssert.strictEqual(tmpCalls[0].Hash, 'pict-default');
						libAssert.strictEqual(tmpCalls[0].Resolved, 'light');
						libAssert.strictEqual(tmpCalls[1].Resolved, 'dark');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'onApply returns a dispose function; offApply also unsubscribes',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);

						let tmpCalls = 0;
						let tmpDispose = tmpProv.onApply(() => { tmpCalls++; });

						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpCalls, 1);

						tmpDispose();
						tmpProv.applyTheme('pict-default', 'dark');
						libAssert.strictEqual(tmpCalls, 1, 'should not fire after dispose');

						let fCB = () => { tmpCalls++; };
						tmpProv.onApply(fCB);
						tmpProv.offApply(fCB);
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpCalls, 1, 'offApply should also unsubscribe');

						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'a throwing listener does not break sibling listeners',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);

						tmpProv.onApply(() => { throw new Error('boom'); });
						let tmpSibling = 0;
						tmpProv.onApply(() => { tmpSibling++; });
						tmpProv.applyTheme('pict-default', 'light');
						libAssert.strictEqual(tmpSibling, 1);
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'Aliases',
			() =>
			{
				test
				(
					'single-mode theme should emit alias lines that resolve via var() indirection',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme({
							Hash: 'alias-single',
							Modes: { Strategy: 'single', Default: 'light' },
							Tokens: { Color: { Background: { Primary: '#abcdef' } } },
							Aliases: { '--legacy-bg': 'Color.Background.Primary' }
						});
						tmpProv.applyTheme('alias-single');

						let tmpCSS = tmpDoc._getStyleEl().textContent;
						libAssert.ok(tmpCSS.indexOf('--theme-color-background-primary: #abcdef;') >= 0);
						libAssert.ok(tmpCSS.indexOf('--legacy-bg: var(--theme-color-background-primary);') >= 0);
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'paired theme aliases live in :root only (var() indirection follows the mode swap)',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme({
							Hash: 'alias-paired',
							Modes: { Strategy: 'paired', Default: 'light' },
							Tokens: { Color: { Background: { Primary: { Light: '#fff', Dark: '#000' } } } },
							Aliases: { '--legacy-bg': 'Color.Background.Primary' }
						});
						tmpProv.applyTheme('alias-paired', 'light');

						let tmpCSS = tmpDoc._getStyleEl().textContent;
						let tmpRootBlock = tmpCSS.split('.theme-dark {')[0];
						let tmpDarkBlock = tmpCSS.split('.theme-dark {')[1] || '';

						libAssert.ok(tmpRootBlock.indexOf('--legacy-bg: var(--theme-color-background-primary);') >= 0,
							'alias should be in :root');
						libAssert.ok(tmpDarkBlock.indexOf('--legacy-bg') < 0,
							'alias should NOT be duplicated in .theme-dark');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'non-string or empty alias targets should be skipped silently',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme({
							Hash: 'alias-empty',
							Modes: { Strategy: 'single', Default: 'light' },
							Tokens: { Color: { Background: { Primary: '#fff' } } },
							Aliases: { '--ok': 'Color.Background.Primary', '--skip': '', '--also-skip': null }
						});
						tmpProv.applyTheme('alias-empty');

						let tmpCSS = tmpDoc._getStyleEl().textContent;
						libAssert.ok(tmpCSS.indexOf('--ok:') >= 0);
						libAssert.ok(tmpCSS.indexOf('--skip:') < 0);
						libAssert.ok(tmpCSS.indexOf('--also-skip:') < 0);
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'unapplyTheme',
			() =>
			{
				test
				(
					'unapplyTheme should remove style element and html classes',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);
						tmpProv.registerTheme(_ThemeDefault);
						tmpProv.applyTheme('pict-default', 'dark');

						// Wire parentNode so removeChild path is exercised.
						let tmpStyleEl = tmpDoc._getStyleEl();
						tmpStyleEl.parentNode =
						{
							removeChild: function (pEl) { /* simulated */ }
						};

						tmpProv.unapplyTheme();
						let tmpClasses = tmpDoc._getHTMLClasses();
						libAssert.ok(tmpClasses.indexOf('theme-light') < 0);
						libAssert.ok(tmpClasses.indexOf('theme-dark') < 0);
						libAssert.strictEqual(tmpProv.getActiveTheme().Hash, null);
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'Auxiliary CSS registration',
			() =>
			{
				test
				(
					'CSS array should pass through to pict.CSSMap.addCSS with priorities',
					(fDone) =>
					{
						let tmpDoc = createStubDocument();
						let tmpProv = createProvider(tmpDoc);

						let tmpAdded = [];
						let tmpRemoved = [];
						tmpProv.pict.CSSMap =
						{
							addCSS: function (pHash, pContent, pPriority) { tmpAdded.push({ pHash, pContent, pPriority }); },
							removeCSS: function (pHash) { tmpRemoved.push(pHash); }
						};

						tmpProv.registerTheme({
							Hash: 'css-test',
							Modes: { Strategy: 'single', Default: 'light' },
							Tokens: {},
							CSS: [
								{ Hash: 'css-test-base', Content: '.demo { color: red; }', Priority: 600 },
								{ Hash: 'css-test-aux', Content: '.aux { color: blue; }' }
							]
						});
						tmpProv.applyTheme('css-test');

						libAssert.strictEqual(tmpAdded.length, 2);
						libAssert.strictEqual(tmpAdded[0].pHash, 'css-test-base');
						libAssert.strictEqual(tmpAdded[0].pPriority, 600);
						libAssert.strictEqual(tmpAdded[1].pPriority, 500); // default
						tearDownDocument();
						fDone();
					}
				);
			}
		);

		suite
		(
			'Template expressions',
			() =>
			{
				function buildTemplateContext()
				{
					let tmpFable = new libFable({
						Product: 'TplTest',
						LogStreams: [{ streamtype: 'console', level: 'fatal' }]
					});
					// PictTemplate base sets `this.pict = this.fable` in its
					// constructor, then calls `this.addPattern(...)` which needs
					// `this.pict.MetaTemplate.addPatternBoth`.  Stub it on fable
					// before constructing any template expression.
					tmpFable.MetaTemplate = { addPatternBoth: function () {} };
					return tmpFable;
				}

				test
				(
					'{~Theme:~} renderer should resolve token paths',
					(fDone) =>
					{
						let tmpTemplate = require('../source/templates/Pict-Template-Theme.js');
						let tmpFable = buildTemplateContext();
						let tmpProvider = new libPictProviderTheme(tmpFable, {}, 'TestTheme');
						let tmpDoc = createStubDocument();
						global.document = tmpDoc;
						tmpFable.providers = { Theme: tmpProvider };
						tmpFable.AppData = {};
						tmpProvider.pict = tmpFable;
						tmpProvider.registerTheme(_ThemeDefault);
						tmpProvider.applyTheme('pict-default', 'light');

						let tmpExpr = new tmpTemplate(tmpFable, {}, 'TestExpr');
						libAssert.strictEqual(tmpExpr.render('Tokens.Color.Background.Primary'), '#ffffff');
						libAssert.strictEqual(tmpExpr.render('Brand.Name'), 'Pict');
						libAssert.strictEqual(tmpExpr.render(''), '');
						tearDownDocument();
						fDone();
					}
				);

				test
				(
					'{~ThemeVar:~} renderer should produce var() references',
					(fDone) =>
					{
						let tmpTemplate = require('../source/templates/Pict-Template-ThemeVar.js');
						let tmpFable = buildTemplateContext();
						let tmpProvider = new libPictProviderTheme(tmpFable, {}, 'TestTheme');
						tmpFable.providers = { Theme: tmpProvider };
						tmpFable.AppData = {};
						tmpProvider.pict = tmpFable;

						let tmpExpr = new tmpTemplate(tmpFable, {}, 'TestExpr');
						libAssert.strictEqual(tmpExpr.render('Color.Background.Primary'), 'var(--theme-color-background-primary)');
						fDone();
					}
				);

				test
				(
					'{~ThemeAsset:~} renderer should resolve "Category.Name" paths',
					(fDone) =>
					{
						let tmpTemplate = require('../source/templates/Pict-Template-ThemeAsset.js');
						let tmpFable = buildTemplateContext();
						let tmpProvider = new libPictProviderTheme(tmpFable, {}, 'TestTheme');
						let tmpDoc = createStubDocument();
						global.document = tmpDoc;
						tmpFable.providers = { Theme: tmpProvider };
						tmpFable.AppData = {};
						tmpProvider.pict = tmpFable;
						tmpProvider.registerTheme({
							Hash: 'asset-tpl',
							Modes: { Strategy: 'single', Default: 'light' },
							Tokens: {},
							SVG: { Logo: '<svg>l</svg>', Icons: { Foo: '<svg>f</svg>' } }
						});
						tmpProvider.applyTheme('asset-tpl');
						let tmpExpr = new tmpTemplate(tmpFable, {}, 'TestExpr');
						libAssert.strictEqual(tmpExpr.render('SVG.Logo'), '<svg>l</svg>');
						libAssert.strictEqual(tmpExpr.render('SVG.Icons.Foo'), '<svg>f</svg>');
						libAssert.strictEqual(tmpExpr.render('SVG'), '');
						tearDownDocument();
						fDone();
					}
				);
			}
		);
	}
);
