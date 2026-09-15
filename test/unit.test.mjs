/**
 * Unit tests for the pure logic in params.js.
 * Run: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
    PARAM_METADATA,
    PLUGIN_ID,
    parseCliFlags,
    specFor,
    inferSpec,
    humanize,
    coerceValue,
    emitYaml,
    stripTopLevelKeys,
    buildIncludeBody,
    propsUrlFromBase,
    isLlamaCppProps,
    isLoopbackHost,
    transportOrderFor,
    transportUrl,
    resolvePropsTarget,
    describeFailure,
    pickApiKey,
    tokenize,
} from '../params.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const propsFixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/llamacpp-props.json'), 'utf8'));

/** The exact CLI block the user pasted. */
const USER_CLI = String.raw`
  --temp 0.9 \
    --dynatemp-range 0.25 --dynatemp-exp 1.0 \
    --top-k 64 --top-p 0.95 --min-p 0.06 \
    --repeat-penalty 1.0 --repeat-last-n 512 \
    --dry-multiplier 0.4 --dry-base 1.75 --dry-allowed-length 3 \
    --dry-penalty-last-n 512 \
    --presence-penalty 0.15 \
    --dry-sequence-breaker $'\n' --dry-sequence-breaker ':' --dry-sequence-breaker '"' \
    --dry-sequence-breaker '*' --dry-sequence-breaker '.' --dry-sequence-breaker '!' \
    --dry-sequence-breaker '?'
`;

test('parseCliFlags: round-trips the user CLI block', () => {
    const { values, unknown } = parseCliFlags(USER_CLI);

    assert.deepEqual(unknown, []);
    assert.equal(values.temperature, 0.9);
    assert.equal(values.dynatemp_range, 0.25);
    assert.equal(values.dynatemp_exponent, 1.0);
    assert.equal(values.top_k, 64);
    assert.equal(values.top_p, 0.95);
    assert.equal(values.min_p, 0.06);
    assert.equal(values.repeat_penalty, 1.0);
    assert.equal(values.repeat_last_n, 512);
    assert.equal(values.dry_multiplier, 0.4);
    assert.equal(values.dry_base, 1.75);
    assert.equal(values.dry_allowed_length, 3);
    assert.equal(values.dry_penalty_last_n, 512);
    assert.equal(values.presence_penalty, 0.15);
    assert.deepEqual(values.dry_sequence_breakers, ['\n', ':', '"', '*', '.', '!', '?']);
});

test('parseCliFlags: negative numbers are values, not flags', () => {
    const { values, unknown } = parseCliFlags('--top-nsigma -1 --seed -1');
    assert.deepEqual(unknown, []);
    assert.equal(values.top_n_sigma, -1);
    assert.equal(values.seed, -1);
});

test('parseCliFlags: boolean flags and inline = values', () => {
    const { values, unknown } = parseCliFlags('--ignore-eos --top-k=32 --no-ignore-eos');
    assert.deepEqual(unknown, []);
    assert.equal(values.top_k, 32);
    assert.equal(values.ignore_eos, false);
});

test('parseCliFlags: reports unknown flags and positional args', () => {
    // A recognised non-sampling flag is swallowed with its value; a genuinely
    // unknown flag is reported and its value surfaces as a positional, since it
    // cannot be consumed safely.
    const { values, unknown, positional } = parseCliFlags('-m model.gguf --not-a-flag 5 --temp 0.5');
    assert.deepEqual(positional, ['5']);
    assert.deepEqual(unknown, ['--not-a-flag']);
    assert.equal(values.temperature, 0.5);
    assert.equal(values['--not-a-flag'], undefined);
});

test('parseCliFlags: a realistic llama-server command line yields no unknowns', () => {
    const cmd = `
        --model /models/foo.gguf -c 8192 -ngl 99 -fa --no-mmap -t 8 --host 0.0.0.0 --port 8080 \\
        --alias foo --api-key secret --jinja --temp 0.9 --top-k 64 --dry-sequence-breaker $'\\n'
    `;
    const { values, unknown } = parseCliFlags(cmd);
    assert.deepEqual(unknown, []);
    assert.equal(values.temperature, 0.9);
    assert.equal(values.top_k, 64);
    assert.deepEqual(values.dry_sequence_breakers, ['\n']);
    // non-sampling flags must not leak into the body
    assert.equal(values.model, undefined);
    assert.equal(values.alias, undefined);
});

