import type { ModuleSignal } from './descriptor.js';
import type { ModuleJson } from './json.js';

/**
 * HTTP methods of a module route (ADR 0083, N7). A `GET` route answers `HEAD` too: the core sends
 * the headers of the response and closes its body unread.
 */
export const MODULE_ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ModuleRouteMethod = (typeof MODULE_ROUTE_METHODS)[number];

/**
 * Repository actions a module route may require. The core checks the caller holds the action on
 * the repository named by the route's `repositoryParam` before the handler runs, by the rules of
 * `/api/v1`: a service key by its permissions, an account by its read or write grant. The first
 * seven read, the others change the repository and are refused in a mirrored one.
 */
export const MODULE_ROUTE_ACTIONS = [
  'repository.read',
  'artifact.read',
  'artifact.list',
  'content.read',
  'package.read',
  'asset.read',
  'annotation.read',
  'upload.create',
  'package.publish',
  'asset.write',
  'annotation.write',
] as const;
export type ModuleRouteAction = (typeof MODULE_ROUTE_ACTIONS)[number];

/** The largest JSON request body a route may accept: 1 MiB. */
export const MODULE_JSON_BODY_LIMIT = 1024 * 1024;
/** The largest JSON response a route may produce: 16 MiB, serialized in memory. */
export const MODULE_JSON_RESPONSE_LIMIT = 16 * 1024 * 1024;
/** The longest a handler may take until its response starts: one hour. */
export const MODULE_ROUTE_TIMEOUT_LIMIT_MS = 60 * 60 * 1000;
/** Routes one module may declare. */
export const MODULE_ROUTE_LIMIT = 64;

/**
 * What a route accepts: no body, a JSON document up to `limit` bytes (at most
 * `MODULE_JSON_BODY_LIMIT`), or a byte stream up to `limit` bytes (at most the core's largest
 * object). A stream body is read under the core's upload admission, idle timeout, deadline and
 * upload bandwidth budget.
 */
export type ModuleRouteBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly limit: number }
  | { readonly kind: 'stream'; readonly limit: number };

/** The request body as the handler receives it; JSON stays `unknown` until the module checks it. */
export type ModuleRequestBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly value: unknown }
  | {
      readonly kind: 'stream';
      /** `Content-Length` when the client sent one. */
      readonly length: number | null;
      /** Read once; the core counts the bytes and refuses more than the route's limit. */
      readonly bytes: AsyncIterable<Uint8Array>;
    };

/**
 * One request after the core authenticated it and checked `access` and `action`. Credentials,
 * cookies and other headers never reach the module.
 */
export interface ModuleRequest {
  readonly method: ModuleRouteMethod | 'HEAD';
  /** Path parameters by name, decoded. */
  readonly params: Readonly<Record<string, string>>;
  /** Query parameters; a repeated parameter is refused by the core before the handler. */
  readonly query: Readonly<Record<string, string>>;
  readonly body: ModuleRequestBody;
  /** The request id of the response, for the module's own log records. */
  readonly requestId: string;
}

/**
 * Codes a handler may refuse a request with; the core answers with the error envelope of the
 * API (ADR 0051) and a fixed message.
 */
export const MODULE_ROUTE_ERRORS = [
  'invalid_input',
  'not_found',
  'conflict',
  'forbidden',
  'busy',
  'unavailable',
  'capacity_exceeded',
  'integrity_mismatch',
] as const;
export type ModuleRouteError = (typeof MODULE_ROUTE_ERRORS)[number];

/**
 * What a handler answers. The core reads it as untrusted input: anything outside this shape is a
 * server error of the module, never sent as it is.
 *
 * - `json`: a document of at most `responseLimit` bytes (and `MODULE_JSON_RESPONSE_LIMIT`).
 * - `content`: a published artifact, sent by the core exactly as `/api/v1` sends content: the
 *   caller needs `content.read` on the repository, and the core gives ETag, `If-None-Match`,
 *   one Range, `If-Range`, `HEAD`, the download queue and the download bandwidth budget. `cache:
 *   'immutable'` lets private caches keep the bytes for a year: a published blob never changes
 *   and its ETag is its SHA-256. Without it nothing is cached.
 * - `stream`: bytes the module builds itself, at most `responseLimit` and exactly `length` when
 *   known. No Range (`Accept-Ranges: none`); `etag`, when given, is a strong quoted tag the core
 *   answers `If-None-Match` with. Admitted per request and paced by the download budget.
 * - `error`: a refusal with one of `MODULE_ROUTE_ERRORS`.
 *
 * A body the core does not read (HEAD, 304, a refusal, a cancelled request) is closed with
 * `return()`.
 */
