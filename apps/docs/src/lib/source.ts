import { type CollectionEntry, getCollection } from "astro:content";
import path from "node:path";
import { type StructuredData, structure } from "fumadocs-core/mdx-plugins";
import { loader, multiple, type StaticSource } from "fumadocs-core/source";
import mayarinOpenAPI from "./openapi.json" with { type: "json" };
import { openapi } from "./openapi.ts";

type DocsPageData = CollectionEntry<"docs">["data"] & {
  readonly _raw: CollectionEntry<"docs">;
  readonly structuredData: StructuredData;
};

type DocsMetaData = CollectionEntry<"meta">["data"];

async function createAstroSource(): Promise<
  StaticSource<{ metaData: DocsMetaData; pageData: DocsPageData }>
> {
  const pages = (await getCollection("docs")).map((page) => ({
    type: "page" as const,
    path: path.relative("content/docs", page.filePath ?? page.id),
    data: { ...page.data, _raw: page, structuredData: structure(page.body ?? "") },
  }));
  const metadata = (await getCollection("meta")).map((meta) => ({
    type: "meta" as const,
    path: path.relative("content/docs", meta.filePath ?? meta.id),
    data: meta.data,
  }));
  return { files: [...pages, ...metadata] };
}

// operationId → uppercase HTTP method, so the sidebar can badge each API op.
// The OpenAPI document is the single source: every operation registers its
// operationId + method, and the transformer stamps the matching page-tree node.
const HTTP_METHODS = ["get", "post", "patch", "put", "delete", "head", "options"] as const;

const methodByOperationId = new Map<string, string>();
for (const pathItem of Object.values(mayarinOpenAPI.paths)) {
  for (const method of HTTP_METHODS) {
    const op = (pathItem as Record<string, { operationId?: string } | undefined> | undefined)?.[
      method
    ];
    if (op?.operationId !== undefined) {
      methodByOperationId.set(op.operationId, method.toUpperCase());
    }
  }
}

const API_PREFIX = "api-reference/";
const MDX_SUFFIX = ".mdx";

export const source = loader({
  source: multiple({
    docs: await createAstroSource(),
    api: await openapi.staticSource({ baseDir: "api-reference", meta: true }),
  }),
  baseUrl: "/",
  pageTree: {
    // Stamp each API operation's page-tree node with its HTTP method so the
    // sidebar `MethodItem` can render a colored badge. Authored pages are
    // left untouched (no operationId → no method).
    transformers: [
      {
        file(node, filePath) {
          if (filePath === undefined || !filePath.startsWith(API_PREFIX)) return node;
          const operationId = filePath.slice(API_PREFIX.length, -MDX_SUFFIX.length);
          if (operationId === "index") return node;
          const method = methodByOperationId.get(operationId);
          if (method === undefined) return node;
          return { ...node, icon: method };
        },
      },
    ],
  },
});

export function getStructuredData(entry: CollectionEntry<"docs">): StructuredData {
  return structure(entry.body ?? "");
}

export function getPageImageUrl(page: (typeof source)["$inferPage"]): string {
  return `/og/docs/${[...page.slugs, "image.jpeg"].join("/")}`;
}
