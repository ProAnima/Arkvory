import { createServer } from '../../apps/api/dist/index.js';
let app;
let timer;
process.once('message', async (config) => {
  try {
    app = await createServer(config);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    process.send({ address });
    timer = setInterval(() => process.send?.({ rss: process.memoryUsage().rss }), 100);
  } catch (error) {
    process.send({ error: error.message });
    process.exitCode = 1;
    process.disconnect();
  }
});
process.on('disconnect', () => {
  clearInterval(timer);
  void app?.close();
});
