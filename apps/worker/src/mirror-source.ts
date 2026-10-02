import { ArkvoryClient, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { parseDescriptor } from '@proanima/arkvory-domain';
import type {
  Cancellation,
  MirrorAnnotation,
  MirrorArtifact,
  MirrorAsset,
  MirrorFeedPage,
  MirrorPage,
  MirrorSource,
  MirrorStage,
} from '@proanima/arkvory-application';

/** A metadata request that does not answer in this time is retried on the next step. */
const requestTimeoutMs = 60_000;
/** A content stream that delivers nothing for this long is aborted and resumed later. */
const idleTimeoutMs = 120_000;

async function absentAs<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ArkvoryHttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The source installation of one mirrored repository over its public API (ADR 0058), with a
 * read-only key read from the configured file. `stop` is the worker's shutdown signal; every
 * request also has its own deadline, so a hung source never blocks the worker.
 */
export class SdkMirrorSource implements MirrorSource {
  private readonly client: ArkvoryClient;
  constructor(
    upstream: string,
    private readonly repository: string,
    token: () => string,
    private readonly stop: AbortSignal,
  ) {
    this.client = new ArkvoryClient(upstream, token, { maxAttempts: 3 });
  }

  private signal(): AbortSignal {
    return AbortSignal.any([this.stop, AbortSignal.timeout(requestTimeoutMs)]);
  }

  async changes(after: string, cancellation: Cancellation): Promise<MirrorFeedPage> {
    cancellation.throwIfAborted();
    return this.client.catalogChanges(this.repository, { after, signal: this.signal() });
  }

  async artifacts(after: string | null): Promise<MirrorPage<MirrorArtifact>> {
    const page = await this.client.list(this.repository, after ?? undefined);
    return { items: page.items.map(artifact), next: page.next };
  }

  async packages(after: string | null): Promise<MirrorPage<string>> {
    const page = await this.client.packages(this.repository, {
      limit: 100,
      ...(after === null ? {} : { after }),
    });
    return { items: page.items.map((item) => item.artifactId), next: page.next };
  }

  async assets(after: string | null): Promise<MirrorPage<MirrorAsset>> {
    const page = await this.client.assetPage(
      this.repository,
      { limit: 100, ...(after === null ? {} : { after }) },
      this.signal(),
    );
    return {
      items: page.items.map(({ path, artifactId }) => ({ path, artifactId })),
      next: page.next,
    };
  }

  async artifact(id: string): Promise<MirrorArtifact | null> {
    const found = await absentAs(this.client.artifact(this.repository, id, this.signal()));
    return found && found.status === 'available' ? artifact(found) : null;
  }

  async annotation(id: string): Promise<MirrorAnnotation | null> {
    const found = await absentAs(this.client.annotations(this.repository, id));
    return found
      ? { labels: found.labels, metadata: found.metadata, collections: found.collections }
      : null;
  }

  async stages(id: string): Promise<readonly MirrorStage[]> {
    const found = await absentAs(this.client.promotions.stages(this.repository, id, this.signal()));
    return (found ?? []).map(({ stage, comment }) => ({ stage, comment }));
  }

  async asset(path: string): Promise<MirrorAsset | null> {
    const found = await absentAs(this.client.asset(this.repository, path));
    return found ? { path: found.path, artifactId: found.artifactId } : null;
  }

  async content(
    source: MirrorArtifact,
    start: number,
    end: number,
  ): Promise<AsyncIterable<Uint8Array>> {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.stop, controller.signal]);
    const response = await this.client.download(this.repository, source.id, { start, end }, signal);
    if (response.status !== 206 || !response.body) {
      controller.abort();
      throw new Error('The source answered a range request without partial content');
    }
    return limited(response.body, end - start + 1, controller);
  }
}

function artifact(upload: { id: string; descriptor: unknown }): MirrorArtifact {
  return { id: upload.id, descriptor: parseDescriptor(upload.descriptor) };
}

/** Exactly `expected` bytes or an error; a stalled stream is aborted after idleTimeoutMs. */
async function* limited(
  body: ReadableStream<Uint8Array>,
  expected: number,
  controller: AbortController,
): AsyncIterable<Uint8Array> {
  let received = 0;
  let timer = setTimeout(() => {
    controller.abort();
  }, idleTimeoutMs);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort();
      }, idleTimeoutMs);
      received += value.length;
      if (received > expected) throw new Error('The source sent more bytes than requested');
      yield value;
    }
    if (received !== expected) throw new Error('The source range ended early');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    controller.abort();
  }
}
