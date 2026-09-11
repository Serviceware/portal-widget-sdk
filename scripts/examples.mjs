/**
 * Runs a pnpm command in every example folder.
 *
 *   node scripts/examples.mjs install     pnpm install
 *   node scripts/examples.mjs build       pnpm run build
 *   node scripts/examples.mjs <script>    any other package.json script
 *
 * The examples are deliberately not part of the repository's pnpm workspace: each folder is its own
 * workspace root (examples/<name>/pnpm-workspace.yaml), so the root install stays limited to what the
 * SDK and CLI need. This runner exists so CI and contributors can still exercise all of them with one
 * command.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const examplesDir = join(root, 'examples');
const [command = 'build', ...rest] = process.argv.slice(2);

const examples = readdirSync(examplesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(examplesDir, entry.name, 'package.json')))
    .map(entry => entry.name);

const args = command === 'install' ? ['install', ...rest] : ['run', command, ...rest];
if (args.some(arg => !/^[\w@:./=-]+$/.test(arg))) {
    console.error('Arguments may only contain word characters, "@", ":", ".", "/", "=" and "-".');
    process.exit(1);
}
const commandLine = `pnpm ${args.join(' ')}`;

for (const example of examples) {
    console.log(`\n=== examples/${example}: ${commandLine} ===`);
    // A single command string through the shell resolves pnpm.cmd on Windows and pnpm on POSIX alike.
    const result = spawnSync(commandLine, { cwd: join(examplesDir, example), stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        console.error(`examples/${example}: ${commandLine} failed with exit code ${result.status ?? 'unknown'}.`);
        process.exit(result.status ?? 1);
    }
}
