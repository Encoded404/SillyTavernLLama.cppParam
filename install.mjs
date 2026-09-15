#!/usr/bin/env node
/**
 * Copy this extension into a SillyTavern install (or remove it).
 *
 * The repository root *is* the extension, so the normal way to install is
 * SillyTavern's own "Install extension" menu with this repo's URL, or a plain
 * `git clone` into public/scripts/extensions/third-party/. This script exists for
 * installs that are not git clones (zip downloads, dev checkouts).
 *
 * Usage:
 *   node install.mjs --dir /path/to/SillyTavern [--name llama-cpp-samplers] [--uninstall] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_NAME = 'llama-cpp-samplers';

/** Extension payload: everything else in the repo is development tooling. */
const EXTENSION_FILES = ['manifest.json', 'index.js', 'params.js', 'style.css', 'settings.html'];

const ANSI = {
    red: s => `\u001b[31m${s}\u001b[0m`,
    green: s => `\u001b[32m${s}\u001b[0m`,
    yellow: s => `\u001b[33m${s}\u001b[0m`,
    cyan: s => `\u001b[36m${s}\u001b[0m`,
};

function usage(exitCode = 0) {
    const out = exitCode === 0 ? console.log : console.error;
    out(`Usage: node install.mjs --dir <SillyTavern path> [options]

Options:
  --dir <path>     SillyTavern checkout or install directory. Required.
  --name <folder>  Destination folder name under third-party/. Default: ${DEFAULT_NAME}
  --uninstall      Remove the extension instead of installing it.
  --dry-run        Show what would happen without writing anything.
  -h, --help       Show this help.

Examples:
  node install.mjs --dir ~/SillyTavern
  node install.mjs --dir ~/SillyTavern --uninstall
`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const args = { name: DEFAULT_NAME, uninstall: false, dryRun: false };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--dir': args.dir = argv[++i]; break;
            case '--name': args.name = argv[++i]; break;
            case '--uninstall': args.uninstall = true; break;
            case '--dry-run': args.dryRun = true; break;
            case '-h':
            case '--help': usage(0); break;
            default:
                console.error(ANSI.red(`Unknown argument: ${argv[i]}`));
                usage(1);
        }
    }

    return args;
}

function isSillyTavern(dir) {
    return fs.existsSync(path.join(dir, 'public', 'scripts', 'extensions'))
        && fs.existsSync(path.join(dir, 'package.json'))
        && fs.existsSync(path.join(dir, 'server.js'));
}

/** Drop `third-party/<name>` from disabledExtensions across every user profile. */
function enableForAllUsers(dir, name, dryRun) {
    const dataDir = path.join(dir, 'data');
    const profiles = [];
    const patched = [];

    if (!fs.existsSync(dataDir)) return { profiles, patched };

    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const settingsPath = path.join(dataDir, entry.name, 'settings.json');
        if (!fs.existsSync(settingsPath)) continue;

        let settings;
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (error) {
            console.warn(ANSI.yellow(`  ! ${settingsPath} is not valid JSON, skipping (${error.message})`));
            continue;
        }

        profiles.push(settingsPath);

        const disabled = settings?.extension_settings?.disabledExtensions;
        if (!Array.isArray(disabled) || !disabled.includes(`third-party/${name}`)) continue;

        if (!dryRun) {
            settings.extension_settings.disabledExtensions = disabled.filter(x => x !== `third-party/${name}`);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
        }

        patched.push(settingsPath);
    }

    return { profiles, patched };
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.dir) {
        console.error(ANSI.red('Missing --dir. Point it at your SillyTavern directory.'));
        usage(1);
    }

    const dir = path.resolve(args.dir.replace(/^~(?=$|\/)/, process.env.HOME || '~'));

    if (!fs.existsSync(dir)) {
        console.error(ANSI.red(`Directory not found: ${dir}`));
        process.exit(1);
    }

    if (!isSillyTavern(dir)) {
        console.error(ANSI.red(`${dir} does not look like a SillyTavern install (expected server.js, package.json and public/scripts/extensions).`));
        process.exit(1);
    }

    const targetDir = path.join(dir, 'public', 'scripts', 'extensions', 'third-party', args.name);

    if (args.uninstall) {
        if (!fs.existsSync(targetDir)) {
            console.log(ANSI.yellow(`Nothing to remove: ${targetDir} does not exist.`));
            return;
        }
        if (!args.dryRun) fs.rmSync(targetDir, { recursive: true, force: true });
        console.log(`${args.dryRun ? '[dry-run] would remove' : 'Removed'} ${ANSI.cyan(targetDir)}`);
        return;
    }

    for (const file of EXTENSION_FILES) {
        if (!fs.existsSync(path.join(__dirname, file))) {
            console.error(ANSI.red(`Missing extension file: ${file}`));
            process.exit(1);
        }
    }

    if (fs.existsSync(targetDir) && !args.dryRun) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    if (!args.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
        for (const file of EXTENSION_FILES) {
            fs.copyFileSync(path.join(__dirname, file), path.join(targetDir, file));
        }
    }

    const { profiles, patched } = enableForAllUsers(dir, args.name, args.dryRun);

    console.log(`${args.dryRun ? '[dry-run] would install' : 'Installed'} ${ANSI.green(`third-party/${args.name}`)} -> ${ANSI.cyan(targetDir)}`);
    for (const file of EXTENSION_FILES) console.log(`  + ${file}`);

    if (!profiles.length) {
        console.log(ANSI.yellow('No settings.json found yet (SillyTavern has not run) — the extension will be enabled on first start.'));
    } else if (patched.length) {
        console.log(`Enabled for ${patched.length} profile(s):`);
        for (const file of patched) console.log(`  ~ ${file}`);
    } else {
        console.log(`Already enabled for ${profiles.length} profile(s).`);
    }

    console.log(`
Next steps:
  1. Restart SillyTavern (or reload the page) so the extension is discovered.
  2. Chat Completion -> API: Custom (OpenAI-compatible), URL: http://<host>:<port>/v1
  3. Open the "llama.cpp samplers" panel, hit Refresh, and enable what you need.

Note: /props is read directly by the browser, so llama.cpp must allow the origin.
      Recent llama.cpp defaults to --cors-origins '*' which is fine. If you locked
      CORS down, allow SillyTavern's origin instead.`);
}

main();
