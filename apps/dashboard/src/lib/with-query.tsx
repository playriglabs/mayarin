/**
 * HOC that mounts a component below the shared React Query provider.
 *
 * `useQueryClient` (via `useEffectMutation`/`useEffectQuery`) must run below the
 * `QueryClientProvider` in the React tree. An island cannot supply that context
 * to itself — rendering `<Providers>` around one's own hook call puts the hook
 * above the provider — so this HOC wraps the component as a real child of the
 * provider, which is what makes SSR resolve the context.
 *
 * Use on the default export of any island that needs queries/mutations:
 *   export default withQuery(LoginForm);
 */

import { type ComponentType, createElement } from "react";
import Providers from "@/components/providers";

export function withQuery<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return function WithQuery(props: P) {
    return createElement(Providers, null, createElement(Component, props));
  };
}
