import * as fs from 'node:fs';
import * as path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { MultilanguageValue, SspWidgetConfig } from './config';
import { WidgetMetadataJson } from './metadata';
import { CONFIG_FILE_NAME, ZIP_SIDECAR_ENTRY_NAME } from './package-identity';
import { extractPreludeTag } from './prelude';
import { isSupportedFileName, isValidCustomElementName, isValidLanguageTag, isValidPortalTag, languageCodeFromFileName, RULES } from './rules';

export type ValidationSeverity = 'error' | 'warning';

/**
 * Codes shared with the Portal dialog's own `WidgetDialogFieldError` union
 * (`required`, `invalidTagName`, `maxLengthExceeded`, `invalidTag`,
 * `maxReached`, `invalidNumber`, `englishRequired`, `size_invalid`,
 * `format_invalid`, `file_name_invalid`, `invalidJson`) plus codes the
 * dialog has no counterpart for, because it does not perform the check at
 * all: `notACustomElementName`, `invalidLanguageFileName`, `empty`,
 * `fileNotFound`, `notFlat`, `tagPreludeMismatch`, `preludeMissing`.
 */
export type ValidationIssueCode =
    | 'required'
    | 'invalidTagName'
    | 'maxLengthExceeded'
    | 'invalidTag'
    | 'maxReached'
    | 'invalidNumber'
    | 'englishRequired'
    | 'size_invalid'
    | 'format_invalid'
    | 'file_name_invalid'
    | 'invalidJson'
    | 'notACustomElementName'
    | 'invalidLanguageFileName'
    | 'empty'
    | 'fileNotFound'
    | 'notFlat'
    | 'tagPreludeMismatch'
    | 'preludeMissing';

export interface ValidationIssue {
    severity: ValidationSeverity;
    field: string;
    code: ValidationIssueCode;
    message: string;
}

function issue(
    field: string,
    code: ValidationIssueCode,
    message: string,
    severity: ValidationSeverity = 'error'
): ValidationIssue {
    return { severity, field, code, message };
}

function tagNameIssue(tagName: string): ValidationIssue | null {
    const trimmed = tagName.trim();

    if (!trimmed) {
        return issue('tagName', 'required', 'tagName is required.');
    }

    if (trimmed.length > RULES.tagName.maxLength) {
        return issue('tagName', 'maxLengthExceeded', `tagName must be ${RULES.tagName.maxLength} characters or fewer.`);
    }

    if (!isValidPortalTag(trimmed)) {
        return issue(
            'tagName',
            'invalidTagName',
            `tagName "${trimmed}" must match ${RULES.tagName.pattern} -- lowercase letters, digits and hyphens only (the Portal upload dialog's own rule).`
        );
    }

    if (!isValidCustomElementName(trimmed)) {
        return issue(
            'tagName',
            'notACustomElementName',
            `tagName "${trimmed}" passes the Portal dialog's own tagName pattern but is not a valid custom element name -- customElements.define() requires a lowercase-letter start, at least one hyphen, no trailing hyphen, and rejects the reserved SVG/MathML hyphenated names. It will import cleanly and then throw at mount time (PACK-06, D-16).`
        );
    }

    return null;
}

function multilanguageIssue(
    field: string,
    data: MultilanguageValue[] | undefined,
    maxLength: number
): ValidationIssue | null {
    if (!Array.isArray(data) || data.length === 0) {
        return issue(field, 'required', `${field} is required -- at least an English ("en") entry.`);
    }

    const englishEntry = data.find(item => item.language === 'en');
    if (!englishEntry?.value?.trim()) {
        return issue(field, 'englishRequired', `${field} must have a non-blank English ("en") entry.`);
    }

    const tooLong = data.find(item => item.value && item.value.length > maxLength);
    if (tooLong) {
        return issue(
            field,
            'maxLengthExceeded',
            `${field} entry for "${tooLong.language}" exceeds ${maxLength} characters.`
        );
    }

    return null;
}

