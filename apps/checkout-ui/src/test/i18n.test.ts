import { describe, expect, test } from "bun:test";
import { en } from "../i18n/en.ts";
import { LOCALES, matchLocale, translateEnglish } from "../i18n/index.tsx";

describe("matchLocale", () => {
  test("takes an exact or base-language match", () => {
    expect(matchLocale(["id-ID"])).toBe("id");
    expect(matchLocale(["ms-MY"])).toBe("ms");
    expect(matchLocale(["ja"])).toBe("ja");
    expect(matchLocale(["pt-PT"])).toBe("pt-BR");
  });

  test("reads zh as Simplified, and skips Traditional rather than guess", () => {
    expect(matchLocale(["zh-CN"])).toBe("zh-Hans");
    expect(matchLocale(["zh-SG"])).toBe("zh-Hans");
    expect(matchLocale(["zh-TW", "ja"])).toBe("ja");
    expect(matchLocale(["zh-Hant-HK"])).toBe("en");
  });

  test("walks the browser's list in order and ends at English", () => {
    expect(matchLocale(["fil-PH", "th-TH"])).toBe("th");
    expect(matchLocale(["fil-PH"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });
});

describe("translation", () => {
  test("fills {name} values and leaves an unknown one visible", () => {
    expect(translateEnglish("continueWith", { asset: "ETH" })).toBe("Continue with ETH");
    expect(translateEnglish("continueWith")).toBe("Continue with {asset}");
  });

  test("every locale keeps the placeholders the English string has", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const locale of LOCALES) {
      for (const [key, english] of Object.entries(en)) {
        const translated = locale.messages[key as keyof typeof en];
        expect({ locale: locale.code, key, names: names(translated) }).toEqual({
          locale: locale.code,
          key,
          names: names(english),
        });
      }
    }
  });
});
