import { ArkvoryHttpError, type ArkvoryClient } from '@proanima/arkvory-sdk';
import type { FleetController, FleetProbe } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, dateMessage, message, relativeMessage } from './i18n.js';
import { feedback, showFailure } from './feedback.js';
import { confirmAction } from './confirm-dialog.js';
import { fingerprintText } from './fleet-presentation.js';

const cell = (...children: Node[]) => {
  const td = document.createElement('td');
  td.append(...children);
  return td;
};
const text = (value: string) => {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
};
const when = (date: string | null) => {
  const span = document.createElement('span');
  if (date) relativeMessage(span, date);
  else message(span, 'fleetNever');
  return span;
};

/**
 * Pairing on the Sites page (ADR 0077). Adding a site: check its address, compare the
 * certificate fingerprint with the one the site shows, enter its code. This site: who manages it,
 * revoking them, making a code. A code and a fingerprint are shown, never stored in the page.
 */
export class FleetPairingCard {
  private readonly form = element('fleet-add', HTMLFormElement);
  private readonly url = element('fleet-url', HTMLInputElement);
  private readonly code = element('fleet-code', HTMLInputElement);
  private readonly probeBox = element('fleet-probe', HTMLElement);
  private readonly addStatus = element('fleet-add-status', HTMLOutputElement);
  private readonly selfStatus = element('fleet-self-status', HTMLOutputElement);
  private readonly codeBox = element('fleet-code-box', HTMLElement);
  /** The checked site and the address as typed when it was checked. */
  private probed: { readonly probe: FleetProbe; readonly typed: string } | undefined;
  private generation = 0;
  /** The newest check: an answer for an address typed before is dropped. */
  private checking = 0;
  constructor(
    private readonly client: ArkvoryClient,
    private readonly paired: () => Promise<void>,
  ) {
    element('fleet-check', HTMLButtonElement).onclick = () => {
      void this.check();
    };
    this.url.oninput = () => {
      // Another address needs its own check: a confirmed fingerprint belongs to one address.
      this.checking++;
      this.probed = undefined;
      this.addStatus.hidden = true;
      this.probeBox.hidden = true;
    };
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.pair();
    };
    element('fleet-make-code', HTMLButtonElement).onclick = () => {
      void this.makeCode();
    };
  }

  clear() {
    this.generation++;
    this.form.reset();
    this.probed = undefined;
    this.probeBox.hidden = true;
    this.addStatus.hidden = true;
    this.selfStatus.hidden = true;
    this.codeBox.hidden = true;
    element('fleet-code-value', HTMLElement).textContent = '';
    element('fleet-controllers', HTMLTableSectionElement).replaceChildren();
  }

  /** This site and who manages it, read when the page opens. */
  async open() {
    const generation = this.generation;
    try {
      const [self, controllers] = await Promise.all([
        this.client.fleet.topology(),
        this.client.fleet.controllers(),
      ]);
      if (generation !== this.generation) return;
      message(element('fleet-self', HTMLElement), 'fleetSelfValue', {
        name: self.site.name,
        version: self.site.version,
      });
      this.renderControllers(controllers);
    } catch (error) {
      if (generation !== this.generation) return;
      this.selfStatus.hidden = false;
      showFailure(this.selfStatus, error);
    }
  }

  private async check() {
    const generation = this.generation;
    const request = ++this.checking;
    const typed = this.url.value.trim();
    const current = () => generation === this.generation && request === this.checking;
    this.probed = undefined;
    this.probeBox.hidden = true;
    this.addStatus.hidden = false;
    feedback(this.addStatus, 'fleetChecking');
    try {
      const probe = await this.client.fleet.probe(typed);
      if (!current()) return;
      this.probed = { probe, typed };
      this.addStatus.hidden = true;
      const fingerprint = element('fleet-fingerprint', HTMLElement);
      const compare = element('fleet-compare', HTMLElement);
      const certificate = probe.certificate;
      element('fleet-certificate', HTMLElement).hidden = certificate === null;
      if (certificate) {
        fingerprint.textContent = fingerprintText(certificate.fingerprint);
        element('fleet-subject', HTMLElement).textContent = certificate.subject;
        dateMessage(element('fleet-valid', HTMLElement), certificate.validTo);
        message(compare, 'fleetCompare');
      } else {
        fingerprint.textContent = '';
        message(compare, 'fleetPlain');
      }
      this.probeBox.hidden = false;
      this.code.focus();
    } catch (error) {
      if (current()) showFailure(this.addStatus, error);
    }
  }

  /** Pairs the address that was checked and is still in the field; anything else is checked. */
  private async pair() {
    const checked = this.probed;
    if (!checked || checked.typed !== this.url.value.trim()) {
      await this.check();
      return;
    }
    const probed = checked.probe;
    const generation = this.generation;
    const button = element('fleet-pair', HTMLButtonElement);
    button.disabled = true;
    this.addStatus.hidden = false;
    feedback(this.addStatus, 'fleetPairing');
    try {
      const site = await this.client.fleet.add({
        url: probed.url,
        fingerprint: probed.certificate?.fingerprint ?? null,
        code: this.code.value.trim(),
      });
      if (generation !== this.generation) return;
      this.form.reset();
      this.probed = undefined;
      this.probeBox.hidden = true;
      feedback(this.addStatus, 'fleetPaired', { name: site.name }, 'success');
      await this.paired();
    } catch (error) {
      if (generation !== this.generation) return;
      // The one refusal an administrator fixes on this host, not on the site: say so plainly.
      if (
        error instanceof ArkvoryHttpError &&
        error.serverMessage.includes('ARKVORY_FLEET_KEY_FILE')
      )
        feedback(this.addStatus, 'fleetNoKeyFile', {}, 'error');
      else showFailure(this.addStatus, error);
    } finally {
      button.disabled = false;
    }
  }

  private async makeCode() {
    const generation = this.generation;
    try {
      const pairing = await this.client.fleet.pairing();
      if (generation !== this.generation) return;
      this.codeBox.hidden = false;
      // The code is data in its own element; the sentence around it is translated.
      element('fleet-code-value', HTMLElement).textContent = pairing.code;
      message(
        element('fleet-code-until', HTMLElement),
        'fleetCodeUntil',
        { until: pairing.expiresAt },
        [],
        ['until'],
      );
      const fingerprint = element('fleet-code-fingerprint', HTMLElement);
      if (pairing.fingerprint)
        message(fingerprint, 'fleetCodeFingerprint', {
          fingerprint: fingerprintText(pairing.fingerprint),
        });
      else message(fingerprint, 'fleetCodeProxy');
    } catch (error) {
      if (generation !== this.generation) return;
      this.selfStatus.hidden = false;
      showFailure(this.selfStatus, error);
    }
  }

  private renderControllers(controllers: readonly FleetController[]) {
    element('fleet-controllers-table', HTMLElement).hidden = controllers.length === 0;
    element('fleet-controllers-empty', HTMLElement).hidden = controllers.length > 0;
    element('fleet-controllers', HTMLTableSectionElement).replaceChildren(
      ...controllers.map((controller) => {
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'secondary small';
        message(revoke, 'fleetRevoke');
        revoke.onclick = () => {
          void this.revoke(controller);
        };
        const row = document.createElement('tr');
        row.append(
          cell(text(controller.name)),
          cell(text(controller.pairedBy)),
          cell(when(controller.pairedAt)),
          cell(when(controller.usedAt)),
          cell(revoke),
        );
        return row;
      }),
    );
  }

  private async revoke(controller: FleetController) {
    if (!(await confirmAction('fleetRevokeConfirm', { name: controller.name }, 'fleetRevoke')))
      return;
    try {
      await this.client.fleet.revokeController(controller.id);
      this.selfStatus.hidden = false;
      feedback(this.selfStatus, 'fleetRevoked', {}, 'success');
      this.codeBox.hidden = true;
      element('fleet-code-value', HTMLElement).textContent = '';
      clearMessage(element('fleet-code-until', HTMLElement));
      await this.open();
    } catch (error) {
      this.selfStatus.hidden = false;
      showFailure(this.selfStatus, error);
    }
  }
}
