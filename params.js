/**
 * Pure helpers for the llama.cpp sampler panel.
 *
 * This module has no DOM and no SillyTavern imports so that it can be shared
 * verbatim between the browser extension and the node test suite.
 */

/**
 * Manually curated metadata for the parameters llama.cpp's server exposes in
 * `GET /props` -> `default_generation_settings.params`.
 *
 * `desc` strings are taken from the server's own field schema
 * (tools/server/server-schema.cpp). `min`/`max`/`step` come from the schema
 * limits where they exist, plus llama.cpp's documented ranges otherwise.
 *
 * type:       'float' | 'int' | 'bool' | 'string' | 'stringArray' | 'json'
 * group:      rendering bucket
 * stNative:   SillyTavern already sends this from its own slider on the Custom source
 * advanced:   hidden behind the "Advanced" disclosure, off by default
 */
export const PARAM_METADATA = {
    // --- core sampling ---
    temperature: {
        type: 'float', min: 0, max: 2, step: 0.01, group: 'sampling', stNative: true,
        desc: 'Adjust the randomness of the generated text (0 = greedy)',
    },
    dynatemp_range: {
        type: 'float', min: 0, max: 2, step: 0.01, group: 'sampling',
        desc: 'Dynamic temperature range. The final temperature will be in [temperature - range, temperature + range] (0 = disabled)',
    },
    dynatemp_exponent: {
        type: 'float', min: 0, max: 5, step: 0.01, group: 'sampling',
        desc: 'Dynamic temperature exponent, controls how entropy maps to temperature',
    },
    top_k: {
        type: 'int', min: 0, max: 1000, step: 1, group: 'sampling',
        desc: 'Limit the next token selection to the K most probable tokens (0 = disabled)',
    },
    top_p: {
        type: 'float', min: 0, max: 1, step: 0.01, group: 'sampling', stNative: true,
        desc: 'Limit the next token selection to a subset of tokens with cumulative probability above threshold P (1.0 = disabled)',
    },
    min_p: {
        type: 'float', min: 0, max: 1, step: 0.001, group: 'sampling',
        desc: 'The minimum probability for a token to be considered, relative to the probability of the most likely token (0 = disabled)',
    },
    top_n_sigma: {
        type: 'float', min: -1, max: 10, step: 0.1, group: 'sampling',
        desc: 'Keep tokens within n standard deviations of the top token logit (< 0 = disabled)',
    },
    typical_p: {
        type: 'float', min: 0, max: 1, step: 0.01, group: 'sampling',
        desc: 'Enable locally typical sampling with parameter p (1.0 = disabled)',
    },
    xtc_probability: {
        type: 'float', min: 0, max: 1, step: 0.01, group: 'sampling',
        desc: 'Set the chance for token removal via XTC sampler (0 = disabled)',
    },
    xtc_threshold: {
        type: 'float', min: 0, max: 1, step: 0.01, group: 'sampling',
        desc: 'Set a minimum probability threshold for tokens to be removed via XTC sampler (> 0.5 disables XTC)',
    },
    min_keep: {
        type: 'int', min: 0, max: 1024, step: 1, group: 'sampling', advanced: true,
        desc: 'If greater than 0, force samplers to return at least N possible tokens',
    },
    seed: {
        type: 'int', min: -1, max: 2147483647, step: 1, group: 'sampling', advanced: true,
        desc: 'Set the random number generator (RNG) seed (-1 = random)',
    },

    // --- penalties ---
    repeat_penalty: {
        type: 'float', min: 0, max: 2, step: 0.01, group: 'penalties',
        desc: 'Control the repetition of token sequences in the generated text (1.0 = disabled)',
    },
    repeat_last_n: {
        type: 'int', min: -1, max: 16384, step: 1, group: 'penalties',
        desc: 'Last n tokens to consider for penalizing repetition (0 = disabled, -1 = context size)',
    },
    presence_penalty: {
        type: 'float', min: -2, max: 2, step: 0.01, group: 'penalties', stNative: true,
        desc: 'Repeat alpha presence penalty (0 = disabled)',
    },
    frequency_penalty: {
        type: 'float', min: -2, max: 2, step: 0.01, group: 'penalties', stNative: true,
        desc: 'Repeat alpha frequency penalty (0 = disabled)',
    },

    // --- DRY ---
    dry_multiplier: {
        type: 'float', min: 0, max: 10, step: 0.01, group: 'dry',
        desc: "Set the DRY (Don't Repeat Yourself) repetition penalty multiplier (0 = disabled)",
    },
    dry_base: {
        type: 'float', min: 1, max: 4, step: 0.01, group: 'dry',
        desc: 'Set the DRY repetition penalty base value (must be >= 1.0, any value < 1.0 is replaced with the default)',
    },
    dry_allowed_length: {
        type: 'int', min: 0, max: 64, step: 1, group: 'dry',
        desc: 'Tokens that extend repetition beyond this length receive exponentially increasing penalty',
    },
    dry_penalty_last_n: {
        type: 'int', min: -1, max: 16384, step: 1, group: 'dry',
        desc: 'How many tokens to scan for repetitions (0 = disabled, -1 = context size)',
    },
    dry_sequence_breakers: {
        type: 'stringArray', group: 'dry',
        desc: 'Sequence breakers for DRY sampling. Must be a NON-EMPTY array of strings; the server rejects an empty array.',
    },

    // --- mirostat / adaptive ---
    mirostat: {
        type: 'int', min: 0, max: 2, step: 1, group: 'mirostat',
        desc: 'Enable Mirostat sampling, controlling perplexity during text generation (0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0)',
    },
    mirostat_tau: {
        type: 'float', min: 0, max: 10, step: 0.01, group: 'mirostat',
        desc: 'Set the Mirostat target entropy, parameter tau',
    },
    mirostat_eta: {
        type: 'float', min: 0, max: 1, step: 0.01, group: 'mirostat',
        desc: 'Set the Mirostat learning rate, parameter eta',
    },
    adaptive_target: {
        type: 'float', min: -1, max: 1, step: 0.01, group: 'mirostat', advanced: true,
        desc: 'Adaptive sampling target entropy (valid range 0.0 to 1.0; negative = disabled)',
    },
    adaptive_decay: {
        type: 'float', min: 0, max: 0.99, step: 0.01, group: 'mirostat', advanced: true,
        desc: 'EMA decay for adaptive sampling; history approximates 1/(1-decay) tokens',
    },

    // --- request pipeline (not sampling per se) ---
    samplers: {
        type: 'stringArray', group: 'pipeline', advanced: true,
        desc: 'The order in which samplers are applied. An array of sampler type names, or a single string of sampler chars',
    },
    ignore_eos: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Ignore the end-of-sequence token and continue generating',
    },
    n_probs: {
        type: 'int', min: 0, max: 20, step: 1, group: 'pipeline', advanced: true,
        desc: 'If greater than 0, output the probabilities of top N tokens for each generated token (alias: logprobs)',
    },
    stop: {
        type: 'stringArray', group: 'pipeline', advanced: true,
        desc: 'Stop sequences. Falls back to the server CLI defaults when empty.',
    },
    max_tokens: {
        type: 'int', min: -1, max: 32768, step: 1, group: 'pipeline', advanced: true,
        desc: 'Maximum number of tokens to predict',
    },
    n_predict: {
        type: 'int', min: -1, max: 32768, step: 1, group: 'pipeline', advanced: true,
        desc: 'Maximum number of tokens to predict (same as max_tokens)',
    },
    n_keep: {
        type: 'int', min: -1, max: 32768, step: 1, group: 'pipeline', advanced: true,
        desc: 'Number of tokens from the initial prompt to retain when context size is exceeded (-1 retains all)',
    },
    n_discard: {
        type: 'int', min: 0, max: 32768, step: 1, group: 'pipeline', advanced: true,
        desc: 'Number of tokens after n_keep that may be discarded when shifting context (0 = half context)',
    },
    logit_bias: {
        type: 'json', group: 'pipeline', advanced: true,
        desc: 'Modify the likelihood of specific tokens. Array of [token, bias] pairs or an object mapping token to bias',
    },
    grammar: {
        type: 'string', group: 'pipeline', advanced: true,
        desc: 'GBNF grammar string for constrained generation',
    },
    grammar_lazy: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Lazy grammar triggering',
    },
    grammar_triggers: {
        type: 'json', group: 'pipeline', advanced: true,
        desc: 'Grammar trigger definitions',
    },
    preserved_tokens: {
        type: 'stringArray', group: 'pipeline', advanced: true,
        desc: 'Tokens that are preserved when using grammars',
    },
    chat_format: {
        type: 'string', group: 'pipeline', advanced: true,
        desc: 'Chat template format',
    },
    reasoning_format: {
        type: 'string', group: 'pipeline', advanced: true,
        desc: 'How reasoning traces are parsed out of the model output',
    },
    reasoning_in_content: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Keep reasoning content in the message body',
    },
    generation_prompt: {
        type: 'string', group: 'pipeline', advanced: true,
        desc: 'Generation prompt appended for reasoning models',
    },
    'speculative.types': {
        type: 'stringArray', group: 'pipeline', advanced: true,
        desc: 'Speculative decoding methods enabled on the server',
    },
    timings_per_token: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Include per-token timings in the response',
    },
    stream: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Stream the response token by token (SillyTavern controls this with its own toggle)',
    },
    post_sampling_probs: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Return probabilities after applying the sampling chain',
    },
    backend_sampling: {
        type: 'bool', group: 'pipeline', advanced: true,
        desc: 'Use backend sampling instead of llama.cpp sampling',
    },
    lora: {
        type: 'json', group: 'pipeline', advanced: true,
        desc: 'LoRA adapters to apply to this request',
    },
};

