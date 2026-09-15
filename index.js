/**
 * llama.cpp sampler panel for SillyTavern's Custom (OpenAI-compatible) endpoint.
 *
 * Why an extension rather than a core patch: the Custom endpoint is the only
 * chat-completion source that forwards arbitrary request-body keys, through
 * `custom_include_body`, which the server merges with mergeObjectWithYaml() in
 * src/endpoints/backends/chat-completions.js. SillyTavern emits
 * CHAT_COMPLETION_SETTINGS_READY with the outgoing payload immediately before it
 * POSTs, so an extension can merge its own parameters in without touching a
 * single core file.
 *
 * Parameter discovery uses llama.cpp's `GET /props`, which serialises the entire
 * resolved sampling configuration under `default_generation_settings.params`.
 *
 * Everything SillyTavern-side goes through SillyTavern.getContext() (the
 * documented stable API) rather than deep imports of internal modules.
 */
import {
    GROUP_ORDER,
    GROUP_TITLES,
    PARAM_METADATA,
    specFor,
    coerceValue,
    parseCliFlags,
    buildIncludeBody,
    propsUrlFromBase,
    isLlamaCppProps,
} from './params.js';

const MODULE = 'st_llamacpp_samplers';
const PANEL_ID = 'llamasampler_panel';
const LOG = '[llamacpp-samplers]';
const DETECT_TIMEOUT_MS = 5000;
const REPROBE_DEBOUNCE_MS = 750;
const DEFAULT_EXTENSION_PATH = 'third-party/llama-cpp-samplers';

const metaIndex = new Map(Object.keys(PARAM_METADATA).map((key, i) => [key, i]));

/**
 * Our own folder name relative to /scripts/extensions, e.g.
 * "third-party/SomeFolderName", as expected by renderExtensionTemplateAsync().
 * Derived from the module URL so the extension works regardless of the folder
 * name it was installed into.
 */
const EXTENSION_PATH = (() => {
    try {
        const dir = new URL('.', import.meta.url).pathname.replace(/\/+$/, '');
        const marker = '/scripts/extensions/';
        const at = dir.indexOf(marker);
        const name = at === -1 ? '' : dir.slice(at + marker.length);
        return name ? decodeURIComponent(name) : DEFAULT_EXTENSION_PATH;
    } catch {
        return DEFAULT_EXTENSION_PATH;
    }
})();

/* ------------------------------------------------------------ ST plumbing -- */

/** Lazy context access: the SillyTavern global may not exist at module load. */
function ctx() {
    return SillyTavern.getContext();
}

function log(...args) {
    console.debug(LOG, ...args);
}

function warn(...args) {
    console.warn(LOG, ...args);
}

/** DOMPurify if SillyTavern exposes it, otherwise a pass-through. */
function sanitize(html) {
    const domPurify = globalThis.SillyTavern?.libs?.DOMPurify;
    return domPurify ? domPurify.sanitize(html) : html;
}

/* ------------------------------------------------------------------ state -- */

function defaultState() {
    return {
        detected: false,
        lastError: '',
        serverInfo: '',
        probedUrl: '',
        /// Raw `default_generation_settings.params` from the last successful probe.
        params: {},
        /// key -> { enabled, value, touched }
        rows: {},
        cliText: '',
        cliOpen: false,
    };
}

