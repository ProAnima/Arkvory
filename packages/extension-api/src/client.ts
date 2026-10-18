import type { ModuleSignal } from './descriptor.js';
import type { ModuleManifest } from './manifest.js';

/** Pattern of the name of a transfer or tree capability. */
export const TRANSFER_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The capability the client and the server agreed on (ADR 0079, 5.2): the server's offer from
 * `capabilities.transfer` with the highest version both sides know.
 */
export interface TransferOffer {
  readonly name: string;
  /** Semver version of the protocol, as `capabilities.transfer` lists it. */
  readonly version: string;
  /** The module that serves the capability on the server. */
  readonly module: string;
  /** Path prefix of the module's routes, such as `/api/ext/<id>/v1/`. */
  readonly prefix: string;
}

/** One request an extension sends to its module's routes; bodies are bounded byte arrays. */
export interface TransferRequest {
  readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
}

/**
 * The server's 2xx answer to a `TransferRequest`. Any other status rejects with the client's
 * HTTP error (its machine code and reason, ADR 0051), as every other request of the client.
 */
export interface TransferResponse {
  readonly status: number;
  header(name: string): string | null;
  /** The body; read it to the end or call `cancel`. */
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
}

/**
 * Requests under the agreed offer's prefix. The client adds its credential and checks the
 * server as for every other request; the extension never sees the credential.
 */
export interface TransferChannel {
  /** `path` is relative to the offer's prefix, without a leading `/`, and may carry a query. */
  request(path: string, request: TransferRequest, signal: ModuleSignal): Promise<TransferResponse>;
}

/** A download the extension may carry out its own way. */
export interface TransferDownload {
  readonly offer: TransferOffer;
  readonly channel: TransferChannel;
  readonly repository: string;
  readonly artifactId: string;
  /** Decimal bytes of the artifact. */
  readonly size: string;
  /** Lowercase hex SHA-256 of the artifact. */
  readonly sha256: string;
  /** Bytes the caller already holds: the extension yields the content from this offset on. */
  readonly offset: number;
  /** Bytes `start` to `end` (inclusive) of the artifact through the core content route. */
  readRange(start: number, end: number, signal: ModuleSignal): Promise<Uint8Array>;
}

/** An upload the extension may carry out its own way; the upload session already exists. */
export interface TransferUpload {
  readonly offer: TransferOffer;
  readonly channel: TransferChannel;
  readonly repository: string;
  readonly uploadId: string;
  /** Decimal bytes of the content. */
  readonly size: string;
  /** Lowercase hex SHA-256 of the content, computed by the client. */
  readonly sha256: string;
  /** Bytes `start` to `end` (inclusive) of the local content. */
  read(start: number, end: number, signal: ModuleSignal): Promise<Uint8Array>;
}

/**
 * A client-side way to move bytes (ADR 0079, 5.2). The client offers it only when the server
 * offers the same name and a common version, and the core's own transfer stays available: a
 * method that returns null declines, and a failure falls back to the core transfer, except in
 * `strict` mode. The client always verifies the result itself — the size and SHA-256 of a
 * download, the published descriptor of an upload — so an extension cannot make it accept
 * other bytes.
 */
export interface TransferExtension {
  readonly name: string;
  /**
   * Semver versions of the protocol this extension speaks, as the server's
   * `capabilities.transfer` lists them (`ModuleTransferOffer.versions`); matched exactly.
   */
  readonly versions: readonly string[];
  /**
   * The content from `plan.offset` to the end, in order. The client stops reading at the size
   * and continues with the core transfer from wherever a failing stream stopped.
   */
  download?(
    plan: TransferDownload,
    signal: ModuleSignal,
  ): Promise<AsyncIterable<Uint8Array> | null>;
  /**
   * Delivers the content to the server; resolves `true` once the module holds it (the client
   * then finishes the upload the core way, sending what is still missing), `false` to decline.
   */
  upload?(plan: TransferUpload, signal: ModuleSignal): Promise<boolean>;
}

/** What a client module gets when `arkvoryctl` creates it. */
export interface ClientModuleContext {
  /** Aborts when the command ends or is cancelled. */
  readonly signal: ModuleSignal;
  /** Version of the client that loads the module, such as `0.6.0` or `development`. */
  readonly clientVersion: string;
}

/** The contributions of a client module (ADR 0079, 5.11). */
export interface ClientModule {
  readonly transfer?: readonly TransferExtension[];
}

/** The module fields of a client package's `module.json`: no server `roles`. */
export type ClientModuleManifest = Omit<ModuleManifest, 'roles'>;

/**
 * The default export of the entry of a client package (`side: client`, ADR 0078, 3.1). Its
 * manifest must equal the signed one; `create` does no I/O, the contributions do it when used.
 */
export interface ClientModuleDescriptor {
  readonly manifest: ClientModuleManifest;
  create(context: ClientModuleContext): ClientModule;
}
