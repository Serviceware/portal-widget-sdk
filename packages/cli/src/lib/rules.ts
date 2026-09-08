/**
 * Mirrored copies of the Portal upload dialog's ENFORCED validation rules
 * (D-14). Every value below cites the exact Portal source file it was copied
 * from. `rules-drift.spec.ts` re-reads those source files from disk on every
 * test run and fails the build the moment a mirrored value no longer appears
 * there -- this file must never be trusted blind.
 *
 * Deliberately free of Angular and Portal-library imports: these are
 * mirrors, not references, so the shipped CLI has no dependency on the
 * Portal (see README.md).
 */

export const RULES = {
    // widget-management-add-private-widget-dialog.component.ts:64-69 (module constants)
    tagName: {
        maxLength: 100, // MAX_TAG_NAME_LENGTH
        pattern: /^[a-z0-9-]+$/ // getTagNameError :651; PortalValidators.tagNameValidator (portal-validators.ts:164)
    },
    name: { maxLength: 100, englishMandatory: true }, // MAX_NAME_LENGTH
    description: { maxLength: 4000, englishMandatory: true }, // MAX_DESCRIPTION_LENGTH
    changes: { maxLength: 4000, englishMandatory: true }, // MAX_CHANGES_LENGTH
    tags: {
        max: 10, // MAX_TAGS
        pattern: /^[a-zA-Z0-9-]+$/, // PortalValidators.isValidTag (portal-validators.ts:229)
        maxLength: 100 // PortalValidators.isValidTag (portal-validators.ts:230)
    },
    dependencies: { max: 10 }, // MAX_DEPENDENCIES
    defaultColumns: { min: 1, max: 12 }, // buildValidationState :622
    defaultRows: { min: 1, max: 12 }, // buildValidationState :623
    angularVersion: { min: 0, max: 99 }, // buildValidationState :624
    logo: { maxSizeMb: 2 }, // PortalValidators.validateImageFile (portal-validators.ts:110)
    jsFile: { maxSizeMb: 10 }, // PortalValidators.validateJSFile (portal-validators.ts:103)
    // ENFORCED 1 MB (portal-validators.ts:117 -- validateJSONFile). The
    // dialog's own `languageFilesConfig.maxFileSize` (:137) advertises 5 MB,
    // but that only gates the file picker's own toast, never the Upload
    // button. A 2 MB file passes the picker and then silently disables
    // Upload with nothing shown to explain it (C3).
    languageFile: { maxSizeMb: 1 },
    languageTag: { primarySubtagPattern: /^[A-Za-z]{2,3}$/ }, // dialog :754 (isValidLanguageTag)
    // minio object-name rule, PortalValidators.findUnsupportedCharacters (portal-validators.ts:24)
    minioFilename: { pattern: /^[a-zA-Z0-9! _.*'()-]+(\/[a-zA-Z0-9! _.*'()-]+)*$/ }
} as const;

/**
 * The reserved hyphenated Custom Elements names the spec carves out for SVG
 * and MathML built-ins. Each of these passes the dialog's own
 * `/^[a-z0-9-]+$/` pattern cleanly and then throws the instant a browser
 * tries `customElements.define(name, ...)`.
 */
const RESERVED_CUSTOM_ELEMENT_NAMES = new Set([
    'annotation-xml',
    'color-profile',
    'font-face',
    'font-face-src',
    'font-face-uri',
    'font-face-format',
    'font-face-name',
    'missing-glyph'
]);

/** Mirrors the dialog's own `getTagNameError` pattern check (D-14). */
export function isValidPortalTag(tag: string): boolean {
    return RULES.tagName.pattern.test(tag);
}

/**
 * The rule the Portal does NOT have (D-16, PACK-06). A tag can pass
 * `isValidPortalTag` -- the dialog's own field validator -- and still throw
 * the instant a browser tries to register it as a custom element: the spec
 * requires a lowercase-letter start, at least one hyphen, no trailing
 * hyphen, and forbids a short list of reserved hyphenated names.
 */
export function isValidCustomElementName(tag: string): boolean {
    if (!isValidPortalTag(tag)) {
        return false;
    }
    if (!/^[a-z]/.test(tag)) {
        return false;
    }
    if (!tag.includes('-')) {
        return false;
    }
    if (tag.endsWith('-')) {
        return false;
    }
    return !RESERVED_CUSTOM_ELEMENT_NAMES.has(tag);
}

/** Mirrors the dialog's own private `isValidLanguageTag` exactly (:752-764). */
export function isValidLanguageTag(tag: string): boolean {
    const [primarySubtag] = tag.split('-');
    if (!RULES.languageTag.primarySubtagPattern.test(primarySubtag ?? '')) {
        return false;
    }

    try {
        const result = Intl.getCanonicalLocales(tag);
        return Array.isArray(result) && result.length > 0;
    } catch {
        return false;
    }
}

/** Mirrors the dialog's own private `extractLanguageCode` exactly (:766-770). */
export function languageCodeFromFileName(fileName: string): string {
    const baseName = fileName.split(/[/\\]/).pop() ?? fileName;
    return baseName.toLowerCase().endsWith('.json') ? baseName.slice(0, -5) : baseName;
}

/** Mirrors `PortalValidators.isFileNameSupported` (portal-validators.ts:15-17). */
export function isSupportedFileName(fileName: string): boolean {
    if (!fileName) {
        return true;
    }
    return fileName.split('').every(char => RULES.minioFilename.pattern.test(char));
}
