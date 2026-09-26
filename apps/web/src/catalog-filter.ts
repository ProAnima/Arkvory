import { element } from './dom.js';
export function installCatalogFilter(search: () => void) {
  const clearSearch = element('search-clear', HTMLButtonElement);
  const updateSearch = () => {
    clearSearch.disabled =
      !element('query', HTMLInputElement).value && !element('filter-label', HTMLInputElement).value;
  };
  for (const id of ['query', 'filter-label'])
    element(id, HTMLInputElement).addEventListener('input', updateSearch);
  clearSearch.onclick = () => {
    element('query', HTMLInputElement).value = '';
    element('filter-label', HTMLInputElement).value = '';
    updateSearch();
    search();
  };
}
