export function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof constructor)) throw new Error(`Missing element ${id}`);
  return value;
}
