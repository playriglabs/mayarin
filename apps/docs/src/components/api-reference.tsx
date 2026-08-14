import { createOpenAPIPage } from "fumadocs-openapi/ui";

export const APIReference = createOpenAPIPage({
  shikiOptions: {
    themes: { light: "github-light", dark: "github-dark" },
  },
  playground: { enabled: true },
  schemaUI: { showExample: true },
});
