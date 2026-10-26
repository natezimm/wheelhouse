import { notesText } from './notes';

describe('event notes', () => {
  it('keeps plain notes as they are and turns simple HTML into lines of text', () => {
    expect(notesText(null)).toBe('');
    expect(notesText('  Bring shin guards  ')).toBe('Bring shin guards');
    expect(notesText('Line one<br>Line <b>two</b><p>Para &amp; more</p>')).toBe('Line one\nLine two\nPara & more');
    expect(notesText('<a href="https://example.com">Directions</a>')).toBe('Directions');
  });

  it('never runs anything in the notes', () => {
    expect(notesText('<img src=x onerror="window.ranNotes=1">Hi<script>window.ranNotes=1</script>')).toBe('Hi');
    expect((window as unknown as { ranNotes?: number }).ranNotes).toBeUndefined();
  });
});
