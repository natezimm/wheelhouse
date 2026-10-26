import type { CalendarEvent, CalendarSource, EventRequest } from './calendar';
import { Day, addDays, addMonths, dayIn } from './days';

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
    recurring: original?.recurring ?? request.repeat !== 'Never',
    seriesId: original?.seriesId ?? null,
    creationId: original?.creationId ?? null,
    description: request.description !== undefined ? request.description || null : original?.description ?? null,
    recurrence: original?.recurrence ?? null,
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
    pending: true,
    endDate: request.allDay ? addDays(day, length / 86_400_000) : null,
    startsAt,
    endsAt: startsAt ? new Date(Date.parse(startsAt) + length).toISOString() : null,
  };
}

/** Expand only the loaded range. Monthly dates skip short months, as Google and the demo do. */
export function previewOccurrences(
  request: EventRequest,
  source: CalendarSource,
  id: string,
  zone: string,
  from: Day,
  to: Day,
): CalendarEvent[] {
  if (request.repeat === 'Never')
    return [{ ...previewEvent(request, source, `pending:${id}`, zone), creationId: id }];
  const events: CalendarEvent[] = [];
  const step = request.repeat === 'Weekly' ? 7 : 1;
  const durationDays = Math.max(
    1,
    Math.ceil(
      (Date.parse(`${request.endDate}T00:00:00Z`) - Date.parse(`${request.startDate}T00:00:00Z`)) /
        86_400_000,
    ),
  );
  const first =
    request.repeat === 'Monthly'
      ? Math.max(
          0,
          (Number(from.slice(0, 4)) - Number(request.startDate.slice(0, 4))) * 12 +
            Number(from.slice(5, 7)) -
            Number(request.startDate.slice(5, 7)) -
            Math.ceil(durationDays / 28) -
            1,
        )
      : Math.max(
          0,
          Math.floor((Date.parse(from) - Date.parse(request.startDate)) / 86_400_000 / step) -
            durationDays,
        );
  for (let n = first; ; n++) {
    const month = request.repeat === 'Monthly' ? addMonths(request.startDate, n) : '';
    const day =
      request.repeat === 'Monthly'
        ? `${month.slice(0, 8)}${request.startDate.slice(8)}`
        : addDays(request.startDate, n * step);
    if (day >= to) break;
    if (
      request.repeat === 'Monthly' &&
      new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day
    )
      continue;
    const shift = (Date.parse(day) - Date.parse(request.startDate)) / 86_400_000;
    const occurrence = previewEvent(
      { ...request, startDate: day, endDate: addDays(request.endDate, shift) },
      source,
      `pending:${id}:${day}`,
      zone,
    );
    events.push({ ...occurrence, creationId: id, seriesId: `pending:${id}` });
  }
  return events;
}

export function overlaps(event: CalendarEvent, from: Day, to: Day, zone: string): boolean {
  return event.allDay
    ? event.startDate! < to && event.endDate! > from
    : dayIn(zone, event.startsAt!) < to &&
        dayIn(zone, new Date(Date.parse(event.endsAt!) - 1)) >= from;
}
