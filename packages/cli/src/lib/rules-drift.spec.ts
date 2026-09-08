import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACKAGE_ROOT } from '../package-root';

/**
 * Reads the two Portal source files this package mirrors rules from
 * (rules.ts). In the SSP_Portal monorepo this spec read them directly off
 * disk; in this repository it reads the verbatim snapshots under
 * `reference/ssp-portal/`, so it fails the moment a snapshot is refreshed
 * with a changed Portal limit and rules.ts was not updated alongside it.
 * Refresh the snapshots from SSP_Portal whenever the Portal changes (see
 * reference/ssp-portal/README.md).
 */
const REFERENCE_DIR = path.resolve(PACKAGE_ROOT, '..', '..', 'reference', 'ssp-portal');
const DIALOG_PATH = path.join(REFERENCE_DIR, 'widget-management-add-private-widget-dialog.component.ts');
const PORTAL_VALIDATORS_PATH = path.join(REFERENCE_DIR, 'portal-validators.ts');

describe('rules-drift: mirrored constants in rules.ts still match the Portal source they were copied from', () => {
    let dialogSource: string;
    let validatorsSource: string;

    beforeAll(() => {
        dialogSource = fs.readFileSync(DIALOG_PATH, 'utf8');
        validatorsSource = fs.readFileSync(PORTAL_VALIDATORS_PATH, 'utf8');
    });

    it('dialog module-level constants are unchanged', () => {
        expect(dialogSource).toContain('const MAX_TAGS = 10;');
        expect(dialogSource).toContain('const MAX_DEPENDENCIES = 10;');
        expect(dialogSource).toContain('const MAX_TAG_NAME_LENGTH = 100;');
        expect(dialogSource).toContain('const MAX_NAME_LENGTH = 100;');
        expect(dialogSource).toContain('const MAX_DESCRIPTION_LENGTH = 4000;');
        expect(dialogSource).toContain('const MAX_CHANGES_LENGTH = 4000;');
    });

    it('the three PortalValidators.validateFile size ceilings are unchanged (10 JS, 2 image, 1 JSON)', () => {
        expect(validatorsSource).toContain("'application/javascript,text/javascript', 10, false");
        expect(validatorsSource).toContain("'image/png,image/jpeg,image/gif', 2, false");
        expect(validatorsSource).toContain("'application/json', 1, false");
    });

    it('the lowercase tagName pattern is unchanged in both the dialog and portal-validators', () => {
        expect(dialogSource).toContain('/^[a-z0-9-]+$/');
        expect(validatorsSource).toContain('/^[a-z0-9-]+$/');
    });

    it('the isValidTag pattern and its 100-character bound are unchanged', () => {
        expect(validatorsSource).toContain('/^[a-zA-Z0-9-]+$/');
        expect(validatorsSource).toContain('tag.length <= 100');
    });

    it('the language primary-subtag pattern is unchanged', () => {
        expect(dialogSource).toContain('/^[A-Za-z]{2,3}$/');
    });

    it('the column/row and angularVersion numeric bounds in buildValidationState are unchanged', () => {
        expect(dialogSource).toContain('this.defaultColumns(), 1, 12');
        expect(dialogSource).toContain('this.defaultRows(), 1, 12');
        expect(dialogSource).toContain('this.angularVersion(), 0, 99');
    });
});
