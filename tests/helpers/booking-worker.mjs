import { parentPort, workerData } from 'node:worker_threads';
import { createDatabase } from '../../server/db.ts';
import { createApp } from '../../server/app.ts';

const db = createDatabase(workerData.file);
if (workerData.barrier) {
  const original = db.prepare.bind(db),
    gate = new Int32Array(workerData.barrier);
  db.prepare = (sql) => {
    const statement = original(sql);
    if (!sql.startsWith('SELECT request_payload,create_result FROM bookings')) return statement;
    return new Proxy(statement, {
      get(target, name) {
        if (name === 'get')
          return (...values) => {
            const row = target.get(...values);
            // Force both old, unlocked lookups to see an absent key. The corrected
            // implementation reads under BEGIN IMMEDIATE and does not need this gate.
            if (!row && !db.isTransaction) {
              Atomics.add(gate, 0, 1);
              Atomics.notify(gate, 0);
              if (Atomics.load(gate, 0) < 2) Atomics.wait(gate, 0, 1, 2000);
            }
            return row;
          };
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}
const server = createApp(db).listen(0, '127.0.0.1', () =>
  parentPort.postMessage(server.address().port),
);
parentPort.on('message', (message) => {
  if (message === 'stop')
    server.close(() => {
      db.close();
      parentPort.close();
    });
});
