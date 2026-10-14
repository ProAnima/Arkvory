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
  if (/(^|\/)\.{1,2}(\/|$)|%2e%2e|%2f|\\/i.test(route)) return false;
  return patterns.some((pattern) => pattern.test(route));
}
