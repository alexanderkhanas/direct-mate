import * as path from 'path';
import * as dotenv from 'dotenv';

// Load apps/api/.env so DATABASE_URL etc. are available to the test app.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Shrink the demo debounce window for e2e — tests issue many sequential
// requests and 1500ms × N would blow past jest's 5s default timeout.
process.env.DEMO_DEBOUNCE_MS = '50';
