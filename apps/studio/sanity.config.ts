import { visionTool } from "@sanity/vision";
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";

import post from "./schemas/post";

export default defineConfig({
  name: "mayarin",
  title: "Mayarin",
  projectId: "2p7qxknu",
  dataset: "production",
  plugins: [structureTool(), visionTool()],
  schema: {
    types: [post],
  },
});
