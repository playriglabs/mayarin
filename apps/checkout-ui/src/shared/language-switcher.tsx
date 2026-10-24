import { isLocaleCode, LOCALES, useI18n } from "../i18n/index.tsx";
import { Dropdown } from "./dropdown.tsx";

/**
 * The language, in the checkout's own dropdown with a flag per language. The
 * flag stands for the language's home market, not a claim about the payer; the
 * name beside it is what they read.
 */
export function LanguageSwitcher({ className = "" }: { readonly className?: string }) {
  const { locale, t, setLocale } = useI18n();

  return (
    <Dropdown
      compact
      className={className}
      label={t("language")}
      value={locale}
      options={LOCALES.map((candidate) => ({
        value: candidate.code,
        title: candidate.label,
        mark: (size: number) => (
          <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>
            {candidate.flag}
          </span>
        ),
      }))}
      onSelect={(next) => {
        if (isLocaleCode(next)) setLocale(next);
      }}
    />
  );
}
