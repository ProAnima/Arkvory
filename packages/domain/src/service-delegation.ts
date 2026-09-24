import { DepotError } from './artifact.js';
import type { ServiceBinding } from './service-policy.js';
export const administrationActions = [
  'service-account.read',
  'service-account.manage',
  'policy.read',
  'policy.manage',
  'credential.read',
  'credential.manage',
  'service-audit.read',
] as const;
export type AdministrationAction = (typeof administrationActions)[number];
export interface ServiceDelegation {
  readonly keyId: string;
  readonly targetAccountId: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly actions: readonly AdministrationAction[];
  readonly ceiling: readonly ServiceBinding[];
}
export function parseAdministrationActions(value: unknown): readonly AdministrationAction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > administrationActions.length)
    throw new DepotError('invalid_input', 'Invalid administration actions');
  const values: readonly unknown[] = value;
  return [
    ...new Set(
      values.map((entry) => {
        const action = administrationActions.find((a) => a === entry);
        if (!action) throw new DepotError('invalid_input', 'Unknown administration action');
        return action;
      }),
    ),
  ].sort();
}
