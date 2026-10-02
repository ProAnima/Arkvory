import assert from 'node:assert/strict';
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
