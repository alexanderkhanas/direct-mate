/**
 * Where to go after sign-in or sign-up, from `?next=`. Only the pages a link
 * from Claude leads to (`/claude/…`, and the setup, where the owner reviews
 * the reply examples from their chats): an open `next` would let a link send a
 * freshly signed-in owner anywhere.
 */
export function safeNext(raw: string | null): string | null {
  return raw && /^\/(claude\/[a-z]+|onboarding)(\?[\w=&.-]*)?$/.test(raw) ? raw : null;
}