/** Order in which groups are rendered. */
export const GROUP_ORDER = ['sampling', 'penalties', 'dry', 'mirostat', 'pipeline', 'detected'];

/** Human readable group headings. */
export const GROUP_TITLES = {
    sampling: 'Sampling',
    penalties: 'Penalties / repetition',
    dry: 'DRY',
    mirostat: 'Mirostat / adaptive',
    pipeline: 'Request pipeline',
    detected: 'Other (detected, no metadata)',
};

/**
 * CLI flags accepted by llama.cpp, mapped to the JSON body key the server reads.
 * Flag names and aliases taken from common/arg.cpp.
 */
export const CLI_FLAG_MAP = {
    '--temp': 'temperature',
    '--temperature': 'temperature',
    '--top-k': 'top_k',
    '--top-p': 'top_p',
    '--min-p': 'min_p',
    '--top-nsigma': 'top_n_sigma',
    '--top-n-sigma': 'top_n_sigma',
    '--typical': 'typical_p',
    '--typical-p': 'typical_p',
    '--xtc-probability': 'xtc_probability',
    '--xtc-threshold': 'xtc_threshold',
    '--repeat-penalty': 'repeat_penalty',
    '--repeat-last-n': 'repeat_last_n',
    '--presence-penalty': 'presence_penalty',
    '--frequency-penalty': 'frequency_penalty',
    '--dry-multiplier': 'dry_multiplier',
    '--dry-base': 'dry_base',
    '--dry-allowed-length': 'dry_allowed_length',
    '--dry-penalty-last-n': 'dry_penalty_last_n',
    '--dry-sequence-breaker': 'dry_sequence_breakers',
    '--dynatemp-range': 'dynatemp_range',
    '--dynatemp-exp': 'dynatemp_exponent',
    '--mirostat': 'mirostat',
    '--mirostat-lr': 'mirostat_eta',
    '--mirostat-eta': 'mirostat_eta',
    '--mirostat-ent': 'mirostat_tau',
    '--mirostat-tau': 'mirostat_tau',
    '--samplers': 'samplers',
    '--min-keep': 'min_keep',
    '--seed': 'seed',
    '-s': 'seed',
    '--n-predict': 'n_predict',
    '-n': 'n_predict',
    '--keep': 'n_keep',
};

