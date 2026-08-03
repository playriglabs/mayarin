declare module "virtual:code-snippets" {
  export type Snippet = {
    id: string;
    tab: string;
    filename: string;
    lang: string;
    code: string;
    /** Shiki output, generated at build time by `plugins/shiki-snippets.ts`. */
    html: string;
  };

  export const snippets: Snippet[];
}
