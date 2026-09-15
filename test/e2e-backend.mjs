#!/usr/bin/env node
/**
 * End-to-end test of the contract the extension relies on:
 *
 *   extension-built YAML  ->  SillyTavern /api/backends/chat-completions/generate
 *                         ->  mergeObjectWithYaml()  ->  POST to llama.cpp /v1/chat/completions
 *
 * It does not exercise the browser DOM (that is what the browser test is for);
 * it proves the generated YAML is accepted by SillyTavern's YAML parser, merged
 * with the user's own custom_include_body, given precedence over SillyTavern's
 * own sliders, and forwarded verbatim to the server.
 *
 * Env:
 *   ST_URL       base url of a running SillyTavern (default http://127.0.0.1:8000)
 *   MOCK_URL     base url of the mock llama.cpp  (default http://127.0.0.1:8989)
 *   MOCK_RECORD  file the mock writes requests to
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCliFlags, buildIncludeBody, emitYaml } from '../params.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const MOCK_URL = process.env.MOCK_URL || 'http://127.0.0.1:8989';
const MOCK_RECORD = process.env.MOCK_RECORD || path.join(__dirname, 'received.json');

const USER_CLI = String.raw`
    --temp 0.9 --dynatemp-range 0.25 --dynatemp-exp 1.0
    --top-k 64 --top-p 0.95 --min-p 0.06
    --repeat-penalty 1.0 --repeat-last-n 512
    --dry-multiplier 0.4 --dry-base 1.75 --dry-allowed-length 3 --dry-penalty-last-n 512
    --presence-penalty 0.15
    --dry-sequence-breaker $'\n' --dry-sequence-breaker ':' --dry-sequence-breaker '"'
    --dry-sequence-breaker '*' --dry-sequence-breaker '.' --dry-sequence-breaker '!' --dry-sequence-breaker '?'
`;

/** Minimal cookie jar, because node's fetch does not keep cookies. */
async function getCsrfToken() {
    const response = await fetch(`${ST_URL}/csrf-token`);
    const body = await response.json();

    const cookies = (response.headers.getSetCookie?.() || [])
        .map(c => c.split(';')[0])
        .join('; ');

    return { token: body.token, cookies };
}

function check(name, fn) {
    try {
        fn();
        console.log(`  ok  ${name}`);
        return true;
    } catch (error) {
        console.error(`  FAIL ${name}\n       ${error.message}`);
        return false;
    }
}

async function main() {
    // What the extension would build from the CLI flags above.
    const { values, unknown } = parseCliFlags(USER_CLI);
    assert.deepEqual(unknown, [], 'CLI import should not report unknown flags');

    // A user's pre-existing custom_include_body: must survive, and must not
    // collide with anything we send (SillyTavern's YAML parser rejects dupes).
    const existing = [
        '# my own params',
        'custom_flag: 1',
        'logit_bias:',
        '  "1": 2',
        'dry_multiplier: 9.99',
        '',
    ].join('\n');

    const includeBody = buildIncludeBody(existing, values);
    console.log('--- custom_include_body sent to SillyTavern ---');
    console.log(includeBody);

    const { token, cookies } = await getCsrfToken();

    const payload = {
        chat_completion_source: 'custom',
        custom_url: `${MOCK_URL}/v1`,
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 32,
        stream: false,
        // SillyTavern's own sliders — the extension's YAML must win over these.
        temperature: 0.1,
        top_p: 0.1,
        presence_penalty: 0,
        frequency_penalty: 0,
        custom_include_body: includeBody,
    };

    const response = await fetch(`${ST_URL}/api/backends/chat-completions/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token,
            Cookie: cookies,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        console.error(`SillyTavern returned HTTP ${response.status}: ${await response.text()}`);
        process.exit(1);
    }
    await response.json();

    const received = JSON.parse(fs.readFileSync(MOCK_RECORD, 'utf8'));
    const body = received.body;

    console.log('\n--- body received by the mock llama.cpp server ---');
    console.log(JSON.stringify(body, null, 2).split('\n').slice(0, 60).join('\n'));
    console.log('---');

    let passed = 0;
    let failed = 0;
    const t = (name, fn) => (check(name, fn) ? passed++ : failed++);

    t('routes to the mock llama.cpp endpoint', () => {
        assert.equal(received.path, '/v1/chat/completions');
    });

    t('llama.cpp-only params made it through', () => {
        assert.equal(body.top_k, 64);
        assert.equal(body.min_p, 0.06);
        assert.equal(body.dynatemp_range, 0.25);
        assert.equal(body.dynatemp_exponent, 1);
        assert.equal(body.repeat_penalty, 1);
        assert.equal(body.repeat_last_n, 512);
    });

    t('DRY params made it through', () => {
        assert.equal(body.dry_multiplier, 0.4);
        assert.equal(body.dry_base, 1.75);
        assert.equal(body.dry_allowed_length, 3);
        assert.equal(body.dry_penalty_last_n, 512);
    });

    t('dry_sequence_breakers is a real array, newline included', () => {
        assert.deepEqual(body.dry_sequence_breakers, ['\n', ':', '"', '*', '.', '!', '?']);
    });

    t('extension values override SillyTavern sliders', () => {
        assert.equal(body.temperature, 0.9);
        assert.equal(body.top_p, 0.95);
        assert.equal(body.presence_penalty, 0.15);
    });

    t('the pre-existing override beat nothing else and was replaced exactly once', () => {
        assert.equal(body.dry_multiplier, 0.4);
    });

    t("the user's own YAML survived untouched", () => {
        assert.equal(body.custom_flag, 1);
        assert.deepEqual(body.logit_bias, { 1: 2 });
    });

    t('SillyTavern still sent its usual fields', () => {
        assert.equal(body.model, 'test-model');
        assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
        assert.ok('max_tokens' in body);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