/**
 * Common llama-server flags that are not sampling parameters. They are
 * recognised so that pasting a full command line does not drown the user in
 * meaningless "unknown flag" warnings. `true` means the flag consumes a value.
 */
export const CLI_IGNORED_FLAGS = {
    '-m': true, '--model': true, '--hf-repo': true, '--hf-file': true, '--lora': true, '--lora-scaled': true,
    '-c': true, '--ctx-size': true, '--n-ctx': true, '--predict': true,
    '-ngl': true, '--gpu-layers': true, '--n-gpu-layers': true, '-ngld': true,
    '-t': true, '--threads': true, '-tb': true, '--threads-batch': true,
    '-b': true, '--batch-size': true, '-ub': true, '--ubatch-size': true,
    '-np': true, '--parallel': true, '--alias': true, '-a': true,
    '--host': true, '--port': true, '--api-key': true, '--api-key-file': true,
    '--cors-origins': true, '--cors-methods': true, '--cors-headers': true,
    '--tensor-split': true, '-ts': true, '--main-gpu': true, '-mg': true,
    '--split-mode': true, '-sm': true, '--rope-scaling': true, '--rope-freq-base': true,
    '--rope-freq-scale': true, '-ctk': true, '--cache-type-k': true,
    '-ctv': true, '--cache-type-v': true, '--chat-template': true, '--chat-template-file': true,
    '--draft-max': true, '--draft-min': true, '--draft-p-min': true,
    '--top-k-draft': true, '--temp-draft': true, '--min-p-draft': true, '--top-p-draft': true,
    '--log-format': true, '--log-file': true, '--log-colors': true, '-o': true, '--logdir': true,
    '--slot-save-path': true, '--timeout': true, '--threads-http': true,
    '--cache-reuse': true, '--numa': true, '--device': true, '-d': true,
    '--sampling-seq': true, '--lora-init-without-apply': false,
    '--mlock': false, '--no-mmap': false, '--mmap': false, '--numa-distribute': false,
    '--jinja': false, '--no-jinja': false, '--no-warmup': false, '--warmup': false,
    '-fa': false, '--flash-attn': false, '--no-flash-attn': false,
    '--cont-batching': false, '--no-cont-batching': false,
    '--metrics': false, '--slots': false, '--props': false, '--no-webui': false, '--webui': false,
    '--embedding': false, '--embeddings': false, '--rerank': false,
    '--verbose': false, '-v': false, '--log-disable': false, '--no-log-prefix': false,
    '--log-prefix': false, '--perf': false, '--no-perf': false,
    '--context-shift': false, '--no-context-shift': false,
    '--cors-credentials': false, '--no-cors-credentials': false,
    '--swa-full': false, '--no-swa-full': false, '--no-op-offload': false,
};

