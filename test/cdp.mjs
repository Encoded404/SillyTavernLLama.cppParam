/**
 * Tiny Chrome DevTools Protocol client for the browser test.
 * Uses node's global WebSocket (Node >= 22), so there is no dependency to install.
 */

export async function openPage(url) {
    const target = url === null
        ? await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }).then(r => r.json())
        : await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then(r => r.json());

    const page = await connect(target.webSocketDebuggerUrl);

    if (url === null) {
        // Attach first, then navigate, so startup errors are captured.
        await page.send('Page.navigate', { url: 'about:blank' });
    }

    return page;
}

async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    const consoleErrors = [];

    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);

        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(`${message.error.message} (${JSON.stringify(message.error)})`));
            else resolve(message.result);
            return;
        }

        if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
            consoleErrors.push(message.params.args?.map(a => a.value ?? a.description).join(' '));
        }
        if (message.method === 'Runtime.exceptionThrown') {
            consoleErrors.push(message.params?.exceptionDetails?.exception?.description || 'exception');
        }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`CDP timeout for ${method}`));
            }
        }, 60000);
    });

    await send('Runtime.enable');
    await send('Page.enable');

    const evaluate = async (expression, { awaitPromise = true } = {}) => {
        const result = await send('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue: true,
            userGesture: true,
        });

        if (result.exceptionDetails) {
            throw new Error(`page evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
        }

        return result.result.value;
    };

    /** Poll an in-page boolean expression until it is true. */
    const waitFor = async (expr, timeoutMs = 40000, label = expr) => {
        const ok = await evaluate(`(async () => {
            const deadline = Date.now() + ${timeoutMs};
            while (Date.now() < deadline) {
                try { if (${expr}) return true; } catch (e) {}
                await new Promise(r => setTimeout(r, 200));
            }
            return false;
        })()`);

        if (!ok) throw new Error(`timed out waiting for: ${label}`);
        return true;
    };

    return {
        send,
        evaluate,
        waitFor,
        consoleErrors,
        navigate: (targetUrl) => send('Page.navigate', { url: targetUrl }),
        close: () => ws.close(),
    };
}
