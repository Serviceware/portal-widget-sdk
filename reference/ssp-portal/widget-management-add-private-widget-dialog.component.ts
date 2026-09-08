import {
    ChangeDetectionStrategy,
    Component,
    VERSION,
    computed,
    effect,
    inject,
    signal,
    viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeBlueAutoCompleteModule } from '@codeblue/prime/autocomplete';
import { CodeBlueButtonModule } from '@codeblue/prime/button';
import { CodeBlueDialogModule } from '@codeblue/prime/dialog';
import { CodeBlueFloatLabelModule } from '@codeblue/prime/floatlabel';
import { CodeBlueInputNumberModule } from '@codeblue/prime/inputnumber';
import { CodeBlueInputTextModule } from '@codeblue/prime/inputtext';
import { CodeBlueUploadModule } from '@codeblue/prime/input-upload';
import { CodeBlueToggleSwitchModule } from '@codeblue/prime/toggleswitch';
import { MultilanguageDropdownComponent, MultilanguageTextAreaComponent } from '@codeblue/angular-multilanguage';
import { TranslateModule, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AppConfigService, PortalToastService, PortalValidators, WidgetInterface } from '@ssp/common';
import { FileUploadConfig, FileUploadError, MultiFileUploadComponent } from '@ssp/ui';
import { MultilanguageData } from '@ssp/utils';
import { PrivateWidgetDialogDraft, PrivateWidgetDialogFiles, WidgetDependencyFormValue } from '../../models';
import { PrivateWidgetDialogService, WidgetManagementPanelFacadeService } from '../../services';
import { WidgetUploadFormDto } from '../../../widgets-management/models';
import { PackageFiles } from '../../../widgets-management/services';
import { finalize, firstValueFrom, take } from 'rxjs';
import { TranslationApiService } from '../../../shared/services';
import { IconComponent } from '@codeblue/angular-icon';

type WidgetDialogFieldError =
    | 'required'
    | 'invalidTagName'
    | 'duplicateTagName'
    | 'maxLengthExceeded'
    | 'invalidTag'
    | 'maxReached'
    | 'invalidNumber'
    | 'file_name_invalid'
    | 'format_invalid'
    | 'size_invalid'
    | 'englishRequired'
    | 'invalidJson';

type WidgetDialogValidationState = {
    tagName: WidgetDialogFieldError | null;
    name: WidgetDialogFieldError | null;
    description: WidgetDialogFieldError | null;
    changes: WidgetDialogFieldError | null;
    tags: WidgetDialogFieldError | null;
    dependencies: WidgetDialogFieldError | null;
    defaultColumns: WidgetDialogFieldError | null;
    defaultRows: WidgetDialogFieldError | null;
    angularVersion: WidgetDialogFieldError | null;
    logo: WidgetDialogFieldError | null;
    fullVersionFile: WidgetDialogFieldError | null;
    lightVersionFile: WidgetDialogFieldError | null;
    languageFiles: WidgetDialogFieldError | null;
    isValid: boolean;
};

const MAX_TAGS = 10;
const MAX_DEPENDENCIES = 10;
const MAX_TAG_NAME_LENGTH = 100;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_CHANGES_LENGTH = 4000;

