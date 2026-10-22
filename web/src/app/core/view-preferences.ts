import { Injectable } from '@angular/core';
import { CalendarView } from './calendar-period';

/** Where the calendar is open: the phone layout, the desktop layout (768 px and wider), or the wall. */
export type ViewContext = 'phone' | 'desktop' | 'wall';

export const VIEW_STORAGE_KEY = 'wheelhouse.calendar.view.v1';

const DEFAULTS: Record<ViewContext, CalendarView> = { phone: 'day', desktop: 'week', wall: 'week' };

const isView = (value: unknown): value is CalendarView => value === 'day' || value === 'week' || value === 'month';

/**
 * The view each context opened last, kept in this browser. Only the view is kept: never a
 * date, a draft or anything about the family. Missing, corrupt or blocked storage gives the defaults.
 */
@Injectable({ providedIn: 'root' })
export class ViewPreferences {
  view(context: ViewContext): CalendarView {
    const saved = this.read()[context];
    return isView(saved) ? saved : DEFAULTS[context];
  }

  remember(context: ViewContext, view: CalendarView): void {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ ...this.read(), [context]: view }));
    } catch {
      // Private windows and full or blocked storage: the view just isn't remembered.
    }
  }

  private read(): Partial<Record<ViewContext, unknown>> {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        return {};
      }
      // Keep only the contexts this version knows, each with a valid view.
      const known: Partial<Record<ViewContext, CalendarView>> = {};
      for (const context of Object.keys(DEFAULTS) as ViewContext[]) {
        const view = (saved as Record<string, unknown>)[context];
        if (isView(view)) {
          known[context] = view;
        }
      }
      return known;
    } catch {
      return {};
    }
  }
}
