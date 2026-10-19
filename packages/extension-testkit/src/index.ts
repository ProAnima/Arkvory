export {
  storageRegistrationContract,
  computeContract,
  changeFeedContract,
} from './host-registration.js';
/**
 * Contract suites of the extension points and host services (ADR 0079, section 7; ADR 0083,
 * section 1). Each suite is a function of a factory of the implementation under test; core
 * implementations and external modules run the same suites. Product code never imports this
 * package: only tests do.
 */
export {
  stagedCompletionContract,
  verifyThenCommit,
  type StagedHarness,
} from './staged-completion.js';
export { catalogReadContract, type CatalogReadHarness } from './catalog-read.js';
export { licenseContract, type LicenseHarness } from './license.js';
export {
  dataDirectoryContract,
  type DataDirectoryHarness,
  type DataQuota,
} from './data-directory.js';
export {
  capabilityContract,
  counterConsumer,
  counterProvider,
  type CapabilityHost,
  type Counter,
  type HostRun,
  type HostedModule,
  type TestDescriptor,
} from './capability.js';
export { bytesOf, descriptorOf, gather, sha256 } from './support.js';

/**
 * Which suite covers each host service of the contract. A service the core provides without a
 * suite here is refused by a governance test: a point enters the contract with its suite.
 */
export const CONTRACT_SUITES = {
  license: 'licenseContract',

  'blob-store': 'storageRegistrationContract',
  compute: 'computeContract',
  'change-feed': 'changeFeedContract',
  'staged-completion': 'stagedCompletionContract',
  'catalog-read': 'catalogReadContract',
  'content-read': 'catalogReadContract',
  'upload-read': 'uploadReadContract',
  'data-directory': 'dataDirectoryContract',
} as const;

export { uploadReadContract, type UploadReadHarness } from './upload-read.js';
