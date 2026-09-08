import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { readConfig } from '../lib/config';
import { nextAction } from '../lib/output';
import { packWidget } from '../lib/pack';
import { CLI_BIN_NAME, CONFIG_FILE_NAME } from '../lib/package-identity';
import { unpackWidget } from '../lib/unpack';
import { formatIssues, validateConfig, validateZip } from '../lib/validate';
import { WizardIo, runWizard } from '../lib/wizard';

function printHelp(): void {
    console.log(`
${CLI_BIN_NAME} - pack a hand-written ${CONFIG_FILE_NAME} into an import-ready Portal ZIP

Usage:
  ${CLI_BIN_NAME}                                        Wizard -- embed: two questions, one import-ready ZIP;
                                                       custom: one question, a config to pack your own bundles
  ${CLI_BIN_NAME} pack [--config <path>] [--out <dir>]
  ${CLI_BIN_NAME} validate <${CONFIG_FILE_NAME} | *.zip>
  ${CLI_BIN_NAME} unpack <zip> [--out <dir>] [--force] [--with-bundles]
  ${CLI_BIN_NAME} --help

Commands:
  (no args)  Wizard -- derives everything but the display name (and, for embed, the URL)
  pack       Config -> <tagName>.zip
  validate   Per-field pass/fail report against the dialog's own rules
  unpack     ZIP -> editable ${CONFIG_FILE_NAME}, recovered even from a foreign archive
`);
}

async function runPack(argv: string[]): Promise<void> {
    const { values } = parseArgs({
        args: argv,
        options: {
            config: { type: 'string', default: CONFIG_FILE_NAME },
            out: { type: 'string' }
        },
        allowPositionals: false
    });

    const result = await packWidget({
        configPath: values.config as string,
        outDir: values.out as string | undefined
    });
    console.log(result.nextAction);
}

async function runValidate(argv: string[]): Promise<void> {
    const [targetPath] = argv;
    if (!targetPath) {
        console.error(`Usage: ${CLI_BIN_NAME} validate <${CONFIG_FILE_NAME} | *.zip>`);
        process.exitCode = 1;
        return;
    }

    const resolved = path.resolve(targetPath);
    const isZip = resolved.toLowerCase().endsWith('.zip');

    const issues = isZip
        ? validateZip(new Uint8Array(await fs.readFile(resolved)))
        : validateConfig(readConfig(resolved), path.dirname(resolved));
    const hasErrors = issues.some(item => item.severity === 'error');

    console.log(formatIssues(issues));
    console.log(nextAction(isZip ? 'validate-zip' : 'validate-config', { hasErrors }));
    process.exitCode = hasErrors ? 1 : 0;
}

async function runUnpack(argv: string[]): Promise<void> {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            out: { type: 'string' },
            force: { type: 'boolean', default: false },
            'with-bundles': { type: 'boolean', default: false }
        },
        allowPositionals: true
    });

    const [zipPath] = positionals;
    if (!zipPath) {
        console.error(`Usage: ${CLI_BIN_NAME} unpack <zip> [--out <dir>] [--force] [--with-bundles]`);
        process.exitCode = 1;
        return;
    }

    const result = await unpackWidget({
        zipPath,
        outDir: values.out as string | undefined,
        force: values.force as boolean,
        withBundles: values['with-bundles'] as boolean
    });

    console.log(formatIssues(result.issues));
    console.log(result.nextAction);
}

/**
 * Backs `WizardIo` with `node:readline/promises` over the real terminal.
 * Reads lines through the interface's own async iterator rather than
 * repeated `rl.question()` calls -- with piped (non-TTY) stdin, a second
 * `rl.question()` call never resolves once the first has consumed a line,
 * which would silently hang the wizard's second and third questions. The
 * iterator has no such limitation and behaves identically for a real
 * interactive terminal. Closed in a `finally` so a thrown validation/pack
 * error still releases stdin.
 */
async function runWizardCli(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const lines = rl[Symbol.asyncIterator]();
    try {
        const io: WizardIo = {
            ask: async (question, fallback) => {
                process.stdout.write(fallback ? `${question} [${fallback}] ` : `${question} `);
                const next = await lines.next();
                return next.done ? '' : next.value;
            },
            log: (line: string) => console.log(line)
        };
        await runWizard(io, process.cwd());
    } finally {
        rl.close();
    }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
    const [command, ...rest] = argv;

    if (command === '--help' || command === '-h') {
        printHelp();
        return;
    }

    switch (command) {
        case undefined:
            await runWizardCli();
            return;
        case 'pack':
            await runPack(rest);
            return;
        case 'validate':
            await runValidate(rest);
            return;
        case 'unpack':
            await runUnpack(rest);
            return;
        default:
            console.error(`Unknown command "${command}".`);
            printHelp();
            process.exitCode = 1;
    }
}
