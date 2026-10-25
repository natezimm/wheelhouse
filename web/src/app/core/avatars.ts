/**
 * The built-in pictures a member can choose instead of their initial. Each is drawn in
 * `public/avatars/{id}.svg` on a transparent background, so it sits on the member's color.
 * The API accepts the same ids (`Families/MemberAvatars`).
 */
export const AVATARS = [
  { id: 'fox', name: 'Fox' },
  { id: 'cat', name: 'Cat' },
  { id: 'dog', name: 'Dog' },
  { id: 'bear', name: 'Bear' },
  { id: 'panda', name: 'Panda' },
  { id: 'koala', name: 'Koala' },
  { id: 'bunny', name: 'Bunny' },
  { id: 'lion', name: 'Lion' },
  { id: 'tiger', name: 'Tiger' },
  { id: 'owl', name: 'Owl' },
  { id: 'penguin', name: 'Penguin' },
  { id: 'frog', name: 'Frog' },
  { id: 'monkey', name: 'Monkey' },
  { id: 'unicorn', name: 'Unicorn' },
  { id: 'dino', name: 'Dino' },
  { id: 'robot', name: 'Robot' },
] as const;

/** Where a picture is served from, or null for one this app does not have. */
export function avatarUrl(id: string | null | undefined): string | null {
  return AVATARS.some((avatar) => avatar.id === id) ? `/avatars/${id}.svg` : null;
}
