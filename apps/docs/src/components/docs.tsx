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
import { ThemeSwitchWithSocial } from "./theme-switch";

const BRAND_KIT_BASE_URL = "https://mayarin.xyz/brand-kit";

function Brand() {
  return (
    <span className="flex items-center">
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
        <span className="-ml-0.5 font-medium font-sans text-2xl">mayarin</span>
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
}: {
  readonly tree: Root;
  readonly children: ReactNode;
  readonly pathname: string;
  readonly params: AstroProviderProps["params"];
  readonly page?: DocsPageProps;
  readonly apiProps?: OpenAPIPageProps;
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
          // Park the social links inside the bottom box, beside the light/dark
          // toggle (the default theme switch slot).
          themeSwitch: (props) => <ThemeSwitchWithSocial {...props} />,
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
