import { setTimeout as delay } from 'node:timers/promises';
import type { AgentHeartbeat, FileVault } from '@proanima/arkvory-infrastructure';

const probeTimeoutMs = 5000;

/**
 * Vault facts of the heartbeat: identity and statfs of the vault volume. A hung NAS mount must
 * not stall lease renewal, so a probe is bounded and single-flight: while one is unsettled the
 * vault is reported unavailable instead of queueing more filesystem calls behind it.
 */
export class VaultProbe {
  private inflight: Promise<AgentHeartbeat> | undefined;
  private vaultId: string | null = null;
  /** Last failure code of the agent, reported with every heartbeat. */
  lastError: string | null = null;

  constructor(private readonly vault: FileVault | null) {}

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
