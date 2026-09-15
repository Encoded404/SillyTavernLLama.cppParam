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
- `/props` must be reachable **from your browser**, so CORS applies. llama.cpp
  defaults to `--cors-origins '*'`, which works. If you locked it down, allow
  SillyTavern's origin instead (e.g. `--cors-origins 'http://localhost:8000'`).
- If llama.cpp runs with `--api-key`, put the same key in SillyTavern's Custom
  endpoint API key field; the extension forwards it to `/props`.

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
node install.mjs --dir ~/SillyTavern --dry-run     # preview
node install.mjs --dir ~/SillyTavern --uninstall
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
manifest.json     SillyTavern extension manifest
index.js          entry point: UI + the CHAT_COMPLETION_SETTINGS_READY merge
params.js         pure logic: metadata table, inference, YAML, CLI parser
settings.html     Handlebars template for the panel chrome
style.css         panel styling
install.mjs       optional copy-based installer / uninstaller
test/             unit + end-to-end tests (not shipped to SillyTavern's runtime)
```

`params.js` has no DOM and no SillyTavern imports so that the browser extension and
the node tests share one implementation.

## Development

```bash
npm install
npm test              # 23 unit tests
```

The unit suite covers CLI parsing, YAML emission/merging and spec inference, and
validates the generated YAML against the real `yaml` package SillyTavern uses.

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
  live values, unknown-key fallback, CLI import, the in-page merge, and a real
  generation whose request lands on the mock. It disables SillyTavern's bundled
  Quick Reply extension for the run, because that extension's
  `GENERATION_AFTER_COMMANDS` hook blocks generation in a headless browser.

## Limitations

- Detection is llama.cpp-specific by design. Other OpenAI-compatible servers expose
  no way to enumerate their samplers, so nothing can be auto-discovered there.
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