function tagsIssue(tags: string[]): ValidationIssue | null {
    if (tags.length > RULES.tags.max) {
        return issue('tags', 'maxReached', `tags may contain at most ${RULES.tags.max} entries.`);
    }

    const invalid = tags.find(tag => !(RULES.tags.pattern.test(tag) && tag.length <= RULES.tags.maxLength));
    if (invalid !== undefined) {
        return issue(
            'tags',
            'invalidTag',
            `tag "${invalid}" must match ${RULES.tags.pattern} and be ${RULES.tags.maxLength} characters or fewer.`
        );
    }

    return null;
}

function dependenciesIssue(dependencies: { name: string; dependency: string }[]): ValidationIssue | null {
    if (dependencies.length > RULES.dependencies.max) {
        return issue(
            'dependencies',
            'maxReached',
            `dependencies may contain at most ${RULES.dependencies.max} entries.`
        );
    }

    const invalid = dependencies.some(dependency => !dependency.name?.trim() || !dependency.dependency?.trim());
    if (invalid) {
        return issue('dependencies', 'required', 'each dependency requires both a non-blank name and dependency value.');
    }

    return null;
}

function numberRangeIssue(field: string, value: number, min: number, max: number): ValidationIssue | null {
    return Number.isInteger(value) && value >= min && value <= max
        ? null
        : issue(field, 'invalidNumber', `${field} must be an integer between ${min} and ${max}.`);
}

/**
 * The fields `portal-widget.json` and the ZIP's own `widget-metadata.json`
 * share exactly (D-14) -- `SspWidgetConfig` and `WidgetMetadataJson` both
 * satisfy this shape, so `validateConfig` and `validateZip` can run the
 * identical field-rule set and hold a config and an already-built archive to
 * exactly the same standard.
 */
interface ValidatableMetadataFields {
    tagName: string;
    name: MultilanguageValue[];
    description: MultilanguageValue[];
    changes: MultilanguageValue[];
    tags: string[];
    dependencies: { name: string; dependency: string }[];
    defaultSize: { columns: number; rows: number };
    angularVersion: number;
}

/**
 * Walks the fields in the same order `buildValidationState` does (D-14), so
 * a reader comparing the two can follow along.
 */
function collectMetadataFieldIssues(fields: ValidatableMetadataFields): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const tagIssue = tagNameIssue(fields.tagName ?? '');
    if (tagIssue) issues.push(tagIssue);

    const nameIssue = multilanguageIssue('name', fields.name, RULES.name.maxLength);
    if (nameIssue) issues.push(nameIssue);

    const descriptionIssue = multilanguageIssue('description', fields.description, RULES.description.maxLength);
    if (descriptionIssue) issues.push(descriptionIssue);

    const changesIssue = multilanguageIssue('changes', fields.changes, RULES.changes.maxLength);
    if (changesIssue) issues.push(changesIssue);

    const tagsIssueResult = tagsIssue(fields.tags ?? []);
    if (tagsIssueResult) issues.push(tagsIssueResult);

    const dependenciesIssueResult = dependenciesIssue(fields.dependencies ?? []);
    if (dependenciesIssueResult) issues.push(dependenciesIssueResult);

    const columnsIssue = numberRangeIssue(
        'defaultSize.columns',
        fields.defaultSize?.columns,
        RULES.defaultColumns.min,
        RULES.defaultColumns.max
    );
    if (columnsIssue) issues.push(columnsIssue);

    const rowsIssue = numberRangeIssue(
        'defaultSize.rows',
        fields.defaultSize?.rows,
        RULES.defaultRows.min,
        RULES.defaultRows.max
    );
    if (rowsIssue) issues.push(rowsIssue);

    const angularVersionIssue = numberRangeIssue(
        'angularVersion',
        fields.angularVersion,
        RULES.angularVersion.min,
        RULES.angularVersion.max
    );
    if (angularVersionIssue) issues.push(angularVersionIssue);

    return issues;
}

