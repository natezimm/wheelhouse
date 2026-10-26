/**
 * An event's notes as plain text. Google keeps them as text or as simple HTML (line breaks,
 * paragraphs, bold, links); the screens show the words and the line breaks, never the markup.
 */
export function notesText(notes: string | null | undefined): string {
  if (!notes) return '';
  if (!/[<&]/.test(notes)) return notes.trim();
  const lines = notes.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|li|h[1-6])(\s[^>]*)?>/gi, '\n');
  // A detached document parses without running anything or loading images.
  const text = new DOMParser().parseFromString(lines, 'text/html').body.textContent ?? '';
  return text.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
