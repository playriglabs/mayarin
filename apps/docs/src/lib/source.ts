import { type CollectionEntry, getCollection } from "astro:content";
import path from "node:path";
import { type StructuredData, structure } from "fumadocs-core/mdx-plugins";
import { loader, multiple, type StaticSource } from "fumadocs-core/source";
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

export const source = loader({
  source: multiple({
    docs: await createAstroSource(),
    api: await openapi.staticSource({ baseDir: "api-reference", meta: true }),
  }),
  baseUrl: "/",
});

export function getStructuredData(entry: CollectionEntry<"docs">): StructuredData {
  return structure(entry.body ?? "");
}

export function getPageImageUrl(page: (typeof source)["$inferPage"]): string {
  return `/og/docs/${[...page.slugs, "image.webp"].join("/")}`;
}