/**
 * Shared by `validateConfig` (bytes read from disk) and `validateZip` (bytes
 * read from the archive) so the language-file size/parse/name rules are
 * expressed exactly once and both entry points are held to the same
 * standard.
 */
function languageFileContentIssues(field: string, fileName: string, bytes: Buffer): ValidationIssue[] {
    if (bytes.length > RULES.languageFile.maxSizeMb * 1024 * 1024) {
        return [
            issue(
                field,
                'size_invalid',
                `${fileName} exceeds the enforced ${RULES.languageFile.maxSizeMb} MB limit (PortalValidators.validateJSONFile). The Portal dialog's file picker advertises a larger figure, but that figure only gates the picker and never gates the Upload button -- this is the ENFORCED limit.`
            )
        ];
    }

    if (bytes.length === 0) {
        return [issue(field, 'empty', `${fileName} is empty.`)];
    }

    try {
        JSON.parse(bytes.toString('utf8'));
    } catch {
        return [issue(field, 'invalidJson', `${fileName} content is not parseable JSON.`)];
    }

    const languageCode = languageCodeFromFileName(fileName);
    if (!isValidLanguageTag(languageCode)) {
        return [
            issue(
                field,
                'invalidLanguageFileName',
                `"${fileName}" does not resolve to a valid language tag -- the Portal silently drops files like this from the import without reporting anything.`
            )
        ];
    }

    return [];
}

function logoIssues(logo: string | undefined, configDir: string): ValidationIssue[] {
    if (!logo) {
        return [];
    }

    const resolved = path.resolve(configDir, logo);
    if (!fs.existsSync(resolved)) {
        return [issue('logo', 'fileNotFound', `logo file not found at ${resolved}.`)];
    }

    if (!isSupportedFileName(path.basename(resolved))) {
        return [
            issue('logo', 'file_name_invalid', `${path.basename(resolved)} contains characters unsupported by the Portal's storage layer.`)
        ];
    }

    const stats = fs.statSync(resolved);
    if (stats.size > RULES.logo.maxSizeMb * 1024 * 1024) {
        return [
            issue(
                'logo',
                'size_invalid',
                `logo exceeds the enforced ${RULES.logo.maxSizeMb} MB limit (PortalValidators.validateImageFile).`
            )
        ];
    }

    return [];
}

function languageFileIssues(languageFiles: string[] | undefined, configDir: string): ValidationIssue[] {
    if (!languageFiles?.length) {
        return [];
    }

    const issues: ValidationIssue[] = [];
    languageFiles.forEach((languageFile, index) => {
        const field = `languageFiles[${index}]`;
        const resolved = path.resolve(configDir, languageFile);

        if (!fs.existsSync(resolved)) {
            issues.push(issue(field, 'fileNotFound', `language file not found at ${resolved}.`));
            return;
        }

        const bytes = fs.readFileSync(resolved);
        issues.push(...languageFileContentIssues(field, path.basename(resolved), bytes));
    });

    return issues;
}

/**
 * Deliberately does NOT implement the dialog's `duplicateTagName` check --
 * it needs the list of widgets already installed on a specific Portal,
 * which this CLI cannot know (see README.md).
 */
export function validateConfig(config: SspWidgetConfig, configDir: string): ValidationIssue[] {
    const issues = collectMetadataFieldIssues({
        tagName: config.tagName ?? '',
        name: config.name,
        description: config.description,
        changes: config.changes,
        tags: config.tags ?? [],
        dependencies: config.dependencies ?? [],
        defaultSize: config.defaultSize,
        angularVersion: config.angularVersion
    });

    issues.push(...logoIssues(config.logo, configDir));
    issues.push(...languageFileIssues(config.languageFiles, configDir));

    return issues;
}

