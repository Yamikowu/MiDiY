import { zhTW, type MessageKey } from './zh-TW';
import { en } from './en';
export type Locale = 'zh-TW' | 'en';
type Params = Record<string, string | number>;
type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const LANGUAGE_KEY = 'midiy-ui-language-v1';
let locale: Locale = 'zh-TW';
let storage: LanguageStorage | undefined;
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function resolveLocale(saved: string | null, preferred: readonly string[]): Locale {
  if (saved === 'zh-TW' || saved === 'en') return saved;
  for (const language of preferred) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-TW';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'zh-TW';
}
export function initializeLocale(target: LanguageStorage | undefined, preferred: readonly string[]) {
  storage = target; let saved: string | null = null;
  try { saved = storage?.getItem(LANGUAGE_KEY) ?? null; } catch { /* Storage may be unavailable. */ }
  locale = resolveLocale(saved, preferred);
}
export function setLocale(next: Locale) {
  try { storage?.setItem(LANGUAGE_KEY, next); } catch { /* Switching still works without persistence. */ }
  if (locale === next) return;
  locale = next;
  for (const listener of listeners) listener();
}
export function onLocaleChange(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function t(key: MessageKey, params: Params = {}): string {
  const message: string = (locale === 'en' ? en : zhTW)[key];
  return message.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}
const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Explicit text bindings update in place; inputs, selections and user content are never replaced. */
export function l(key: MessageKey, params: Params = {}): string {
  return `<span data-i18n="${key}" data-i18n-params="${escapeHtml(JSON.stringify(params))}">${escapeHtml(t(key, params))}</span>`;
}
export function attribute(name: string, key: MessageKey, params: Params = {}): string {
  return `${name}="${escapeHtml(t(key, params))}" data-i18n-${name}="${key}" data-i18n-${name}-params="${escapeHtml(JSON.stringify(params))}"`;
}
const labelKeys = new Map<string, MessageKey>();
for (const key of Object.keys(zhTW) as MessageKey[]) {
  if (!zhTW[key].includes('{')) { labelKeys.set(zhTW[key], key); labelKeys.set(en[key], key); }
}
/** Only call with program-defined labels, never Profile names or user notes. */
export function translateLabel(label: string): string { const key = labelKeys.get(label); return key ? t(key) : label; }
export function labelMarkup(label: string): string { const key = labelKeys.get(label); return key ? l(key) : escapeHtml(label); }
export function labelAttributes(label: string): string { const key = labelKeys.get(label); return key ? `data-i18n="${key}"` : ''; }
export function formatError(error: unknown): string {
  const value = error as { code?: MessageKey; params?: Params; message?: string; detail?: unknown } | null;
  if (value?.code && Object.hasOwn(zhTW, value.code)) return t(value.code, { ...value.params, ...(value.detail ? { p0: formatError(value.detail) } : {}) });
  return translateLabel(value?.message ?? String(error));
}
export function localize(root: Document | Element) {
  const apply = (element: Element) => {
    const params = (name: string) => JSON.parse(element.getAttribute(name) || '{}') as Params;
    const key = element.getAttribute('data-i18n') as MessageKey | null;
    if (key && Object.hasOwn(zhTW, key)) {
      const text = t(key, params('data-i18n-params'));
      if (element.textContent !== text) element.textContent = text;
    }
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const key = element.getAttribute(`data-i18n-${name}`) as MessageKey | null;
      if (key && Object.hasOwn(zhTW, key)) element.setAttribute(name, t(key, params(`data-i18n-${name}-params`)));
    }
  };
  if (root.nodeType === 1) apply(root as Element);
  root.querySelectorAll('[data-i18n],[data-i18n-aria-label],[data-i18n-title],[data-i18n-placeholder]').forEach(apply);
}
export function mountLanguageSwitcher() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-locale]')];
  const refresh = () => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-Hant';
    for (const button of buttons) {
      const active = button.dataset.locale === locale;
      button.setAttribute('aria-pressed', String(active)); button.classList.toggle('is-active', active);
    }
    localize(document);
  };
  buttons.forEach(button => button.addEventListener('click', () => setLocale(button.dataset.locale as Locale)));
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) localize(node as Element);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = onLocaleChange(refresh); refresh();
  return () => { observer.disconnect(); unsubscribe(); };
}
