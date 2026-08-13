FROM oven/bun:1.2.5

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run typecheck

CMD ["bun", "run", "start:railway"]
