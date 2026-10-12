/**
 * The console's one icon set: outlines on a 24px grid, drawn inside 3..21 so nothing is clipped,
 * one stroke width (--icon-stroke) with round caps and joins. Geometry is independent of theme
 * and language. Navigation, actions, notices and help all take their icons from here.
 */
const paths = {
  // Actions.
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4-4',
  refresh: 'M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.5H14M5.5 21v-4.5H10',
  download: 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14',
  open: 'M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pause: 'M9 5v14m6-14v14',
  play: 'M7 4.5v15L19 12Z',
  stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  close: 'm6 6 12 12M18 6 6 18',
  plus: 'M12 5v14m-7-7h14',
  save: 'M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 0v5h7V4M8 20v-6h8v6',
  back: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1ZM5 15a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1',
  check: 'm5 12.5 4.5 4.5L19 7',
  key: 'M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1.2-2.8L19.5 3.5M16 7l2.5 2.5M13.5 9.5 15.5 11.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
  trash: 'M4 7h16m-10-3h4M6 7l1 12.1a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7m-8 4v5m4-5v5',
  history: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2',
  settings: 'M4 7h8m4 0h4M4 17h4m4 0h8M14 5v4M10 15v4',
  login: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M4 12h11m-4-4 4 4-4 4',
  logout: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m-1-8h11m-4-4 4 4-4 4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 15h8m-4-4v4',
  language:
    'M4 6h9M8.5 4v2M11 6c-.8 4-3.2 7.2-7 9M6 9.5c1.2 2.2 3 4 5.5 5.2M13 20l3.5-9 3.5 9m-6-2.5h5',
  collapse:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 0v16m7-11-3 3 3 3',
  expand:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 0v16m4-11 3 3-3 3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  message: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1Z',
  // Notices and help.
  alert:
    'M10.3 4.3 3.3 17a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12.7a2 2 0 0 0-3.4 0ZM12 9.5v4m0 3.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-4.5M12 8h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.3-2.4 3.8M12 17h.01',
  // Navigation.
  grid: 'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm10 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm10 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z',
  layers: 'm12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  folder: 'M4 7a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z',
  mirror:
    'M4 5a1 1 0 0 1 1-1h6v16H5a1 1 0 0 1-1-1ZM14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5m0-12 3 4-3 4',
  server:
    'M5 4h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 10h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm3-7h.01M8 17h.01',
  database:
    'M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  flag: 'M5 21V4m0 0h11.5l-2 4 2 4H5',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-2.5-12-3 14',
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
