import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PACKAGE_ROOT } from '../package-root';
import { nextAction } from './output';

export const SKILL_NAME = 'portal-private-widget';

/**
 * Where each agent family looks for project (or, with `global`, user) skills.
 * `.claude/skills` is Claude Code's; `.agents/skills` is the shared location
 * other Agent Skills clients and `npx skills` use.
 */
export const SKILL_TARGETS = {
    claude: path.join('.claude', 'skills'),
    agents: path.join('.agents', 'skills')
} as const;

export type SkillTarget = keyof typeof SKILL_TARGETS;

/**
 * The skill's single source is `skills/` at the repository root. The build
 * copies it to `<package root>/skills/` so it ships in the npm package; from a
 * checkout without a build (vitest), fall back to the repository copy.
 */
export function resolveSkillFile(packageRoot = PACKAGE_ROOT): string {
    const candidates = [
        path.join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md'),
        path.join(packageRoot, '..', '..', 'skills', SKILL_NAME, 'SKILL.md')
    ];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) {
        throw new Error(`Skill file not found (looked in ${candidates.join(', ')}). This likely means the package was not built correctly.`);
    }
    return found;
}

export interface InstallSkillOptions {
    /** Project directory to install into. Ignored when `global` is set. Default: cwd. */
    dir?: string;
    /** Install into the user's home directory instead of a project. */
    global?: boolean;
    /** Default: every target. */
    targets?: SkillTarget[];
    /** Overwrite a SKILL.md that differs from the shipped one. */
    force?: boolean;
    /** Test seams. */
    sourceFile?: string;
    homeDir?: string;
}

export interface InstalledSkill {
    target: SkillTarget;
    path: string;
    status: 'written' | 'unchanged';
}

export interface InstallSkillResult {
    installed: InstalledSkill[];
    nextAction: string;
}

/**
 * Copies the shipped SKILL.md into each target's `<base>/<target dir>/portal-private-widget/`.
 * Refuses to replace a locally modified copy unless `force` is set, and checks
 * every target before writing any, so a refusal never leaves a partial install.
 */
export function installSkill(options: InstallSkillOptions = {}): InstallSkillResult {
    const source = fs.readFileSync(options.sourceFile ?? resolveSkillFile());
    const base = options.global ? (options.homeDir ?? os.homedir()) : path.resolve(options.dir ?? process.cwd());
    const targets = options.targets && options.targets.length > 0 ? options.targets : (Object.keys(SKILL_TARGETS) as SkillTarget[]);

    const planned = targets.map(target => {
        const file = path.join(base, SKILL_TARGETS[target], SKILL_NAME, 'SKILL.md');
        const existing = fs.existsSync(file) ? fs.readFileSync(file) : null;
        return { target, file, unchanged: existing !== null && existing.equals(source), conflict: existing !== null && !existing.equals(source) };
    });

    const conflicts = planned.filter(item => item.conflict);
    if (conflicts.length > 0 && !options.force) {
        throw new Error(
            `${conflicts.map(item => item.file).join(', ')} already exists with different content. ` +
                'Re-run with --force to replace it with the version shipped in this CLI.'
        );
    }

    const installed: InstalledSkill[] = planned.map(item => {
        if (!item.unchanged) {
            fs.mkdirSync(path.dirname(item.file), { recursive: true });
            fs.writeFileSync(item.file, source);
        }
        return { target: item.target, path: item.file, status: item.unchanged ? 'unchanged' : 'written' };
    });

    const pathsWith = (status: InstalledSkill['status']) => installed.filter(item => item.status === status).map(item => item.path);
    return {
        installed,
        nextAction: nextAction('skill-install', { skillPaths: pathsWith('written'), unchangedSkillPaths: pathsWith('unchanged') })
    };
}
