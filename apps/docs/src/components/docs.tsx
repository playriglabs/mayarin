import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";
import { APIReference } from "./api-reference";
import { MethodItem } from "./method-badge";
import SearchDialog from "./search.tsx";
import { ThemeSwitchWithHash } from "./theme-switch";

const BRAND_KIT_BASE_URL = "https://mayarin.xyz/brand-kit";

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src={`${BRAND_KIT_BASE_URL}/mayarin-full-black.png`}
        alt="mayarin"
        height="32"
        className="h-8 w-auto dark:hidden"
      />
      <img
        src={`${BRAND_KIT_BASE_URL}/mayarin-full-white.png`}
        alt="mayarin"
        height="32"
        className="hidden h-8 w-auto dark:block"
      />
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
  apiProps,
  commitHash,
}: {
  readonly tree: Root;
  readonly children: ReactNode;
  readonly pathname: string;
  readonly params: AstroProviderProps["params"];
  readonly page?: DocsPageProps;
  readonly apiProps?: OpenAPIPageProps;
  readonly commitHash?: string;
}) {
  return (
    <RootProvider pathname={pathname} params={params} navigate={navigate} search={{ SearchDialog }}>
      <DocsLayout
        tree={tree}
        nav={{ title: <Brand />, url: "/" }}
        sidebar={{ defaultOpenLevel: 1, components: { Item: MethodItem } }}
        slots={{
          // Park the last commit hash inside the bottom box, next to the
          // light/dark toggle (the default theme switch slot).
          themeSwitch: (props) => <ThemeSwitchWithHash hash={commitHash} {...props} />,
        }}
      >
        <DocsPage {...page}>
          {apiProps !== undefined ? (
            <div className="api-reference-content">
              <APIReference {...apiProps} />
            </div>
          ) : (
            children
          )}
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