function state() {
    const extensionSettings = ctx().extensionSettings;

    if (typeof extensionSettings[MODULE] !== 'object' || extensionSettings[MODULE] === null) {
        extensionSettings[MODULE] = defaultState();
    }

    const settings = extensionSettings[MODULE];
    for (const [key, value] of Object.entries(defaultState())) {
        if (!(key in settings)) settings[key] = value;
    }
    if (typeof settings.params !== 'object' || settings.params === null) settings.params = {};
    if (typeof settings.rows !== 'object' || settings.rows === null) settings.rows = {};

    return settings;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

function ensureRow(key) {
    const settings = state();
    if (!settings.rows[key]) settings.rows[key] = { enabled: false, value: settings.params[key] };
    return settings.rows[key];
}

/** The Custom endpoint API key, as typed into the connection panel. */
function getCustomApiKey() {
    const input = document.getElementById('api_key_custom');
    return input && typeof input.value === 'string' ? input.value.trim() : '';
}

/** Everything /props reported, plus anything already configured by the user. */
function knownKeys() {
    const settings = state();
    return [...new Set([...Object.keys(settings.params), ...Object.keys(settings.rows)])];
}

function sortKeys(keys) {
    return [...keys].sort((a, b) => {
        const ia = metaIndex.has(a) ? metaIndex.get(a) : Number.MAX_SAFE_INTEGER;
        const ib = metaIndex.has(b) ? metaIndex.get(b) : Number.MAX_SAFE_INTEGER;
        if (ia !== ib) return ia - ib;
        return a.localeCompare(b);
    });
}

/** Normalise a control value into what should end up in the request body. */
function normalizeRowValue(spec, raw) {
    // String arrays are edited as JSON-ish text in the UI.
    if (spec.type === 'stringArray' && typeof raw === 'string') {
        const text = raw.trim();
        if (text === '') return [];
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                return Array.isArray(parsed) ? parsed.map(String) : undefined;
            } catch {
                return undefined;
            }
        }
        return [text];
    }

    return coerceValue(spec, raw);
}

/** Parameters that should be merged into the request body right now. */
function collectOverrides() {
    const settings = state();
    const overrides = {};

    for (const [key, row] of Object.entries(settings.rows)) {
        if (!row || !row.enabled) continue;

        const spec = specFor(key, settings.params[key]);
        const value = normalizeRowValue(spec, row.value);

        if (value === undefined || value === null) continue;
        // An empty array would make llama.cpp reject e.g. dry_sequence_breakers.
        if (Array.isArray(value) && value.length === 0) continue;

        overrides[key] = value;
    }

    return overrides;
}

/* ------------------------------------------------------------------ probe -- */

