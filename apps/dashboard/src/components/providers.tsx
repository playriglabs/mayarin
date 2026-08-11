/**
 * Provider island for components that read data.
 *
 * Wraps islands in a single shared `QueryClient` (see `lib/query`) plus the
 * motion configuration. Each island hydrates independently; sharing the query
 * client means a mutation in one island can invalidate a query another reads.
 *
 * An island that animates but does NOT query mounts `MotionProvider` on its
 * own instead of this, so it never pulls React Query into its bundle.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MotionProvider } from "@/lib/motion";
import { queryClient } from "@/lib/query";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>{children}</MotionProvider>
    </QueryClientProvider>
  );
}
