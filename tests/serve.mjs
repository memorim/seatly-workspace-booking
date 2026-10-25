import { createApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';
createApp(createDatabase(':memory:')).listen(4240, '127.0.0.1');