test('parseCliFlags: reports known flags with a missing value', () => {
    const { unknown } = parseCliFlags('--temp --top-k 5');
    assert.deepEqual(unknown, ['--temp (missing value)']);
});

test('parseCliFlags: samplers split on separators', () => {
    const { values } = parseCliFlags('--samplers top_k;top_p,temperature');
    assert.deepEqual(values.samplers, ['top_k', 'top_p', 'temperature']);
});

test('parseCliFlags: shell comments are ignored', () => {
    const { values } = parseCliFlags('# my llama flags\n--temp 0.7 # inline\n--top-k 40');
    assert.equal(values.temperature, 0.7);
    assert.equal(values.top_k, 40);
});

test('tokenize: quoted strings and ANSI-C escapes', () => {
    assert.deepEqual(tokenize(`--dry-sequence-breaker $'\\n'`), ['--dry-sequence-breaker', '\n']);
    assert.deepEqual(tokenize('--dry-sequence-breaker ":"'), ['--dry-sequence-breaker', ':']);
    assert.deepEqual(tokenize(`$'\\x41\\u0042'`), ['AB']);
});

test('humanize: builds readable labels for unknown keys', () => {
    assert.equal(humanize('dry_penalty_last_n'), 'Dry Penalty Last N');
    assert.equal(humanize('xtc_probability'), 'Xtc Probability');
    assert.equal(humanize('speculative.types'), 'Speculative Types');
});

test('specFor: uses curated metadata when available', () => {
    const spec = specFor('dry_multiplier', 0.4);
    assert.equal(spec.type, 'float');
    assert.equal(spec.min, 0);
    assert.equal(spec.max, 10);
    assert.equal(spec.group, 'dry');
    assert.ok(spec.desc.includes('DRY'));
    assert.ok(!spec.inferred);
});

test('specFor: infers a spec for parameters without metadata', () => {
    const spec = specFor('brand_new_llamacpp_knob', 7);
    assert.equal(spec.type, 'int');
    assert.equal(spec.step, 1);
    assert.equal(spec.group, 'detected');
    assert.equal(spec.label, 'Brand New Llamacpp Knob');
    assert.ok(spec.inferred);
});

test('inferSpec: covers every value shape', () => {
    assert.equal(inferSpec('a', true).type, 'bool');
    assert.equal(inferSpec('a', 3).type, 'int');
    assert.equal(inferSpec('a', 0.25).type, 'float');
    assert.equal(inferSpec('a', ['x']).type, 'stringArray');
    assert.equal(inferSpec('a', [{ x: 1 }]).type, 'json');
    assert.equal(inferSpec('a', { x: 1 }).type, 'json');
    assert.equal(inferSpec('a', 'text').type, 'string');
    assert.equal(inferSpec('a', null).type, 'string');

    const fraction = inferSpec('a', 0.25);
    assert.equal(fraction.min, 0);
    assert.equal(fraction.max, 1);
});

test('coerceValue: matches the declared spec type', () => {
    assert.equal(coerceValue(specFor('top_k'), '64'), 64);
    assert.equal(coerceValue(specFor('dry_multiplier'), '0.4'), 0.4);
    assert.equal(coerceValue(specFor('ignore_eos'), true), true);
    assert.deepEqual(coerceValue(specFor('dry_sequence_breakers'), 'x'), ['x']);
    assert.deepEqual(coerceValue(specFor('dry_sequence_breakers'), ['a', 'b']), ['a', 'b']);
    assert.deepEqual(coerceValue(specFor('dry_sequence_breakers'), ''), []);
    assert.deepEqual(coerceValue(specFor('logit_bias'), '{"1": 2}'), { 1: 2 });
    assert.equal(coerceValue(specFor('logit_bias'), 'not json'), undefined);
});

