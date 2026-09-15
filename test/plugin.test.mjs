/**
 * Tests the server plugin in-process: no SillyTavern, no port juggling, just the
 * Express handler it registers.
 *
 * Run: node --test test/unit.test.mjs test/plugin.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { init, info } from '../server-plugin.mjs';
import { PLUGIN_ID } from '../params.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(__dirname, 'fixtures', 'llamacpp-props.json'), 'utf8');

/** Capture the handler the plugin registers. */
async function loadRoutes() {
    const routes = new Map();
    const router = { get: (routePath, handler) => routes.set(routePath, handler) };
    await init(router);
    return routes;
}

/** Minimal Express response double. */
function makeResponse() {
    return {
        statusCode: 200,
        contentType: '',
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        type(value) { this.contentType = value; return this; },
        send(payload) { this.body = payload; return this; },
    };
}

function makeRequest(url, authorization) {
    return {
        query: url === undefined ? {} : { url },
        get: (header) => (header.toLowerCase() === 'authorization' ? authorization : undefined),
    };
}

/** Start a throwaway upstream that records what it was asked for. */
async function startUpstream(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

test('plugin info is well formed', () => {
    assert.equal(info.id, PLUGIN_ID);
    assert.equal(typeof info.name, 'string');
    assert.equal(typeof info.description, 'string');
    // SillyTavern requires ids to be lowercase alphanumeric with - or _
    assert.match(info.id, /^[a-z0-9_-]+$/);
});

test('plugin registers the /props route', async () => {
    const routes = await loadRoutes();
    assert.ok(routes.has('/props'), 'expected a /props route');
    assert.equal(routes.size, 1, 'the plugin should expose exactly one route');
});

test('plugin proxies a loopback llama.cpp and forwards its JSON', async () => {
    const upstream = await startUpstream((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fixture);
    });

    try {
        const handler = (await loadRoutes()).get('/props');
        const res = makeResponse();
        await handler(makeRequest(`${upstream.base}/v1`), res);

        assert.equal(res.statusCode, 200);
        const payload = JSON.parse(res.body);
        assert.equal(payload.default_generation_settings.params.top_k, 64);
    } finally {
        await upstream.close();
    }
});

test('plugin only ever requests a path ending in /props', async () => {
    const seen = [];
    const upstream = await startUpstream((req, res) => {
        seen.push(req.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fixture);
    });

    try {
        const handler = (await loadRoutes()).get('/props');

        // Whatever the client asks for, the upstream path always ends in /props and
        // never carries a query string or fragment. A path prefix is preserved so
        // llama.cpp behind a reverse proxy still works.
        for (const target of [`${upstream.base}/v1`, `${upstream.base}/`, `${upstream.base}/admin?x=1`]) {
            const res = makeResponse();
            await handler(makeRequest(target), res);
            assert.equal(res.statusCode, 200, `${target} should succeed`);
        }

        assert.deepEqual(seen, ['/props', '/props', '/admin/props']);
    } finally {
        await upstream.close();
    }
});

test('plugin forwards the llama.cpp API key when given one', async () => {
    let received;
    const upstream = await startUpstream((req, res) => {
        received = req.headers.authorization;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fixture);
    });

    try {
        const handler = (await loadRoutes()).get('/props');

        const withKey = makeResponse();
        await handler(makeRequest(`${upstream.base}/v1`, 'Bearer secret'), withKey);
        assert.equal(received, 'Bearer secret');

        const withoutKey = makeResponse();
        await handler(makeRequest(`${upstream.base}/v1`), withoutKey);
        assert.equal(received, undefined);
    } finally {
        await upstream.close();
    }
});

test('plugin rejects bad input instead of fetching', async () => {
    const handler = (await loadRoutes()).get('/props');

    const cases = [
        ['missing url', undefined],
        ['empty url', ''],
        ['non-http scheme', 'file:///etc/passwd'],
        ['credentials in url', 'http://user:pw@127.0.0.1:8080/v1'],
        ['not a url', 'nonsense'],
        ['oversized url', `http://127.0.0.1:8080/${'x'.repeat(3000)}`],
        ['wrong type', ['http://127.0.0.1:8080/v1']],
    ];

    for (const [label, url] of cases) {
        const res = makeResponse();
        await handler(makeRequest(url), res);
        assert.equal(res.statusCode, 400, `${label} should be rejected`);
        assert.ok(res.body?.error, `${label} should explain itself`);
    }
});

test('plugin reports an unreachable upstream as 502 rather than hanging', async () => {
    const handler = (await loadRoutes()).get('/props');
    const res = makeResponse();

    // Port 9 (discard) is closed here; the plugin should fail fast and cleanly.
    await handler(makeRequest('http://127.0.0.1:9/v1'), res);

    assert.equal(res.statusCode, 502);
    assert.ok(res.body?.error, 'expected an error message');
});

test('plugin surfaces a non-OK upstream status', async () => {
    const upstream = await startUpstream((req, res) => {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
    });

    try {
        const handler = (await loadRoutes()).get('/props');
        const res = makeResponse();
        await handler(makeRequest(`${upstream.base}/v1`), res);

        assert.equal(res.statusCode, 502);
        assert.match(res.body.error, /401/);
    } finally {
        await upstream.close();
    }
});
