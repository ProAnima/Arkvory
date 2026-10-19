import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { LicenseEvidence, LicenseService } from '@proanima/arkvory-extension-api';

/** A fresh licence reader; mutations use the host's verified activation and revocation paths. */
export interface LicenseHarness {
  readonly service: LicenseService;
  readonly feature: string;
  activate(): Promise<LicenseEvidence>;
  revoke(): Promise<LicenseEvidence>;
}

/** Read-only module view: no grant without a licence, exact evidence and signed revocation. */
export function licenseContract(
  name: string,
  open: (t: TestContext) => Promise<LicenseHarness>,
): void {
  void test(`${name}: licence state and evidence follow verified documents`, async (t) => {
    const h = await open(t);
    assert.equal((await h.service.view(h.feature)).state, 'none');
    assert.deepEqual(await h.service.evidence(), []);
    const token = await h.activate();
    const view = await h.service.view(h.feature);
    assert.equal(view.state, 'valid');
    assert.equal(view.licenseId, token.licenseId);
    assert.ok(view.features.includes(h.feature));
    assert.equal((await h.service.view('absent-contract-feature')).state, 'none');
    assert.deepEqual(await h.service.evidence(), [token]);
    const statement = await h.revoke();
    assert.equal((await h.service.view(h.feature)).state, 'revoked');
    assert.deepEqual(await h.service.evidence(), [token, statement]);
  });
}
