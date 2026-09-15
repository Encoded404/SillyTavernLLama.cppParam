/**
 * Optional SillyTavern *server* plugin for llama.cpp Samplers.
 *
 * Why this exists: the extension discovers parameters by reading llama.cpp's
 * `GET /props`. It normally does that straight from the browser, which breaks
 * when llama.cpp is only reachable from the SillyTavern server - the common case
 * of `--host 127.0.0.1` on the same box you run SillyTavern on while you browse
 * from another machine. A browser fetch to 127.0.0.1 would either fail or, worse,
 * silently find an unrelated llama.cpp on the client.
 *
 * With this plugin installed and `enableServerPlugins: true` in config.yaml, the
 * extension routes the lookup through SillyTavern instead, so "127.0.0.1" means
 * what it means to the server.
 *
 * The endpoint is deliberately narrow: it can only ever request a `/props` URL,
 * never an arbitrary path. It is mounted by SillyTavern after its CSRF, login and
 * whitelist middleware, so it inherits the same access control as the rest of the
 * API. It does no caching and holds no state.
 *
 * Install:
 *   node plugins.js install https://github.com/Encoded404/SillyTavernLLama.cppParam
 *
 * Note: server plugins are not sandboxed. Only run plugins you trust.
 */
import { PLUGIN_ID, pickApiKey, resolvePropsTarget } from './params.js';

const LOG = '[llamacpp-samplers]';
const TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;

/**
 * SillyTavern's own secret store, so this plugin can use the same Custom endpoint
 * API key the server already uses for chat completions. That matters because
 * SillyTavern hides saved keys from the browser unless `allowKeysExposure` is on,
 * so the client often cannot supply one.
 */
const SECRETS_MODULE = new URL('../../src/endpoints/secrets.js', import.meta.url).href;

let secrets = null;
let secretsLoaded = false;

async function loadSecrets() {
    if (secretsLoaded) return secrets;
    secretsLoaded = true;

    try {
        secrets = await import(SECRETS_MODULE);
    } catch (error) {
        secrets = null;
        console.warn(`${LOG} could not load SillyTavern's secrets module; an API key would have to come from the client:`, error?.message);
    }

    return secrets;
}

/** The Custom endpoint API key saved in SillyTavern, or '' if there is none. */
function readStoredApiKey(request) {
    const directories = request.user?.directories;
    if (!secrets || !directories) return '';

    try {
        return secrets.readSecret(directories, secrets.SECRET_KEYS.CUSTOM) || '';
    } catch (error) {
        console.warn(`${LOG} could not read the stored Custom endpoint API key:`, error?.message);
        return '';
    }
}

export const info = {
    id: PLUGIN_ID,
    name: 'llama.cpp Sampler Discovery',
    description: 'Reads llama.cpp /props on behalf of the llama.cpp Samplers extension, for setups where llama.cpp is only reachable from the SillyTavern server.',
};

/**
 * Normalise and vet a client-supplied target.
 * @param {string} raw
 * @returns {string|null} An absolute `/props` URL, or null if unacceptable.
 */
function validateTarget(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;

    // resolvePropsTarget() appends /props, so this endpoint can never be used to
    // fetch an arbitrary path on an arbitrary host.
    return resolvePropsTarget(url.href) || null;
}

export async function init(router) {
    await loadSecrets();

    router.get('/props', async (request, response) => {
        const raw = request.query.url;

        if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
            return response.status(400).json({ error: 'Provide a single "url" query parameter.' });
        }

        const target = validateTarget(raw);
        if (!target) {
            return response.status(400).json({ error: 'The "url" parameter must be an absolute http(s) URL without embedded credentials.' });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const headers = { accept: 'application/json' };

            // Prefer the key the client sent; fall back to the one SillyTavern has
            // stored for its own Custom endpoint, which the browser cannot read.
            const authorization = pickApiKey(request.get('authorization'), readStoredApiKey(request));
            if (authorization) headers.authorization = authorization;

            const upstream = await fetch(target, { headers, signal: controller.signal });
            const body = await upstream.text();

            if (body.length > MAX_RESPONSE_BYTES) {
                return response.status(502).json({ error: 'Upstream /props response is too large.' });
            }

            if (!upstream.ok) {
                return response.status(502).json({
                    error: `Upstream responded ${upstream.status} for ${target}`,
                    detail: body.slice(0, 300),
                    unauthorized: upstream.status === 401 || upstream.status === 403,
                });
            }

            return response.type('application/json').send(body);
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? `Timed out after ${TIMEOUT_MS}ms reaching ${target}`
                : String(error?.message || error);
            return response.status(502).json({ error: message });
        } finally {
            clearTimeout(timer);
        }
    });
}