export type ModuleResponse =
  | { readonly kind: 'json'; readonly status: 200 | 201 | 202; readonly body: ModuleJson }
  | {
      readonly kind: 'content';
      readonly repository: string;
      readonly artifact: string;
      readonly cache?: 'no-store' | 'immutable';
    }
  | {
      readonly kind: 'stream';
      /** `type/subtype`, lowercase, with an optional `; charset=…`; never HTML, XML, SVG or script. */
      readonly contentType: string;
      readonly length: number | null;
      readonly etag: string | null;
      readonly body: AsyncIterable<Uint8Array>;
    }
  | { readonly kind: 'error'; readonly code: ModuleRouteError };

/**
 * One HTTP route of a module (ADR 0079, 5.2; ADR 0083, N7). The core authenticates the request,
 * checks `access` and `action`, admits writes, applies body limits and the error contract, and
 * only then calls `handle`. Routes with `effect: 'read'` are `GET` and are also served by read
 * gateways when the module runs there; routes that write are served by the writer only.
 */
export interface ModuleRoute {
  readonly method: ModuleRouteMethod;
  /**
   * The full path under one of the module's `routePrefixes` (`/api/ext/<id>/v<major>/…`): literal
   * segments of lowercase letters, digits, `.`, `_` and `-`, and parameters `:name`.
   */
  readonly path: string;
  /** `<module id>.<name>`, unique in the module; the same in the OpenAPI fragment. */
  readonly operationId: string;
  readonly effect: 'read' | 'write';
  /** Any authenticated caller, or the global administrator of the installation only. */
  readonly access: 'authenticated' | 'administrator';
  /**
   * The repository action the caller must hold, checked on the repository named by the path
   * parameter `repositoryParam`; both null for none. A writing route open to every authenticated
   * caller must name a writing action.
   */
  readonly action: ModuleRouteAction | null;
  readonly repositoryParam: string | null;
  readonly body: ModuleRouteBody;
  /** The largest `json` or `stream` response in bytes. */
  readonly responseLimit: number;
  /**
   * How long the handler may take until it answers, in milliseconds (at most
   * `MODULE_ROUTE_TIMEOUT_LIMIT_MS`); then its signal aborts and the caller gets `unavailable`.
   * A stream body is read within this time.
   */
  readonly timeoutMs: number;
  /**
   * Answers one request. The signal aborts when the client goes away, the time runs out or the
   * process stops; the handler then gives up. A throw is a server error: the caller gets
   * `internal` and the log records `module.route_failed`.
   */
  handle(request: ModuleRequest, signal: ModuleSignal): Promise<ModuleResponse>;
}

/**
 * A transfer protocol the module serves under one of its route prefixes (ADR 0079, 5.2). The
 * core lists it in `capabilities.transfer`; a client that has an extension of the same name and
 * a common version may use it, and falls back to the core's transfer otherwise.
 */
export interface ModuleTransferOffer {
  /** `[a-z][a-z0-9-]{1,31}`, unique in the installation. */
  readonly name: string;
  /** Semver versions of the protocol, 1 to 16, without duplicates. */
  readonly versions: readonly string[];
  /** One of the module's `routePrefixes` with at least one route. */
  readonly prefix: string;
}

/**
 * The host service `routes` (ADR 0083, section 2.4), for modules that declare it in `uses`.
 * Every call belongs in `create`: the core checks the declaration right after `create` returns
 * and refuses later calls. A module whose routes, fragment or offers break the contract does not
 * start (`routes_invalid`, `openapi_invalid`, `openapi_route_mismatch`, `transfer_invalid`).
 */
export interface ModuleRoutes {
  add(route: ModuleRoute): void;
  /**
   * The OpenAPI 3.1 fragment of the routes, once; required when the module has routes. Paths are
   * full paths with `{name}` parameters, each operation names its `operationId` and
   * `x-arkvory-access`, components are `components.schemas.ext_<id>_*` (hyphens of the id as
   * `_`), and references point only to them or to the core's `NativeError`. Security schemes are
   * the core's.
   */
  document(fragment: ModuleJson): void;
  /** Advertises a transfer protocol; only modules of kind `transfer`. */
  offerTransfer(offer: ModuleTransferOffer): void;
}
