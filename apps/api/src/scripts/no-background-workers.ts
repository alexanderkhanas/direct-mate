/**
 * Imported first by CLI scripts that boot the whole AppModule (the
 * simulator): background workers that spend shared budgets stay off, so a
 * script run never reads a store's Instagram history or claims its import.
 * Must run before the app's configuration is read.
 */
process.env.HISTORY_IMPORT_WORKER_ENABLED = 'false';

export {};