test('propsUrlFromBase: strips /v1 and trailing slashes', () => {
    assert.equal(propsUrlFromBase('http://localhost:8080/v1'), 'http://localhost:8080/props');
    assert.equal(propsUrlFromBase('http://localhost:8080/v1/'), 'http://localhost:8080/props');
    assert.equal(propsUrlFromBase('http://localhost:8080/'), 'http://localhost:8080/props');
    assert.equal(propsUrlFromBase('http://localhost:8080'), 'http://localhost:8080/props');
    assert.equal(propsUrlFromBase('  '), '');
});

test('isLlamaCppProps: recognises the real payload and rejects others', () => {
    assert.equal(isLlamaCppProps(propsFixture), true);
    assert.equal(isLlamaCppProps({ data: [] }), false);
    assert.equal(isLlamaCppProps({ default_generation_settings: { params: [] } }), false);
    assert.equal(isLlamaCppProps(null), false);
});

test('every /props key resolves to a spec', () => {
    const params = propsFixture.default_generation_settings.params;
    const keys = Object.keys(params);
    assert.ok(keys.length > 40, 'fixture should carry the full parameter set');

    for (const key of keys) {
        const spec = specFor(key, params[key]);
        assert.ok(spec.type, `${key} should resolve to a type`);
        assert.ok(spec.label, `${key} should resolve to a label`);
        if (spec.type === 'float' || spec.type === 'int') {
            assert.ok(Number.isFinite(spec.min), `${key} needs a min`);
            assert.ok(Number.isFinite(spec.max), `${key} needs a max`);
            assert.ok(spec.min <= spec.max, `${key} needs min <= max`);
        }
    }
});

test('metadata covers the whole sampler surface', () => {
    const params = propsFixture.default_generation_settings.params;
    const missing = Object.keys(params).filter(k => !PARAM_METADATA[k]);
    // Only the deliberately unknown fixture key should fall through to inference.
    assert.deepEqual(missing, ['brand_new_llamacpp_knob']);
});

test('emitYaml + stripTopLevelKeys: merge without duplicate keys', () => {
    const existing = ['# my own params', 'custom_flag: 1', 'dry_multiplier: 0.1', 'logit_bias:', '  "1": 2', ''].join('\n');

    const stripped = stripTopLevelKeys(existing, ['dry_multiplier']);
    assert.ok(!stripped.includes('dry_multiplier'));
    assert.ok(stripped.includes('custom_flag: 1'));
    assert.ok(stripped.includes('# my own params'));
    assert.ok(stripped.includes('logit_bias:'), 'nested blocks must survive');
    assert.ok(stripped.includes('  "1": 2'), 'nested continuation lines must survive');

    const merged = buildIncludeBody(existing, { dry_multiplier: 0.4, top_k: 64 });
    assert.ok(merged.includes('custom_flag: 1'));
    assert.equal(merged.match(/dry_multiplier/g).length, 1, 'no duplicate keys allowed');
    assert.ok(merged.includes('dry_multiplier: 0.4'));
    assert.ok(merged.includes('top_k: 64'));
});

test('buildIncludeBody: no overrides leaves the user YAML untouched', () => {
    const existing = 'top_k: 1\n';
    assert.equal(buildIncludeBody(existing, {}), existing);
    assert.equal(buildIncludeBody(existing, undefined), existing);
});

test('buildIncludeBody: skips undefined values', () => {
    const merged = buildIncludeBody('', { top_k: 64, logit_bias: undefined });
    assert.equal(merged.trim(), 'top_k: 64');
});

