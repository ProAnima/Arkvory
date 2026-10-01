import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { LegacyClient, LegacyConstructor } from './sdk-legacy.js';

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Signature<T> = T extends (...args: infer P) => infer R ? [P, R] : never;
type ChangedMethods = {
  [K in keyof LegacyClient]: Equal<
    Signature<LegacyClient[K]>,
    Signature<ArkvoryClient[K]>
  > extends true
    ? never
    : K;
}[keyof LegacyClient];

// ADR 0041 adds an optional AbortSignal to registerPackage; ADR 0046 adds part layout limits to
// capabilities. Existing invocations and reads remain assignable.
// ADR 0047 widens deletion blockers (promotion_stage) and permission names (artifact.promote);
// exhaustive consumers of these values must handle the additions.
type Widened =
  | 'inspectDeletion'
  | 'deleteArtifact'
  | 'previewStoragePolicy'
  | 'runStoragePolicy'
  | 'previewRetention'
  | 'applyRetention'
  | 'repositories'
  | 'repository';
export type ExistingCallsRemainValid = Assert<
  Omit<ArkvoryClient, Widened> extends Omit<LegacyClient, Widened> ? true : false
>;
type Blocker<T> = T extends {
  inspectDeletion(...args: never[]): Promise<{ blockers: readonly (infer B)[] }>;
}
  ? B
  : never;
export type WidenedBlockers = Assert<
  Equal<Exclude<Blocker<ArkvoryClient>, Blocker<LegacyClient>>, 'promotion_stage'>
>;
// Compile against built package exports, as an external strict TypeScript consumer does.
export type UnchangedMethods = Assert<
  Equal<ChangedMethods, 'registerPackage' | 'capabilities' | Widened>
>;
export type UnchangedKeys = Assert<
  Equal<
    Exclude<
      keyof ArkvoryClient,
      | 'identity'
      | 'administration'
      | 'updates'
      | 'inRepository'
      | 'cleanup'
      | 'configureCleanup'
      | 'requestCleanup'
      | 'register'
      | 'tokens'
      | 'createToken'
      | 'revokeToken'
      | 'promotions'
    >,
    keyof LegacyClient
  >
>;
export type UnchangedConstructor = Assert<
  Equal<ConstructorParameters<typeof ArkvoryClient>, ConstructorParameters<LegacyConstructor>>
>;

export function metadataSearch(client: ArkvoryClient, signal: AbortSignal) {
  void client.search('releases', { metadataKey: 'commit', metadataValue: 'abc' });
  void client.registerPackage('releases', 'artifact', signal);
}
