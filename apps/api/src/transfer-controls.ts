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
  const loginGate = new AdmissionQueue(2, 16, 16, 1000, 2);
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
      uploadBandwidth.close();
      downloadBandwidth.close();
    },
  };
}
export type TransferControls = ReturnType<typeof createTransferControls>;
