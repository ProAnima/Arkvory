/** How a request authenticated. Policies use it to tell interactive sessions from automation. */
export type CredentialKind = 'session' | 'personal-token' | 'service-key' | 'file-key';
export const credentialKinds: readonly CredentialKind[] = [
  'session',
  'personal-token',
  'service-key',
  'file-key',
];
/** `read` personal tokens never carry write grants, whatever the account's groups allow. */
export type TokenScope = 'read' | 'read-write';
