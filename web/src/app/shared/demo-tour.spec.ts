import { DESKTOP_TOUR, PHONE_TOUR, placeCard } from './demo-tour';

describe('placeCard', () => {
  const card = { width: 360, height: 200 };
  const view = { width: 1440, height: 900 };

  it('goes below what it points at, centred on it', () => {
    expect(placeCard({ top: 20, left: 1040, width: 240, height: 50 }, card, view, 'middle')).toEqual({ top: 84, left: 980 });
  });

  it('goes above when there is no room below', () => {
    expect(placeCard({ top: 700, left: 100, width: 200, height: 100 }, card, view, 'middle')).toEqual({ top: 486, left: 20 });
  });

  it('goes beside a part too tall for either', () => {
    expect(placeCard({ top: 150, left: 100, width: 200, height: 700 }, card, view, 'middle')).toEqual({ top: 150, left: 314 });
  });

  it('stays on the screen', () => {
    const at = placeCard({ top: 10, left: 1400, width: 40, height: 40 }, card, view, 'middle');
    expect(at.left).toBe(1440 - 360 - 16);
  });

  it('sits in the middle, or the bottom corner, with nothing to point at', () => {
    expect(placeCard(null, card, view, 'middle')).toEqual({ top: 350, left: 540 });
    expect(placeCard(null, card, view, 'corner')).toEqual({ top: 684, left: 1048 });
    expect(placeCard(null, { width: 358, height: 200 }, { width: 390, height: 844 }, 'corner')).toEqual({ top: 628, left: 16 });
  });
});

describe('the tours', () => {
  it('have five stops each, ending on something to try', () => {
    expect(DESKTOP_TOUR.length).toBe(5);
    expect(PHONE_TOUR.length).toBe(5);
    expect(DESKTOP_TOUR.at(-1)?.kind).toBe('wall');
    expect(PHONE_TOUR.at(-1)?.kind).toBe('looks');
  });
});
