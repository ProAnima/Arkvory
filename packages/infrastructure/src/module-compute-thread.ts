import './module-compute-confine.js';
// Load the task and all workspace libraries only after this thread is confined.
await import('./module-compute-task.js');
