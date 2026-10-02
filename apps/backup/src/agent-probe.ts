import { setTimeout as delay } from 'node:timers/promises';
import type { AgentHeartbeat, FileVault } from '@proanima/arkvory-infrastructure';

const probeTimeoutMs = 5000;
/** Write checks are rarer than heartbeats: a sleeping backup disk is not woken every 30 s. */
export const writeProbeIntervalMs = 10 * 60 * 1000;

/**
 * Vault facts of the heartbeat: identity and statfs of the vault volume, and on the first
 * heartbeat and then every writeProbeIntervalMs a file created and removed in it, so
 * "available" also means writable. A hung NAS mount must not stall lease renewal, so a probe
 * is bounded and single-flight: while one is unsettled the vault is reported unavailable
 * instead of queueing more filesystem calls behind it.
 */
export class VaultProbe {
  private inflight: Promise<AgentHeartbeat> | undefined;
  private vaultId: string | null = null;
  private writtenAt: number | null = null;
  /** Last failure code of the agent, reported with every heartbeat. */
  lastError: string | null = null;

  constructor(
    private readonly vault: FileVault | null,
    private readonly now: () => number = Date.now,
  ) {}

  async facts(): Promise<AgentHeartbeat> {
    const vault = this.vault;
    if (!vault)
      return {
        vaultConfigured: false,
        vaultId: null,
        vaultAvailable: false,
        freeBytes: null,
        totalBytes: null,
        lastError: this.lastError,
      };
    const probe = (this.inflight ??= this.probe(vault).finally(() => {
      this.inflight = undefined;
    }));
    const timeout = delay(probeTimeoutMs, undefined, { ref: false }).then(() => this.unavailable());
    return Promise.race([probe.catch(() => this.unavailable()), timeout]);
  }

  private async probe(vault: FileVault): Promise<AgentHeartbeat> {
    const [identity, volume] = await Promise.all([vault.identity(), vault.volume()]);
    this.vaultId = identity.vaultId;
    const now = this.now();
    if (this.writtenAt === null || now - this.writtenAt >= writeProbeIntervalMs) {
      // A failed write keeps the vault unavailable until a later probe writes again.
      this.writtenAt = null;
      await vault.writeProbe();
      this.writtenAt = now;
    }
    return {
      vaultConfigured: true,
      vaultId: identity.vaultId,
      vaultAvailable: true,
      freeBytes: volume.freeBytes,
      totalBytes: volume.totalBytes,
      lastError: this.lastError,
    };
  }

  private unavailable(): AgentHeartbeat {
    return {
      vaultConfigured: true,
      vaultId: this.vaultId,
      vaultAvailable: false,
      freeBytes: null,
      totalBytes: null,
      lastError: this.lastError,
    };
  }
}
