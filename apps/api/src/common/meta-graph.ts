/**
 * The Graph API hosts for Instagram calls. A connection made through Unified
 * Login (Facebook Login for Business) lives on graph.facebook.com, where `/me`
 * is the business integration system user, not the account. One made through
 * Instagram Login lives on graph.instagram.com. Both address the account by
 * id, so every path is the same on either host.
 */
export const GRAPH_API = 'https://graph.facebook.com/v27.0';
export const IG_GRAPH_API = 'https://graph.instagram.com/v27.0';

/** How an Instagram connection was made (`connections.login_method`). */
export type InstagramLoginMethod = 'instagram' | 'unified';

export function isInstagramLoginMethod(value: unknown): value is InstagramLoginMethod {
  return value === 'instagram' || value === 'unified';
}

/** The host a connection's calls go to. A connection with no method predates the choice: Unified. */
export function graphApi(method: InstagramLoginMethod | null | undefined): string {
  return method === 'instagram' ? IG_GRAPH_API : GRAPH_API;
}

/**
 * `app_state` row holding the app-wide pause on Meta's call budget: the history
 * import sets it, and every scheduled Graph reader waits it out.
 */
export const GRAPH_BUDGET_KEY = 'instagram_history_budget';
