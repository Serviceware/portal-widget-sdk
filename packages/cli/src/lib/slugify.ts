import { isValidCustomElementName } from './rules';

const MAX_TAG_LENGTH = 100;

// Unicode combining diacritical marks block (0x0300-0x036F), left behind by
// String.prototype.normalize('NFKD') once a base letter and its accent are
// split apart -- e.g. a display name with an umlaut. Expressed as numeric
// code-point bounds (not a \u regex escape) so the source stays plain ASCII.
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;
const ASCII_MAX = 0x7f;

/**
 * Best-effort ASCII transliteration for the common Latin diacritics a
 * display name might carry. Anything left non-ASCII after decomposition is
 * simply dropped -- there is no legitimate custom element name character
 * outside `[a-z0-9-]` to preserve it for.
 */
function toAsciiLower(input: string): string {
    const decomposed = input.normalize('NFKD');
    const kept = Array.from(decomposed).filter(char => {
        const code = char.codePointAt(0) ?? 0;
        const isCombiningMark = code >= COMBINING_MARKS_START && code <= COMBINING_MARKS_END;
        return !isCombiningMark && code <= ASCII_MAX;
    });
    return kept.join('').toLowerCase();
}

/**
 * Display name -> `ssp-`-namespaced tag a browser will actually accept as a
 * custom element name (T-02-05). Every derived widget tag in this package
 * carries the `ssp-` prefix, which also guarantees the two properties
 * `isValidCustomElementName` requires that the Portal's own field does not
 * enforce: a lowercase-letter start and at least one hyphen. The
 * postcondition is asserted, not hoped for -- a wizard that could emit an
 * invalid tag would be shipping the exact defect this phase exists to catch.
 */
export function slugifyTag(displayName: string): string {
    const ascii = toAsciiLower(displayName);
    const hyphenated = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = hyphenated || 'widget';

    let tag = `ssp-${base}`;
    if (tag.length > MAX_TAG_LENGTH) {
        tag = tag.slice(0, MAX_TAG_LENGTH).replace(/-+$/g, '');
    }

    if (!isValidCustomElementName(tag)) {
        throw new Error(`slugifyTag derived an invalid custom element name "${tag}" from "${displayName}".`);
    }

    return tag;
}
