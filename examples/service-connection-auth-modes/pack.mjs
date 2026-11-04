/**
 * Packs every test widget (run `pnpm build` first) into dist/<tag>.zip with the portal-widget CLI, ready for
 * Portal Admin -> Configuration -> Widgets -> Import.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES } from './modes.mjs';

const here = dirname(fileURLToPath(import.meta.url));

for (const { tag } of MODES) {
    const config = join('widgets', tag, 'portal-widget.json');
    // One command string through the shell resolves portal-widget.cmd on Windows and portal-widget on POSIX alike.
    const result = spawnSync(`pnpm exec portal-widget pack --config ${config} --out dist`, { cwd: here, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        console.error(`${tag}: pack failed with exit code ${result.status ?? 'unknown'}.`);
        process.exit(result.status ?? 1);
    }
}
