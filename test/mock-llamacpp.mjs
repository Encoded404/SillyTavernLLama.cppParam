#!/usr/bin/env node
/**
 * Minimal stand-in for `llama-server`, used by the tests.
 *
 *   GET  /props                 -> mirrors llama.cpp's real /props shape
 *   GET  /v1/models             -> OpenAI-compatible model list
 *   POST /v1/chat/completions   -> records the received body, returns a canned reply
 *
 * Env:
 *   PORT         listen port (default 8989)
 *   RECORD_FILE  where to write the last received request (default test/received.json)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const propsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'llamacpp-props.json'), 'utf8'));

const port = Number(process.env.PORT || 8989);
const recordFile = process.env.RECORD_FILE || path.join(__dirname, 'received.json');

function cors(res) {
    // llama.cpp defaults to --cors-origins '*'
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}

function json(res, payload, status = 200) {
    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && url.pathname === '/props') {
        json(res, propsFixture);
        return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
        json(res, {
            object: 'list',
            data: [{ id: propsFixture.model_alias, object: 'model', owned_by: 'llamacpp' }],
        });
        return;
    }

    if (req.method === 'POST' && ['/v1/chat/completions', '/chat/completions'].includes(url.pathname)) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let parsed = {};
            try {
                parsed = JSON.parse(body);
            } catch {
                parsed = { _unparsable: body };
            }

            fs.writeFileSync(recordFile, JSON.stringify({
                path: url.pathname,
                authorization: req.headers.authorization || null,
                body: parsed,
            }, null, 2));

            const reply = {
                id: 'chatcmpl-test',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: parsed.model || propsFixture.model_alias,
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
            json(res, reply);
        });
        return;
    }

    json(res, { error: { message: `no route for ${req.method} ${url.pathname}` } }, 404);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`mock llama.cpp listening on http://127.0.0.1:${port}`);
    console.log(`recording requests to ${recordFile}`);
});
