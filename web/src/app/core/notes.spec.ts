import { notesText } from './notes';

describe('event notes', () => {
  it('keeps plain notes as they are and turns simple HTML into lines of text', () => {
    expect(notesText(null)).toBe('');
    expect(notesText('  Bring shin guards  ')).toBe('Bring shin guards');
    expect(notesText('Line one<br>Line <b>two</b><p>Para &amp; more</p>')).toBe('Line one\nLine two\nPara & more');
    expect(notesText('<a href="https://example.com">Directions</a>')).toBe('Directions');
  });

  it('preserves text around comments and omits script and style contents', () => {
    expect(notesText('Before<!-- <script> -->Keep this<!-- </script> -->After')).toBe('BeforeKeep thisAfter');
    expect(notesText('One<SCRIPT>hidden</SCRIPT ><br class="line">Two<style>hidden</style>')).toBe('One\nTwo');
    expect(notesText('<div>One<div>Two</div></div><p>Three')).toBe('One\nTwo\nThree');
  });

  it('never runs anything in the notes', () => {
    expect(notesText('<img src=x onerror="window.ranNotes=1">Hi<script>window.ranNotes=1</script>')).toBe('Hi');
    expect((window as unknown as { ranNotes?: number }).ranNotes).toBeUndefined();
  });
});