test('buildIncludeBody: output survives a real YAML parser (SillyTavern uses `yaml`)', async (t) => {
    let YAML;
    try {
        YAML = await import('yaml');
    } catch {
        t.skip('yaml package not installed');
        return;
    }

    const existing = ['# user params', 'custom_flag: 1', 'logit_bias:', '  "1": 2', ''].join('\n');
    const overrides = {
        temperature: 0.9,
        dynatemp_range: 0.25,
        dynatemp_exponent: 1,
        top_k: 64,
        top_p: 0.95,
        min_p: 0.06,
        repeat_penalty: 1,
        repeat_last_n: 512,
        dry_multiplier: 0.4,
        dry_base: 1.75,
        dry_allowed_length: 3,
        dry_penalty_last_n: 512,
        presence_penalty: 0.15,
        dry_sequence_breakers: ['\n', ':', '"', '*', '.', '!', '?'],
        ignore_eos: false,
    };

    const text = buildIncludeBody(existing, overrides);
    const parsed = YAML.parse(text);

    assert.deepEqual(parsed, { custom_flag: 1, logit_bias: { 1: 2 }, ...overrides });
    // the parser must accept the array including a real newline break
    assert.deepEqual(parsed.dry_sequence_breakers, ['\n', ':', '"', '*', '.', '!', '?']);
});

test('buildIncludeBody: YAML output round-trips scalars correctly', async (t) => {
    let YAML;
    try {
        YAML = await import('yaml');
    } catch {
        t.skip('yaml package not installed');
        return;
    }

    const overrides = { a: 1, b: 1.5, c: true, d: false, e: 'plain', f: 'with: colon', g: ['x', 'y'], h: { n: 1 } };
    const parsed = YAML.parse(emitYaml(overrides));
    assert.deepEqual(parsed, overrides);
});

/* ------------------------------------------------------------- routing -- */

test('isLoopbackHost: recognises loopback names', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', 'foo.localhost', '0.0.0.0']) {
        assert.equal(isLoopbackHost(host), true, `${host} should be loopback`);
    }
    for (const host of ['192.168.1.50', 'llama.example.com', '10.0.0.5', 'my-pc', '']) {
        assert.equal(isLoopbackHost(host), false, `${host} should not be loopback`);
    }
});

test('transportOrderFor: same machine prefers a direct fetch', () => {
    // Page served from loopback, llama.cpp on loopback: the browser can reach it.
    assert.deepEqual(
        transportOrderFor('http://127.0.0.1:8080/v1', '127.0.0.1'),
        ['direct', 'plugin', 'corsProxy'],
    );
    // Both on a LAN host: still the browser's own network.
    assert.deepEqual(
        transportOrderFor('http://192.168.1.50:8080/v1', '192.168.1.50'),
        ['direct', 'plugin', 'corsProxy'],
    );
});

test('transportOrderFor: remote browser with local llama.cpp must go through the server', () => {
    // The user's setup: llama.cpp on 127.0.0.1 next to SillyTavern, browsing from elsewhere.
    assert.deepEqual(
        transportOrderFor('http://127.0.0.1:8080/v1', '192.168.1.50'),
        ['plugin', 'corsProxy', 'direct'],
    );
    assert.deepEqual(
        transportOrderFor('http://127.0.0.1:8080/v1', 'tavern.example.com'),
        ['plugin', 'corsProxy', 'direct'],
    );
    // A public llama.cpp is reachable from the browser, so no server hop needed.
    assert.deepEqual(
        transportOrderFor('https://llama.example.com/v1', 'tavern.example.com'),
        ['direct', 'plugin', 'corsProxy'],
    );
});

test('transportOrderFor: an unparsable URL falls back to a direct attempt', () => {
    assert.deepEqual(transportOrderFor('not a url', '127.0.0.1'), ['direct', 'plugin', 'corsProxy']);
});

test('transportOrderFor: a remembered route is tried first', () => {
    assert.deepEqual(
        transportOrderFor('http://127.0.0.1:8080/v1', '192.168.1.50', 'corsProxy'),
        ['corsProxy', 'plugin', 'direct'],
    );
    // A remembered route that does not apply here is ignored.
    assert.deepEqual(
        transportOrderFor('http://127.0.0.1:8080/v1', '127.0.0.1', 'plugin'),
        ['plugin', 'direct', 'corsProxy'],
    );
});

