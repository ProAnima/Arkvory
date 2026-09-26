/** Session ID survives reload; a duplicated tab must acquire its own workspace. */
export async function openDownloadWorkspace(): Promise<FileSystemDirectoryHandle> {
  const root = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle('arkvory-download-staging-v1', { create: true });
  let name: string | null = null;
  try {
    name = sessionStorage.getItem('arkvory.download.session');
  } catch {
    /* Storage may be disabled. */
  }
  if (!name || !/^session-[a-f0-9-]{36}$/.test(name)) name = `session-${crypto.randomUUID()}`;
  const acquire = (candidate: string): Promise<FileSystemDirectoryHandle> =>
    new Promise((resolve, reject) => {
      void navigator.locks
        .request(`arkvory-download:${candidate}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(acquire(`session-${crypto.randomUUID()}`));
            return;
          }
          try {
            const directory = await root.getDirectoryHandle(candidate, { create: true });
            try {
              sessionStorage.setItem('arkvory.download.session', candidate);
            } catch {
              /* In-memory transfers still work. */
            }
            for await (const [entry, handle] of root.entries()) {
              if (
                entry === candidate ||
                handle.kind !== 'directory' ||
                !/^session-[a-f0-9-]{36}$/.test(entry)
              )
                continue;
              await navigator.locks.request(
                `arkvory-download:${entry}`,
                { ifAvailable: true },
                async (available) => {
                  if (available && !(await recentReceipts(await root.getDirectoryHandle(entry))))
                    await root.removeEntry(entry, { recursive: true });
                },
              );
            }
            resolve(directory);
            // Released by the browser on document destruction, including crashes.
            await new Promise<void>(() => undefined);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Download storage unavailable'));
          }
        })
        .catch(reject);
    });
  return acquire(name);
}

async function recentReceipts(directory: FileSystemDirectoryHandle) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    const file = await (await directory.getFileHandle(name)).getFile();
    // Preserve recoverable intents during a reload gap; reclaim abandoned data after seven days.
    if (Date.now() - file.lastModified < 7 * 86400000) return true;
  }
  return false;
}
