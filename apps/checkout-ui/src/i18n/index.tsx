import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { en, type MessageKey, type Messages } from "./en.ts";
import { id } from "./locales/id.ts";
import { ja } from "./locales/ja.ts";
import { ms } from "./locales/ms.ts";
import { ptBR } from "./locales/pt-br.ts";
import { th } from "./locales/th.ts";
import { vi } from "./locales/vi.ts";
import { zhHans } from "./locales/zh-hans.ts";

/** A language the checkout speaks, named in itself so a payer can find theirs. */
export const LOCALES = [
  { code: "en", flag: "🇺🇸", label: "English", messages: en },
  { code: "id", flag: "🇮🇩", label: "Bahasa Indonesia", messages: id },
  { code: "ms", flag: "🇲🇾", label: "Bahasa Melayu", messages: ms },
  { code: "th", flag: "🇹🇭", label: "ไทย", messages: th },
  { code: "vi", flag: "🇻🇳", label: "Tiếng Việt", messages: vi },
  { code: "ja", flag: "🇯🇵", label: "日本語", messages: ja },
  { code: "zh-Hans", flag: "🇨🇳", label: "简体中文", messages: zhHans },
  { code: "pt-BR", flag: "🇧🇷", label: "Português (Brasil)", messages: ptBR },
] as const satisfies readonly { code: string; flag: string; label: string; messages: Messages }[];

export type LocaleCode = (typeof LOCALES)[number]["code"];

const STORAGE_KEY = "mayarin.checkout.locale";

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
  return LOCALES.some((locale) => locale.code === value);
}

/**
 * The browser's language, matched to one we have. `zh` is Simplified unless the
 * tag says Traditional (`zh-TW`, `zh-HK`, `zh-Hant`), which we do not have and
 * leaves to the next language the browser lists; `pt-PT` is as close to `pt-BR`
 * as we get. Anything else, `fil` included, ends at English.
 */
export function matchLocale(tags: readonly string[]): LocaleCode {
  for (const tag of tags) {
    const [base = "", ...rest] = tag.toLowerCase().split("-");
    if (base === "zh") {
      if (rest.some((part) => ["hant", "tw", "hk", "mo"].includes(part))) continue;
      return "zh-Hans";
    }
    if (base === "pt") return "pt-BR";
    const match = LOCALES.find((locale) => locale.code.toLowerCase().split("-")[0] === base);
    if (match !== undefined) return match.code;
  }
  return "en";
}

function initialLocale(): LocaleCode {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocaleCode(stored)) return stored;
  } catch {
    // Storage can be blocked; the browser's language is then the answer.
  }
  return matchLocale(window.navigator.languages ?? [window.navigator.language]);
}

export type Translate = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

function translator(messages: Messages): Translate {
  return (key, values) => {
    const template = messages[key];
    if (values === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
  };
}

/** What a component sees outside a provider — tests render this way — is English. */
export const translateEnglish: Translate = translator(en);

interface I18n {
  readonly locale: LocaleCode;
  readonly t: Translate;
  readonly setLocale: (locale: LocaleCode) => void;
}

const I18nContext = createContext<I18n>({
  locale: "en",
  t: translateEnglish,
  setLocale: () => undefined,
});

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: LocaleCode) {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered, but the page still switches.
    }
  }

  const messages = LOCALES.find((candidate) => candidate.code === locale)?.messages ?? en;
  return (
    <I18nContext.Provider value={{ locale, t: translator(messages), setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function useT(): Translate {
  return useContext(I18nContext).t;
}
