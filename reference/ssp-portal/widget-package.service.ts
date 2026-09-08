import { Injectable } from '@angular/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { WidgetMetadataExportDto, WidgetMetadataImportDto } from '../../models';

export type PackageFiles = {
    full?: File;
    light?: File;
    languages?: File[];
    logo?: File;
};

@Injectable({ providedIn: 'root' })
export class WidgetPackageService {
    async pack(data: WidgetMetadataExportDto, files: PackageFiles): Promise<File> {
        const entries: Record<string, Uint8Array> = {};

        const widgetData: WidgetMetadataImportDto = {
            ...data,
            fileFullName: files.full?.name,
            fileLightName: files.light?.name
        };

        entries['widget-metadata.json'] = new Uint8Array(strToU8(JSON.stringify(widgetData, null, 2)));

        if (files.full) entries[files.full.name] = await this.fileToBytes(files.full);
        if (files.light) entries[files.light.name] = await this.fileToBytes(files.light);
        if (files.logo) entries['logo.png'] = await this.fileToBytes(files.logo);
        if (files.languages?.length) {
            for (const langFile of files.languages) {
                entries[langFile.name] = await this.fileToBytes(langFile);
            }
        }
        const zipped = zipSync(entries, { level: 0 });
        const buffer = new Uint8Array(zipped);
        return new File([buffer], `${data.tagName}.zip`, { type: 'application/zip' });
    }

    async unpack(zipFile: File): Promise<{ data: WidgetMetadataImportDto; files: PackageFiles }> {
        const bytes = new Uint8Array(await zipFile.arrayBuffer());
        const unzipped = unzipSync(bytes);

        const dataEntry = unzipped['widget-metadata.json'];
        if (!dataEntry) throw new Error('widget-metadata.json missing');
        const data = JSON.parse(strFromU8(dataEntry)) as WidgetMetadataImportDto;

        const toFile = (name: string, type: string): File | undefined => {
            const entry = unzipped[name];
            if (!entry) return undefined;
            const buffer = new Uint8Array(entry);
            return new File([buffer], name, { type });
        };

        const full = data.fileFullName ? toFile(data.fileFullName, 'application/javascript') : undefined;
        const light = data.fileLightName ? toFile(data.fileLightName, 'application/javascript') : undefined;
        const logo = toFile('logo.png', 'image/png');

        const languagesFiles = Object.keys(unzipped)
            .filter(filename => filename.toLowerCase().endsWith('.json'))
            .filter(filename => filename !== 'widget-metadata.json');

        const languages: File[] = [];
        languagesFiles.forEach(filename => {
            const file = toFile(filename, 'application/json');
            if (file) languages.push(file);
        });

        return { data, files: { full, light, logo, languages } };
    }

    private async fileToBytes(file: File): Promise<Uint8Array> {
        const ab = await file.arrayBuffer();
        return new Uint8Array(ab);
    }
}
