import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { MultilanguageData } from '@ssp/utils';
/**
 * Shared validation utilities for the SSP Portal
 */
export class PortalValidators {
    // ================================
    // File Name Validation
    // ================================

    /**
     * Validates the file name in order to avoid unsupported special characters by minio.
     * @param fileName the file name to validate
     */
    static isFileNameSupported(fileName: string): boolean {
        return PortalValidators.findUnsupportedCharacters(fileName).length === 0;
    }

    /**
     * Returns the unsupported characters of the file name based on minio restrictions.
     */
    static findUnsupportedCharacters(filename: string | undefined): string {
        if (!filename) return '';
        const validObjectNamesRegex = /^[a-zA-Z0-9! _.*'()-]+(\/[a-zA-Z0-9! _.*'()-]+)*$/;
        return Array.from(new Set(filename.split('').filter(char => !validObjectNamesRegex.test(char)))).join(', ');
    }

    // ================================
    // File Format Validation
    // ================================

    /**
     * Validates the file format.
     * @param mimeType the file mime type e.g. image/png
     * @param validFormats the valid formats separated by comma e.g. image/png, image/jpeg
     */
    static isFormatValid(mimeType: string, validFormats: string): boolean {
        return validFormats === '*.*' || validFormats.split(',').some(format => format.trim() === mimeType);
    }

    // ================================
    // File Size Validation
    // ================================

    /**
     * Validates the file size.
     * @param file the file to validate
     * @param validSize the maximum allowed size
     * @param inKB if true, validSize is in KB, otherwise in MB
     */
    static isFileSizeValid(file: File, validSize: number, inKB: boolean): boolean {
        return file.size <= validSize * 1024 * (inKB ? 1 : 1024);
    }

    // ================================
    // Comprehensive File Validation
    // ================================

    /**
     * Validates a file against name, format, and size constraints.
     * @param file the file to validate
     * @param validFormats valid formats separated by comma
     * @param maxSize maximum file size
     * @param inKB if true, maxSize is in KB, otherwise in MB
     */
    static validateFile(
        file: File,
        validFormats: string,
        maxSize: number,
        inKB: boolean
    ): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        if (!PortalValidators.isFileNameSupported(file.name)) {
            errors.push('file_name_invalid');
        }

        if (!PortalValidators.isFormatValid(file.type, validFormats)) {
            errors.push('format_invalid');
        }

        if (!PortalValidators.isFileSizeValid(file, maxSize, inKB)) {
            errors.push('size_invalid');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // ================================
    // Specific File Type Validators
    // ================================

    /**
     * Validates JavaScript files (.js)
     */
    static validateJSFile(file: File): { isValid: boolean; errors: string[] } {
        return PortalValidators.validateFile(file, 'application/javascript,text/javascript', 10, false);
    }

    /**
     * Validates image files (PNG, JPEG, GIF)
     */
    static validateImageFile(file: File): { isValid: boolean; errors: string[] } {
        return PortalValidators.validateFile(file, 'image/png,image/jpeg,image/gif', 2, false);
    }

    /**
     * Validates JSON files
     */
    static validateJSONFile(file: File): { isValid: boolean; errors: string[] } {
        return PortalValidators.validateFile(file, 'application/json', 1, false);
    }

    // ================================
    // Form Validators
    // ================================

    /**
     * @param validFormats e.g. 'image/png, image/jpeg'
     * @param validSize in mb
     * @param inKB if true, validSize is in KB
     */
    static imageUploadValidator(validFormats: string, validSize: number, inKB: boolean): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            const file = control.value as File;

            if (!file) {
                return null;
            }

            const mimeType = file.type;
            const fileName = file.name;

            if (!PortalValidators.isFileNameSupported(fileName)) {
                return { nameInvalid: true };
            }

            if (!PortalValidators.isFormatValid(mimeType, validFormats)) {
                return { formatInvalid: true };
            }

            if (!PortalValidators.isFileSizeValid(file, validSize, inKB)) {
                return { sizeInvalid: true };
            }

            return null;
        };
    }

    /**
     * Validates widget tag names (lowercase letters, numbers, and hyphens only)
     */
    static tagNameValidator(): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            const value = control.value;
            if (!value) return null;

            const validPattern = /^[a-z0-9-]+$/;
            return validPattern.test(value) ? null : { invalidTagName: true };
        };
    }

    /**
     * Validates tag format (letters, numbers, and dashes only)
     */
    static tagFormatValidator(): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            const value = control.value;
            if (!value) return null;

            // Allow letters (any case), numbers, and hyphens
            const validPattern = /^[a-zA-Z0-9-]+$/;
            return validPattern.test(value) && value.length <= 100 ? null : { invalidTagFormat: true };
        };
    }

    /**
     * Validates multi-language data with max length and optional English requirement
     */
    static multiLanguageValidator(maxLength: number, englishMandatory = false): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            const data = control.value as MultilanguageData[];
            if (!data || !Array.isArray(data)) return null;

            if (englishMandatory) {
                const englishEntry = data.find(item => item.language === 'en');
                if (!englishEntry?.value?.trim()) {
                    return { englishRequired: true };
                }
            }

            const hasExceededLength = data.some(item => item.value && item.value.length > maxLength);

            return hasExceededLength ? { maxLengthExceeded: { maxLength } } : null;
        };
    }

    /**
     * Validates multi-language data with max length and requires a non-empty value for each entry.
     */
    static multiLanguageAllRequiredValidator(maxLength: number): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            const data = control.value as MultilanguageData[];
            if (!data || !Array.isArray(data)) return null;

            if (data.some(item => !item?.value?.trim())) {
                return { required: true };
            }

            const hasExceededLength = data.some(item => item.value && item.value.length > maxLength);
            return hasExceededLength ? { maxLengthExceeded: true } : null;
        };
    }

    // ================================
    // Tag Validation Helpers
    // ================================

    /**
     * Validates if a tag string is valid (letters, numbers and dash, max 100 chars)
     */
    static isValidTag(tag: string): boolean {
        const pattern = /^[a-zA-Z0-9-]+$/;
        return pattern.test(tag) && tag.length <= 100;
    }
}
