/**
 * Imported first by CLI scripts that boot the whole AppModule (the
 * simulator): background workers that spend shared budgets stay off, so a
 * script run never reads a store's Instagram history or claims its import,
 * and never fetches a store's Instagram content. Must run before the app's
 * configuration is read.
 */
process.env.HISTORY_IMPORT_WORKER_ENABLED = 'false';
process.env.CONTENT_FETCH_WORKER_ENABLED = 'false';

export {};
