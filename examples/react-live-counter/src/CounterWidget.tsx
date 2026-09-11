import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { WidgetSize } from '@serviceware/portal-widget-sdk';
import { useInputs, usePortal, useSettings, useTranslate } from './portal-store';

/** Re-renders once per `everyMs` while `active`; returns the current time. */
function useNow(active: boolean, everyMs: number): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        if (!active) {
            return;
        }
        setNow(new Date());
        const timer = setInterval(() => setNow(new Date()), everyMs);
        return () => clearInterval(timer);
    }, [active, everyMs]);
    return now;
}

export function CounterWidget() {
    const ctx = usePortal();
    const { inputs, changeCount, lastChanged } = useInputs();
    const settings = useSettings();
    const t = useTranslate();

    const [count, setCount] = useState(0);
    const [startedAt, setStartedAt] = useState(() => Date.now());
    const [size, setSize] = useState<WidgetSize | null>(null);
    const announced = useRef(false);

    // The Portal hides the element (`hidden` input); a hidden widget should not burn timers.
    const running = !inputs.hidden;
    const now = useNow(running && settings.showClock, 1000);

    useEffect(() => {
        if (!running || settings.intervalMs === 0) {
            return;
        }
        const timer = setInterval(() => setCount(current => current + settings.step), settings.intervalMs);
        return () => clearInterval(timer);
    }, [running, settings.intervalMs, settings.step]);

    useEffect(() => ctx.onResize(setSize), [ctx]);

    useEffect(() => {
        if (count >= settings.target && !announced.current) {
            announced.current = true;
            ctx.toast.success(
                t('reached', { target: settings.target, seconds: Math.round((Date.now() - startedAt) / 1000) }),
                t('reachedTitle')
            );
        }
        if (count < settings.target) {
            announced.current = false;
        }
    }, [count, ctx, settings.target, startedAt, t]);

    const reset = (): void => {
        setCount(0);
        setStartedAt(Date.now());
    };

    const progress = Math.min(100, (count / settings.target) * 100);
    const style = { '--rlc-accent': settings.accentColor } as CSSProperties;
    const cadence = settings.intervalMs === 0 ? t('manual') : t('every', { seconds: settings.intervalMs / 1000 });

    return (
        <div className="rlc-root" style={style}>
            <header className="rlc-header">
                <h2 className="rlc-title">{settings.title}</h2>
                {settings.showClock && (
                    <time className="rlc-clock" dateTime={now.toISOString()}>
                        {now.toLocaleTimeString(inputs.language || undefined)}
                    </time>
                )}
            </header>

            <div className="rlc-count" aria-live="polite">
                <span className="rlc-count-value">{count.toLocaleString(inputs.language || undefined)}</span>
                <span className="rlc-count-target">
                    {t('of')} {settings.target.toLocaleString(inputs.language || undefined)}
                </span>
            </div>
            <div className="rlc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                <div className="rlc-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="rlc-cadence">{running ? cadence : t('paused')}</p>

            <div className="rlc-toolbar">
                <button type="button" className="rlc-button" onClick={() => setCount(current => current - settings.step)}>
                    {t('decrement', { step: settings.step })}
                </button>
                <button type="button" className="rlc-button" onClick={() => setCount(current => current + settings.step)}>
                    {t('increment', { step: settings.step })}
                </button>
                <button type="button" className="rlc-button" onClick={reset}>
                    {t('reset')}
                </button>
                {inputs.showSettingsButton && (
                    <button type="button" className="rlc-button rlc-button-primary" onClick={() => ctx.openSettings()}>
                        {t('settings')}
                    </button>
                )}
            </div>

            <footer className="rlc-footer">
                <span>{t('changes', { count: changeCount })}</span>
                <span>{changeCount ? t('lastChange', { names: lastChanged.join(', ') }) : t('noChange')}</span>
                {size && (
                    <span>
                        {t('size')} {Math.round(size.width)} x {Math.round(size.height)} px
                    </span>
                )}
                <span>
                    {inputs.language} / {inputs.portalScreenLayout}
                </span>
            </footer>
        </div>
    );
}
