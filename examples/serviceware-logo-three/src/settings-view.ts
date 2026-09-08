import { SecretInConfigError, withDefaults, type PortalWidgetInputs, type WidgetContext } from '@serviceware/portal-widget-sdk';
import { button, h, type MountedView } from './dom';
import { pickOverrides, Translator } from './i18n';
import { LogoSettings, safeColor, schema } from './schema';

interface FieldSpec {
    key: keyof LogoSettings;
    input: 'color' | 'number' | 'checkbox' | 'text' | 'password';
    min?: number;
    max?: number;
    step?: number;
    hint?: string;
}

const FIELDS: FieldSpec[] = [
    { key: 'iconColor', input: 'color' },
    { key: 'depth', input: 'number', min: 1, max: 80, step: 1 },
    { key: 'rotationSpeed', input: 'number', min: 0, max: 6, step: 0.1 },
    { key: 'autoRotate', input: 'checkbox' },
    { key: 'wireframe', input: 'checkbox' },
    { key: 'caption', input: 'text' },
    { key: 'apiKey', input: 'password', hint: 'settings.apiKeyHint' }
];

/** Shown in settings mode when the instance is not in admin mode; never renders the form. */
export function mountAdminOnlyNotice(ctx: WidgetContext<LogoSettings>): MountedView {
    const texts = new Translator();
    texts.set(undefined, pickOverrides(ctx.inputs.configuration.customTrans, ctx.inputs.language || 'en'));
    const notice = h('p', 'sw3d-notice', texts.t('settings.adminOnly'));
    ctx.root.appendChild(notice);
    return {
        onInputsChange(): void {},
        destroy(): void {
            notice.remove();
        }
    };
}

/** Rendered instead of the widget while the Portal shows the element inside its settings dialog. */
export function mountSettings(ctx: WidgetContext<LogoSettings>): MountedView {
    const inputs = ctx.inputs;
    const texts = new Translator();

    ctx.element.classList.add('sw3d-host');

    const form = h('form', 'sw3d-settings');
    const title = h('h2', 'sw3d-settings-title');
    const intro = h('p', 'sw3d-settings-intro');
    const error = h('p', 'sw3d-error');
    error.hidden = true;
    const actions = h('div', 'sw3d-actions');
    const cancelButton = button('sw3d-button', () => ctx.cancel());
    const saveButton = h('button', 'sw3d-button sw3d-button-primary');
    saveButton.type = 'submit';
    actions.append(cancelButton, saveButton);

    const controls = new Map<keyof LogoSettings, HTMLInputElement>();
    const labels = new Map<keyof LogoSettings, HTMLElement>();
    const hints = new Map<keyof LogoSettings, HTMLElement>();

    form.append(title, intro);
    for (const spec of FIELDS) {
        const field = h('label', spec.input === 'checkbox' ? 'sw3d-field sw3d-field-inline' : 'sw3d-field');
        const label = h('span', 'sw3d-field-label');
        const control = h('input', 'sw3d-input');
        control.type = spec.input;
        control.name = spec.key;
        if (spec.min !== undefined) {
            control.min = String(spec.min);
        }
        if (spec.max !== undefined) {
            control.max = String(spec.max);
        }
        if (spec.step !== undefined) {
            control.step = String(spec.step);
        }
        if (spec.input === 'password') {
            control.autocomplete = 'off';
        }
        field.append(spec.input === 'checkbox' ? control : label, spec.input === 'checkbox' ? label : control);
        if (spec.hint) {
            const hint = h('small', 'sw3d-hint');
            field.append(hint);
            hints.set(spec.key, hint);
        }
        controls.set(spec.key, control);
        labels.set(spec.key, label);
        form.append(field);
    }
    form.append(error, actions);
    ctx.root.appendChild(form);

    function fill(settings: LogoSettings): void {
        for (const spec of FIELDS) {
            const control = controls.get(spec.key) as HTMLInputElement;
            const value = settings[spec.key];
            if (spec.input === 'checkbox') {
                control.checked = Boolean(value);
            } else if (spec.input === 'color') {
                control.value = safeColor(value);
            } else {
                control.value = String(value ?? '');
            }
        }
    }

    function collect(): LogoSettings {
        const current = withDefaults(inputs.configuration, schema);
        const read = (key: keyof LogoSettings): HTMLInputElement => controls.get(key) as HTMLInputElement;
        const depth = Number(read('depth').value);
        const rotationSpeed = Number(read('rotationSpeed').value);
        return {
            iconColor: safeColor(read('iconColor').value),
            depth: Number.isFinite(depth) && depth > 0 ? depth : current.depth,
            rotationSpeed: Number.isFinite(rotationSpeed) ? rotationSpeed : current.rotationSpeed,
            autoRotate: read('autoRotate').checked,
            wireframe: read('wireframe').checked,
            caption: read('caption').value.trim(),
            apiKey: read('apiKey').value
        };
    }

    function refreshTexts(): void {
        title.textContent = texts.t('settings.title');
        intro.textContent = texts.t('settings.intro');
        saveButton.textContent = texts.t('settings.save');
        cancelButton.textContent = texts.t('settings.cancel');
        for (const spec of FIELDS) {
            (labels.get(spec.key) as HTMLElement).textContent = texts.t(`settings.${spec.key}`);
            if (spec.hint) {
                (hints.get(spec.key) as HTMLElement).textContent = texts.t(spec.hint);
            }
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        error.hidden = true;
        try {
            ctx.save(collect());
        } catch (caught) {
            if (caught instanceof SecretInConfigError) {
                error.textContent = caught.message;
                error.hidden = false;
                ctx.toast.error(caught.message, texts.t('settings.title'));
                return;
            }
            throw caught;
        }
    });

    async function loadTexts(): Promise<void> {
        const language = inputs.language || 'en';
        const overrides = pickOverrides(inputs.configuration.customTrans, language);
        try {
            texts.set(inputs.apiUrl ? await ctx.loadTranslations(language) : undefined, overrides);
        } catch {
            texts.set(undefined, overrides);
        }
        refreshTexts();
    }

    fill(withDefaults(inputs.configuration, schema));
    refreshTexts();
    void loadTexts();

    return {
        onInputsChange(changed: Partial<PortalWidgetInputs<LogoSettings>>): void {
            if ('configuration' in changed) {
                fill(withDefaults(inputs.configuration, schema));
            }
            if ('language' in changed) {
                void loadTexts();
            }
        },
        destroy(): void {
            form.remove();
            ctx.element.classList.remove('sw3d-host');
        }
    };
}
