import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { GitHubReleases } from './github.js';
import { record, version } from './model.js';
import { RemoteError } from './remote-model.js';
import type { RemoteInput, RemoteTarget, RemoteOwner } from './remote-model.js';
import { RemoteSsh, discoverHost } from './remote-ssh.js';
import {
  inspectTarget,
  makeRemoteStage,
  nativeAsset,
  installCommand,
  remoteNode,
  removeRemoteStage,
} from './remote-target.js';
import { openTunnel } from './remote-tunnel.js';

export type RemotePhase =
  | 'fingerprint'
  | 'inspect'
  | 'review'
  | 'download'
  | 'upload'
  | 'install'
  | 'owner'
  | 'verify'
  | 'ready'
  | 'failed'
  | 'closed';
export interface RemoteState {
  destination: string;
  phase: RemotePhase;
  fingerprint: string;
  target: RemoteTarget | null;
  version: string;
  url: string;
  error: string;
}
export class RemoteWorkflow {
  readonly state: RemoteState = {
    destination: '',
    phase: 'fingerprint',
    fingerprint: '',
    target: null,
    version: '',
    url: '',
    error: '',
  };
  private readonly ssh = new RemoteSsh();
  private tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined;
  private busy = false;
  private owner: RemoteOwner | undefined;
  private readonly lifecycle = new AbortController();
  constructor(
    private readonly input: RemoteInput,
    private readonly artifact?: string,
  ) {
    this.state.destination = `${input.username}@${input.host}:${String(input.port)}`;
  }
  async discover() {
    const fingerprint = await discoverHost(this.input);
    this.lifecycle.signal.throwIfAborted();
    this.state.fingerprint = fingerprint;
  }
  async inspect() {
    if (this.busy || this.state.phase !== 'fingerprint' || !this.state.fingerprint)
      throw new RemoteError('state');
    await this.run(async () => {
      this.state.phase = 'inspect';
      await this.ssh.connect(this.input, this.state.fingerprint);
      this.lifecycle.signal.throwIfAborted();
      this.state.target = await inspectTarget(this.ssh, this.input.platform);
      this.lifecycle.signal.throwIfAborted();
      this.state.phase = 'review';
      // Release authentication material once the established connection owns authentication.
      this.input.password = '';
      this.input.privateKey = '';
      this.input.passphrase = '';
    });
  }
  async install(owner?: RemoteOwner) {
    const target = this.state.target;
    if (this.busy || this.state.phase !== 'review' || !target) throw new RemoteError('state');
    if (!target.installed && !owner) throw new RemoteError('owner');
    this.owner = owner;
    await this.run(async () => {
      if (!target.installed) await this.installNew(target);
      this.lifecycle.signal.throwIfAborted();
      this.state.phase = 'verify';
      await this.ssh.exec(remoteNode(target.platform, readinessScript), '', 150000);
      this.lifecycle.signal.throwIfAborted();
      this.tunnel = await openTunnel(this.ssh);
      this.lifecycle.signal.throwIfAborted();
      const response = await fetch(this.tunnel.url + '/health/live', {
        redirect: 'error',
        signal: AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(15000)]),
      });
      await response.body?.cancel();
      if (!response.ok) throw new RemoteError('health');
      this.lifecycle.signal.throwIfAborted();
      this.state.url = this.tunnel.url;
      this.state.phase = 'ready';
      this.input.githubToken = '';
      this.owner = undefined;
    });
  }
  private async installNew(target: RemoteTarget) {
    const directory = await mkdtemp(join(tmpdir(), 'depot-remote-'));
    let remoteStage: string | undefined;
    try {
      this.lifecycle.signal.throwIfAborted();
      this.state.phase = 'download';
      const source = await this.installer(target, directory);
      this.lifecycle.signal.throwIfAborted();
      this.state.version = source.version;
      this.state.phase = 'upload';
      remoteStage = await makeRemoteStage(this.ssh, target);
      const path = remoteStage + '/' + nativeAsset(target);
      await this.ssh.upload(source.path, path);
      this.lifecycle.signal.throwIfAborted();
      this.state.phase = 'install';
      await this.ssh.exec(installCommand(target, path, source.hash), '', 20 * 60000);
      this.lifecycle.signal.throwIfAborted();
      this.state.phase = 'owner';
      // The installer secures this root before this input reaches it. No password enters argv or logs.
      await this.ssh.exec(
        remoteNode(target.platform, ownerScript),
        Buffer.from(
          JSON.stringify({ name: this.owner?.owner, password: this.owner?.ownerPassword }),
        ).toString('base64'),
        60000,
      );
    } finally {
      // Best-effort cleanup must not mask installation failure. On disconnection, preserve remote staging for inspection.
      if (remoteStage && this.ssh.active)
        await removeRemoteStage(this.ssh, target, remoteStage).catch(() => undefined);
      // Only the fresh directory created by mkdtemp is removed; remote installation/data are never rolled back by deletion.
      await rm(directory, { recursive: true, force: true });
    }
  }
  private async installer(target: RemoteTarget, directory: string) {
    const name = nativeAsset(target);
    if (this.artifact) {
      const manifest = record(
        JSON.parse(
          await readFile(
            join(this.artifact, `native-${target.platform === 'windows' ? 'win32' : 'linux'}.json`),
            'utf8',
          ),
        ),
      );
      const hash = record(manifest['files'])[name],
        path = join(this.artifact, name);
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(path, { signal: this.lifecycle.signal })) {
        const bytes: unknown = chunk;
        if (!(bytes instanceof Uint8Array)) throw new RemoteError('checksum');
        digest.update(bytes);
      }
      if (typeof hash !== 'string' || digest.digest('hex') !== hash)
        throw new RemoteError('checksum');
      return { path, hash, version: version(String(manifest['version'])) };
    }
    const github = new GitHubReleases(this.input.githubToken, this.lifecycle.signal);
    try {
      const source = await github.native(target.platform, name),
        path = join(directory, name);
      await github.download(source.url, path, source.hash);
      return { ...source, path };
    } catch {
      throw new RemoteError('release');
    }
  }
  private async run(action: () => Promise<void>) {
    this.busy = true;
    try {
      await action();
    } catch (error) {
      if (this.state.phase !== 'closed') {
        this.state.error = error instanceof RemoteError ? error.code : 'operation';
        this.state.phase = 'failed';
      }
      this.tunnel?.close();
      this.ssh.close();
      this.clearSecrets();
    } finally {
      this.busy = false;
    }
  }
  get active() {
    return this.ssh.active;
  }
  close() {
    this.state.phase = 'closed';
    this.lifecycle.abort();
    this.tunnel?.close();
    this.ssh.close();
    this.clearSecrets();
  }
  private clearSecrets() {
    this.input.password = '';
    this.input.privateKey = '';
    this.input.passphrase = '';
    this.input.githubToken = '';
    this.owner = undefined;
  }
}
// Health credentials stay on the server; the client only observes readiness success/failure.
const readinessScript = `(async()=>{
 const fs=require('node:fs/promises'), path=require('node:path'), {pathToFileURL}=require('node:url');
 const root=process.platform==='win32'?'C:/ProgramData/ProAnima/Depot':'/opt/proanima-depot';
 const state=JSON.parse(await fs.readFile(path.join(root,'installation.json'),'utf8'));
 if(!/^[0-9]+\\.[0-9]+\\.[0-9]+$/.test(state.current.version))throw Error('version');
 const {Services}=await import(pathToFileURL(path.join(root,'releases',state.current.version,'apps/deploy/dist/services.js')).href);
 await new Services(root,state).healthy();
})().catch(()=>{process.exitCode=1;});`;
const ownerScript = `(async()=>{
 const fs=require('node:fs/promises'), path=require('node:path');
 const root=process.platform==='win32'?'C:/ProgramData/ProAnima/Depot':'/opt/proanima-depot';
 let input=''; for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw Error('input');}
 const state=JSON.parse(await fs.readFile(path.join(root,'installation.json'),'utf8'));
 if(!/^[0-9]+\\.[0-9]+\\.[0-9]+$/.test(state.current.version))throw Error('version');
 const {pathToFileURL}=require('node:url');
 const owner=await import(pathToFileURL(path.join(root,'releases',state.current.version,'apps/deploy/dist/owner.js')).href);
 const file=path.join(root,'config/remote-owner.json');
 await fs.writeFile(file,Buffer.from(input,'base64'),{flag:'wx',mode:0o600});
 try{await owner.createOwner(root,file);}finally{await fs.rm(file,{force:true});}
})().catch(()=>{process.exitCode=1;});`;
