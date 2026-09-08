/**
 * The Serviceware icon (the round "cookie" mark), traced with potrace into a single path.
 * `serviceware-cookie.svg` in the example root is the source of truth; build.mjs inlines it as text.
 * The tracing is black, so the scene colours it with the configurable icon colour instead.
 */
import cookieSvg from '../serviceware-cookie.svg';

export const LOGO_SVG: string = cookieSvg;

/** Serviceware orange; default for the configurable icon colour. */
export const ICON_FILL = '#ff8300';
