import { element } from './dom.js';
const fields = ['query', 'filter-label', 'filter-metadata-key', 'filter-metadata-value'];
export function catalogFilter() {
  const key = element('filter-metadata-key', HTMLInputElement).value;
  return {
    q: element('query', HTMLInputElement).value,
    label: element('filter-label', HTMLInputElement).value,
    ...(key
      ? {
          metadataKey: key,
          metadataValue: element('filter-metadata-value', HTMLInputElement).value,
        }
      : {}),
  };
}
export function installCatalogFilter(search: () => void) {
  const clearSearch = element('search-clear', HTMLButtonElement);
  const updateSearch = () => {
    element('filter-metadata-key', HTMLInputElement).required = Boolean(
      element('filter-metadata-value', HTMLInputElement).value,
    );
    clearSearch.disabled = !fields.some((id) => element(id, HTMLInputElement).value);
  };
  for (const id of fields) element(id, HTMLInputElement).addEventListener('input', updateSearch);
  clearSearch.onclick = () => {
    for (const id of fields) element(id, HTMLInputElement).value = '';
    updateSearch();
    search();
  };
}
