/**
 * The Graph API host and version for every Instagram call. Instagram API with
 * Unified Login lives on graph.facebook.com and addresses the Instagram
 * account by id: `/me` is the business integration system user, not the
 * account.
 */
export const GRAPH_API = 'https://graph.facebook.com/v27.0';

/**
 * `app_state` row holding the app-wide pause on Meta's call budget: the history
 * import sets it, and every scheduled Graph reader waits it out.
 */
export const GRAPH_BUDGET_KEY = 'instagram_history_budget';
