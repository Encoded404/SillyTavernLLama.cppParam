#!/usr/bin/env node
/**
 * Browser end-to-end test: drives a real SillyTavern in headless Chrome over CDP.
 *
 * Covers what the backend test cannot: the injected UI, /props detection, the
 * dynamically built rows, the CLI-flag import, the
 * CHAT_COMPLETION_SETTINGS_READY merge inside the live page, and a real
 * generation whose request lands on a mock llama.cpp server.
 *
 * Prerequisites: SillyTavern on :8000, mock llama.cpp on :8989, Chrome CDP on :9222.
 * Env: ST_URL, MOCK_URL, MOCK_RECORD
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const MOCK_URL = process.env.MOCK_URL || 'http://127.0.0.1:8989';
const MOCK_RECORD = process.env.MOCK_RECORD || path.join(__dirname, 'received.json');
const MESSAGE = 'browser e2e probe message';

const CLI_TEXT = String.raw`--temp 0.9 --dynatemp-range 0.25 --dynatemp-exp 1.0 --top-k 64 --top-p 0.95 --min-p 0.06 --repeat-penalty 1.0 --repeat-last-n 512 --dry-multiplier 0.4 --dry-base 1.75 --dry-allowed-length 3 --dry-penalty-last-n 512 --presence-penalty 0.15 --dry-sequence-breaker $'\n' --dry-sequence-breaker ':' --dry-sequence-breaker '"' --dry-sequence-breaker '*' --dry-sequence-breaker '.' --dry-sequence-breaker '!' --dry-sequence-breaker '?'`;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
        passed++;
    } catch (error) {
        console.error(`  FAIL ${name}\n        ${error.message}`);
        failed++;
    }
}

// Attach before navigation so startup errors are captured.
const page = await openPage(null);

/** Dismiss any modal that blocks startup (fresh installs show a welcome dialog). */
async function dismissModals() {
    return page.evaluate(`(async () => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const cancel = jQuery('.popup:visible').find('.popup-button-cancel').last()[0];
            const ok = jQuery('.popup:visible').find('.popup-button-ok').last()[0];
            const target = cancel || ok;
            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 600));
                continue;
            }
            if (!jQuery('.popup:visible').length) return true;
            await new Promise(r => setTimeout(r, 300));
        }
        return false;
    })()`);
}

/**
 * SillyTavern ships the Quick Reply extension enabled, and its
 * GENERATION_AFTER_COMMANDS hook swallows the generation in a headless
 * environment (no user to answer its prompts). It is orthogonal to what we are
 * testing, so disable it and reload.
 */
async function ensureQuickReplyDisabled() {
    const alreadyDisabled = await page.evaluate(
        `SillyTavern.getContext().extensionSettings.disabledExtensions.includes('quick-reply')`,
    );
    if (alreadyDisabled) return false;

    await page.evaluate(`(async () => {
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings.disabledExtensions.push('quick-reply');
        ctx.saveSettingsDebounced();
        await new Promise(r => setTimeout(r, 2500));
        return true;
    })()`);

    await page.send('Page.reload', {});
    await new Promise(r => setTimeout(r, 1500));
    return true;
}

