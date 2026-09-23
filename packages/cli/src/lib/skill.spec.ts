import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { installSkill, resolveSkillFile, SKILL_NAME } from './skill';

describe('resolveSkillFile', () => {
    it('finds the repository skill, a valid Agent Skill whose name matches its folder', () => {
        const file = resolveSkillFile();
        expect(path.basename(path.dirname(file))).toBe(SKILL_NAME);
        const text = fs.readFileSync(file, 'utf8');
        expect(text).toMatch(new RegExp(`^---\\r?\\nname: ${SKILL_NAME}\\r?\\ndescription: .+\\r?\\n---`));
    });

    it('prefers the build-time copy inside the package over the repository copy', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-widget-skill-root-'));
        try {
            const shipped = path.join(root, 'skills', SKILL_NAME, 'SKILL.md');
            fs.mkdirSync(path.dirname(shipped), { recursive: true });
            fs.writeFileSync(shipped, 'shipped');
            expect(resolveSkillFile(root)).toBe(shipped);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('throws a clear error when neither copy exists', () => {
        expect(() => resolveSkillFile(path.join(os.tmpdir(), 'no-such-package-root', 'a', 'b'))).toThrow(/Skill file not found/);
    });
});

describe('installSkill', () => {
    let tempDir: string;
    let sourceFile: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-widget-skill-'));
        sourceFile = path.join(tempDir, 'source.md');
        fs.writeFileSync(sourceFile, '---\nname: portal-private-widget\n---\nv1\n');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const project = () => path.join(tempDir, 'project');
    const claudeFile = () => path.join(project(), '.claude', 'skills', SKILL_NAME, 'SKILL.md');
    const agentsFile = () => path.join(project(), '.agents', 'skills', SKILL_NAME, 'SKILL.md');

    it('writes the skill for every target by default and names each path in the next action', () => {
        const result = installSkill({ dir: project(), sourceFile });

        expect(fs.readFileSync(claudeFile(), 'utf8')).toContain('v1');
        expect(fs.readFileSync(agentsFile(), 'utf8')).toContain('v1');
        expect(result.installed.map(item => item.status)).toEqual(['written', 'written']);
        expect(result.nextAction).toContain(claudeFile());
        expect(result.nextAction).toContain(agentsFile());
    });

    it('limits the install to the requested targets', () => {
        installSkill({ dir: project(), sourceFile, targets: ['claude'] });

        expect(fs.existsSync(claudeFile())).toBe(true);
        expect(fs.existsSync(agentsFile())).toBe(false);
    });

    it('installs into the home directory with global', () => {
        const home = path.join(tempDir, 'home');
        installSkill({ global: true, homeDir: home, sourceFile, targets: ['claude'] });

        expect(fs.existsSync(path.join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md'))).toBe(true);
    });

    it('reports an identical existing copy as unchanged', () => {
        installSkill({ dir: project(), sourceFile });
        const again = installSkill({ dir: project(), sourceFile });

        expect(again.installed.map(item => item.status)).toEqual(['unchanged', 'unchanged']);
        expect(again.nextAction).toContain(`Up to date ${claudeFile()}`);
        expect(again.nextAction).not.toContain('Installed');
    });

    it('refuses to replace a modified copy without force, and writes nothing in that case', () => {
        installSkill({ dir: project(), sourceFile, targets: ['claude'] });
        fs.writeFileSync(claudeFile(), 'local edits');

        expect(() => installSkill({ dir: project(), sourceFile })).toThrow(/--force/);
        expect(fs.readFileSync(claudeFile(), 'utf8')).toBe('local edits');
        expect(fs.existsSync(agentsFile())).toBe(false);
    });

    it('replaces a modified copy with force', () => {
        installSkill({ dir: project(), sourceFile, targets: ['claude'] });
        fs.writeFileSync(claudeFile(), 'local edits');

        installSkill({ dir: project(), sourceFile, force: true });

        expect(fs.readFileSync(claudeFile(), 'utf8')).toContain('v1');
    });
});
