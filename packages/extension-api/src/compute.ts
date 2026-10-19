import type { ModuleSignal } from './descriptor.js';
/** Structured data copied into an isolated compute thread; shared memory is refused. */
export type ComputeMessage =
  | null
  | boolean
  | number
  | string
  | ArrayBuffer
  | Uint8Array
  | readonly ComputeMessage[]
  | { readonly [key: string]: ComputeMessage };
export interface ComputeTask {
  readonly name: string;
  readonly entry: string;
}
/** Declared signed entries only. One task at a time, at most 64 queued; timeout 60 seconds. */
export interface ComputePool {
  run(task: string, input: ComputeMessage, signal: ModuleSignal): Promise<ComputeMessage>;
}
