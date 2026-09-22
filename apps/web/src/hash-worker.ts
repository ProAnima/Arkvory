import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!(event.data instanceof Blob)) return;
  const file = event.data;
  void (async () => {
    const hash = sha256.create();
    const reader = file.stream().getReader();
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        hash.update(chunk.value);
        bytes += chunk.value.byteLength;
        globalThis.postMessage({ bytes });
      }
      globalThis.postMessage({ sha256: bytesToHex(hash.digest()) });
    } finally {
      reader.releaseLock();
      hash.destroy();
    }
  })().catch(() => {
    globalThis.postMessage({ error: 'Hashing failed' });
  });
});