test('transportUrl: builds the right URL per route', () => {
    const base = 'http://127.0.0.1:8080/v1';
    assert.equal(transportUrl('direct', base), 'http://127.0.0.1:8080/props');
    assert.equal(transportUrl('corsProxy', base), '/proxy/http://127.0.0.1:8080/props');
    assert.equal(
        transportUrl('plugin', base),
        `/api/plugins/${PLUGIN_ID}/props?url=${encodeURIComponent('http://127.0.0.1:8080/props')}`,
    );
});

test('resolvePropsTarget: accepts a base URL or an already absolute /props URL', () => {
    assert.equal(resolvePropsTarget('http://host:8080/v1'), 'http://host:8080/props');
    assert.equal(resolvePropsTarget('http://host:8080/'), 'http://host:8080/props');
    assert.equal(resolvePropsTarget('http://host:8080/props'), 'http://host:8080/props');
    assert.equal(resolvePropsTarget('http://host:8080/props/'), 'http://host:8080/props');
});

test('propsUrlFromBase: drops query strings and fragments', () => {
    assert.equal(propsUrlFromBase('http://host:8080/admin?x=1'), 'http://host:8080/admin/props');
    assert.equal(propsUrlFromBase('http://host:8080/v1?x=1'), 'http://host:8080/props');
    assert.equal(propsUrlFromBase('http://host:8080/v1#frag'), 'http://host:8080/props');
});

test('propsUrlFromBase: keeps a reverse-proxy path prefix and never doubles /props', () => {
    assert.equal(propsUrlFromBase('http://gw/llama/v1'), 'http://gw/llama/props');
    assert.equal(propsUrlFromBase('http://host:8080/props'), 'http://host:8080/props');
    assert.equal(propsUrlFromBase('http://host:8080/props/props'), 'http://host:8080/props/props');
});

test('pickApiKey: a client-supplied key wins, otherwise the stored one is used', () => {
    assert.equal(pickApiKey('Bearer from-client', 'stored'), 'Bearer from-client');
    assert.equal(pickApiKey(undefined, 'stored'), 'Bearer stored');
    assert.equal(pickApiKey('', 'stored'), 'Bearer stored');
    assert.equal(pickApiKey(undefined, undefined), '');
    assert.equal(pickApiKey(undefined, ''), '');
});

/* ------------------------------------------------------- error reporting -- */

const fakeResponse = (status, statusText, body) => ({ status, statusText, text: async () => body });

test('describeFailure: flags a 401 and includes llama.cpp\'s message', async () => {
    const failure = await describeFailure(fakeResponse(401, 'Unauthorized', '{"error":{"message":"Invalid API Key"}}'));
    assert.equal(failure.unauthorized, true);
    assert.match(failure.text, /401 Unauthorized/);
    assert.match(failure.text, /Invalid API Key/);
});

test('describeFailure: treats the proxy\'s 400 "Unauthorized" artifact as an auth failure', async () => {
    // SillyTavern rewrites an upstream 401 to 400 but keeps the status text.
    const failure = await describeFailure(fakeResponse(400, 'Unauthorized', 'Invalid API Key'));
    assert.equal(failure.unauthorized, true);
    assert.match(failure.text, /400 Unauthorized/);
});

test('describeFailure: surfaces the server plugin\'s error payload', async () => {
    const body = JSON.stringify({ error: 'Upstream responded 401 for http://127.0.0.1:8080/props', unauthorized: true });
    const failure = await describeFailure(fakeResponse(502, 'Bad Gateway', body));
    assert.equal(failure.unauthorized, true);
    assert.match(failure.text, /Upstream responded 401/);
});

test('describeFailure: a plain failure is not reported as auth', async () => {
    const failure = await describeFailure(fakeResponse(404, 'Not Found', ''));
    assert.equal(failure.unauthorized, false);
    assert.equal(failure.text, '404 Not Found');
});

test('describeFailure: tolerates an unreadable body and truncates a huge one', async () => {
    const noBody = await describeFailure({ status: 500, statusText: 'Internal Server Error' });
    assert.equal(noBody.text, '500 Internal Server Error');

    const huge = await describeFailure(fakeResponse(500, 'ERR', 'x'.repeat(5000)));
    assert.ok(huge.text.length < 300, `expected truncation, got ${huge.text.length} chars`);
});