/** Flags that map to a body key plus a fixed boolean value. */
export const CLI_BOOL_FLAGS = {
    '--ignore-eos': ['ignore_eos', true],
    '--no-ignore-eos': ['ignore_eos', false],
};

/** Keys whose CLI flag may be repeated / comma separated and become arrays. */
export const CLI_ARRAY_FLAGS = {
    '--dry-sequence-breaker': { key: 'dry_sequence_breakers', mode: 'append' },
    '--samplers': { key: 'samplers', mode: 'split', separators: /[,;]/ },
};

/** Turn `dry_penalty_last_n` into `Dry Penalty Last N`. */
export function humanize(key) {
    return String(key)
        .split(/[._]/)
        .filter(Boolean)
        .map(part => (/^[a-z]{1,2}$/.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
        .join(' ');
}

/**
 * Build a spec for a parameter the metadata table does not know about, using
 * the live value from /props to make an educated guess.
 */
export function inferSpec(key, value) {
    const base = { label: humanize(key), desc: null, group: 'detected', advanced: true, inferred: true };

    if (typeof value === 'boolean') {
        return { ...base, type: 'bool' };
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const isInt = Number.isInteger(value);
        if (isInt) {
            return {
                ...base,
                type: 'int',
                step: 1,
                min: value < 0 ? Math.floor(value * 2) : 0,
                max: Math.max(10, Math.ceil(Math.abs(value) * 4)),
            };
        }
        const abs = Math.abs(value);
        return abs <= 1
            ? { ...base, type: 'float', step: 0.01, min: Math.min(0, value), max: 1 }
            : { ...base, type: 'float', step: 0.01, min: value < 0 ? -abs * 2 : 0, max: abs * 2 };
    }

    if (Array.isArray(value)) {
        const primitive = value.every(v => ['string', 'number', 'boolean'].includes(typeof v));
        return { ...base, type: primitive ? 'stringArray' : 'json' };
    }

    if (value !== null && typeof value === 'object') {
        return { ...base, type: 'json' };
    }

    return { ...base, type: 'string' };
}

/**
 * Resolve the spec for a parameter: curated metadata when available, otherwise
 * an inferred one.
 */
export function specFor(key, value) {
    const meta = PARAM_METADATA[key];
    if (meta) {
        return { ...meta, label: meta.label || humanize(key), key };
    }
    return { ...inferSpec(key, value), key };
}

/** Coerce a raw control value to the type the server expects. */
export function coerceValue(spec, raw) {
    switch (spec.type) {
        case 'int': {
            const n = Math.trunc(Number(raw));
            return Number.isFinite(n) ? n : 0;
        }
        case 'float': {
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        }
        case 'bool':
            return raw === true || raw === 'true' || raw === 1 || raw === '1';
        case 'stringArray':
            if (Array.isArray(raw)) return raw.map(String);
            return String(raw).trim() === '' ? [] : [String(raw)];
        case 'json': {
            if (typeof raw !== 'string') return raw;
            try {
                return JSON.parse(raw);
            } catch {
                return undefined;
            }
        }
        default:
            return typeof raw === 'string' ? raw : String(raw);
    }
}

/** Parse a textarea into tokens, honouring quotes, `$'...'` and line continuations. */
export function tokenize(input) {
    const s = String(input || '').replace(/\\\r?\n/g, ' ');
    const out = [];
    let i = 0;

    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length) break;

        // shell comment to end of line
        if (s[i] === '#') {
            while (i < s.length && s[i] !== '\n') i++;
            continue;
        }

        let token = '';

        if (s[i] === '$' && (s[i + 1] === '"' || s[i + 1] === "'")) {
            const quote = s[i + 1];
            i += 2;
            let raw = '';
            while (i < s.length && s[i] !== quote) {
                if (s[i] === '\\' && i + 1 < s.length) {
                    raw += s[i] + s[i + 1];
                    i += 2;
                    continue;
                }
                raw += s[i++];
            }
            i++;
            token = unescapeAnsiC(raw);
        } else if (s[i] === '"' || s[i] === "'") {
            const quote = s[i++];
            while (i < s.length && s[i] !== quote) {
                if (quote === '"' && s[i] === '\\' && i + 1 < s.length) {
                    token += unescapeAnsiC(s[i] + s[i + 1]);
                    i += 2;
                    continue;
                }
                token += s[i++];
            }
            i++;
        } else {
            while (i < s.length && !/\s/.test(s[i])) token += s[i++];
        }

        out.push(token);
    }

    return out;
}