try {
    await page.navigate(`${ST_URL}/`);
    await page.waitFor(`document.querySelector('#llamasampler_panel')`, 60000, 'extension panel');
    await dismissModals();
    await page.waitFor(`SillyTavern.getContext().characters?.length > 0`, 30000, 'character list');

    if (await ensureQuickReplyDisabled()) {
        console.log('  ..   disabled the Quick Reply extension and reloaded');
        await page.waitFor(`document.querySelector('#llamasampler_panel')`, 60000, 'extension panel after reload');
        await dismissModals();
        await page.waitFor(`SillyTavern.getContext().characters?.length > 0`, 30000, 'character list after reload');
    }

    /* ---------------------------------------------------- 1. panel mounts -- */
    const mountInfo = JSON.parse(await page.evaluate(`JSON.stringify({
        afterTopP: document.querySelector('#top_p_openai')?.closest('.range-block')?.nextElementSibling?.id || null,
        dataSource: document.querySelector('#llamasampler_panel')?.getAttribute('data-source') || null,
        hasCliBox: !!document.querySelector('#llamasampler_cli'),
        hasPreview: !!document.querySelector('#llamasampler_preview'),
        keyInputType: document.querySelector('#llamasampler_api_key')?.getAttribute('type') || null,
        warning: document.querySelector('#llamasampler_panel .llamasampler-warning')?.textContent || '',
    })`));
    check('panel sits directly after the Top P slider', () => assert.equal(mountInfo.afterTopP, 'llamasampler_panel'));
    check('panel is gated to the custom source', () => assert.equal(mountInfo.dataSource, 'custom'));
    check('panel exposes the CLI import and preview controls', () => {
        assert.ok(mountInfo.hasCliBox && mountInfo.hasPreview);
    });
    check('panel offers an API key field, kept out of SillyTavern settings', () => {
        assert.equal(mountInfo.keyInputType, 'password', 'the key field should be masked');
        assert.ok(mountInfo.warning.includes('localStorage'), mountInfo.warning);
        assert.ok(/unencrypted/i.test(mountInfo.warning), mountInfo.warning);
    });

    /* ------------------------------------------- 2. select custom + probe -- */
    await page.evaluate(`(async () => {
        // Chat Completion must be the active API, otherwise SillyTavern short-circuits
        // Generate() with online_status === 'no_connection'.
        $('#main_api').val('openai').trigger('change');
        await new Promise(r => setTimeout(r, 500));
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val(${JSON.stringify(`${MOCK_URL}/v1`)}).trigger('input').trigger('change');
        $('#custom_model_id').val('test-model').trigger('input').trigger('change');
        await new Promise(r => setTimeout(r, 800));
        $('#llamasampler_panel .llamasampler-refresh').trigger('click');
        return true;
    })()`);

    await page.waitFor(`document.querySelector('#llamasampler_panel .llamasampler-ok')`, 15000, 'llama.cpp detection');
    await page.waitFor(`SillyTavern.getContext().onlineStatus !== 'no_connection'`, 20000, 'chat completion connection');

    const status = await page.evaluate(`document.querySelector('#llamasampler_panel .llamasampler-status').innerText`);
    check('detects the llama.cpp server and shows its build info', () => {
        assert.ok(status.includes('llama.cpp detected'), status);
        assert.ok(status.includes('test-model'), status);
    });
    check('the status line names the route that worked', () => {
        assert.ok(status.includes('via'), status);
    });

    /* ------------------------------- 2b. server-side route (plugin) -- */
    // Simulates a browser that cannot reach llama.cpp directly: the lookup has
    // to be performed by the SillyTavern server instead.
    const viaPlugin = JSON.parse(await page.evaluate(`(async () => {
        $('#llamasampler_transport').val('plugin').trigger('change');
        await new Promise(r => setTimeout(r, 3000));
        return JSON.stringify({
            status: document.querySelector('#llamasampler_panel .llamasampler-status').innerText,
            topK: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.value,
            rows: document.querySelectorAll('#llamasampler_panel .llamasampler-row').length,
        });
    })()`));

    check('forcing the plugin route reaches llama.cpp through the SillyTavern server', () => {
        assert.ok(viaPlugin.status.includes('llama.cpp detected'), viaPlugin.status);
        assert.ok(viaPlugin.status.includes('SillyTavern server plugin'), viaPlugin.status);
        assert.equal(viaPlugin.topK, '64');
        assert.ok(viaPlugin.rows >= 40, `only ${viaPlugin.rows} rows`);
    });

    // Back to automatic routing for the rest of the run.
    await page.evaluate(`$('#llamasampler_transport').val('auto').trigger('change')`);
    await page.waitFor(`document.querySelector('#llamasampler_panel .llamasampler-ok')`, 15000, 'auto routing restored');
    await new Promise(r => setTimeout(r, 500));

    /* --------------------------- 2c. server-side route (CORS proxy) -- */
    // Only meaningful when SillyTavern's CORS proxy is switched on
    // (enableCorsProxy: true in config.yaml), so this is a soft check.
    const viaProxy = JSON.parse(await page.evaluate(`(async () => {
        $('#llamasampler_transport').val('corsProxy').trigger('change');
        await new Promise(r => setTimeout(r, 3000));
        return JSON.stringify({
            status: document.querySelector('#llamasampler_panel .llamasampler-status').innerText,
            topK: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.value,
        });
    })()`));

    if (viaProxy.status.includes('CORS proxy')) {
        if (process.env.MOCK_API_KEY) {
            // The mock requires an API key and SillyTavern hides the saved one from
            // the browser, so this route must fail with advice rather than a bare 400.
            check('a rejected CORS proxy request explains the --api-key cause', () => {
                assert.ok(viaProxy.status.includes('rejected the request'), viaProxy.status);
                assert.ok(viaProxy.status.includes('--api-key') || viaProxy.status.includes('API key field'), viaProxy.status);
            });

            // The extension's own field is the browser-local option: it must work,
            // and it must stay out of the settings SillyTavern stores server-side.
            const ownKey = JSON.parse(await page.evaluate(`(async () => {
                $('#llamasampler_transport').val('corsProxy').trigger('change');
                $('#llamasampler_api_key').val(${JSON.stringify(process.env.MOCK_API_KEY)}).trigger('input').trigger('change');
                await new Promise(r => setTimeout(r, 3500));
                return JSON.stringify({
                    status: document.querySelector('#llamasampler_panel .llamasampler-status').innerText,
                    topK: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.value,
                    stored: localStorage.getItem('st-llamacpp-samplers:apiKey'),
                    leaked: JSON.stringify(SillyTavern.getContext().extensionSettings)
                        .includes(${JSON.stringify(process.env.MOCK_API_KEY)}),
                });
            })()`));

            check('a key typed into the extension field lets the CORS proxy route authenticate', () => {
                assert.ok(ownKey.status.includes('llama.cpp detected'), ownKey.status);
                assert.equal(ownKey.topK, '64');
            });

            check('the key lands in browser storage, not in SillyTavern extension settings', () => {
                assert.equal(ownKey.stored, process.env.MOCK_API_KEY);
                assert.equal(ownKey.leaked, false, 'the key must never be written to extensionSettings');
            });

            const settingsPath = process.env.ST_SETTINGS || '/tmp/st-test/data/default-user/settings.json';
            if (fs.existsSync(settingsPath)) {
                check('the key never reaches SillyTavern settings on disk', () => {
                    const contents = fs.readFileSync(settingsPath, 'utf8');
                    assert.ok(!contents.includes(process.env.MOCK_API_KEY), `${settingsPath} contains the API key`);
                });
            }

            // Leave the browser clean for the rest of the run.
            await page.evaluate(`$('#llamasampler_api_key').val('').trigger('input')`);
        } else {
            check('forcing the CORS proxy route also reaches llama.cpp through SillyTavern', () => {
                assert.ok(viaProxy.status.includes('llama.cpp detected'), viaProxy.status);
                assert.equal(viaProxy.topK, '64');
            });
        }
    } else {
        console.log('  skip CORS proxy route (enableCorsProxy is false in this SillyTavern)');
    }

    await page.evaluate(`$('#llamasampler_transport').val('auto').trigger('change')`);
    await page.waitFor(`document.querySelector('#llamasampler_panel .llamasampler-ok')`, 15000, 'auto routing restored');
    await new Promise(r => setTimeout(r, 500));

    /* ------------------------------------- 3. negative detection case -- */
    const negative = await page.evaluate(`(async () => {
        $('#custom_api_url_text').val('http://127.0.0.1:9/v1').trigger('input').trigger('change');
        await new Promise(r => setTimeout(r, 200));
        $('#llamasampler_panel .llamasampler-refresh').trigger('click');
        await new Promise(r => setTimeout(r, 4000));
        const text = document.querySelector('#llamasampler_panel .llamasampler-status').innerText;
        $('#custom_api_url_text').val(${JSON.stringify(`${MOCK_URL}/v1`)}).trigger('input').trigger('change');
        $('#llamasampler_panel .llamasampler-refresh').trigger('click');
        await new Promise(r => setTimeout(r, 2000));
        return text;
    })()`);
    check('a non-llama.cpp / unreachable endpoint is reported, not silently accepted', () => {
        assert.ok(negative.includes('Not detected'), negative);
    });

    /* ---------------------------- 3b. a pinned route explains itself -- */
    // Pinning means "only this route", which is a common reason a working setup
    // still fails, so the message has to say so.
    const pinned = await page.evaluate(`(async () => {
        $('#custom_api_url_text').val('http://127.0.0.1:9/v1').trigger('input').trigger('change');
        $('#llamasampler_transport').val('direct').trigger('change');
        await new Promise(r => setTimeout(r, 5000));
        const text = document.querySelector('#llamasampler_panel .llamasampler-status').innerText;
        $('#llamasampler_transport').val('auto').trigger('change');
        $('#custom_api_url_text').val(${JSON.stringify(`${MOCK_URL}/v1`)}).trigger('input').trigger('change');
        await new Promise(r => setTimeout(r, 1500));
        return text;
    })()`);

    check('a pinned route says so instead of silently reporting only one failure', () => {
        assert.ok(pinned.includes('Route is pinned to'), pinned);
        assert.ok(!pinned.includes('<!DOCTYPE'), 'should not quote SillyTavern\'s HTML 404 page');
    });

    await page.waitFor(`document.querySelector('#llamasampler_panel .llamasampler-ok')`, 15000, 'detection restored');
    await new Promise(r => setTimeout(r, 500));

    /* --------------------------------------------- 4. rows built from props -- */
    const rows = JSON.parse(await page.evaluate(`JSON.stringify(
        [...document.querySelectorAll('#llamasampler_panel .llamasampler-row')].map(r => r.dataset.key)
    )`));

    check('a row was built for every parameter from /props', () => {
        assert.ok(rows.length >= 40, `only ${rows.length} rows`);
    });
    check('llama.cpp-only parameters are present', () => {
        for (const key of ['top_k', 'min_p', 'dynatemp_range', 'dry_multiplier', 'dry_base',
            'dry_allowed_length', 'dry_penalty_last_n', 'dry_sequence_breakers', 'repeat_penalty', 'xtc_probability']) {
            assert.ok(rows.includes(key), `missing row for ${key}`);
        }
    });

    const topK = JSON.parse(await page.evaluate(`JSON.stringify({
        value: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.value,
        slider: document.querySelector('#llamasampler_panel .llamasampler-range[data-key="top_k"]')?.value,
        min: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.min,
        max: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="top_k"]')?.max,
        default: document.querySelector('#llamasampler_panel .llamasampler-row[data-key="top_k"] .llamasampler-default')?.textContent,
    })`));
    check('top_k is prefilled from the live server value with its curated range', () => {
        assert.equal(topK.value, '64');
        assert.equal(topK.slider, '64');
        assert.equal(topK.min, '0');
        assert.equal(topK.max, '1000');
        assert.ok(topK.default.includes('64'), topK.default);
    });

    const unknownRow = JSON.parse(await page.evaluate(`JSON.stringify({
        label: document.querySelector('#llamasampler_panel .llamasampler-row[data-key="brand_new_llamacpp_knob"] .llamasampler-name')?.innerText,
        badge: document.querySelector('#llamasampler_panel .llamasampler-row[data-key="brand_new_llamacpp_knob"] .llamasampler-badge-warn')?.textContent,
        max: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="brand_new_llamacpp_knob"]')?.max,
        type: document.querySelector('#llamasampler_panel .llamasampler-number[data-key="brand_new_llamacpp_knob"]') ? 'number' : 'other',
    })`));
    check('an unknown /props key gets a generated label, badge and inferred range', () => {
        assert.ok(unknownRow.label.includes('Brand New Llamacpp Knob'), unknownRow.label);
        assert.equal(unknownRow.badge, '?');
        assert.equal(unknownRow.type, 'number');
        assert.ok(Number(unknownRow.max) > 7, 'inferred max should exceed the live value');
    });

    const advanced = JSON.parse(await page.evaluate(`JSON.stringify({
        open: !!document.querySelector('#llamasampler_panel .llamasampler-advanced')?.open,
        summary: document.querySelector('#llamasampler_panel .llamasampler-advanced summary')?.innerText,
        hasGrammar: !!document.querySelector('#llamasampler_panel .llamasampler-advanced .llamasampler-row[data-key="grammar"]'),
    })`));
    check('pipeline parameters are tucked into a collapsed Advanced section', () => {
        assert.equal(advanced.open, false, 'advanced section should start collapsed');
        assert.ok(advanced.summary.startsWith('Advanced'), advanced.summary);
        assert.ok(advanced.hasGrammar, 'grammar should be inside the advanced section');
    });

    /* ------------------------------------------------- 5. CLI flag import -- */
    await page.evaluate(`(async () => {
        $('#llamasampler_panel .llamasampler-cli-toggle').trigger('click');
        $('#llamasampler_cli').val(${JSON.stringify(CLI_TEXT)}).trigger('input');
        await new Promise(r => setTimeout(r, 100));
        $('#llamasampler_panel .llamasampler-cli-apply').trigger('click');
        return true;
    })()`);

    const cli = JSON.parse(await page.evaluate(`JSON.stringify({
        warn: document.querySelector('#llamasampler_cli_warn')?.textContent,
        enabled: [...document.querySelectorAll('#llamasampler_panel .llamasampler-enable')].filter(c => c.checked).map(c => c.dataset.key),
        preview: document.querySelector('#llamasampler_preview')?.textContent,
    })`));

    check('CLI import enables exactly the flags that were mapped', () => {
        const expected = ['temperature', 'dynatemp_range', 'dynatemp_exponent', 'top_k', 'top_p', 'min_p',
            'repeat_penalty', 'repeat_last_n', 'dry_multiplier', 'dry_base', 'dry_allowed_length',
            'dry_penalty_last_n', 'presence_penalty', 'dry_sequence_breakers'];
        assert.deepEqual([...cli.enabled].sort(), [...expected].sort());
    });
    check('CLI import reports no unrecognized flags', () => {
        assert.ok(cli.warn.includes('Applied 14 parameter(s).'), cli.warn);
        assert.ok(!cli.warn.includes('Unrecognized'), cli.warn);
    });
    check('preview shows the YAML that will be merged', () => {
        assert.ok(cli.preview.includes('dry_multiplier: 0.4'), cli.preview);
        assert.ok(cli.preview.includes('top_k: 64'), cli.preview);
        assert.ok(cli.preview.includes('dry_sequence_breakers:'), cli.preview);
    });

    /* ------------------------------------------- 6. merge into the payload -- */
    const merged = await page.evaluate(`(async () => {
        const ctx = SillyTavern.getContext();
        const data = { custom_include_body: '# mine\\ncustom_flag: 1\\ndry_multiplier: 9.99\\n' };
        await ctx.eventSource.emit(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
        return data.custom_include_body;
    })()`);
    check('the live page merges our parameters into generate_data', () => {
        assert.ok(merged.includes('dry_multiplier: 0.4'), merged);
        assert.ok(merged.includes('top_k: 64'), merged);
        assert.ok(!merged.includes('9.99'), 'our value must replace the pre-existing one');
        assert.ok(merged.includes('custom_flag: 1'), 'the user YAML must survive');
        assert.equal(merged.match(/dry_multiplier/g).length, 1, 'no duplicate keys');
    });

    const otherSource = await page.evaluate(`(async () => {
        $('#chat_completion_source').val('openai').trigger('change');
        await new Promise(r => setTimeout(r, 200));
        const ctx = SillyTavern.getContext();
        const data = { custom_include_body: 'untouched: 1\\n' };
        await ctx.eventSource.emit(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, data);
        $('#chat_completion_source').val('custom').trigger('change');
        return data.custom_include_body;
    })()`);
    check('the merge is a no-op for other chat completion sources', () => {
        assert.equal(otherSource, 'untouched: 1\n');
    });

    /* ------------------------------------- 7. a real generation round-trip -- */
    try {
        fs.rmSync(MOCK_RECORD, { force: true });
    } catch { /* nothing to remove */ }

    const sent = await page.evaluate(`(async () => {
        const ctx = SillyTavern.getContext();
        const list = await fetch('/api/characters/all', { method: 'POST', headers: ctx.getRequestHeaders() }).then(r => r.json());
        if (!list.length) return 'no characters';

        // selectCharacterById takes an index into the client-side characters array
        let index = ctx.characters.findIndex(c => c.avatar === list[0].avatar);
        if (index === -1) index = 0;

        // let any pending chat save settle, otherwise SillyTavern refuses to switch
        await new Promise(r => setTimeout(r, 1500));
        await ctx.selectCharacterById(index, { switchMenu: false });

        // getContext() returns a snapshot, so re-read it while polling
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && SillyTavern.getContext().characterId === undefined) {
            await new Promise(r => setTimeout(r, 250));
        }
        if (SillyTavern.getContext().characterId === undefined) return 'character never got selected';
        await new Promise(r => setTimeout(r, 1500));

        const box = document.querySelector('#send_textarea');
        if (!box) return 'no send box';
        box.value = ${JSON.stringify(MESSAGE)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
        $('#send_but').trigger('click');
        return 'sent';
    })()`);

    if (sent !== 'sent') {
        check(`real generation (skipped: ${sent})`, () => assert.ok(false));
    } else {
        const deadline = Date.now() + 30000;
        let received = null;
        while (Date.now() < deadline) {
            try {
                const candidate = JSON.parse(fs.readFileSync(MOCK_RECORD, 'utf8'));
                if (candidate?.body?.messages?.some(m => String(m.content).includes(MESSAGE))) {
                    received = candidate;
                    break;
                }
            } catch { /* not written yet */ }
            await new Promise(r => setTimeout(r, 400));
        }

        check('a real SillyTavern generation delivers our parameters to llama.cpp', () => {
            assert.ok(received, 'no generation request reached the mock server');
            const body = received.body;
            console.log(`        (llama.cpp received ${Object.keys(body).length} body keys)`);
            assert.equal(body.top_k, 64);
            assert.equal(body.min_p, 0.06);
            assert.equal(body.dry_multiplier, 0.4);
            assert.equal(body.dynatemp_range, 0.25);
            assert.deepEqual(body.dry_sequence_breakers, ['\n', ':', '"', '*', '.', '!', '?']);
            assert.equal(body.temperature, 0.9);
            assert.equal(body.presence_penalty, 0.15);
        });
    }

    if (page.consoleErrors.length) {
        console.log('\npage console errors (first 5):');
        for (const error of page.consoleErrors.slice(0, 5)) console.log(`  ! ${error}`);
    }
} catch (error) {
    console.error(`\nABORTED: ${error.message}`);
    console.error('page console errors:', page.consoleErrors.slice(0, 10));
    failed++;
} finally {
    page.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}