async function probeServer({ quiet = false } = {}) {
    const settings = state();
    const url = propsUrlFromBase(ctx().chatCompletionSettings.custom_url);

    if (!url) {
        settings.detected = false;
        settings.lastError = 'Set the Custom endpoint URL first.';
        render();
        if (!quiet) toastr.warning('Set the Custom endpoint URL first.', 'llama.cpp samplers');
        return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

    try {
        const headers = {};
        const key = getCustomApiKey();
        if (key) headers.Authorization = `Bearer ${key}`;

        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from ${url}`);
        }

        const payload = await response.json();
        if (!isLlamaCppProps(payload)) {
            throw new Error('no default_generation_settings.params in the response');
        }

        const params = payload.default_generation_settings.params;
        settings.detected = true;
        settings.lastError = '';
        settings.params = params;
        settings.probedUrl = url;
        settings.serverInfo = [
            payload.build_info,
            payload.model_alias,
            payload.model_ftype,
            payload.default_generation_settings.n_ctx ? `n_ctx ${payload.default_generation_settings.n_ctx}` : '',
        ].filter(Boolean).join(' · ');

        for (const [key, value] of Object.entries(params)) {
            const row = settings.rows[key];
            if (!row) {
                settings.rows[key] = { enabled: false, value };
            } else if (!row.touched && !row.enabled) {
                // Adopt the server value while the user has not taken control.
                row.value = value;
            }
        }

        log(`detected llama.cpp at ${url} with ${Object.keys(params).length} parameters`);
        if (!quiet) toastr.success(`Found ${Object.keys(params).length} parameters.`, 'llama.cpp samplers');
    } catch (error) {
        settings.detected = false;
        settings.probedUrl = url;
        settings.lastError = error?.name === 'AbortError'
            ? `timed out after ${DETECT_TIMEOUT_MS}ms reaching ${url}`
            : `${error?.message || error}`;

        if (!quiet) {
            toastr.error(settings.lastError, 'llama.cpp samplers');
            console.debug(LOG, 'probe failed:', error);
        }
    } finally {
        clearTimeout(timer);
    }

    saveSettings();
    render();
}

let reprobeTimer = null;
function scheduleReprobe() {
    clearTimeout(reprobeTimer);
    reprobeTimer = setTimeout(() => probeServer({ quiet: true }), REPROBE_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------- view -- */

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatServerValue(value) {
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) return JSON.stringify(value);
    return String(value);
}

function buildValueControl(spec, key, value) {
    const attrs = [
        `data-key="${escapeAttr(key)}"`,
        Number.isFinite(spec.min) ? `min="${spec.min}"` : '',
        Number.isFinite(spec.max) ? `max="${spec.max}"` : '',
        Number.isFinite(spec.step) ? `step="${spec.step}"` : '',
    ].filter(Boolean).join(' ');

    switch (spec.type) {
        case 'bool':
            return `<input type="checkbox" class="llamasampler-bool" data-key="${escapeAttr(key)}" ${value ? 'checked' : ''}>`;

        case 'int':
        case 'float': {
            const numeric = Number(value);
            const safe = Number.isFinite(numeric) ? numeric : 0;
            return `<input type="range" class="neo-range-slider llamasampler-range" ${attrs} value="${safe}">`
                + `<input type="number" class="neo-range-input llamasampler-number" ${attrs} value="${safe}">`;
        }

        case 'stringArray':
        case 'json': {
            const text = value === undefined || value === null ? '' : JSON.stringify(value);
            return `<input type="text" class="text_pole llamasampler-text" data-key="${escapeAttr(key)}" value="${escapeAttr(text)}">`;
        }

        default:
            return `<input type="text" class="text_pole llamasampler-text" data-key="${escapeAttr(key)}" value="${escapeAttr(value ?? '')}">`;
    }
}

function buildRow(key) {
    const settings = state();
    const serverValue = settings.params[key];
    const spec = specFor(key, serverValue);
    const row = ensureRow(key);
    const value = row.value === undefined ? serverValue : row.value;

    const badges = [
        spec.stNative ? '<span class="llamasampler-badge" title="SillyTavern also sends this from its own slider">st</span>' : '',
        spec.inferred ? '<span class="llamasampler-badge llamasampler-badge-warn" title="No curated metadata; the range is inferred from the live value">?</span>' : '',
    ].join('');

    const title = spec.desc ? ` title="${escapeAttr(spec.desc)}"` : '';
    const serverHint = settings.detected && serverValue !== undefined
        ? `<span class="llamasampler-default">server: ${escapeAttr(formatServerValue(serverValue))}</span>`
        : '';

    return `
        <div class="llamasampler-row${row.enabled ? ' llamasampler-row-on' : ''}" data-key="${escapeAttr(key)}">
            <label class="checkbox_label llamasampler-enable-label"${title}>
                <input type="checkbox" class="llamasampler-enable" data-key="${escapeAttr(key)}" ${row.enabled ? 'checked' : ''}>
                <span class="llamasampler-name">${escapeAttr(spec.label)}${badges}</span>
            </label>
            <code class="llamasampler-key" title="JSON body key">${escapeAttr(key)}</code>
            <div class="llamasampler-control">${buildValueControl(spec, key, value)}</div>
            <div class="llamasampler-hint">${serverHint}${spec.desc ? `<span class="llamasampler-desc">${escapeAttr(spec.desc)}</span>` : ''}</div>
        </div>`;
}

function buildGroup(title, keys) {
    if (!keys.length) return '';
    return `<div class="llamasampler-group">
        <div class="llamasampler-group-title">${escapeAttr(title)}</div>
        ${keys.map(buildRow).join('')}
    </div>`;
}

function renderGroups() {
    const settings = state();
    const groups = new Map();

    for (const key of sortKeys(knownKeys())) {
        const spec = specFor(key, settings.params[key]);
        const bucket = spec.advanced ? 'advanced' : (spec.group || 'detected');
        if (!groups.has(bucket)) groups.set(bucket, []);
        groups.get(bucket).push(key);
    }

    const primaryOrder = [...GROUP_ORDER.filter(group => group !== 'pipeline'), 'pipeline'];
    const primary = primaryOrder
        .filter(name => groups.has(name))
        .map(name => buildGroup(GROUP_TITLES[name] || name, groups.get(name)))
        .join('');

    const advancedKeys = groups.get('advanced') || [];
    const advanced = advancedKeys.length
        ? `<details class="llamasampler-advanced">
               <summary>Advanced / request pipeline (${advancedKeys.length})</summary>
               ${buildGroup('Advanced', advancedKeys)}
           </details>`
        : '';

    return sanitize(primary + advanced);
}

function renderStatus() {
    const settings = state();

    if (settings.detected) {
        return `<span class="llamasampler-ok">llama.cpp detected</span> <span class="llamasampler-muted">${escapeAttr(settings.serverInfo || '')}</span>`;
    }
    if (settings.lastError) {
        return `<span class="llamasampler-err">Not detected</span> <span class="llamasampler-muted">${escapeAttr(settings.lastError)}</span>`;
    }
    return '<span class="llamasampler-muted">Not probed yet.</span>';
}

function renderPreview() {
    const $preview = jQuery('#llamasampler_preview');
    if (!$preview.length) return;

    const overrides = collectOverrides();
    $preview.text(Object.keys(overrides).length ? buildIncludeBody('', overrides) : '# nothing enabled yet');
}

function render() {
    const $panel = jQuery(`#${PANEL_ID}`);
    if (!$panel.length) return;

    $panel.find('.llamasampler-status').html(renderStatus());
    $panel.find('.llamasampler-groups').html(renderGroups());
    renderPreview();
}

/* -------------------------------------------------------------- injection -- */

function onChatCompletionSettingsReady(generateData) {
    if (!generateData || typeof generateData !== 'object') return;
    if (ctx().chatCompletionSettings.chat_completion_source !== 'custom') return;

    const overrides = collectOverrides();
    if (!Object.keys(overrides).length) return;

    generateData.custom_include_body = buildIncludeBody(generateData.custom_include_body, overrides);
    log('merged custom_include_body:\n' + generateData.custom_include_body);
}

/* ---------------------------------------------------------------- wiring -- */

function applyCliFlags() {
    const settings = state();
    const { values, unknown } = parseCliFlags(settings.cliText);

    for (const [key, value] of Object.entries(values)) {
        const spec = specFor(key, settings.params[key]);
        settings.rows[key] = {
            enabled: true,
            touched: true,
            // Keep an editable representation in the row.
            value: spec.type === 'stringArray' || spec.type === 'json' ? JSON.stringify(value) : value,
        };
    }

    const applied = Object.keys(values).length;
    const message = unknown.length
        ? `Applied ${applied} parameter(s). Unrecognized: ${unknown.join(', ')}`
        : `Applied ${applied} parameter(s).`;

    jQuery('#llamasampler_cli_warn')
        .text(message)
        .toggleClass('llamasampler-err', unknown.length > 0);

    if (unknown.length) warn('unrecognized CLI flags:', unknown);

    saveSettings();
    render();
}

/** Keep every control for `key` in sync with the value the user just typed. */
function syncControlValue(key, value, source) {
    jQuery(`#${PANEL_ID}`)
        .find('[data-key]')
        .filter((_, el) => el.dataset.key === key && el !== source)
        .filter('.llamasampler-range, .llamasampler-number')
        .val(value);
}

function bindEvents() {
    const $panel = jQuery(`#${PANEL_ID}`);

    $panel.on('change', '.llamasampler-enable', function () {
        const key = jQuery(this).data('key');
        const row = ensureRow(key);
        row.enabled = jQuery(this).prop('checked');
        row.touched = true;
        jQuery(this).closest('.llamasampler-row').toggleClass('llamasampler-row-on', row.enabled);
        saveSettings();
        renderPreview();
    });

    $panel.on('input change', '.llamasampler-range, .llamasampler-number', function () {
        const key = jQuery(this).data('key');
        const value = Number(jQuery(this).val());
        if (!Number.isFinite(value)) return;

        const row = ensureRow(key);
        row.value = value;
        row.touched = true;

        syncControlValue(key, value, this);
        saveSettings();
        renderPreview();
    });

    $panel.on('change', '.llamasampler-bool', function () {
        const key = jQuery(this).data('key');
        const row = ensureRow(key);
        row.value = jQuery(this).prop('checked');
        row.touched = true;
        saveSettings();
        renderPreview();
    });

    $panel.on('input', '.llamasampler-text', function () {
        const key = jQuery(this).data('key');
        const row = ensureRow(key);
        row.value = jQuery(this).val();
        row.touched = true;
        saveSettings();
        renderPreview();
    });

    $panel.on('click', '.llamasampler-refresh', () => probeServer());

    $panel.on('click', '.llamasampler-cli-toggle', () => {
        const settings = state();
        settings.cliOpen = !settings.cliOpen;
        jQuery('#llamasampler_cli_box').toggle(settings.cliOpen);
        saveSettings();
    });

    $panel.on('input', '#llamasampler_cli', function () {
        state().cliText = jQuery(this).val();
        saveSettings();
    });

    $panel.on('click', '.llamasampler-cli-apply', () => applyCliFlags());

    jQuery('#chat_completion_source').on('change', () => {
        syncPanelVisibility();
        if (ctx().chatCompletionSettings.chat_completion_source === 'custom') scheduleReprobe();
    });

    jQuery(document).on('input', '#custom_api_url_text', () => {
        if (ctx().chatCompletionSettings.chat_completion_source === 'custom') scheduleReprobe();
    });
}

/** Keep the panel in step with SillyTavern's own data-source gating. */
function syncPanelVisibility() {
    const visible = ctx().chatCompletionSettings.chat_completion_source === 'custom';
    jQuery(`#${PANEL_ID}`).toggle(visible);
    return visible;
}

async function mountPanel() {
    if (document.getElementById(PANEL_ID)) return true;

    const anchor = jQuery('#top_p_openai').closest('.range-block');
    if (!anchor.length) return false;

    const html = await ctx().renderExtensionTemplateAsync(EXTENSION_PATH, 'settings');
    anchor.after(html);
    return true;
}

function restoreUiState() {
    const settings = state();
    jQuery('#llamasampler_cli').val(settings.cliText || '');
    jQuery('#llamasampler_cli_box').toggle(!!settings.cliOpen);
}

async function mountAndWire() {
    if (!await mountPanel()) return false;
    bindEventsOnce();
    restoreUiState();
    syncPanelVisibility();
    render();
    return true;
}

let subscribed = false;
function subscribe() {
    if (subscribed) return;
    subscribed = true;
    ctx().eventSource.on(ctx().eventTypes.CHAT_COMPLETION_SETTINGS_READY, onChatCompletionSettingsReady);
}

let wired = false;
function bindEventsOnce() {
    if (wired) return;
    wired = true;
    bindEvents();
}

/* ------------------------------------------------------------------ hooks -- */

/** Manifest `activate` hook. */
export async function onActivate() {
    state();
    subscribe();

    if (await mountAndWire()) {
        if (ctx().chatCompletionSettings.chat_completion_source === 'custom') probeServer({ quiet: true });
        return;
    }

    // The settings DOM was not ready yet; retry once SillyTavern is up.
    ctx().eventSource.once(ctx().eventTypes.APP_READY, async () => {
        if (!await mountAndWire()) {
            warn('could not find the Top P slider to anchor the panel to; unsupported SillyTavern version?');
            return;
        }
        if (ctx().chatCompletionSettings.chat_completion_source === 'custom') probeServer({ quiet: true });
    });
}

/** Manifest `clean` hook: forget every discovered parameter and override. */
export function onClean() {
    ctx().extensionSettings[MODULE] = defaultState();
    log('extension data reset');
}
