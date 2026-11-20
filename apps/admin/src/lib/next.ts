/**
 * Where to go after sign-in or sign-up, from `?next=`. Only the pages a
 * sign-in from Claude comes from: an open `next` would let a link send a
 * freshly signed-in owner anywhere.
 */
export function safeNext(raw: string | null): string | null {
  return raw && /^\/claude\/[a-z]+(\?[\w=&.-]*)?$/.test(raw) ? raw : null;
}
