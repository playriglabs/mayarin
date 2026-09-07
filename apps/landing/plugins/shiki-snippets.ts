import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHighlighter, type ThemeRegistration } from "shiki";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:code-snippets";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

type Snippet = {
  id: string;
  tab: string;
  filename: string;
  lang: string;
  code: string;
};

/**
 * The page's palette expressed as a TextMate theme, so highlighting is
 * grammar-accurate but still only ever uses ink, white and the accent.
 */
const theme: ThemeRegistration = {
  name: "mayarin",
  type: "dark",
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": "#c9c9c9",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#5c5c5c", fontStyle: "italic" },
    },
    {
      scope: ["string", "string.quoted", "constant.other.symbol"],
      settings: { foreground: "#0eeb2e" },
    },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#e6e6e6" } },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#ffffff" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#e6e6e6" },
    },
    {
      scope: ["variable", "meta.definition.variable", "support.variable"],
      settings: { foreground: "#c9c9c9" },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#dcdcdc" },
    },
    {
      scope: ["meta.object-literal.key", "variable.object.property"],
      settings: { foreground: "#b4b4b4" },
    },
    {
      scope: ["punctuation", "meta.brace", "keyword.operator"],
      settings: { foreground: "#8a8a8a" },
    },
  ],
};

/**
 * Highlights the snippets once, at build time. Shipping Shiki to the browser
 * would cost more than the rest of the page put together, and these snippets
 * never change at runtime.
 */
export function shikiSnippets(): Plugin {
  // Two lists, one module: the developer section's tabs and the capability
  // cards' examples are highlighted by the same pass but must not share a
  // list — adding to one would silently add a tab to the other.
  const sources = {
    snippets: path.resolve(import.meta.dirname, "../src/data/snippets.json"),
    capabilitySnippets: path.resolve(import.meta.dirname, "../src/data/capability-snippets.json"),
  } as const;

  return {
    name: "mayarin:shiki-snippets",

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },

    async load(id) {
      if (id !== RESOLVED_ID) return undefined;

      const lists: Record<string, Snippet[]> = {};
      for (const [name, file] of Object.entries(sources)) {
        this.addWatchFile(file);
        lists[name] = JSON.parse(await readFile(file, "utf8")) as Snippet[];
      }

      const all = Object.values(lists).flat();
      const highlighter = await createHighlighter({
        themes: [theme],
        langs: [...new Set(all.map((snippet) => snippet.lang))],
      });

      const highlight = (snippet: Snippet) => ({
        ...snippet,
        html: highlighter.codeToHtml(snippet.code.trimEnd(), {
          lang: snippet.lang,
          theme: "mayarin",
        }),
      });

      const modules = Object.entries(lists).map(
        ([name, list]) => `export const ${name} = ${JSON.stringify(list.map(highlight))};`,
      );

      highlighter.dispose();

      return modules.join("\n");
    },
  };
}
