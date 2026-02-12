/**
 * Event store instance for the API
 */
import { PostgreSQLEventStore } from '@screeem/event-sourcing';
import { pool } from '../../config/database.js';
export const eventStore = new PostgreSQLEventStore(pool);
