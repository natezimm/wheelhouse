import { CalendarEvent, daysOf } from './calendar';
import { Day, dayIn, minutesIn } from './days';

/**
 * Where events sit on an hour grid, worked out without any screen: which family days each
 * covers, which overlap, and which side-by-side column each takes. Week and Day draw their
 * hour grids from it, and Month its bars and lines.
 */

const DAY_MINUTES = 24 * 60;

/** A timed event this long or longer reads as a bar across its days, not a block in each. */
export const LONG_MINUTES = DAY_MINUTES;

/** The hours a grid shows at least; it grows to fit anything earlier or later. */
export const FIRST_HOUR = 7;
export const LAST_HOUR = 21;

/** One day's part of a timed event, in minutes from that day's midnight on the family's clock. */
export interface TimedSegment {
  event: CalendarEvent;
  day: Day;
  start: number;
  end: number;
  /** The event started on an earlier day, or goes on to a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** A segment given a column: <code>lane</code> of <code>lanes</code> side by side. */
export interface PlacedSegment extends TimedSegment {
  lane: number;
  lanes: number;
  /** Free minutes below it in its column, before the next event there or the end of the day. */
  room: number;
}

/** Events that did not fit side by side, gathered into one "+N" block in the last column. */
export interface MoreBlock {
  day: Day;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  events: CalendarEvent[];
  /** Minutes free below it in its lanes, as for a placed segment. */
  room: number;
}

/** An all-day or long event as a bar across the visible days it covers. */
export interface DayBar {
  event: CalendarEvent;
  /** The first visible column it covers, from 0, and how many columns. */
  first: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Whether an event belongs in the all-day lane: all-day, or timed and a day or longer. */
export function inAllDayLane(event: CalendarEvent): boolean {
  return event.allDay || Date.parse(event.endsAt!) - Date.parse(event.startsAt!) >= LONG_MINUTES * 60_000;
}

/**
 * Each visible day's parts of the timed events that are not in the all-day lane. An event that
 * runs past midnight is split into one segment per day, all with the same event.
 */
export function timedSegments(events: readonly CalendarEvent[], days: readonly Day[], timeZone: string): Map<Day, TimedSegment[]> {
  const byDay = new Map<Day, TimedSegment[]>(days.map((day) => [day, []]));
  for (const event of events) {
    if (inAllDayLane(event)) {
      continue;
    }
    const covers = daysOf(event, timeZone);
    for (const day of covers) {
      const segments = byDay.get(day);
      if (!segments) {
        continue;
      }
      const startsHere = dayIn(timeZone, event.startsAt!) === day;
      const endsHere = day === covers.at(-1);
      const start = startsHere ? minutesIn(timeZone, event.startsAt!) : 0;
      // An end at midnight belongs to the day before; daysOf has already left the next day out.
      const end = endsHere ? minutesIn(timeZone, event.endsAt!) || DAY_MINUTES : DAY_MINUTES;
      segments.push({ event, day, start, end: Math.max(end, start), continuesBefore: !startsHere, continuesAfter: !endsHere });
    }
  }
  return byDay;
}

/** The same order every time: earlier first, then longer, then by title and id. */
function bySegment(a: TimedSegment, b: TimedSegment): number {
  return a.start - b.start || b.end - a.end || a.event.title.localeCompare(b.event.title) || a.event.id.localeCompare(b.event.id);
}

/**
 * Puts one day's overlapping segments side by side. Segments that only touch (one ends as the
 * next starts) do not overlap. A group needing more than <code>maxColumns</code> columns keeps
 * the first ones and gathers the rest into a "+N" block in the last column.
 */
export function arrange(segments: readonly TimedSegment[], maxColumns = 3): { placed: PlacedSegment[]; more: MoreBlock[] } {
  const sorted = [...segments].sort(bySegment);
  const groups: TimedSegment[][] = [];
  let groupEnd = -1;
  for (const segment of sorted) {
    if (segment.start >= groupEnd || groups.length === 0) {
      groups.push([]);
    }
    groups.at(-1)!.push(segment);
    groupEnd = Math.max(groupEnd, segment.end);
  }

  const placed: PlacedSegment[] = [];
  const more: MoreBlock[] = [];
  groups.forEach((group, index) => {
    const ends: number[] = [];
    const lanesOf = group.map((segment) => {
      let lane = ends.findIndex((end) => end <= segment.start);
      if (lane < 0) {
        lane = ends.length;
      }
      ends[lane] = segment.end;
      return lane;
    });
    const needed = ends.length;
    const lanes = Math.min(needed, maxColumns);
    const kept = needed > maxColumns ? maxColumns - 1 : maxColumns;
    const nextGroup = groups[index + 1]?.[0].start ?? DAY_MINUTES;
    const hidden: TimedSegment[] = [];
    group.forEach((segment, i) => {
      const lane = lanesOf[i];
      if (lane >= kept) {
        hidden.push(segment);
        return;
      }
      const below = group.filter((other, j) => j > i && lanesOf[j] === lane && other.start >= segment.end).map((other) => other.start);
      placed.push({ ...segment, lane, lanes, room: Math.min(nextGroup, ...below) - segment.end });
    });
    if (hidden.length) {
      more.push({
        day: group[0].day,
        start: Math.min(...hidden.map((s) => s.start)),
        end: Math.max(...hidden.map((s) => s.end)),
        lane: kept,
        lanes,
        events: hidden.map((s) => s.event),
        room: nextGroup - Math.max(...hidden.map((s) => s.end)),
      });
    }
  });
  return { placed, more };
}

/**
 * The all-day lane: a bar per all-day or long event across the visible days it covers, in at
 * most <code>maxLanes</code> rows. What does not fit is counted per column as <code>hidden</code>.
 */
export function dayBars(
  events: readonly CalendarEvent[],
  days: readonly Day[],
  timeZone: string,
  maxLanes = 2,
): { bars: DayBar[]; lanes: number; hidden: number[] } {
  const columns = new Map(days.map((day, i) => [day, i]));
  const items = events
    .filter(inAllDayLane)
    .map((event) => {
      const covers = daysOf(event, timeZone);
      const shown = covers.filter((day) => columns.has(day));
      return shown.length
        ? {
            event,
            first: columns.get(shown[0])!,
            last: columns.get(shown.at(-1)!)!,
            continuesBefore: covers[0] < shown[0],
            continuesAfter: covers.at(-1)! > shown.at(-1)!,
          }
        : null;
    })
    .filter((item) => item !== null)
    .sort((a, b) => a.first - b.first || b.last - a.last || a.event.title.localeCompare(b.event.title) || a.event.id.localeCompare(b.event.id));

  const lastInLane: number[] = [];
  const hidden = days.map(() => 0);
  const bars: DayBar[] = [];
  for (const item of items) {
    let lane = lastInLane.findIndex((last) => last < item.first);
    if (lane < 0) {
      lane = lastInLane.length;
    }
    if (lane >= maxLanes) {
      for (let column = item.first; column <= item.last; column++) {
        hidden[column]++;
      }
      continue;
    }
    lastInLane[lane] = item.last;
    bars.push({
      event: item.event,
      first: item.first,
      span: item.last - item.first + 1,
      lane,
      continuesBefore: item.continuesBefore,
      continuesAfter: item.continuesAfter,
    });
  }
  return { bars, lanes: lastInLane.length, hidden };
}

/** The whole hours a grid shows: at least first to last, grown to fit every segment. */
export function hourRange(segments: Iterable<TimedSegment>, first = FIRST_HOUR, last = LAST_HOUR): { first: number; last: number } {
  for (const segment of segments) {
    first = Math.min(first, Math.floor(segment.start / 60));
    last = Math.max(last, Math.ceil(segment.end / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, last) };
}

/** An hour on the grid's gutter, such as "7 AM" or "12 PM". */
export function hourLabel(hour: number): string {
  const h = hour % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One day of a month row: the rows of bars over it, its timed events in order, and how many of its events did not fit. */
export interface MonthDay {
  day: Day;
  lanes: number;
  segments: TimedSegment[];
  more: number;
}

/**
 * One week of the month: all-day and long events as bars across their days, then each day's
 * timed events as lines, starting under the last bar over that day. <code>room(lanes)</code>
 * says how many lines fit under that many rows of bars. A day with more than fits shows one
 * line fewer and counts the rest as "+N more", bars that did not fit included.
 */
export function monthWeek(
  events: readonly CalendarEvent[],
  days: readonly Day[],
  timeZone: string,
  room: (lanes: number) => number,
  maxLanes = 2,
): { bars: DayBar[]; lanes: number; days: MonthDay[] } {
  // Never so many rows of bars that a day has no line left to say what else it holds.
  while (maxLanes > 0 && room(maxLanes) < 1) {
    maxLanes--;
  }
  const { bars, lanes, hidden } = dayBars(events, days, timeZone, maxLanes);
  const segments = timedSegments(events, days, timeZone);
  return {
    bars,
    lanes,
    days: days.map((day, i) => {
      const over = bars.filter((bar) => bar.first <= i && i < bar.first + bar.span).map((bar) => bar.lane + 1);
      const dayLanes = Math.max(0, ...over);
      const fits = room(dayLanes);
      const timed = [...(segments.get(day) ?? [])].sort(bySegment);
      if (timed.length <= fits && hidden[i] === 0) {
        return { day, lanes: dayLanes, segments: timed, more: 0 };
      }
      const shown = Math.max(0, Math.min(timed.length, fits - 1));
      return { day, lanes: dayLanes, segments: timed.slice(0, shown), more: timed.length - shown + hidden[i] };
    }),
  };
}

/** "3:30 PM" as "3:30p" and "9:00 AM" as "9a", for a line in a month's day. */
export function compactTime(time: string): string {
  return time.replace(':00', '').replace(/\s?(AM|PM)$/, (_, half: string) => (half === 'AM' ? 'a' : 'p'));
}
