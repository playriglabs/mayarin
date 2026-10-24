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
  { code: "en", label: "English", messages: en },
  { code: "id", label: "Bahasa Indonesia", messages: id },
  { code: "ms", label: "Bahasa Melayu", messages: ms },
  { code: "th", label: "ไทย", messages: th },
  { code: "vi", label: "Tiếng Việt", messages: vi },
  { code: "ja", label: "日本語", messages: ja },
  { code: "zh-Hans", label: "简体中文", messages: zhHans },
  { code: "pt-BR", label: "Português (Brasil)", messages: ptBR },
] as const satisfies readonly { code: string; label: string; messages: Messages }[];

export type LocaleCode = (typeof LOCALES)[number]["code"];

const STORAGE_KEY = "mayarin.checkout.locale";

function isLocaleCode(value: string | null | undefined): value is LocaleCode {
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

/**
 * The current language and a chevron; the native `<select>` laid over it does the
 * choosing. No icon: the link page renders no SVG, and a test holds it to that.
 */
export function LanguageSwitcher({ className = "" }: { readonly className?: string }) {
  const { locale, t, setLocale } = useI18n();
  const current = LOCALES.find((candidate) => candidate.code === locale);

  return (
    <label
      className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors focus-within:border-muted hover:border-muted hover:text-ink ${className}`}
    >
      <span aria-hidden="true">{current?.label}</span>
      <span
        aria-hidden="true"
        className="size-1.5 -translate-y-0.5 rotate-45 border-r border-b border-current"
      />
      <select
        aria-label={t("language")}
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocaleCode(next)) setLocale(next);
        }}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      >
        {LOCALES.map((candidate) => (
          <option key={candidate.code} value={candidate.code}>
            {candidate.label}
          </option>
        ))}
      </select>
    </label>
  );
}
