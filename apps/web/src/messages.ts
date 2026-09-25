import { en } from './messages-en.js';
import { ru } from './messages-ru.js';
export { en, ru };
export type MessageKey = keyof typeof en;
export type Language = 'ru' | 'en';
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}
export function translate(
  language: Language,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
) {
  return (language === 'ru' ? ru[key] : en[key]).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
