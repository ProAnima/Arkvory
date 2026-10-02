import { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type {
  BackupJobResponse,
  BackupPointResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';
import { credentialRejected } from './error-keys.js';
import { showFailure } from './feedback.js';
import { clearMessage } from './i18n.js';
import { captureBusy, jobActive, needsPolling, pollDelay } from './backup-model.js';
import type { BackupPlanForm } from './backup-plan-form.js';
import type { BackupStatusView } from './backup-status-view.js';
import type { JobRows, PointRows } from './backup-tables.js';

const pageSize = 20;

/** Elements and views of the screen: created once, used by one session at a time. */
export interface BackupUi {
  readonly panel: HTMLElement;
  readonly summary: HTMLElement;
  readonly output: HTMLOutputElement;
  readonly pointsOutput: HTMLOutputElement;
  readonly run: HTMLButtonElement;
  readonly retention: HTMLButtonElement;
  readonly pointsMore: HTMLButtonElement;
  readonly jobsMore: HTMLButtonElement;
  readonly save: HTMLButtonElement;
  readonly view: BackupStatusView;
  readonly form: BackupPlanForm;
  readonly pointRows: PointRows;
  readonly jobRows: JobRows;
}

/** Backup operations the credential may call; discovery is advisory, the server decides. */
export interface BackupAccess {
  readonly read: boolean;
  readonly run: boolean;
  readonly plan: boolean;
  readonly verify: boolean;
  readonly pin: boolean;
  readonly retention: boolean;
}
export const noAccess: BackupAccess = {
  read: false,
  run: false,
  plan: false,
  verify: false,
  pin: false,
  retention: false,
};

/**
 * Operation discovery lists backup operations only to holders of backup.read/backup.manage
 * (ADR 0056), and a reader gateway lists no changes: the same source as other admin screens.
 */
async function discover(client: ArkvoryClient, signal: AbortSignal): Promise<BackupAccess> {
  const ids = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await client.operations(
      { surface: 'administration', limit: 100, ...(after ? { after } : {}) },
      signal,
    );
    for (const operation of result.items) ids.add(operation.operationId);
    if (!result.next || result.next === after) break;
    after = result.next;
  }
  return {
    read: ids.has('getBackupStatus'),
    run: ids.has('requestBackupRun'),
    plan: ids.has('updateBackupPlan'),
    verify: ids.has('requestBackupVerify'),
    pin: ids.has('setBackupPointPin'),
    retention: ids.has('requestBackupRetention'),
  };
}

const finished = (jobs: readonly BackupJobResponse[]) =>
  new Set(jobs.filter((job) => !jobActive(job.state)).map((job) => job.id));

/**
 * One credential's view of the backups screen. Its client is bound to that credential and
 * aborted by close(); a closed session neither renders nor reports late answers.
 */
export class BackupSession {
  readonly client: ArkvoryClient;
  access = noAccess;
  /** A run-now request is in flight: the button stays disabled until the job is listed. */
  requesting = false;
  private readonly controller = new AbortController();
  private closed = false;
  private loads = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private status: BackupStatusResponse | null = null;
  private jobs: readonly BackupJobResponse[] = [];
  private jobsNext: string | null = null;
  private jobsExtended = false;
  private pointList: readonly BackupPointResponse[] = [];
  private pointsNext: string | null = null;

  constructor(
    base: string,
    secret: string,
    private readonly ui: BackupUi,
    private readonly expired: (error: ArkvoryHttpError) => boolean,
  ) {
    this.client = new ArkvoryClient(base, () => secret, { signal: this.controller.signal });
  }

  /** A method, not a property: the answer changes across every await of a caller. */
  active(): boolean {
    return !this.closed;
  }
  get points() {
    return this.pointList;
  }

  async discover(): Promise<BackupAccess> {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)]);
    const access = await discover(this.client, signal);
    if (this.active()) this.access = access;
    return access;
  }

  close() {
    this.closed = true;
    this.controller.abort();
    this.stop();
  }

  /** Runs an action of this session; a closed session reports nothing. */
  guard(output: HTMLOutputElement, action: () => Promise<void>) {
    void action().catch((error: unknown) => {
      this.report(output, error);
    });
  }

  report(output: HTMLOutputElement, error: unknown) {
    if (this.closed) return;
    if (credentialRejected(error) && this.expired(error)) return;
    showFailure(output, error);
  }

  replacePoint(point: BackupPointResponse) {
    this.pointList = this.pointList.map((item) => (item.id === point.id ? point : item));
  }

  async load() {
    if (!this.access.read) return;
    const current = ++this.loads;
    this.ui.form.loadZones();
    this.ui.summary.setAttribute('aria-busy', 'true');
    try {
      const [status, points, jobs] = await Promise.all([
        this.client.backup.status(),
        this.client.backup.points({ limit: pageSize }),
        this.client.backup.jobs({ limit: pageSize }),
      ]);
      if (!this.active() || current !== this.loads) return;
      this.status = status;
      this.pointList = points.items;
      this.pointsNext = points.next;
      this.jobs = jobs.items;
      this.jobsNext = jobs.next;
      this.jobsExtended = false;
      // Only an explicit load fills the plan form; polling never touches it.
      this.ui.form.offer(status.plan);
      this.render();
      this.schedule();
    } finally {
      if (current === this.loads) this.ui.summary.removeAttribute('aria-busy');
    }
  }

  /** Status and the newest jobs; points as well when asked or after a job finished. */
  async refresh(withPoints: boolean) {
    const current = ++this.loads;
    const before = finished(this.jobs);
    const [status, jobs] = await Promise.all([
      this.client.backup.status(),
      this.client.backup.jobs({ limit: pageSize }),
    ]);
    if (!this.active() || current !== this.loads) return;
    this.status = status;
    const head = new Set(jobs.items.map((job) => job.id));
    const older = this.jobsExtended ? this.jobs.filter((job) => !head.has(job.id)) : [];
    this.jobs = [...jobs.items, ...older];
    if (!this.jobsExtended) this.jobsNext = jobs.next;
    // A finished capture, verification or retention changes the points.
    if (withPoints || [...finished(this.jobs)].some((id) => !before.has(id))) {
      const points = await this.client.backup.points({ limit: pageSize });
      if (!this.active() || current !== this.loads) return;
      this.pointList = points.items;
      this.pointsNext = points.next;
    }
    this.render();
  }

  render() {
    if (this.closed) return;
    const ui = this.ui;
    if (this.status) ui.view.render(this.status, Date.now());
    const verifying = new Set<string>();
    for (const job of this.jobs)
      if (job.kind === 'verify' && job.pointId && jobActive(job.state)) verifying.add(job.pointId);
    ui.pointRows.render(this.pointList, verifying);
    ui.jobRows.render(this.jobs);
    ui.pointsMore.hidden = this.pointsNext === null;
    ui.jobsMore.hidden = this.jobsNext === null;
    ui.retention.disabled = this.pointList.length === 0;
    ui.run.disabled = this.requesting || captureBusy(this.status, this.jobs);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Polls only while a job is queued or running and the screen is visible; errors back off. */
  schedule() {
    this.stop();
    if (this.closed || this.ui.panel.hidden || document.hidden) return;
    if (!needsPolling(this.status, this.jobs)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, pollDelay(this.failures));
  }

  /** The page became visible again: resume polling at once if a job was still open. */
  resume() {
    if (this.timer === undefined && !this.ui.panel.hidden && needsPolling(this.status, this.jobs))
      void this.tick();
  }

  private async tick() {
    if (this.closed || this.ui.panel.hidden || document.hidden) return;
    try {
      await this.refresh(false);
      if (this.failures) clearMessage(this.ui.output);
      this.failures = 0;
    } catch (error) {
      this.failures++;
      this.report(this.ui.output, error);
    }
    this.schedule();
  }

  async morePoints() {
    if (!this.pointsNext) return;
    this.ui.pointsMore.disabled = true;
    try {
      const page = await this.client.backup.points({ after: this.pointsNext, limit: pageSize });
      if (!this.active()) return;
      const known = new Set(this.pointList.map((point) => point.id));
      this.pointList = [...this.pointList, ...page.items.filter((point) => !known.has(point.id))];
      this.pointsNext = page.next;
      this.render();
    } finally {
      this.ui.pointsMore.disabled = false;
    }
  }

  async moreJobs() {
    if (!this.jobsNext) return;
    this.ui.jobsMore.disabled = true;
    try {
      const page = await this.client.backup.jobs({ after: this.jobsNext, limit: pageSize });
      if (!this.active()) return;
      const known = new Set(this.jobs.map((job) => job.id));
      this.jobs = [...this.jobs, ...page.items.filter((job) => !known.has(job.id))];
      this.jobsNext = page.next;
      this.jobsExtended = true;
      this.render();
    } finally {
      this.ui.jobsMore.disabled = false;
    }
  }
}
