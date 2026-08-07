# Production image (#76). Multi-stage so the runtime layer never carries the
# devDependencies (svelte-check, eslint, vite, drizzle-kit, ...) that the
# build needs: only `better-auth`, `drizzle-orm` and `postgres` are runtime
# dependencies (see package.json), and this Dockerfile installs exactly that
# set into the final layer.
#
# No secret is ever baked in here: .dockerignore excludes every .env* file,
# and the compose files below pass configuration in at container start
# through `env_file`, read from a file on the host with restrictive
# permissions (docs/deploy.md).

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# Full dependency set, needed to build. `--ignore-scripts` skips the
# `prepare` hook (project.inlang isn't copied in yet at this layer to keep
# dependency installs cacheable separately from source changes); `pnpm
# build` below regenerates the message catalogues itself through the
# Paraglide Vite plugin, so nothing is lost by skipping it here.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# The build itself. `pnpm build` compiles the Paraglide message catalogues
# through the Vite plugin (see AGENTS.md) and produces the adapter-node
# bundle in build/. SvelteKit's postbuild analysis step imports every
# server module to discover its exports, which runs the same top-level
# `if (!env.X) throw` guards `pnpm dev` runs under (db/index.ts,
# server/auth/index.ts) — so, exactly as CI's build step does, this needs
# *some* value for each required variable, never a real one and never
# reachable at build time.
FROM deps AS build
COPY . .
ENV DATABASE_URL=postgres://build:build@build-time-placeholder/build \
	BETTER_AUTH_SECRET=build-time-placeholder-not-a-real-secret \
	BETTER_AUTH_URL=http://localhost:5187 \
	GOOGLE_CLIENT_ID=build-time-placeholder \
	GOOGLE_CLIENT_SECRET=build-time-placeholder \
	AUTH_ALLOWED_EMAILS=
RUN pnpm build

# Runtime-only dependency set: a second, independent `pnpm install` rather
# than pruning the dev install, so nothing dev-only can survive by
# omission. `--ignore-scripts` skips the `prepare` hook, which needs the
# devDependencies (svelte-kit, paraglide-js) this stage deliberately does
# not install; none of the three runtime dependencies need a postinstall.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Final layer: adapter-node's bundle, the committed SQL migrations and the
# plain-node migration runner (scripts/migrate.ts), production
# node_modules. Nothing else — no source, no devDependencies, no .env file.
# Two final stages, `runtime` and `runner`. Nothing may depend on which one
# comes last: docker builds the last stage when no `--target` is given, and
# compose.prod.yaml names the stage it wants on both services precisely so
# that reordering this file cannot change what production runs.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S mastro && adduser -S mastro -G mastro
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/scripts/record-backup-run.ts ./scripts/record-backup-run.ts
# migrate.ts imports this one module to say which database it is about to
# touch. Node resolves that import at runtime, inside this image, so the
# file has to be here: without it the container cannot migrate and
# therefore cannot boot at all. Anything else migrate.ts ever imports from
# src/ has to be added here too, which is why it imports almost nothing.
COPY --from=build /app/src/lib/server/db/target.ts ./src/lib/server/db/target.ts
COPY --from=build /app/package.json ./package.json
USER mastro
EXPOSE 3000
# Migrations run on boot (#76's acceptance): the same script and the same
# committed SQL that `pnpm db:migrate` runs locally, so there is no second
# migration path to keep in sync.
CMD ["sh", "-c", "node scripts/migrate.ts && exec node build"]

# The ACP runner (#82): a second image built from the same source, on the
# same base as `runtime`, but a different CMD and a much smaller slice of
# the tree — `scripts/runner.ts` and `src/lib/server/runner/` are the only
# files it needs, since that module's own internal imports carry explicit
# `.ts` extensions and touch nothing else under `src/lib/server/` (see
# `scripts/runner.ts`'s own comment for why that matters under plain
# node). No `build/` directory, no SvelteKit, no Better Auth secret, no
# DATABASE_URL — this container never receives the app's own database
# credentials, only `RUNNER_DATABASE_URL` for the read-only role
# `drizzle/0035_acp_runner_role.sql` creates. See docs/agent-runner.md for
# every variable a self-hoster configures on this service.
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S mastro && adduser -S mastro -G mastro
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/scripts/runner.ts ./scripts/runner.ts
COPY --from=build /app/src/lib/server/runner ./src/lib/server/runner
COPY --from=build /app/package.json ./package.json
USER mastro
CMD ["node", "scripts/runner.ts", "watch"]
