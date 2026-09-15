# llama.cpp Samplers for SillyTavern

A SillyTavern extension that adds llama.cpp's **full** sampler set — `top_k`,
`min_p`, `dynatemp_range`, the whole DRY family, `typical_p`, XTC, Mirostat and
more — to the **Chat Completion → Custom (OpenAI-compatible)** endpoint, and
builds the UI from whatever your server actually reports.

SillyTavern's Custom endpoint only renders four sliders (Temperature, Frequency
Penalty, Presence Penalty, Top P). Everything else llama.cpp supports is reachable
through `custom_include_body`, but there is no UI for it. This extension is that UI.

---

## Features

- **Automatic llama.cpp detection.** Probes `GET /props` on your Custom endpoint.
  If the response contains `default_generation_settings.params` it is a llama.cpp
  server, and every parameter in that payload becomes a control. Any other
  OpenAI-compatible server is reported as "Not detected" instead of silently
  producing broken requests.
- **Knows how to reach it.** When llama.cpp is only reachable from the SillyTavern
  *server* — the usual `127.0.0.1`-on-the-same-box setup — the lookup is routed
  through SillyTavern instead of the browser. See
  [Networking](#networking-when-llamacpp-is-not-reachable-from-the-browser).
- **Full parameter coverage, with a fallback.** Ships a curated table of
  descriptions and slider ranges transcribed from llama.cpp's own server field
  schema. Parameters it does not know about are still rendered: the label comes
  from the JSON key, the input type from the live value, and the range is inferred
  from it. Those rows carry a `?` badge.
- **Import a llama.cpp command line.** Paste your existing flags and the matching
  rows are filled in and enabled, including `$'\n'`-style arguments and repeated
  `--dry-sequence-breaker`.
- **Opt-in overrides.** Every row has an enable checkbox. Only enabled rows are
  sent, so anything you leave alone stays at your server's CLI default.
- **Server defaults on screen.** Each row shows what the server currently resolves,
  so you can see exactly what you are overriding.
- **Live payload preview.** Shows the exact YAML appended to the request.
- **Your own `custom_include_body` is preserved.** The merge is key-wise, so your
  hand-written entries (including nested ones like `logit_bias`) survive and no
  duplicate keys are ever produced.

## Requirements

- SillyTavern **1.18.0** or newer.
- A **llama.cpp** server (the `/props` endpoint and the extra request-body
  parameters). Recent builds are fine; older ones may expose fewer parameters.
- `/props` must be reachable from whatever asks for it, and **which machine that is
  matters**. llama.cpp defaults to `--cors-origins '*'`, which covers the browser
  route; if you locked CORS down, allow SillyTavern's origin instead (e.g.
  `--cors-origins 'http://localhost:8000'`). See
  [Networking](#networking-when-llamacpp-is-not-reachable-from-the-browser).
- If llama.cpp runs with `--api-key`, put the same key in SillyTavern's Custom
  endpoint API key field. Prefer the server plugin route in that case: SillyTavern
  hides saved keys from the browser, so server-side routes are the reliable ones.
  See [Troubleshooting](#not-detected--http-400-unauthorized).

## Networking: when llama.cpp is not reachable from the browser

The extension discovers parameters by reading llama.cpp's `/props`. It can do that
in three ways, and it picks one automatically:

| Route | Who makes the request | When it applies |
| --- | --- | --- |
| `direct` | your browser | llama.cpp is reachable from the machine you are browsing from |
| `server plugin` | the SillyTavern server | llama.cpp is only reachable from the server (the bundled plugin) |
| `CORS proxy` | the SillyTavern server | same, using SillyTavern's built-in proxy instead |

Generation always works regardless — SillyTavern itself makes those requests
server-side. Only the parameter *discovery* is affected.

**The case this exists for:** llama.cpp started with `--host 127.0.0.1` on the same
machine as the SillyTavern server, while you browse from a different machine, with
SillyTavern's Custom URL set to `http://127.0.0.1:8080/v1`. A browser fetch would
either fail or — worse — silently find an *unrelated* llama.cpp running on your own
laptop. So when the target host is loopback and the page was not served from
loopback, the extension deliberately goes through the server first.

### Route 1 — server plugin (recommended for remote setups)

The repo doubles as a SillyTavern server plugin. Install it either with
SillyTavern's own plugin manager:

```bash
node plugins.js install https://github.com/Encoded404/SillyTavernLLama.cppParam
```

or with the bundled installer:

```bash
node install.mjs --dir ~/SillyTavern --with-plugin
```

Then set `enableServerPlugins: true` in `config.yaml` (it defaults to `false`) and
restart. You should see this on startup:

```
Initializing plugin from .../plugins/.../server-plugin.mjs
1 server plugin(s) are currently loaded.
```

The plugin exposes `GET /api/plugins/llamacpp-samplers/props?url=…`. It is
deliberately narrow: it can only ever request a `/props` path, never an arbitrary
URL path, and it refuses non-http(s) URLs and embedded credentials. It is mounted
after SillyTavern's CSRF, login and whitelist middleware, so it inherits the same
access control as the rest of the API. Like every server plugin it is not
sandboxed — install plugins only from sources you trust.

### Route 2 — SillyTavern's built-in CORS proxy (no install)

If you would rather not enable server plugins, turn on the proxy instead:

```yaml
enableCorsProxy: true
```

The extension then reads `/props` via SillyTavern's `/proxy/` endpoint. Note this
enables a general-purpose proxy for anything that can reach your SillyTavern
(and is exempted from CSRF protection, which is why it ships disabled), so prefer
the plugin if you have a choice.

### The API key field

If llama.cpp runs with `--api-key` and you want to use a browser-side route
(`direct` or `CORS proxy`), open **llama.cpp API key** in the panel and paste the
key there. The key is used for `/props` lookups and nothing else. It is masked by
default, and there is a reveal button and a clear button.

The panel labels this as unsafe on purpose, because it is:

> Stored unencrypted in this browser (localStorage) and never written to
> SillyTavern's settings, so it stays on this machine and does not follow your
> account. It is still a secret: anything else running on this page can read it,
> and the browser will send it to whatever URL is in the endpoint field.

**Where the key is stored, and why not a cookie.** It goes in `localStorage` under
`st-llamacpp-samplers:apiKey`, not in a cookie:

| Storage | Behaviour |
| --- | --- |
| `extensionSettings` | ❌ written to `settings.json` on the **server** and synced with the account — exactly what we want to avoid |
| Cookie | ⚠️ automatically attached to **every** request to the SillyTavern origin, including ones that have nothing to do with llama.cpp, so it ends up in server logs, proxies and any request-tracing |
| `localStorage` ✅ | read only by this extension, sent only to the endpoint you configured |

None of these are encrypted, and all are readable by any other script or extension
running on the page — which is precisely what the warning says aloud. The actual
safe answer is not to need a client-side key at all: use the **server plugin**
route, which reads the key from SillyTavern's store on the server side.

The extension never logs the key, and never writes it to the settings SillyTavern
persists. Both properties are asserted in the browser test suite, including a check
that the key is absent from `settings.json` on disk.

### Forcing a route

The **Route:** dropdown in the panel overrides the automatic choice: `auto`
(default), `direct`, `server plugin`, or `CORS proxy`. The status line always
reports which route actually worked, which makes misconfiguration obvious:

```
llama.cpp detected via SillyTavern server plugin  b6011 · my-model · Q4_K_M · n_ctx 8192
```

## Troubleshooting

### "Not detected … HTTP 400 Unauthorized"

llama.cpp is running with `--api-key`, and the request arrived without the key.

The 400 is a red herring: SillyTavern turns an upstream **401** into a **400** while
keeping the status text `Unauthorized` (`forwardFetchResponse` in `src/util.js`), so
"400 Unauthorized" really means "llama.cpp said 401". You can confirm it:

```bash
curl -i 'http://127.0.0.1:8080/props'
# 401 + {"error":{"code":401,"message":"Invalid API Key",...}}
```

**What is happening.** llama.cpp is running with `--api-key`, and the request
reached it without the key. Routing was fine — this is purely authentication.

**Why the browser-side routes cannot fix this themselves.** SillyTavern
deliberately never hands a saved key to the browser:

- `secret_state` (what the frontend gets from `/api/secrets/read`) is a map of
  booleans, not values.
- `/api/secrets/view` and `/api/secrets/find` both answer **403** unless
  `allowKeysExposure: true`.

So `direct` and `CORS proxy` can only send a key that is physically present in the
API key field *at the time you press Refresh* — a key you saved earlier is on the
server, not in the page. The API key field is also cleared after connecting, which
is why it looks empty even though generation works (SillyTavern's own requests are
made server-side, and read the key there).

**Three ways forward:**

1. **Use the server plugin route (recommended).** It reads the key from
   SillyTavern's own store on the server, exactly the way SillyTavern's chat
   completion request does — which is why generation works today. Set
   **Route: server plugin**, or leave it on `auto`. No key is needed in the browser
   at all.

2. **Type the key into the panel's own field.** The **llama.cpp API key** section
   keeps it in this browser only, so browser-side routes can authenticate. See
   [The API key field](#the-api-key-field) — it is unencrypted, and the UI says so.

3. **Paste the key into SillyTavern's own API key field** and press **Refresh**
   without clicking Connect, so the value is still in the page. (`resolveApiKey`
   falls back to that field, so this works too.)

Setting `allowKeysExposure: true` would also put keys in reach of the browser, but
it exposes *every* stored secret — prefer option 1 or 2.

The extension states this in the panel when it sees a rejected request, instead of
reporting a bare status code.

### "Route is pinned to …"

The **Route:** dropdown is a *pin*, not a preference: choosing `server plugin`
means "use only this route". That is useful for diagnosing which path works, but it
also means a working setup can still fail — and only one failure will be reported.
If you see this, set **Route** back to `auto`.

### "the server plugin is not installed, or enableServerPlugins is false"

The extension reached SillyTavern's API and got its 404. Either the plugin was
never installed (`plugins/<name>/server-plugin.mjs`), or `enableServerPlugins` is
still `false`. Check the SillyTavern startup log for:

```
Initializing plugin from .../plugins/.../server-plugin.mjs
```

If that line is missing, the plugin did not load and no server-side route will work.

### Everything else

| Symptom | Likely cause |
| --- | --- |
| `direct from browser: no response in 5000ms` | llama.cpp is not reachable from the machine you are browsing from — use a server-side route |
| `…: not a llama.cpp /props response` | the URL points at something that is not llama.cpp (vLLM, Ollama, LM Studio, real OpenAI) |
| `Unable to resolve host` / connection refused on the plugin route | llama.cpp is not listening where the *server* expects; check the host and port from the server's point of view |
| Rows appear but are all off | expected — nothing is sent until you enable a row |

## Installation

### Option 1 — SillyTavern's extension installer (recommended)

*Extensions* → **Install Extension**, and paste:

```
https://github.com/Encoded404/SillyTavernLLama.cppParam
```

Choose "Install for all users" unless you have a reason not to. Then reload the
page.

### Option 2 — git clone

```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/Encoded404/SillyTavernLLama.cppParam
```

### Option 3 — copy without git

Useful for zip downloads or a development checkout. The repository root *is* the
extension, but this copies only the files SillyTavern needs:

```bash
node install.mjs --dir ~/SillyTavern
node install.mjs --dir ~/SillyTavern --with-plugin   # also install the server plugin
node install.mjs --dir ~/SillyTavern --dry-run       # preview
node install.mjs --dir ~/SillyTavern --uninstall     # removes both
```

Restart SillyTavern afterwards. The extension appears in the *Extensions* list as
**llama.cpp Samplers (Custom endpoint)**.

## Usage

1. Open *Chat Completion*, set **API** to `Custom (OpenAI-compatible)` and the URL
   to your llama.cpp server, e.g. `http://localhost:8080/v1`. Note the `/v1` — the
   extension strips it when probing `/props`.
2. A **llama.cpp samplers** panel appears directly under the Top P slider, fills
   itself in and shows the server's build info and model.
3. Tick the parameters you want to control, or use **Import CLI flags** and paste
   your existing command line:

   ```
   --temp 0.9
   --dynatemp-range 0.25 --dynatemp-exp 1.0
   --top-k 64 --top-p 0.95 --min-p 0.06
   --repeat-penalty 1.0 --repeat-last-n 512
   --dry-multiplier 0.4 --dry-base 1.75 --dry-allowed-length 3
   --dry-penalty-last-n 512
   --presence-penalty 0.15
   --dry-sequence-breaker $'\n' --dry-sequence-breaker ':'
   --dry-sequence-breaker '"' --dry-sequence-breaker '*'
   --dry-sequence-breaker '.' --dry-sequence-breaker '!' --dry-sequence-breaker '?'
   ```

   Non-sampling flags (`-m`, `-c`, `-ngl`, `--host`, `-fa`, ...) are recognised and
   ignored, so you can paste a whole `llama-server` invocation. Anything genuinely
   unrecognised is listed back to you.
4. **Refresh** re-reads `/props`. This also happens automatically when you pick the
   Custom source or edit the endpoint URL.
5. Enable **Advanced / request pipeline** (collapsed by default) for non-sampling
   knobs such as `stop`, `n_predict`, `logit_bias`, `grammar` and the `samplers`
   order. You rarely need these.

## How it works

The Custom endpoint is the only chat-completion source that forwards arbitrary
request-body keys, via `custom_include_body`, which the server merges with
`mergeObjectWithYaml()` in `src/endpoints/backends/chat-completions.js`. That
field is the entire mechanism — there is no other pass-through.

The extension merges its enabled rows into that YAML string inside the
`CHAT_COMPLETION_SETTINGS_READY` event, which SillyTavern emits with the outgoing
payload immediately before POSTing. **No core file is patched**, which is why this
survives SillyTavern updates.

Parameter names are the JSON body keys llama.cpp reads, which differ from the CLI
flags in several places: `--repeat-penalty` → `repeat_penalty`,
`--dynatemp-exp` → `dynatemp_exponent`, and the repeated `--dry-sequence-breaker`
collapses into a single `dry_sequence_breakers` array. The full set is generated
from the server's own field schema (`tools/server/server-schema.cpp`).

Two details worth knowing:

- The merge is **key-wise**, not text concatenation. Duplicate keys make
  SillyTavern's YAML parser throw, and that error is swallowed silently, so the
  extension strips its own keys out of your existing `custom_include_body` before
  appending.
- Empty arrays are never sent. llama.cpp *rejects* an empty
  `dry_sequence_breakers` rather than falling back, which would turn every request
  into a 500.

## Repository layout

The repository root is the extension, so it can be cloned straight into
`third-party/`.

```
manifest.json      SillyTavern extension manifest
index.js           entry point: UI + the CHAT_COMPLETION_SETTINGS_READY merge
params.js          pure logic: metadata table, inference, YAML, CLI parser, routing
settings.html      Handlebars template for the panel chrome
style.css          panel styling
server-plugin.mjs  optional server plugin: /props on the server's behalf
install.mjs        optional copy-based installer / uninstaller
test/              unit + end-to-end tests (not shipped to SillyTavern's runtime)
```

The repository root is both the extension and the server plugin, which is why
`package.json` carries a `main` field: SillyTavern's plugin loader reads it and
loads `server-plugin.mjs`, instead of stumbling over the browser entry point
(`index.js`) that shares the directory.

`params.js` has no DOM and no SillyTavern imports so that the browser extension, the
server plugin and the node tests all share one implementation — the `/props` URL
construction and the route ordering in particular are used by both halves.

## Development

```bash
npm install
npm test              # 30 unit tests
```

The unit suite covers CLI parsing, YAML emission/merging, spec inference, and the
routing decisions (which transport is preferred for a given target and page host).
It validates the generated YAML against the real `yaml` package SillyTavern uses.

End-to-end suites need a running stack:

```bash
node test/mock-llamacpp.mjs     # stand-in llama.cpp on :8989
node test/e2e-backend.mjs       # also needs SillyTavern on :8000
node test/e2e-browser.mjs       # also needs Chrome with --remote-debugging-port=9222
```

- `test/e2e-backend.mjs` posts extension-built YAML to
  `/api/backends/chat-completions/generate` and asserts the parameters reach the
  mock server, that they beat SillyTavern's own sliders, that a pre-existing
  override is replaced exactly once, and that the user's own YAML survives.
- `test/e2e-browser.mjs` drives real SillyTavern in headless Chrome: panel
  mounting, `/props` detection (including the negative case), row construction from
  live values, unknown-key fallback, CLI import, the in-page merge, both server-side
  routes, and a real generation whose request lands on the mock. It disables
  SillyTavern's bundled Quick Reply extension for the run, because that extension's
  `GENERATION_AFTER_COMMANDS` hook blocks generation in a headless browser.

To exercise both server-side routes, the SillyTavern under test needs
`enableServerPlugins: true` (with the plugin installed) and `enableCorsProxy: true`.
The CORS proxy check skips itself when the proxy is off, rather than failing.

To reproduce a `--api-key` protected llama.cpp, start the mock with a key and store
the same key in SillyTavern:

```bash
API_KEY=test-key node test/mock-llamacpp.mjs
# then, with the CSRF token from GET /csrf-token:
curl -b cookies -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"api_key_custom","value":"test-key"}' http://127.0.0.1:8000/api/secrets/write

MOCK_API_KEY=test-key node test/e2e-browser.mjs
```

With a key in play, the browser-only routes are expected to fail with advice, and
the plugin route to succeed — both of which the suite asserts, along with the fact
that pasting the key into the API key field makes the CORS proxy route work.

The plugin endpoint is also exercised directly, including its rejections:

```bash
curl 'http://127.0.0.1:8000/api/plugins/llamacpp-samplers/props?url=http://127.0.0.1:8080/v1'
curl 'http://127.0.0.1:8000/api/plugins/llamacpp-samplers/props?url=file:///etc/passwd'   # 400
```

## Limitations

- Detection is llama.cpp-specific by design. Other OpenAI-compatible servers expose
  no way to enumerate their samplers, so nothing can be auto-discovered there.
- The server plugin can be pointed at any host, since that is the whole point of it
  (reaching llama.cpp from the server's perspective). It is limited to `/props`
  paths and sits behind SillyTavern's auth, but if you enable server plugins at all
  you are already trusting them with your machine — see SillyTavern's own warning.
- The automatic route choice compares hostnames only, not reachability. If you have
  llama.cpp running on both your client and the server, or you reach llama.cpp
  through a tunnel, use the **Route:** dropdown to pin it.
- `/props` reports parameter *values*, not types, ranges or descriptions — the
  server never serialises its schema. Curated metadata comes from reading
  llama.cpp's source, so a brand-new parameter appears as an inferred `?` row until
  it is added to `params.js`.
- Strings and clusters are edited as raw JSON/YAML-ish text, e.g.
  `["\n", ":", "\"", "*"]`. Numbers and booleans get proper controls.
- `auto_update` is enabled in the manifest. If you are hacking on this repo in
  place inside `third-party/`, set it to `false` to avoid an upstream pull fighting
  your working tree.

## License

MIT — see [LICENSE](LICENSE).