/** Expand bash ANSI-C escapes (used by `$'\n'` style arguments). */
export function unescapeAnsiC(str) {
    return String(str).replace(
        /\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|[\s\S])/g,
        (match, esc) => {
            switch (esc[0]) {
                case 'x':
                case 'u':
                case 'U':
                    return String.fromCodePoint(parseInt(esc.slice(1), 16));
                case 'n': return '\n';
                case 't': return '\t';
                case 'r': return '\r';
                case 'a': return '\x07';
                case 'b': return '\b';
                case 'f': return '\f';
                case 'v': return '\v';
                default:
                    if (/^[0-7]{1,3}$/.test(esc)) return String.fromCodePoint(parseInt(esc, 8));
                    return esc;
            }
        },
    );
}

/**
 * Parse a llama.cpp CLI invocation (or a bare list of flags) into JSON body
 * values, e.g. `--top-k 64 --dry-sequence-breaker $'\n'`.
 *
 * @returns {{values: Object, unknown: string[], positional: string[]}}
 */
export function parseCliFlags(text) {
    const tokens = tokenize(text);
    const values = {};
    const unknown = [];
    const positional = [];

    const isValueToken = (tok) => {
        if (tok === undefined) return false;
        if (!tok.startsWith('-')) return true;
        if (/^-\d/.test(tok)) return true; // negative number
        return false;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (!token.startsWith('-')) {
            positional.push(token);
            continue;
        }

        let flag = token;
        let inlineValue = null;
        const eq = token.indexOf('=');
        if (token.startsWith('--') && eq > 0) {
            flag = token.slice(0, eq);
            inlineValue = token.slice(eq + 1);
        }

        if (Object.hasOwn(CLI_BOOL_FLAGS, flag)) {
            const [key, val] = CLI_BOOL_FLAGS[flag];
            values[key] = val;
            continue;
        }

        const arrayFlag = Object.hasOwn(CLI_ARRAY_FLAGS, flag) ? CLI_ARRAY_FLAGS[flag] : null;
        const key = arrayFlag ? arrayFlag.key : CLI_FLAG_MAP[flag];

        if (!key) {
            if (Object.hasOwn(CLI_IGNORED_FLAGS, flag)) {
                // Non-sampling flag: swallow it (and its value) without warning.
                if (CLI_IGNORED_FLAGS[flag] && isValueToken(tokens[i + 1])) i++;
                continue;
            }
            unknown.push(flag);
            continue;
        }

        let raw = inlineValue;
        if (raw === null) {
            if (!isValueToken(tokens[i + 1])) {
                unknown.push(`${flag} (missing value)`);
                continue;
            }
            raw = tokens[i + 1];
            i++;
        }

        if (arrayFlag) {
            if (arrayFlag.mode === 'append') {
                values[key] = [...(values[key] || []), raw];
            } else {
                values[key] = String(raw).split(arrayFlag.separators || /[,;]/).map(s => s.trim()).filter(Boolean);
            }
            continue;
        }

        const spec = specFor(key, undefined);
        if (spec.type === 'int' && /^-?\d+$/.test(String(raw).trim())) {
            values[key] = parseInt(String(raw).trim(), 10);
        } else if (spec.type === 'float' && /^-?\d*\.?\d+(e-?\d+)?$/i.test(String(raw).trim())) {
            values[key] = parseFloat(String(raw).trim());
        } else if (spec.type === 'bool') {
            values[key] = /^(true|1|yes|on)$/i.test(String(raw).trim());
        } else {
            values[key] = String(raw);
        }
    }

    return { values, unknown, positional };
}

