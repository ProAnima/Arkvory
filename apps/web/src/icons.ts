/** Local outline icons share one view box; geometry is independent of theme and language. */
const paths = {
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  open: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  pause: 'M8 4v16M16 4v16',
  play: 'm7 4 13 8-13 8Z',
  stop: 'M6 6h12v12H6Z',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  save: 'M4 3h13l4 4v14H3V3Zm3 0v6h10V3M7 21v-8h10v8',
  back: 'm14 6-6 6 6 6',
  next: 'm10 6 6 6-6 6',
  reset: 'M3 4v6h6M4 10a8 8 0 1 1 1 8',
  copy: 'M9 9h12v12H9ZM5 15H3V3h12v2',
  check: 'm5 12 4 4L19 6',
  key: 'M14 8a5 5 0 1 0-4 4l4 4h3v3h4v-4l-7-7',
  link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  history: 'M3 4v7h7M3 11a9 9 0 1 1 2 7m7-11v6l4 2',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-8 0v6',
  login: 'M14 3h7v18h-7M3 12h12m-5-5 5 5-5 5',
  logout: 'M10 3H3v18h7M10 12h11m-5-5 5 5-5 5',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
  monitor: 'M3 3h18v14H3ZM8 21h8m-4-4v4',
  language: 'M3 5h12M9 2v3m4 0c0 7-5 12-10 14M5 8c1 5 4 8 8 10m1 3 4-12 4 12m-7-4h6',
  collapse: 'M3 3h18v18H3ZM9 3v18m8-13-4 4 4 4',
  expand: 'M3 3h18v18H3ZM9 3v18m4-13 4 4-4 4',
  menu: 'M4 6h16M4 12h16M4 18h16',
} as const;
export type IconName = keyof typeof paths;
export function initializeStaticIcons() {
  for (const node of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = node.dataset['icon'];
    const known = Object.keys(paths).find((key): key is IconName => key === name);
    if (known) node.replaceChildren(icon(known));
  }
}
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('action-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
