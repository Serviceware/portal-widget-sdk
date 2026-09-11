import { CounterWidget } from './CounterWidget';
import { useInputs, useTranslate } from './portal-store';
import { SettingsForm } from './SettingsForm';

/**
 * The Portal renders a widget with `settingsMode` only inside the administrator's settings dialog.
 * The `isAdminMode` check is belt and braces: a settings-mode instance outside admin mode gets a
 * notice instead of the form.
 */
export function App() {
    const { settingsMode, isAdminMode } = useInputs().inputs;
    const t = useTranslate();
    if (!settingsMode) {
        return <CounterWidget />;
    }
    return isAdminMode ? <SettingsForm /> : <p className="rlc-notice">{t('adminOnly')}</p>;
}
