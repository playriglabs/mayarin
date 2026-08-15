import { defineField, defineType } from "sanity";

export default defineType({
  name: "post",
  type: "document",
  title: "Post",
  fields: [
    defineField({
      name: "title",
      type: "string",
      title: "Title",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      type: "slug",
      title: "Slug",
      options: { source: "title" },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "pubDate",
      type: "datetime",
      title: "Publish date",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      type: "text",
      title: "Description",
      rows: 2,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "thumbnail",
      type: "image",
      title: "Thumbnail",
      options: { hotspot: true },
      description: "Thumbnail image shown on blog cards and post pages.",
    }),
    defineField({
      name: "author",
      type: "string",
      title: "Author",
      initialValue: "Mayarin",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "tags",
      type: "array",
      title: "Tags",
      of: [{ type: "string" }],
      options: { layout: "tags" },
    }),
    defineField({
      name: "draft",
      type: "boolean",
      title: "Draft",
      initialValue: false,
      description: "Drafts are never published to the blog.",
    }),
    defineField({
      name: "body",
      type: "text",
      title: "Body (Markdown)",
      rows: 24,
      description:
        "Raw Markdown — rendered on the blog with Shiki code highlighting. Use ```fences for code.",
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "pubDate",
    },
  },
});
