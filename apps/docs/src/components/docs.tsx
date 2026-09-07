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
import { PersistentFolder } from "./sidebar-folder";
import { ThemeSwitchWithHash } from "./theme-switch";

const BRAND_KIT_BASE_URL = "https://mayarin.xyz/brand-kit";

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex items-center text-2xl leading-none tracking-[-0.06em]">
        <img
          src={`${BRAND_KIT_BASE_URL}/mayarin-logo-black.svg`}
          alt=""
          aria-hidden="true"
          width="32"
          height="32"
          className="size-8 dark:hidden"
        />
        <img
          src={`${BRAND_KIT_BASE_URL}/mayarin-logo-white.svg`}
          alt=""
          aria-hidden="true"
          width="32"
          height="32"
          className="hidden size-8 dark:block"
        />
        <span className="-ml-0.5 font-medium font-sans">mayarin</span>
      </span>
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
        sidebar={{
          defaultOpenLevel: 1,
          components: { Item: MethodItem, Folder: PersistentFolder },
        }}
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
