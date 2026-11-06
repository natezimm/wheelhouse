/**
 * An event's notes as plain text. Google keeps them as text or as simple HTML (line breaks,
 * paragraphs, bold, links); the screens show the words and the line breaks, never the markup.
 */
export function notesText(notes: string | null | undefined): string {
  if (!notes) return '';
  if (!/[<&]/.test(notes)) return notes.trim();
  // Template contents stay inert. Only their plain text leaves this function.
  const template = document.createElement('template');
  template.innerHTML = notes;
  const content = template.content;
  for (const element of content.querySelectorAll('script, style')) {
    element.remove();
  }
  for (const element of content.querySelectorAll('br')) {
    element.replaceWith('\n');
  }
  for (const element of content.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6')) {
    element.before('\n');
    element.after('\n');
  }
  const text = content.textContent ?? '';
  return text.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
