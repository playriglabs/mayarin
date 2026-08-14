FROM oven/bun:1.2.5

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run typecheck
# The buyer-facing pages (#151). The API serves this bundle from
# apps/checkout-ui/dist, so the image must carry it built.
RUN bun run --cwd apps/checkout-ui build

CMD ["bun", "run", "start:railway"]