/** Quote a YAML key when it is not a plain scalar. */
function yamlKey(key) {
    return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Render a scalar/array/object as a YAML value.
 * JSON is a subset of YAML, so JSON.stringify is used for anything non-scalar.
 */
function yamlValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return JSON.stringify(value);
    return JSON.stringify(value);
}

/**
 * Serialize a flat object to YAML text. Nested values are emitted as JSON flow
 * collections, which the server's YAML parser accepts.
 */
export function emitYaml(obj) {
    const lines = [];
    for (const [key, value] of Object.entries(obj || {})) {
        const rendered = yamlValue(value);
        if (rendered === null) continue;
        lines.push(`${yamlKey(key)}: ${rendered}`);
    }
    return lines.join('\n');
}

/**
 * Remove whole top-level mapping entries (including any indented continuation
 * lines, so nested mappings are dropped with their parent) for the given keys.
 * A tiny line-based scan instead of a full YAML parse, because the browser
 * bundle has no YAML library available to extensions.
 */
export function stripTopLevelKeys(yamlText, keys) {
    const wanted = new Set(keys);
    const lines = String(yamlText || '').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const match = /^([^\s#][^:]*?):(\s|$)/.exec(line);

        if (!match) {
            out.push(line);
            i++;
            continue;
        }

        const key = match[1].trim().replace(/^["']|["']$/g, '');

        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) j++;

        if (!wanted.has(key)) {
            out.push(...lines.slice(i, j));
        }

        i = j;
    }

    return out.join('\n');
}

/**
 * Merge sampler overrides into an existing `custom_include_body` YAML string,
 * giving the overrides precedence and never producing duplicate keys (the
 * server's YAML parser rejects those, and the error is swallowed silently).
 */
export function buildIncludeBody(existingYaml, overrides) {
    const keys = Object.keys(overrides || {}).filter(k => yamlValue(overrides[k]) !== null);
    const emitted = emitYaml(Object.fromEntries(keys.map(k => [k, overrides[k]])));

    if (!emitted) return existingYaml ?? '';

    const kept = stripTopLevelKeys(existingYaml ?? '', keys).trim();
    return [kept, emitted].filter(Boolean).join('\n') + '\n';
}

/**
 * Normalize a base URL so `/props` can be requested from it.
 * SillyTavern's custom URL is normally `http://host:port/v1`.
 *
 * Idempotent (an existing `/props` is not doubled) and drops any query string or
 * fragment, so a base like `http://host/admin?x=1` cannot produce
 * `http://host/admin?x=1/props`.
 */
export function propsUrlFromBase(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        url.search = '';
        url.hash = '';

        let pathname = url.pathname.replace(/\/+$/, '');
        if (!/\/props$/i.test(pathname)) {
            pathname = pathname.replace(/\/v1$/i, '') + '/props';
        }

        url.pathname = pathname;
        return url.href;
    } catch {
        // Not an absolute URL: fall back to string handling.
        const trimmed = raw.replace(/\/+$/, '');
        if (/\/props$/i.test(trimmed)) return trimmed;
        return `${trimmed.replace(/\/v1$/i, '')}/props`;
    }
}

/** True when a `/props` payload looks like a llama.cpp server. */
export function isLlamaCppProps(payload) {
    const params = payload?.default_generation_settings?.params;
    return !!params && typeof params === 'object' && !Array.isArray(params);
}

/** Plugin id; also the last segment of the plugin's API route. */
export const PLUGIN_ID = 'llamacpp-samplers';

/** Every way we can reach the llama.cpp HTTP API. */
export const PROP_TRANSPORTS = ['direct', 'plugin', 'corsProxy'];

/**
 * True for host names that only ever mean "the machine making the request".
 * Ports are not part of a hostname, so they are ignored here.
 */
export function isLoopbackHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost'
        || host === '::1'
        || host === '0.0.0.0'
        || host.endsWith('.localhost')
        || /^127\./.test(host);
}

