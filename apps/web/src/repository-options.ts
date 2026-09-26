export function offerRepositoryOptions(
  readable: readonly string[],
  repository: HTMLInputElement,
  options: HTMLElement,
  edited: boolean,
): boolean {
  options.replaceChildren();
  for (const name of readable) {
    const option = document.createElement('option');
    option.value = name;
    options.append(option);
  }
  if (readable.length && !readable.includes(repository.value) && !edited)
    repository.value = readable[0] ?? '';
  return readable.length > 0;
}
