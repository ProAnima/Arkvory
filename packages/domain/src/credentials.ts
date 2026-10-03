/** How a request authenticated. Policies use it to tell interactive sessions from automation. */
export type CredentialKind =
  | 'session'
  | 'personal-token'
  | 'service-key'
  | 'file-key'
  /** A download link (ADR 0062): one artifact's content, issued by another principal. */
  | 'transfer-token';
export const credentialKinds: readonly CredentialKind[] = [
  'session',
  'personal-token',
  'service-key',
  'file-key',
  'transfer-token',
];
/** `read` personal tokens never carry write grants, whatever the account's groups allow. */
export type TokenScope = 'read' | 'read-write';