/**
 * Resolve a `/props` value from whatever the caller supplied: a base URL
 * (`http://host:8080/v1`) or an already absolute `/props` URL.
 */
export function resolvePropsTarget(baseUrl) {
    return propsUrlFromBase(baseUrl);
}

/**
 * Order the transports should be tried in.
 *
 * The interesting case: llama.cpp bound to loopback while the page was loaded
 * from somewhere else. That means llama.cpp lives next to the SillyTavern
 * *server*, not next to the browser, so a direct fetch from the browser would
 * either fail or - worse - silently find a *different* llama.cpp running on the
 * client's own machine. Those setups must go through the server first.
 *
 * @param {string} baseUrl SillyTavern's configured custom endpoint URL.
 * @param {string} pageHostname window.location.hostname of the client.
 * @param {string} [cachedTransport] Transport that worked last time, tried first.
 * @returns {string[]} Transport names, most promising first.
 */
export function transportOrderFor(baseUrl, pageHostname, cachedTransport) {
    let targetHost = '';
    try {
        targetHost = new URL(String(baseUrl)).hostname;
    } catch {
        targetHost = '';
    }

    const mustGoThroughServer = isLoopbackHost(targetHost) && !isLoopbackHost(pageHostname);

    const preferred = mustGoThroughServer
        ? ['plugin', 'corsProxy', 'direct']
        : ['direct', 'plugin', 'corsProxy'];

    if (cachedTransport && preferred.includes(cachedTransport)) {
        return [cachedTransport, ...preferred.filter(transport => transport !== cachedTransport)];
    }

    return preferred;
}