/** `unzipSync` decompresses fully into memory (T-02-08) -- refuse before opening or inspecting. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function readBundleTag(unzipped: Record<string, Uint8Array>, entryName: string | undefined): string | null {
    if (!entryName || !unzipped[entryName]) {
        return null;
    }
    return extractPreludeTag(unzipped[entryName]);
}

function sidecarTemplate(unzipped: Record<string, Uint8Array>): string | null {
    const sidecarBytes = unzipped[ZIP_SIDECAR_ENTRY_NAME];
    if (!sidecarBytes) {
        return null;
    }

    try {
        const parsed = JSON.parse(strFromU8(sidecarBytes)) as { template?: unknown };
        return typeof parsed.template === 'string' ? parsed.template : null;
    } catch {
        return null;
    }
}

function tagPreludeIssues(unzipped: Record<string, Uint8Array>, metadata: WidgetMetadataJson): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const bundleTags: [string, string | null][] = [
        ['fileFullName', readBundleTag(unzipped, metadata.fileFullName)],
        ['fileLightName', readBundleTag(unzipped, metadata.fileLightName)]
    ];

    for (const [field, tag] of bundleTags) {
        if (tag && tag !== metadata.tagName) {
            issues.push(
                issue(
                    'tagName',
                    'tagPreludeMismatch',
                    `metadata tagName "${metadata.tagName}" does not match the tag "${tag}" baked into the ${field} bundle's own prelude -- the Portal never checks this coupling; the archive will import cleanly and then render an empty tile with no console error (PACK-07, D-15).`
                )
            );
        }
    }

    const [, fullTag] = bundleTags[0];
    const [, lightTag] = bundleTags[1];
    if (!fullTag && !lightTag) {
        if (sidecarTemplate(unzipped) === 'embed') {
            issues.push(
                issue(
                    'tagName',
                    'preludeMissing',
                    'the sidecar declares the embed template but neither bundle carries a prelude tag to compare against.'
                )
            );
        } else {
            issues.push(
                issue(
                    'tagName',
                    'preludeMissing',
                    'neither bundle carries a prelude tag -- this archive may predate this tool or register its custom element at build time; the tagName/prelude coupling could not be checked.',
                    'warning'
                )
            );
        }
    }

    return issues;
}

function bundleEntryIssues(field: string, entryName: string | undefined, unzipped: Record<string, Uint8Array>): ValidationIssue[] {
    if (!entryName) {
        return [
            issue(
                field,
                'required',
                `metadata.${field} is required -- the upload form requires both bundles (D-13).`
            )
        ];
    }

    const entryBytes = unzipped[entryName];
    if (!entryBytes) {
        return [issue(field, 'fileNotFound', `${field} names "${entryName}", which is not present in the archive.`)];
    }

    const issues: ValidationIssue[] = [];
    if (entryBytes.length > RULES.jsFile.maxSizeMb * 1024 * 1024) {
        issues.push(
            issue(field, 'size_invalid', `${entryName} exceeds the enforced ${RULES.jsFile.maxSizeMb} MB limit (PortalValidators.validateJSFile).`)
        );
    }
    if (!isSupportedFileName(entryName)) {
        issues.push(issue(field, 'file_name_invalid', `${entryName} contains characters unsupported by the Portal's storage layer.`));
    }

    return issues;
}

function zipLogoIssues(unzipped: Record<string, Uint8Array>): ValidationIssue[] {
    const logoBytes = unzipped['logo.png'];
    if (!logoBytes) {
        return [];
    }

    if (logoBytes.length > RULES.logo.maxSizeMb * 1024 * 1024) {
        return [
            issue('logo', 'size_invalid', `logo.png exceeds the enforced ${RULES.logo.maxSizeMb} MB limit (PortalValidators.validateImageFile).`)
        ];
    }

    return [];
}

/**
 * Every other `.json` entry is a language file to the Portal's own reader
 * (`widget-package.service.ts:57-59`). A flat entry literally named
 * `portal-widget.json` -- this tool's own config filename without the `.txt`
 * sidecar suffix -- is special-cased to always error: its stem passes
 * `Intl.getCanonicalLocales` (C2), so the generic language-tag check alone
 * would let it through as a "valid" bogus locale.
 */
