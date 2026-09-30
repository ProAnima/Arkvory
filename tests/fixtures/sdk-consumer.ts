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

// ADR 0041 adds an optional AbortSignal to registerPackage; existing invocations remain assignable.
export type ExistingCallsRemainValid = Assert<ArkvoryClient extends LegacyClient ? true : false>;
// Compile against built package exports, as an external strict TypeScript consumer does.
export type UnchangedMethods = Assert<Equal<ChangedMethods, 'registerPackage'>>;
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
