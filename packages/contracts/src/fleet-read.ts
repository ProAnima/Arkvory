/**
 * What a controller may read on a site (ADR 0077, stage F2): catalog metadata, never bytes. The
 * site lets a fleet key call exactly these routes; the controller forwards exactly these paths.
 * One list for both, so they cannot drift apart.
 */
export const fleetReadRoutes = [
  '/api/v1/repositories',
  '/api/v1/repositories/:repository',
  '/api/v1/repositories/:repository/search',
  '/api/v1/repositories/:repository/artifacts',
  '/api/v1/repositories/:repository/artifacts/:id',
  '/api/v1/repositories/:repository/artifacts/:id/annotations',
  '/api/v1/repositories/:repository/artifacts/:id/stages',
  '/api/v1/repositories/:repository/packages',
  '/api/v1/repositories/:repository/assets/page',
  '/api/v1/repositories/:repository/asset',
  '/api/v1/repositories/:repository/asset/history',
  '/api/v1/repositories/:repository/storage/usage',
  '/api/v1/repositories/:repository/mirror',
  // Stage F3: what the changes below need to be made with the current revision.
  '/api/v1/system/downloads/settings',
  '/api/v1/system/updates',
] as const;

/** One path segment: percent-encoded text without a slash, a dot segment or a control. */
const segment = '(?!\\.{1,2}(?:/|$))[^/?#\\s]{1,256}';
const patterns = fleetReadRoutes.map(
  (route) => new RegExp(`^${route.replace(/:[a-z]+/g, segment)}$`),
);

/**
 * Whether `path` (with an optional query) is one a controller may read on a site. The path must
 * be absolute, without dot segments, a fragment or more than 2048 characters.
 */
export function isFleetReadPath(path: string): boolean {
  if (path.length > 2048 || !path.startsWith('/api/v1/') || path.includes('#')) return false;
  const [route = ''] = path.split('?', 1);
  // Any spelling of a dot segment (`.`, `..`, `%2e`, `.%2E`): URL parsing on the way to the site
  // would remove it, and the site would get another path than the one checked here.
  if (route.split('/').some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) return false;
  if (/%2f|%5c|\\/i.test(route)) return false;
  return patterns.some((pattern) => pattern.test(route));
}

/**
 * What a controller may change on a site (ADR 0077, stage F3), each with its one method. Both
 * are revision- or id-protected on the site, so a repeated request cannot apply twice.
 */
export const fleetChangeRoutes = [
  ['PUT', '/api/v1/system/downloads/settings'],
  ['POST', '/api/v1/system/updates/requests'],
] as const;
export type FleetChangeMethod = (typeof fleetChangeRoutes)[number][0];

/** The method of a change route, or undefined: exact paths only, without a query. */
export function fleetChangeMethod(path: string): FleetChangeMethod | undefined {
  return fleetChangeRoutes.find(([, route]) => route === path)?.[0];
}
