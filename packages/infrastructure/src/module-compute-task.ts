import { parentPort, workerData } from 'node:worker_threads';
import { runVerifiedComputation } from './module-import.js';
import { computeMessage } from './module-compute-message.js';

const data: unknown = workerData;
if (typeof data !== 'object' || data === null) throw new Error('Invalid compute task');
const directory: unknown = Reflect.get(data, 'directory');
const entry: unknown = Reflect.get(data, 'entry');
if (typeof directory !== 'string' || typeof entry !== 'string')
  throw new Error('Invalid compute entry');
const result = await runVerifiedComputation(
  directory,
  entry,
  computeMessage(Reflect.get(data, 'input')),
);
parentPort?.postMessage(computeMessage(result));
