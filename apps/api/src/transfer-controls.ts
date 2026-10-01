import { AdmissionQueue, BandwidthGovernor, downloadShare } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';

export function createTransferControls(config: ServerConfig, available: () => boolean) {
  const share = config.sharedDownloads ? downloadShare(config.sharedDownloads) : undefined;
  const ceiling = (local: number | undefined, allocated: number | undefined) =>
    Math.min(local || Infinity, allocated || Infinity) === Infinity
      ? 0
      : Math.min(local || Infinity, allocated || Infinity);
  const uploadGate = new AdmissionQueue(
    config.maxUploads,
    config.transferQueueLimit ?? 64,
    config.transferQueuePerPrincipal ?? Math.min(8, config.transferQueueLimit ?? 64),
    config.transferQueueTimeoutMs ?? 20000,
    config.maxUploadsPerPrincipal ?? 1,
  );
  const downloadGate = new AdmissionQueue(
    config.maxDownloads,
    config.transferQueueLimit ?? 64,
    config.transferQueuePerPrincipal ?? Math.min(8, config.transferQueueLimit ?? 64),
    config.transferQueueTimeoutMs ?? 20000,
    config.maxDownloadsPerPrincipal ?? Math.min(4, config.maxDownloads),
  );
  // Anonymous hashing: one active and four queued per client address, so one source cannot
  // occupy both slots or the whole queue.
  const loginGate = new AdmissionQueue(2, 16, 4, 1000, 1);
  // Authenticated password work (own password, administrator create/reset) never waits behind
  // anonymous logins.
  const accountGate = new AdmissionQueue(1, 8, 8, 10000, 1);
  const owners = [...new Set(config.keys.map((key) => key.principal.id))];
  const uploadBandwidth = new BandwidthGovernor(
    {
      bytesPerSecond: config.uploadBytesPerSecond ?? 0,
      perPrincipalBytesPerSecond: config.uploadBytesPerSecondPerPrincipal ?? 0,
    },
    owners,
    available,
  );
  const downloadBandwidth = new BandwidthGovernor(
    {
      bytesPerSecond: ceiling(config.downloadBytesPerSecond, share?.bytesPerSecond),
      perPrincipalBytesPerSecond: ceiling(
        config.downloadBytesPerSecondPerPrincipal,
        share?.perPrincipalBytesPerSecond,
      ),
    },
    owners,
    available,
  );

  return {
    uploadGate,
    downloadGate,
    loginGate,
    accountGate,
    uploadBandwidth,
    downloadBandwidth,
    registerOwner: (id: string) => {
      uploadBandwidth.register(id);
      downloadBandwidth.register(id);
    },
    drain: () => {
      uploadGate.drain();
      downloadGate.drain();
      loginGate.drain();
    },
    close: () => {
      uploadGate.close();
      downloadGate.close();
      loginGate.close();
      accountGate.close();
      uploadBandwidth.close();
      downloadBandwidth.close();
    },
  };
}
export type TransferControls = ReturnType<typeof createTransferControls>;
