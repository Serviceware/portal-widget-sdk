import { fromEvent, Observable } from 'rxjs';
import { EventManagerInterface } from './interfaces/event-manager.interface';
import { PortalBaseEventArgs } from './events/base/portal-base-event-args';
import { map } from 'rxjs/operators';
import { PortalEvent } from './events/base/portal-event';
import { EventInstanceOrClass } from './events/types/event-instance-or-class';

/**
 * Typescript class used for communication between widgets.
 * Each event has its own personal Event class and type of its arguments.
 */
export class EventManager implements EventManagerInterface {
    private readonly eventSuffix = 'SSPEvent';

    /** @inheritdoc */
    listenEvent(eventName: string): Observable<any> {
        return fromEvent<CustomEvent>(window, eventName + this.eventSuffix).pipe(map((e: CustomEvent) => e.detail));
    }

    /** @inheritdoc */
    listenTypedEvent<TEventArgs extends PortalBaseEventArgs>(
        eventInstanceOrClass: EventInstanceOrClass<TEventArgs>
    ): Observable<TEventArgs> {
        const typedEvent: PortalEvent<TEventArgs> =
            eventInstanceOrClass instanceof PortalEvent
                ? eventInstanceOrClass
                : new eventInstanceOrClass({} as TEventArgs);
        const eventName = typedEvent.name;
        return this.listenEvent(eventName).pipe(map((args: TEventArgs) => ({ ...args, handled: true })));
    }

    /** @inheritdoc */
    dispatchValueFromTypedEvent<TEventArgs extends PortalBaseEventArgs>(
        eventInstanceOrClass: EventInstanceOrClass<TEventArgs>,
        args?: TEventArgs
    ): boolean {
        let event: PortalEvent<TEventArgs>;

        if (eventInstanceOrClass instanceof PortalEvent) {
            event = eventInstanceOrClass;
        } else if (args) {
            event = new eventInstanceOrClass(args);
        } else {
            throw new Error('Args must be provided when using class definition');
        }
        this.dispatchValueFromEvent(event.name, event.args);
        return event.args.handled;
    }

    /** @inheritdoc */
    dispatchValueFromEvent(eventName = '', value: unknown = {}): void {
        window.dispatchEvent(new CustomEvent(eventName + this.eventSuffix, { detail: value }));
    }
}
