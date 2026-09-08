import { SspWidgetConfig } from './config';

/**
 * Shape of the ZIP's own `widget-metadata.json` -- a structural mirror of
 * `WidgetMetadataImportDto` (not imported, so no Angular library reaches the
 * shipped runtime). Unrelated to `widgets/embed-widget/widget-metadata.json`,
 * which is the build-side registry format that happens to share the filename.
 */
export interface WidgetMetadataJson {
    tagName: string;
    name: SspWidgetConfig['name'];
    description: SspWidgetConfig['description'];
    changes: SspWidgetConfig['changes'];
    tags: string[];
    defaultSize: { columns: number; rows: number };
    angularVersion: number;
    authenticated: boolean;
    dependencies: { name: string; dependency: string }[];
    fileFullName?: string;
    fileLightName?: string;
}

/**
 * `fileFullName`/`fileLightName` are the single authority for both the
 * metadata fields and the archive entry names `pack.ts` writes -- a rename
 * can never desynchronise the two.
 */
export function buildWidgetMetadata(config: SspWidgetConfig): WidgetMetadataJson {
    return {
        tagName: config.tagName,
        name: config.name,
        description: config.description,
        changes: config.changes,
        tags: config.tags,
        defaultSize: config.defaultSize,
        angularVersion: config.angularVersion,
        authenticated: config.authenticated,
        dependencies: config.dependencies,
        fileFullName: `${config.tagName}-${config.version}-full.js`,
        fileLightName: `${config.tagName}-${config.version}-light.js`
    };
}
