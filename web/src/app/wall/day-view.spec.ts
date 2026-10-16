import { lanes } from './day-view';

describe('day view lanes', () => {
  const at = (start: number, end: number) => ({ start, end });

  it('gives events that do not overlap the whole width', () => {
    expect(lanes([at(60, 120), at(120, 180)]).map((e) => [e.lane, e.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('puts overlapping events side by side, and reuses a lane once it is free', () => {
    const placed = lanes([at(60, 180), at(90, 120), at(130, 150), at(200, 230)]);

    expect(placed.map((e) => [e.start, e.lane, e.lanes])).toEqual([
      [60, 0, 2],
      [90, 1, 2],
      [130, 1, 2],
      [200, 0, 1],
    ]);
  });
});
