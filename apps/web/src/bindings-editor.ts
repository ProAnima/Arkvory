import { servicePermissionNames } from '@proanima/arkvory-contracts';
import type { ServiceBindingResponse } from '@proanima/arkvory-contracts';
import { UiError } from './feedback.js';
import { command, disclosure, field, node } from './management-dom.js';

type Permission = (typeof servicePermissionNames)[number];
const readPermissions: readonly Permission[] = [
  'repository.read',
  'artifact.read',
  'artifact.list',
  'content.read',
  'package.read',
  'asset.read',
  'annotation.read',
];
const publishPermissions: readonly Permission[] = [
  ...readPermissions,
  'upload.create',
  'upload.read',
  'upload.write',
  'upload.complete',
  'upload.cancel',
  'job.read',
  'package.publish',
  'asset.write',
  'annotation.write',
];
let sequence = 0;
export class BindingsEditor {
  readonly root = node('div', undefined, 'binding-editor');
  private readonly rows = node('div', undefined, 'management-stack');
  private readonly add = command('bindingAdd', () => {
    this.append();
  });
  constructor(
    private readonly limit = 64,
    private readonly allowed?: () => readonly ServiceBindingResponse[],
  ) {
    this.root.append(this.rows, this.add);
  }
  set(values: readonly ServiceBindingResponse[]) {
    this.rows.replaceChildren();
    for (const value of values) this.append(value);
    this.add.disabled = values.length >= this.limit;
  }
  read(): readonly ServiceBindingResponse[] {
    const bindings: ServiceBindingResponse[] = [];
    for (const row of this.rows.children) {
      const id = row.querySelector('input')?.value.trim() ?? '';
      const actions = servicePermissionNames.filter(
        (action) =>
          row.querySelector<HTMLInputElement>(`input[data-permission="${action}"]`)?.checked,
      );
      if (
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ||
        !actions.length ||
        bindings.some((b) => b.resource.id === id)
      )
        throw new UiError('bindingInvalid');
      bindings.push({ resource: { kind: 'repository', id }, actions });
    }
    return bindings;
  }
  private append(value?: ServiceBindingResponse) {
    if (this.rows.childElementCount >= this.limit) return;
    const row = node('div', undefined, 'binding-row');
    const repository = field(`binding-${String(++sequence)}`, 'repository');
    repository.input.value = value?.resource.id ?? '';
    repository.input.required = true;
    repository.input.pattern = '[a-z0-9][a-z0-9_-]{0,63}';
    repository.input.setAttribute('list', 'repository-options');
    const choices = disclosure('bindingPermissions');
    const grid = node('div', undefined, 'permission-grid');
    const checks = new Map<Permission, HTMLInputElement>();
    for (const permission of servicePermissionNames) {
      const label = node('label', undefined, 'permission-choice');
      const check = node('input');
      check.type = 'checkbox';
      check.dataset['permission'] = permission;
      check.checked = value?.actions.includes(permission) ?? false;
      label.title = permission;
      label.append(check, node('span', `permission.${permission}`));
      grid.append(label);
      checks.set(permission, check);
    }
    choices.append(grid);
    const updateAllowed = () => {
      const allowed = this.allowed?.();
      for (const [permission, check] of checks) {
        check.disabled =
          allowed !== undefined &&
          !allowed.some(
            (binding) =>
              binding.resource.id === repository.input.value.trim() &&
              binding.actions.includes(permission),
          );
        if (check.disabled) check.checked = false;
      }
    };
    repository.input.addEventListener('input', updateAllowed);
    updateAllowed();
    const preset = (permissions: readonly Permission[]) => {
      for (const [permission, check] of checks)
        check.checked = !check.disabled && permissions.includes(permission);
    };
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      command('bindingRead', () => {
        preset(readPermissions);
      }),
      command('bindingPublish', () => {
        preset(publishPermissions);
      }),
      command('bindingNone', () => {
        preset([]);
      }),
      command(
        'bindingRemove',
        () => {
          row.remove();
          this.add.disabled = false;
          this.add.focus();
        },
        'ghost',
      ),
    );
    row.append(repository.label, actions, choices);
    this.rows.append(row);
    this.add.disabled = this.rows.childElementCount >= this.limit;
    if (!value) repository.input.focus();
  }
}
