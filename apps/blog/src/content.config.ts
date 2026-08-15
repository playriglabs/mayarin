import { defineCollection, z } from "astro:content";
import { createClient, type SanityClient } from "@sanity/client";

// Build-time read from Sanity. Project ID + dataset are pinned to match
// apps/studio/sanity.config.ts (single source of truth lives there); copy kept
// here so the blog does not need an env var to fetch. A read token is only
// needed for private datasets / draft preview (later).
const PROJECT_ID = "2p7qxknu";
const DATASET = "production";

type SanityPost = {
  slug: string | null;
  title: string;
  pubDate: string;
  description: string;
  thumbnail: {
    asset: { url: string } | null;
  } | null;
  author: string | null;
  tags: string[] | null;
  draft: boolean | null;
  body: string | null;
};

const blog = defineCollection({
  loader: {
    name: "sanity",
    load: async ({ store }) => {
      const sanity: SanityClient = createClient({
        projectId: PROJECT_ID,
        dataset: DATASET,
        apiVersion: "2024-10-01",
        useCdn: true,
        ...(process.env.SANITY_API_READ_TOKEN ? { token: process.env.SANITY_API_READ_TOKEN } : {}),
      });

      const posts = await sanity.fetch<SanityPost[]>(
        `*[_type == "post"] | order(pubDate desc) {
          "slug": slug.current,
          title, pubDate, description,
          thumbnail { asset->{ url } },
          author, tags, draft, body
        }`,
      );

      for (const post of posts) {
        // Drafts stay in Sanity; published-only build.
        if (!post.slug || post.draft) continue;

        store.set({
          id: post.slug,
          data: {
            title: post.title,
            pubDate: new Date(post.pubDate),
            description: post.description,
            thumbnailUrl: post.thumbnail?.asset?.url ?? null,
            author: post.author ?? "Mayarin",
            tags: post.tags ?? [],
            draft: post.draft ?? false,
          },
          // Raw markdown body — render(post) in [slug].astro runs it through the
          // project markdown pipeline (shikiConfig: mayarin theme).
          body: post.body ?? "",
        });
      }
    },
  },
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
    thumbnailUrl: z.string().url().nullable().default(null),
    author: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