/** Build the request URL for one transport. */
export function transportUrl(transport, baseUrl) {
    switch (transport) {
        case 'plugin':
            return `/api/plugins/${PLUGIN_ID}/props?url=${encodeURIComponent(resolvePropsTarget(baseUrl))}`;
        case 'corsProxy':
            return `/proxy/${resolvePropsTarget(baseUrl)}`;
        default:
            return resolvePropsTarget(baseUrl);
    }
}

/** Human readable transport name for the UI. */
export function transportLabel(transport) {
    switch (transport) {
        case 'plugin': return 'SillyTavern server plugin';
        case 'corsProxy': return 'SillyTavern CORS proxy';
        case 'direct': return 'direct from browser';
        default: return transport;
    }
}

/** Advice for the most common cause of a refused request. */
export const AUTH_HINT = ' The server refused the request, which usually means llama.cpp is running with '
    + '--api-key. Put the same key in this endpoint\'s API key field. The server plugin route can use it '
    + 'even when SillyTavern hides the saved key from the browser.';

/**
 * Decide which Authorization header to send upstream for `/props`.
 *
 * A header supplied by the caller wins. Otherwise fall back to the key
 * SillyTavern has stored for its Custom endpoint - which the browser usually
 * cannot read, because SillyTavern hides saved keys unless `allowKeysExposure`
 * is enabled. This is why the server plugin can succeed where a browser fetch
 * cannot: it reads the secret on the server side.
 *
 * @param {string} [clientAuthorization] Header the caller supplied, if any.
 * @param {string} [storedKey] Bare key from SillyTavern's secret store.
 * @returns {string} Authorization header value, or '' for none.
 */
export function pickApiKey(clientAuthorization, storedKey) {
    if (clientAuthorization) return String(clientAuthorization);
    return storedKey ? `Bearer ${storedKey}` : '';
}

/**
 * Describe a failed HTTP response in a way a human can act on.
 *
 * SillyTavern's proxy turns an upstream 401 into a 400 while keeping the status
 * text "Unauthorized" (forwardFetchResponse in src/util.js), so the status code
 * alone is misleading and the status text has to be considered too. A plain 400
 * ("Bad Request") is not treated as an auth failure.
 *
 * @param {{status: number, statusText?: string, text?: () => Promise<string>}} response
 * @returns {Promise<{status: number, unauthorized: boolean, text: string}>}
 */
export async function describeFailure(response) {
    const statusLine = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

    // The server plugin reports auth failures explicitly in its JSON body.
    let unauthorized = response.status === 401
        || response.status === 403
        || (response.status === 400 && /unauthorized/i.test(response.statusText || ''));

    let detail = '';

    if (typeof response.text === 'function') {
        try {
            const raw = (await response.text() || '').trim();
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed?.unauthorized) unauthorized = true;
                    const error = parsed?.error;
                    detail = (error && typeof error === 'object' ? error.message : error) || parsed?.message || '';
                } catch {
                    detail = raw;
                }
            }
        } catch {
            // Body already consumed or unreadable; the status alone will do.
        }
    }

    // SillyTavern's 404 page is a full HTML document; quoting it helps nobody.
    if (detail.startsWith('<')) detail = '';

    return {
        status: response.status,
        unauthorized,
        text: detail ? `${statusLine}: ${detail.slice(0, 200)}` : statusLine,
    };
}
