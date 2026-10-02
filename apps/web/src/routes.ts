export const views = [
  'catalog',
  'repositories',
  'services',
  'packages',
  'administration',
  'updates',
  'backups',
  'upload',
  'downloads',
  'history',
  'metadata',
  'onboarding',
  'help',
] as const;
export type View = (typeof views)[number];

/** Console location kept in the URL fragment. It never contains credentials or form data. */
export type Route =
  | { kind: 'empty' }
  | { kind: 'unknown' }
  | { kind: 'view'; view: View }
  | { kind: 'artifact'; repository: string; id: string };

export function isView(value: string): value is View {
  return views.some((view) => view === value);
}

// Links published before path routes keep opening the same screens.
const legacy: Readonly<Record<string, View>> = { '#onboarding': 'onboarding', '#help': 'help' };

export function parseRoute(hash: string): Route {
  if (hash === '' || hash === '#' || hash === '#/') return { kind: 'empty' };
  const old = legacy[hash];
  if (old) return { kind: 'view', view: old };
  if (!hash.startsWith('#/')) return { kind: 'unknown' };
  const parts = hash.slice(2).split('/');
  try {
    const [first, repository, id, ...rest] = parts.map((part) => decodeURIComponent(part));
    if (first === 'artifact' && repository && id && rest.length === 0)
      return { kind: 'artifact', repository, id };
    if (first && parts.length === 1 && isView(first)) return { kind: 'view', view: first };
  } catch {
    // A malformed percent escape is an unknown link, not a failure of the console.
  }
  return { kind: 'unknown' };
}

export function formatRoute(route: Route): string {
  if (route.kind === 'view') return `#/${route.view}`;
  if (route.kind === 'artifact')
    return `#/artifact/${encodeURIComponent(route.repository)}/${encodeURIComponent(route.id)}`;
  return '#/catalog';
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b) && a.kind === b.kind;
}