function zipLanguageFileIssues(unzipped: Record<string, Uint8Array>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const languageEntryNames = Object.keys(unzipped)
        .filter(name => name.toLowerCase().endsWith('.json'))
        .filter(name => name !== 'widget-metadata.json');

    for (const name of languageEntryNames) {
        if (name.toLowerCase() === CONFIG_FILE_NAME.toLowerCase()) {
            issues.push(
                issue(
                    name,
                    'invalidLanguageFileName',
                    `"${name}" is this tool's own config filename packed flat, without the ${ZIP_SIDECAR_ENTRY_NAME} sidecar suffix -- the Portal's unpack() treats any other .json entry as a translation file and would import it as a genuine (bogus) translation.`
                )
            );
            continue;
        }

        issues.push(...languageFileContentIssues(name, name, Buffer.from(unzipped[name])));
    }

    return issues;
}

/**
 * Opens a built ZIP the same way the Portal's own reader does (`unzipSync`)
 * and runs the same field-rule set `validateConfig` runs against its own
 * `widget-metadata.json`, plus the checks that only make sense once an
 * archive exists: flat-entry names, the two bundle files, `logo.png`, every
 * other `.json` as a language file, and the tagName/prelude coupling the
 * Portal never checks at all (PACK-07, D-15).
 */
export function validateZip(zipBytes: Uint8Array): ValidationIssue[] {
    if (zipBytes.length > MAX_ARCHIVE_BYTES) {
        throw new Error(
            `Refusing to open a ${(zipBytes.length / 1024 / 1024).toFixed(1)} MB archive -- over the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB cap this command will inspect.`
        );
    }

    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(zipBytes);
    } catch (error) {
        throw new Error(`Could not open the archive: ${(error as Error).message}`);
    }

    const totalUncompressed = Object.values(unzipped).reduce((sum, entry) => sum + entry.length, 0);
    if (totalUncompressed > MAX_ARCHIVE_BYTES) {
        throw new Error(
            `Refusing to inspect an archive that expands to over ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB uncompressed.`
        );
    }

    const issues: ValidationIssue[] = [];

    for (const name of Object.keys(unzipped)) {
        if (name.includes('/') || name.includes('\\')) {
            issues.push(
                issue(
                    name,
                    'notFlat',
                    `entry "${name}" is not flat -- the Portal's reader looks entries up by bare name, so a nested entry is invisible to it.`
                )
            );
        }
    }

    const metadataBytes = unzipped['widget-metadata.json'];
    if (!metadataBytes) {
        issues.push(issue('widget-metadata.json', 'fileNotFound', 'widget-metadata.json missing'));
        return issues;
    }

    let metadata: WidgetMetadataJson;
    try {
        metadata = JSON.parse(strFromU8(metadataBytes)) as WidgetMetadataJson;
    } catch (error) {
        issues.push(
            issue('widget-metadata.json', 'invalidJson', `widget-metadata.json content is not parseable JSON: ${(error as Error).message}`)
        );
        return issues;
    }

    issues.push(...collectMetadataFieldIssues(metadata));
    issues.push(...bundleEntryIssues('fileFullName', metadata.fileFullName, unzipped));
    issues.push(...bundleEntryIssues('fileLightName', metadata.fileLightName, unzipped));
    issues.push(...zipLogoIssues(unzipped));
    issues.push(...zipLanguageFileIssues(unzipped));
    issues.push(...tagPreludeIssues(unzipped, metadata));

    return issues;
}

/**
 * The terminal report (D-14): errors first, then warnings, one line each
 * naming the field, the severity and the message, closed by a summary count.
 */
export function formatIssues(issues: ValidationIssue[]): string {
    if (issues.length === 0) {
        return 'No problems found.';
    }

    const errors = issues.filter(item => item.severity === 'error');
    const warnings = issues.filter(item => item.severity === 'warning');

    const lines = [...errors, ...warnings].map(
        item => `[${item.severity}] ${item.field}: ${item.message} (${item.code})`
    );
    lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);

    return lines.join('\n');
}
