// Spawned by tests/event-loop-watchdog.test.mjs: a process with the event-loop watchdog that
// either stalls its main thread or keeps it responsive. Usage: node watchdog-child.mjs <mode>.
import { startEventLoopWatchdog } from '@proanima/arkvory-infrastructure';

const mode = process.argv[2];
const busy = (milliseconds) => {
  const end = Date.now() + milliseconds;
  while (Date.now() < end);
};
startEventLoopWatchdog({
  seconds: mode === 'off' ? 0 : 1,
  intervalMs: 100,
  fields: { service: 'test', version: 'dev', pid: process.pid, hostname: 'test' },
  onError: (error) => {
    throw error;
  },
});
if (mode === 'stall' || mode === 'off') {
  setTimeout(() => {
    // An endless loop as far as timers can tell; the watchdog must end the process first.
    busy(mode === 'off' ? 2500 : 20000);
    process.stdout.write('not killed\n');
  }, 300);
} else {
  // Short synchronous bursts below the limit keep the heartbeat moving.
  let rounds = 0;
  const tick = setInterval(() => {
    busy(250);
    if (++rounds === 10) {
      clearInterval(tick);
      process.stdout.write('alive\n');
    }
  }, 50);
}
