import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";
import SearchDialog from "./search.tsx";

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/images/mayarin-logo.png" alt="" width="32" height="32" />
      <span className="font-brand text-[1.15rem] tracking-[-0.025em]">mayarin</span>
      <span className="border-l border-fd-border pl-2.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-fd-muted-foreground">
        docs
      </span>
    </span>
  );
}

export function Docs({
  tree,
  children,
  pathname,
  params,
  page,
}: {
  readonly tree: Root;
  readonly children: ReactNode;
  readonly pathname: string;
  readonly params: AstroProviderProps["params"];
  readonly page?: DocsPageProps;
}) {
  return (
    <RootProvider pathname={pathname} params={params} navigate={navigate} search={{ SearchDialog }}>
      <DocsLayout
        tree={tree}
        nav={{ title: <Brand />, url: "/" }}
        links={[
          { text: "Dashboard", url: "https://dashboard.mayarin.xyz", external: true },
          { text: "GitHub", url: "https://github.com/playriglabs/mayarin", external: true },
        ]}
        sidebar={{ defaultOpenLevel: 1 }}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
