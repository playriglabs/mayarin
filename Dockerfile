FROM oven/bun:1.4.0

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
# A host that cannot hold the whole monorepo's tsc in memory (deploy/aws, 4 GB) sets
# SKIP_TYPECHECK; the check still runs in the pre-push hook and in CI.
ARG SKIP_TYPECHECK=
RUN [ -n "$SKIP_TYPECHECK" ] || bun run typecheck
# The buyer-facing pages (#151). The API serves this bundle from
# apps/checkout-ui/dist, so the image must carry it built.
RUN bun run --cwd apps/checkout-ui build
# The docs service is deployed as an isolated Railway project. Build its
# standalone Node output into the same image.
RUN bun run --cwd apps/docs build

CMD ["bun", "run", "start:railway"]
