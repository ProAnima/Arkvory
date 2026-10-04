import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function exerciseContainerRecovery(run, compose, ready) {
  for (const role of ['api', 'worker', 'backup', 'database']) {
    const name = `proanima-arkvory-${role}-1`;
    const inspect = () => JSON.parse(run(['inspect', name]))[0];
    assert.equal(inspect().HostConfig.RestartPolicy.Name, 'unless-stopped');
    const before = inspect().RestartCount;
    try {
      if (role === 'database') {
        // Stop PostgreSQL immediately, without telling the engine to stop the container.
        run([
          ...compose,
          'exec',
          '-T',
          '-u',
          'postgres',
          role,
          'sh',
          '-c',
          'pg_ctl -D "$PGDATA" stop -m immediate -w -t 30',
        ]);
      } else {
        run([
          ...compose,
          'exec',
          '-T',
          role,
          'node',
          '-e',
          "const fs=require('fs');for(const p of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))){try{const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8');if(c.split('\\0')[1]==='apps/deploy/dist/container.js')process.kill(Number(p),'SIGKILL');}catch{}}",
        ]);
      }
    } catch (error) {
      // The supervisor may terminate exec along with the crashed main process.
      if (![137, 143].includes(error.status)) throw error;
    }
    let recovered = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      await delay(1000);
      const state = inspect();
      if (state.RestartCount > before && state.State.Running && !state.State.Restarting) {
        recovered = true;
        break;
      }
    }
    assert.ok(recovered, `${role} must recover without docker start or compose up`);
    await ready();
  }
  console.log(
    'Container restart policy and actual API/worker/backup/database crash recovery passed',
  );
}

// Runs inside a service container: opens the inspector of its role process (SIGUSR1) and pauses
// the main thread. Its other threads go on, as in a real hang; the script returns when the
// process dies. Only Node built-ins: fetch and WebSocket are global in Node 24.
const pauseMainThread = `
const fs = require('fs');
const pid = fs.readdirSync('/proc').filter((p) => /^\\d+$/.test(p)).find((p) => {
  try { return fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\\0')[1] === 'apps/deploy/dist/container.js'; }
  catch { return false; }
});
process.kill(Number(pid), 'SIGUSR1');
(async () => {
  let targets;
  for (let attempt = 0; attempt < 50 && !targets; attempt++) {
    try { targets = await (await fetch('http://127.0.0.1:9229/json/list')).json(); }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  socket.onopen = () => {
    socket.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
    socket.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }));
  };
  await new Promise((resolve) => { socket.onclose = resolve; socket.onerror = resolve; });
})();
`;

/**
 * A hang, not a crash: each service's main thread is paused at once and nothing ends it but
 * the event-loop watchdog (ADR 0067, default 60 s). The engine then restarts the container by
 * its policy, and the installation is ready again without docker start or compose up.
 */
export async function exerciseStallRecovery(run, compose, ready) {
  const roles = ['api', 'worker', 'backup'];
  const inspect = (role) => JSON.parse(run(['inspect', `proanima-arkvory-${role}-1`]))[0];
  const before = Object.fromEntries(roles.map((role) => [role, inspect(role).RestartCount]));
  await Promise.all(
    roles.map(
      (role) =>
        new Promise((resolve, reject) => {
          const pause = spawn(
            'docker',
            [...compose, 'exec', '-T', role, 'node', '-e', pauseMainThread],
            { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
          );
          let stderr = '';
          pause.stderr.on('data', (chunk) => (stderr += chunk));
          const timer = setTimeout(() => {
            pause.kill();
            reject(new Error(`${role}: the paused process was not ended by its watchdog`));
          }, 180000);
          pause.on('close', () => {
            clearTimeout(timer);
            resolve();
          });
          pause.on('error', (error) => {
            clearTimeout(timer);
            reject(new Error(`${role}: ${error.message} ${stderr.slice(0, 300)}`));
          });
        }),
    ),
  );
  for (const role of roles) {
    let recovered = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      const state = inspect(role);
      if (state.RestartCount > before[role] && state.State.Running && !state.State.Restarting) {
        recovered = true;
        break;
      }
      await delay(1000);
    }
    assert.ok(recovered, `${role} must be restarted after its main thread hung`);
  }
  await ready();
  console.log(
    'Container hang recovery: the event-loop watchdog ended paused API, worker and backup agent; the engine restarted them',
  );
}
