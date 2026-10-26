import type { CalendarEvent, CalendarSource, EventRequest } from './calendar';
import { Day, addDays, dayIn } from './days';
import { parseRule, ruleDays } from './repeat-rule';

/** Local wall-clock time to UTC, matching the API's standard-time choice on a DST overlap. */
export function instantAt(day: Day, time: string, zone: string): string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partsAt = (instant: number) => {
    const p = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
    return Date.parse(
      `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}Z`,
    );
  };
  let local = Date.parse(`${day}T${time}Z`);
  if (!Number.isFinite(local)) throw new Error('Invalid event time');
  for (let gap = 0; gap <= 48; gap++, local += 30 * 60_000) {
    const offsets = new Set(
      [-86_400_000, 0, 86_400_000].map((delta) => partsAt(local + delta) - (local + delta)),
    );
    const candidates = [...offsets]
      .map((offset) => local - offset)
      .filter((instant) => partsAt(instant) === local);
    if (candidates.length) return new Date(Math.max(...candidates)).toISOString();
  }
  throw new Error('Invalid event time');
}

export function previewEvent(
  request: EventRequest,
  source: CalendarSource,
  id: string,
  zone: string,
  original?: CalendarEvent,
): CalendarEvent {
  return {
    id,
    calendarId: source.id,
    memberId: source.memberId,
    title: request.title,
    location: request.location,
    allDay: request.allDay,
    startDate: request.allDay ? request.startDate : null,
    endDate: request.allDay ? request.endDate : null,
    startsAt: request.allDay ? null : instantAt(request.startDate, request.startTime!, zone),
    endsAt: request.allDay ? null : instantAt(request.endDate, request.endTime!, zone),
    recurring: original?.recurring ?? !!request.recurrence,
    seriesId: original?.seriesId ?? null,
    creationId: original?.creationId ?? null,
    description: request.description !== undefined ? request.description || null : original?.description ?? null,
    recurrence: request.recurrence || original?.recurrence || null,
    memberIds: othersIn(request, source, original),
    pending: true,
  };
}

/** Series edits keep each occurrence's day, using the new wall-clock times and duration. */
export function previewSeries(
  request: EventRequest,
  source: CalendarSource,
  original: CalendarEvent,
  zone: string,
): CalendarEvent {
  const day = original.startDate ?? dayIn(zone, original.startsAt!);
  const length = request.allDay
    ? Date.parse(`${request.endDate}T00:00:00Z`) - Date.parse(`${request.startDate}T00:00:00Z`)
    : Date.parse(instantAt(request.endDate, request.endTime!, zone)) -
      Date.parse(instantAt(request.startDate, request.startTime!, zone));
  const startsAt = request.allDay ? null : instantAt(day, request.startTime!, zone);
  return {
    ...original,
    calendarId: source.id,
    memberId: source.memberId,
    title: request.title,
    location: request.location,
    recurrence: request.recurrence || original.recurrence,
    description: request.description !== undefined ? request.description || null : original.description ?? null,
    memberIds: othersIn(request, source, original),
    pending: true,
    endDate: request.allDay ? addDays(day, length / 86_400_000) : null,
    startsAt,
    endsAt: startsAt ? new Date(Date.parse(startsAt) + length).toISOString() : null,
  };
}

/** Expand only the loaded range, as Google and the demo expand the rule (see ruleDays). */
export function previewOccurrences(
  request: EventRequest,
  source: CalendarSource,
  id: string,
  zone: string,
  from: Day,
  to: Day,
): CalendarEvent[] {
  const rule = parseRule(request.recurrence);
  if (!rule)
    return [{ ...previewEvent(request, source, `pending:${id}`, zone), creationId: id }];
  const durationDays = Math.max(
    1,
    Math.ceil(
      (Date.parse(`${request.endDate}T00:00:00Z`) - Date.parse(`${request.startDate}T00:00:00Z`)) /
        86_400_000,
    ),
  );
  // An occurrence that started a few days before the range can still run into it.
  return ruleDays(request.startDate, rule, addDays(from, -durationDays), to).map((day) => {
    const shift = (Date.parse(day) - Date.parse(request.startDate)) / 86_400_000;
    const occurrence = previewEvent(
      { ...request, startDate: day, endDate: addDays(request.endDate, shift) },
      source,
      `pending:${id}:${day}`,
      zone,
    );
    return { ...occurrence, creationId: id, seriesId: `pending:${id}` };
  });
}

export function overlaps(event: CalendarEvent, from: Day, to: Day, zone: string): boolean {
  return event.allDay
    ? event.startDate! < to && event.endDate! > from
    : dayIn(zone, event.startsAt!) < to &&
        dayIn(zone, new Date(Date.parse(event.endsAt!) - 1)) >= from;
}

/** The members a changed event is for besides its calendar's owner, as the server answers them. */
function othersIn(request: EventRequest, source: CalendarSource, original?: CalendarEvent): string[] {
  return (request.memberIds ?? original?.memberIds ?? []).filter((id) => id !== source.memberId);
}
