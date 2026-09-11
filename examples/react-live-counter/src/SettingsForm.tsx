import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useInputs, usePortal, useSettings, useTranslate } from './portal-store';
import { CounterSettings, HEX_COLOR } from './schema';

type Draft = Record<keyof CounterSettings, string>;
type Errors = Partial<Record<keyof CounterSettings, true>>;

function toDraft(settings: CounterSettings): Draft {
    return {
        title: settings.title,
        step: String(settings.step),
        intervalMs: String(settings.intervalMs),
        target: String(settings.target),
        accentColor: settings.accentColor,
        showClock: settings.showClock ? 'on' : ''
    };
}

function parse(draft: Draft): { settings: CounterSettings; errors: Errors } {
    const errors: Errors = {};
    const integer = (key: 'step' | 'intervalMs' | 'target', min: number, max: number, allowZero = false): number => {
        const value = Number(draft[key]);
        const ok = Number.isInteger(value) && ((allowZero && value === 0) || (value >= min && value <= max));
        if (!ok) {
            errors[key] = true;
        }
        return value;
    };
    const settings: CounterSettings = {
        title: draft.title.trim(),
        step: integer('step', 1, 1000),
        intervalMs: integer('intervalMs', 250, 60_000, true),
        target: integer('target', 1, 1_000_000),
        accentColor: draft.accentColor.toLowerCase(),
        showClock: draft.showClock === 'on'
    };
    if (!HEX_COLOR.test(settings.accentColor)) {
        errors.accentColor = true;
    }
    return { settings, errors };
}

/** Rendered instead of the counter while the Portal shows the element inside its settings dialog. */
export function SettingsForm() {
    const ctx = usePortal();
    const { configuration } = useInputs().inputs;
    const settings = useSettings();
    const t = useTranslate();
    const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
    const [errors, setErrors] = useState<Errors>({});

    // The Portal re-sets `configuration` when it arrives from the server; refill the form then.
    useEffect(() => {
        setDraft(toDraft(settings));
        setErrors({});
    }, [configuration, settings]);

    const update = (key: keyof CounterSettings, value: string): void => {
        setDraft(current => ({ ...current, [key]: value }));
    };

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const parsed = parse(draft);
        setErrors(parsed.errors);
        if (Object.keys(parsed.errors).length > 0) {
            ctx.toast.warning(t('invalid'), t('settingsTitle'));
            return;
        }
        ctx.save(parsed.settings);
    };

    const field = (key: keyof CounterSettings, input: ReactElement, inline = false): ReactElement => (
        <label className={`rlc-field${inline ? ' rlc-field-inline' : ''}${errors[key] ? ' rlc-field-invalid' : ''}`}>
            {inline ? input : <span className="rlc-field-label">{t(key)}</span>}
            {inline ? <span className="rlc-field-label">{t(key)}</span> : input}
        </label>
    );

    return (
        <form className="rlc-settings" onSubmit={submit} noValidate>
            <h2 className="rlc-settings-title">{t('settingsTitle')}</h2>
            <p className="rlc-settings-intro">{t('settingsIntro')}</p>
            {field('title', <input className="rlc-input" name="title" maxLength={80} value={draft.title} onChange={e => update('title', e.target.value)} />)}
            {field('step', <input className="rlc-input" name="step" type="number" min={1} max={1000} step={1} value={draft.step} onChange={e => update('step', e.target.value)} />)}
            {field(
                'intervalMs',
                <input className="rlc-input" name="intervalMs" type="number" min={0} max={60000} step={250} value={draft.intervalMs} onChange={e => update('intervalMs', e.target.value)} />
            )}
            {field('target', <input className="rlc-input" name="target" type="number" min={1} max={1000000} step={1} value={draft.target} onChange={e => update('target', e.target.value)} />)}
            {field('accentColor', <input className="rlc-input" name="accentColor" type="color" value={draft.accentColor} onChange={e => update('accentColor', e.target.value)} />)}
            {field('showClock', <input name="showClock" type="checkbox" checked={draft.showClock === 'on'} onChange={e => update('showClock', e.target.checked ? 'on' : '')} />, true)}
            <div className="rlc-actions">
                <button type="button" className="rlc-button" onClick={() => ctx.cancel()}>
                    {t('cancel')}
                </button>
                <button type="submit" className="rlc-button rlc-button-primary">
                    {t('save')}
                </button>
            </div>
        </form>
    );
}