@Component({
    selector: 'ssp-admin-widget-management-add-private-widget-dialog',
    standalone: true,
    providers: [PrivateWidgetDialogService],
    imports: [
        TranslatePipe,
        TranslateModule,
        FormsModule,
        CodeBlueAutoCompleteModule,
        CodeBlueButtonModule,
        CodeBlueDialogModule,
        CodeBlueFloatLabelModule,
        CodeBlueInputNumberModule,
        CodeBlueInputTextModule,
        CodeBlueUploadModule,
        CodeBlueToggleSwitchModule,
        MultiFileUploadComponent,
        MultilanguageDropdownComponent,
        MultilanguageTextAreaComponent,
        IconComponent
    ],
    templateUrl: './widget-management-add-private-widget-dialog.component.html',
    styleUrl: './widget-management-add-private-widget-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetManagementAddPrivateWidgetDialogComponent {
    private readonly translationApiService = inject(TranslationApiService);
    private readonly translateService = inject(TranslateService);
    private readonly toastService = inject(PortalToastService);
    private readonly privateWidgetDialogService = inject(PrivateWidgetDialogService);

    readonly languageFilesUpload = viewChild(MultiFileUploadComponent);

    readonly facade = inject(WidgetManagementPanelFacadeService);
    protected readonly isSCE = inject(AppConfigService).globals.isSCE;
    protected readonly editMode = computed(() => this.facade.privateWidgetDialogMode() === 'edit');
    readonly tagName = signal('');
    readonly tagNameTouched = signal(false);
    readonly submitAttempted = signal(false);
    readonly isSubmitting = signal(false);
    readonly name = signal<MultilanguageData[]>(this.createEmptyMultilanguageData());
    readonly description = signal<MultilanguageData[]>(this.createEmptyMultilanguageData());
    readonly tags = signal<string[]>([]);
    readonly defaultColumns = signal(1);
    readonly defaultRows = signal(1);
    readonly angularVersion = signal(0);
    readonly authenticated = signal(false);
    readonly changes = signal<MultilanguageData[]>(this.createEmptyMultilanguageData());
    readonly dependencies = signal<WidgetDependencyFormValue[]>([]);
    readonly logoFile = signal<File | null>(null);
    readonly fullVersionFile = signal<File | null>(null);
    readonly lightVersionFile = signal<File | null>(null);
    readonly logoFileName = signal('');
    readonly fullVersionFileName = signal('');
    readonly lightVersionFileName = signal('');
    readonly languageFiles = signal<File[]>([]);
    readonly existingWidgets = signal<Array<Pick<WidgetInterface, 'id' | 'name'>>>([]);
    readonly validationState = computed<WidgetDialogValidationState>(() => this.buildValidationState());
    readonly tagNameInvalid = computed(
        () => (this.tagNameTouched() || this.submitAttempted()) && this.validationState().tagName !== null
    );
    protected readonly portalAngularVersion = VERSION.major;
    readonly languageFilesConfig: FileUploadConfig = {
        allowDownload: true,
        allowReplace: true,
        allowDelete: true,
        maxFileSize: 5,
        allowedExtensions: ['.json']
    };

    readonly dialogTitle = computed(() =>
        this.editMode() ? 'widgets_management_edit_private_widget' : 'widgets_management_upload_private_widget'
    );
    readonly submitButtonText = computed(() => (this.editMode() ? 'update' : 'upload'));
    readonly canSubmit = computed(() => this.validationState().isValid && !this.isSubmitting());

    private wasDialogOpen = false;

    private readonly syncDialogState = effect(() => {
        const isOpen = this.facade.addPrivateWidgetDialogOpen();

        if (isOpen && !this.wasDialogOpen) {
            this.resetForm();
            this.loadAvailableWidgets();

            if (this.editMode()) {
                this.patchFormForEditMode();
            } else {
                const pendingImportZipFile = this.facade.consumePendingImportZipFile();
                if (pendingImportZipFile) {
                    void this.importZip(pendingImportZipFile);
                }
            }
        }

        if (!isOpen && this.wasDialogOpen) {
            this.resetForm();
        }

        this.wasDialogOpen = isOpen;
    });

    closeDialog(): void {
        this.facade.closeAddPrivateWidgetDialog();
        this.resetForm();
    }

    onVisibleChange(isOpen: boolean): void {
        this.facade.setAddPrivateWidgetDialogOpen(isOpen);
    }

    autoTranslate = async (_sourceLang: string, text: string, targetLangs: string[]): Promise<MultilanguageData[]> => {
        if (!text.trim() || !targetLangs.length) return [];

        return firstValueFrom(this.translationApiService.translate(text, targetLangs));
    };

    addDependency(): void {
        this.dependencies.update(current => [...current, { name: '', dependency: '' }]);
    }

    removeDependency(index: number): void {
        this.dependencies.update(current => current.filter((_, currentIndex) => currentIndex !== index));
    }

    updateDependencyName(index: number, value: string): void {
        this.dependencies.update(current =>
            current.map((dependency, currentIndex) =>
                currentIndex === index ? { ...dependency, name: value } : dependency
            )
        );
    }

    updateDependencyVersion(index: number, value: string): void {
        this.dependencies.update(current =>
            current.map((dependency, currentIndex) =>
                currentIndex === index ? { ...dependency, dependency: value } : dependency
            )
        );
    }

    onLogoFileChange(event: unknown): void {
        const file = event instanceof File ? event : null;
        this.logoFile.set(file);
        this.logoFileName.set(file ? file.name : this.logoFileName());
    }

    onLogoFileDelete(): void {
        this.logoFile.set(null);
        this.logoFileName.set('');
    }

    onFullVersionFileChange(event: unknown): void {
        const file = event instanceof File ? event : null;
        this.fullVersionFile.set(file);
        this.fullVersionFileName.set(file ? file.name : this.fullVersionFileName());
    }

    onFullVersionFileDelete(): void {
        this.fullVersionFile.set(null);
        this.fullVersionFileName.set('');
    }

    onLightVersionFileChange(event: unknown): void {
        const file = event instanceof File ? event : null;
        this.lightVersionFile.set(file);
        this.lightVersionFileName.set(file ? file.name : this.lightVersionFileName());
    }

    onLightVersionFileDelete(): void {
        this.lightVersionFile.set(null);
        this.lightVersionFileName.set('');
    }

    async onLanguageFilesChange(files: File[]): Promise<void> {
        if (this.sameFiles(this.languageFiles(), files)) {
            return;
        }

        const validFiles: File[] = [];
        for (const file of files) {
            if (await this.validateLanguageFile(file)) {
                validFiles.push(file);
            }
        }

        this.languageFiles.set(validFiles);

        const languageFilesUpload = this.languageFilesUpload();
        if (languageFilesUpload) {
            languageFilesUpload.setFiles(validFiles);
        }
    }

    onLanguageFilesError(errors: FileUploadError[]): void {
        errors.forEach(error => {
            const title = this.translateService.instant('uploading_file_failed', { name: error.file.name });
            const message = this.translateService.instant(error.reason, {
                '0': this.languageFilesConfig.maxFileSize + ' MB'
            });

            this.toastService.error(message, title);
        });
    }

    onSubmit(): void {
        this.submitAttempted.set(true);
        this.tagNameTouched.set(true);

        if (!this.canSubmit()) {
            return;
        }

        if (this.editMode()) {
            this.onUpdate();
            return;
        }

        this.onUpload();
    }

    async importZip(file: File): Promise<void> {
        try {
            const { data, files } = await this.privateWidgetDialogService.importWidgetPackage(file);
            this.applyImportedDraft(this.privateWidgetDialogService.createImportDraft(data));
            await this.applyImportedFiles(files);
            this.submitAttempted.set(false);
            this.tagNameTouched.set(false);
            this.toastService.success(
                this.translateService.instant('widgets_management_import_success_message'),
                this.translateService.instant('widgets_management_import_success_title')
            );
        } catch {
            this.toastService.error(
                this.translateService.instant('invalid_widget_zip_message'),
                this.translateService.instant('invalid_widget_zip_title')
            );
        }
    }

    getTagNameHelperText(): string {
        switch (this.validationState().tagName) {
            case 'required':
                return 'widgets_management_upload_widget_tag_name_required';
            case 'maxLengthExceeded':
                return 'max_length_exceeded';
            case 'invalidTagName':
                return 'widgets_management_upload_widget_tag_name_invalid_format';
            case 'duplicateTagName':
                return 'widgets_management_upload_widget_tag_name_unique';
            default:
                return 'widgets_management_upload_widget_tag_name_hint';
        }
    }

    getTagNameHelperTextParams(): Record<string, number> {
        return { maxLength: MAX_TAG_NAME_LENGTH };
    }

    private patchFormForEditMode(): void {
        const selectedWidget = this.facade.selectedWidget();
        const selectedVersion = this.facade.selectedVersion();

        if (!selectedWidget?.isPrivate) {
            this.resetForm();
            return;
        }

        const draft = this.privateWidgetDialogService.createEditDraft(selectedWidget, selectedVersion);
        this.applyEditDraft(draft);
        this.loadExistingFilesForEditMode(
            selectedVersion?.name ?? '',
            selectedVersion?.fileName,
            selectedVersion?.fileNameLight
        );
    }

    private resetForm(): void {
        this.tagName.set('');
        this.tagNameTouched.set(false);
        this.submitAttempted.set(false);
        this.isSubmitting.set(false);
        this.name.set(this.createEmptyMultilanguageData());
        this.description.set(this.createEmptyMultilanguageData());
        this.tags.set([]);
        this.defaultColumns.set(1);
        this.defaultRows.set(1);
        this.angularVersion.set(0);
        this.authenticated.set(false);
        this.changes.set(this.createEmptyMultilanguageData());
        this.dependencies.set([]);
        this.logoFile.set(null);
        this.fullVersionFile.set(null);
        this.lightVersionFile.set(null);
        this.logoFileName.set('');
        this.fullVersionFileName.set('');
        this.lightVersionFileName.set('');
        this.languageFiles.set([]);
        this.languageFilesUpload()?.setFiles([]);
    }

    private createEmptyMultilanguageData(): MultilanguageData[] {
        return this.privateWidgetDialogService.createEmptyMultilanguageData();
    }

    private loadAvailableWidgets(): void {
        this.privateWidgetDialogService
            .loadExistingWidgets()
            .pipe(take(1))
            .subscribe({
                next: widgets => {
                    this.existingWidgets.set(widgets);
                },
                error: () => {
                    this.existingWidgets.set([]);
                }
            });
    }

    private loadExistingFilesForEditMode(widgetName: string, fileName?: string, fileNameLight?: string): void {
        this.privateWidgetDialogService
            .loadEditFiles(widgetName, fileName, fileNameLight)
            .pipe(take(1))
            .subscribe({
                next: files => {
                    void this.applyLoadedEditFiles(files);
                },
                error: err => {
                    this.toastService.error(
                        this.translateService.instant('error_config_file_get', {
                            error: err?.message ?? ''
                        })
                    );
                }
            });
    }

    private async applyLoadedEditFiles(files: PrivateWidgetDialogFiles): Promise<void> {
        const { fullVersionFile: fullFile, lightVersionFile: lightFile, languageFiles } = files;
        if (!fullFile || !lightFile) {
            this.fullVersionFile.set(null);
            this.lightVersionFile.set(null);
            this.fullVersionFileName.set('');
            this.lightVersionFileName.set('');
            this.languageFiles.set([]);
            this.languageFilesUpload()?.setFiles([]);
            return;
        }

        this.fullVersionFile.set(fullFile);
        this.lightVersionFile.set(lightFile);
        this.fullVersionFileName.set(fullFile.name);
        this.lightVersionFileName.set(lightFile.name);

        if (languageFiles.length > 0) {
            await this.onLanguageFilesChange(languageFiles);
            return;
        }

        this.languageFiles.set([]);
        this.languageFilesUpload()?.setFiles([]);
    }

    private onUpload(): void {
        const uploadDto = this.createFormSubmissionDto();

        this.isSubmitting.set(true);
        this.privateWidgetDialogService
            .saveWidget('create', uploadDto)
            .pipe(
                finalize(() => {
                    this.isSubmitting.set(false);
                }),
                take(1)
            )
            .subscribe({
                next: () => {
                    this.toastService.success(
                        this.translateService.instant('widgets_management_upload_widget_success')
                    );
                    this.facade.loadWidgets();
                    this.closeDialog();
                },
                error: () => {
                    this.toastService.error(this.translateService.instant('widgets_management_upload_widget_error'));
                }
            });
    }

    private onUpdate(): void {
        const widgetId = this.facade.selectedWidget()?.id;
        if (!widgetId) {
            this.toastService.error(this.translateService.instant('widget_updated_error'));
            return;
        }

        const updateDto = this.createFormSubmissionDto();

        this.isSubmitting.set(true);
        this.privateWidgetDialogService
            .saveWidget('edit', updateDto, widgetId)
            .pipe(
                finalize(() => {
                    this.isSubmitting.set(false);
                }),
                take(1)
            )
            .subscribe({
                next: () => {
                    this.toastService.success(this.translateService.instant('widget_updated'));
                    this.facade.loadWidgets();
                    this.refreshSelectedWidget(widgetId);
                    this.closeDialog();
                },
                error: () => {
                    this.toastService.error(this.translateService.instant('widget_updated_error'));
                }
            });
    }

    private refreshSelectedWidget(widgetId: string): void {
        this.privateWidgetDialogService
            .reloadWidget(widgetId)
            .pipe(take(1))
            .subscribe({
                next: widget => {
                    const initialVersion = widget.usedVersion ?? widget.versions.at(-1) ?? null;
                    this.facade.selectedWidget.set(widget);
                    this.facade.selectedVersionId.set(initialVersion?.id ?? null);
                    this.facade.currentVersionId.set(initialVersion?.id ?? null);
                }
            });
    }

    private applyEditDraft(draft: PrivateWidgetDialogDraft): void {
        this.tagName.set(draft.tagName);
        this.tagNameTouched.set(false);
        this.name.set(draft.name);
        this.description.set(draft.description);
        this.tags.set(draft.tags);
        this.defaultColumns.set(draft.defaultColumns);
        this.defaultRows.set(draft.defaultRows);
        this.angularVersion.set(draft.angularVersion);
        this.authenticated.set(draft.authenticated);
        this.changes.set(draft.changes);
        this.dependencies.set(draft.dependencies);
        this.logoFile.set(draft.logoFile);
        this.fullVersionFile.set(null);
        this.lightVersionFile.set(null);
        this.logoFileName.set(draft.logoFileName);
        this.fullVersionFileName.set(draft.fullVersionFileName);
        this.lightVersionFileName.set(draft.lightVersionFileName);
        this.languageFiles.set([]);
    }

    private applyImportedDraft(draft: Partial<PrivateWidgetDialogDraft>): void {
        if (draft.tagName !== undefined) {
            this.tagName.set(draft.tagName);
        }

        if (draft.angularVersion !== undefined) {
            this.angularVersion.set(draft.angularVersion);
        }

        if (draft.authenticated !== undefined) {
            this.authenticated.set(draft.authenticated);
        }

        if (draft.defaultColumns !== undefined) {
            this.defaultColumns.set(draft.defaultColumns);
        }

        if (draft.defaultRows !== undefined) {
            this.defaultRows.set(draft.defaultRows);
        }

        if (draft.name !== undefined) {
            this.name.set(draft.name);
        }

        if (draft.description !== undefined) {
            this.description.set(draft.description);
        }

        if (draft.changes !== undefined) {
            this.changes.set(draft.changes);
        }

        if (draft.tags !== undefined) {
            this.tags.set(draft.tags);
        }

        if (draft.dependencies !== undefined) {
            this.dependencies.set(draft.dependencies);
        }
    }

    private async applyImportedFiles(files: PackageFiles): Promise<void> {
        if (files.logo) {
            this.logoFile.set(files.logo);
            this.logoFileName.set(files.logo.name);
        }

        if (files.full) {
            this.fullVersionFile.set(files.full);
            this.fullVersionFileName.set(files.full.name);
        }

        if (files.light) {
            this.lightVersionFile.set(files.light);
            this.lightVersionFileName.set(files.light.name);
        }

        if (files.languages?.length) {
            await this.onLanguageFilesChange(files.languages);
            return;
        }

        this.languageFiles.set([]);
        this.languageFilesUpload()?.setFiles([]);
    }

    private createFormSubmissionDto(): WidgetUploadFormDto {
        return {
            tagName: this.tagName().trim(),
            name: this.name(),
            description: this.description(),
            tags: this.tags(),
            defaultSize: {
                columns: this.defaultColumns(),
                rows: this.defaultRows()
            },
            logo: this.logoFile(),
            fullVersionFile: this.fullVersionFile() as File,
            lightVersionFile: this.lightVersionFile() as File,
            languageFiles: this.languageFiles(),
            angularVersion: this.angularVersion(),
            authenticated: this.authenticated(),
            changes: this.changes(),
            dependencies: this.dependencies()
        };
    }

    private buildValidationState(): WidgetDialogValidationState {
        const fieldState = {
            tagName: this.getTagNameError(),
            name: this.getMultilanguageError(this.name(), MAX_NAME_LENGTH, true),
            description: this.getMultilanguageError(this.description(), MAX_DESCRIPTION_LENGTH, true),
            changes: this.getMultilanguageError(this.changes(), MAX_CHANGES_LENGTH, true),
            tags: this.getTagsError(),
            dependencies: this.getDependenciesError(),
            defaultColumns: this.getNumberRangeError(this.defaultColumns(), 1, 12),
            defaultRows: this.getNumberRangeError(this.defaultRows(), 1, 12),
            angularVersion: this.getNumberRangeError(this.angularVersion(), 0, 99),
            logo: this.getOptionalFileError(this.logoFile(), file => PortalValidators.validateImageFile(file)),
            fullVersionFile: this.getRequiredFileError(this.fullVersionFile(), file =>
                PortalValidators.validateJSFile(file)
            ),
            lightVersionFile: this.getRequiredFileError(this.lightVersionFile(), file =>
                PortalValidators.validateJSFile(file)
            ),
            languageFiles: this.getLanguageFilesError()
        };

        return {
            ...fieldState,
            isValid: Object.values(fieldState).every(error => error === null)
        };
    }

    private getTagNameError(): WidgetDialogFieldError | null {
        const tagName = this.tagName().trim();
        if (!tagName) {
            return 'required';
        }

        if (tagName.length > MAX_TAG_NAME_LENGTH) {
            return 'maxLengthExceeded';
        }

        if (!/^[a-z0-9-]+$/.test(tagName)) {
            return 'invalidTagName';
        }

        const currentWidgetId = this.facade.selectedWidget()?.id;
        return this.existingWidgets().some(widget => widget.name === tagName && widget.id !== currentWidgetId)
            ? 'duplicateTagName'
            : null;
    }

    private getMultilanguageError(
        data: MultilanguageData[],
        maxLength: number,
        englishMandatory: boolean
    ): WidgetDialogFieldError | null {
        if (!Array.isArray(data) || data.length === 0) {
            return 'required';
        }

        if (englishMandatory) {
            const englishEntry = data.find(item => item.language === 'en');
            if (!englishEntry?.value?.trim()) {
                return 'englishRequired';
            }
        }

        return data.every(item => !item.value || item.value.length <= maxLength) ? null : 'maxLengthExceeded';
    }

    private getTagsError(): WidgetDialogFieldError | null {
        const tags = this.tags();
        if (tags.length > MAX_TAGS) {
            return 'maxReached';
        }

        return tags.every(tag => PortalValidators.isValidTag(tag)) ? null : 'invalidTag';
    }

    private getDependenciesError(): WidgetDialogFieldError | null {
        const dependencies = this.dependencies();
        if (dependencies.length > MAX_DEPENDENCIES) {
            return 'maxReached';
        }

        return dependencies.every(dependency => dependency.name.trim() && dependency.dependency.trim())
            ? null
            : 'required';
    }

    private getNumberRangeError(value: number, min: number, max: number): WidgetDialogFieldError | null {
        return this.isIntegerInRange(value, min, max) ? null : 'invalidNumber';
    }

    private getOptionalFileError(
        file: File | null,
        validator: (file: File) => { isValid: boolean; errors: string[] }
    ): WidgetDialogFieldError | null {
        if (!file) {
            return null;
        }

        return this.getFileValidationError(file, validator);
    }

    private getRequiredFileError(
        file: File | null,
        validator: (file: File) => { isValid: boolean; errors: string[] }
    ): WidgetDialogFieldError | null {
        if (!file) {
            return 'required';
        }

        return this.getFileValidationError(file, validator);
    }

    private getFileValidationError(
        file: File,
        validator: (file: File) => { isValid: boolean; errors: string[] }
    ): WidgetDialogFieldError | null {
        const validation = validator(file);
        return validation.isValid ? null : (validation.errors[0] as WidgetDialogFieldError);
    }

    private getLanguageFilesError(): WidgetDialogFieldError | null {
        for (const file of this.languageFiles()) {
            const validationError = this.getFileValidationError(file, validatedFile =>
                PortalValidators.validateJSONFile(validatedFile)
            );

            if (validationError) {
                return validationError;
            }
        }

        return null;
    }

    private isIntegerInRange(value: number, min: number, max: number): boolean {
        return Number.isInteger(value) && value >= min && value <= max;
    }

    private isValidLanguageTag(tag: string): boolean {
        const [primarySubtag] = tag.split('-');
        if (!/^[A-Za-z]{2,3}$/.test(primarySubtag ?? '')) {
            return false;
        }

        try {
            const result = Intl.getCanonicalLocales(tag);
            return Array.isArray(result) && result.length > 0;
        } catch {
            return false;
        }
    }

    private extractLanguageCode(fileName: string): string {
        const baseName = fileName.split(/[/\\]/).pop() ?? fileName;
        const lowerCaseName = baseName.toLowerCase();
        return lowerCaseName.endsWith('.json') ? baseName.slice(0, -5) : baseName;
    }

    private async validateLanguageFile(file: File): Promise<boolean> {
        const fileName = file.name;
        const languageCode = this.extractLanguageCode(fileName);

        if (!this.isValidLanguageTag(languageCode)) {
            this.showLanguageValidationError('invalid_language_code', fileName);
            return false;
        }

        try {
            if (file.size === 0) {
                this.showLanguageValidationError('invalid_json_or_empty', fileName);
                return false;
            }

            const text = await file.text();
            if (!text.trim()) {
                this.showLanguageValidationError('invalid_json_or_empty', fileName);
                return false;
            }

            JSON.parse(text);
            return true;
        } catch {
            this.showLanguageValidationError('invalid_json_or_empty', fileName);
            return false;
        }
    }

    private showLanguageValidationError(
        key: 'invalid_language_code' | 'invalid_json_or_empty',
        fileName: string
    ): void {
        const title = this.translateService.instant('uploading_file_failed', { name: fileName });
        this.toastService.error(this.translateService.instant(key), title);
    }

    private sameFiles(oldFiles: File[], newFiles: File[]): boolean {
        if (oldFiles.length !== newFiles.length) {
            return false;
        }

        return oldFiles.every((fileA, index) => {
            const fileB = newFiles[index];
            return fileA.name === fileB.name && fileA.size === fileB.size && fileA.lastModified === fileB.lastModified;
        });
    }
}
