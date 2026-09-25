export const serviceActions = [
  'repository.read',
  'artifact.read',
  'artifact.list',
  'artifact.delete',
  'content.read',
  'upload.create',
  'upload.read',
  'upload.write',
  'upload.complete',
  'upload.cancel',
  'job.read',
  'package.read',
  'package.publish',
  'asset.read',
  'asset.write',
  'asset.restore',
  'annotation.read',
  'annotation.write',
  'reference.write',
  'audit.read',
] as const;
export type ServiceAction = (typeof serviceActions)[number];
export interface ServiceBinding {
  readonly resource: { readonly kind: 'repository'; readonly id: string };
  readonly actions: readonly ServiceAction[];
}
export interface ManagedCredential {
  readonly accountId: string;
  readonly keyId: string;
  readonly bindings: readonly ServiceBinding[];
}
