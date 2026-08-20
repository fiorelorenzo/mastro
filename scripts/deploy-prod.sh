#!/usr/bin/env bash
#
# deploy-prod.sh — the tag-triggered production deploy. Runs ON the
# production host, as the user that owns the deploy directory, invoked by
# .github/workflows/deploy-prod.yml's self-hosted `deploy` job from a
# checkout of the tag being deployed.
#
# Usage (cwd must be that checkout, i.e. what actions/checkout leaves in
# $GITHUB_WORKSPACE):
#   scripts/deploy-prod.sh <tag>
#
# What it does, in order:
#   1. rsync the checked-out tag into $MASTRO_DEPLOY_DIR, excluding (and
#      thereby protecting) everything that only exists on the box.
#   2. Remember the image currently serving, so there is something to roll
#      back to, then build the new one.
#   3. Bring the stack up and wait for it to be healthy. If that recreated
#      `web`, recreate `scheduler` too (#384): compose only recreates a
#      container whose own inputs changed, and scheduler's inputs don't
#      change just because web's did, so left alone it would keep running
#      against a network reference to a `web` container that no longer
#      exists.
#   4. Health-gate it: /health has to answer ok *and* the container that
#      answered has to be running the image just built. A green /health on
#      its own proves nothing about which build served it. Then confirm
#      `scheduler` itself can reach `web` over the compose network (#384) —
#      the loopback /health check above cannot see that path at all, since
#      it never leaves the host.
#   5. On any failure from step 3 on, put the previous image back, bring
#      the stack up on it, and exit non-zero. Before that, `set -e` is
#      enough: nothing live has changed yet.
#   6. Record DEPLOYED.json, which is the source of truth for what is live
#      (the deploy directory is not a git checkout, so nothing else on the
#      box can tell you).
#
# The image is built here rather than on a GitHub-hosted runner and pulled
# from a registry: mastro's image is small (no browser, no monorepo), the
# build is a `pnpm install` plus a Vite build, and building on the box
# keeps the pipeline to two moving parts instead of four. The cost is a few
# minutes of a shared vCPU per release; revisit that if this box ever gets
# busy enough for it to matter.
#
# Idempotent: re-running for the same tag re-syncs the same source,
# rebuilds the same image (mostly from cache) and re-runs the same health
# gate.
set -euo pipefail

TAG="${1:?usage: deploy-prod.sh <tag>}"
REPO_ROOT="$(pwd)"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
ACTOR="${GITHUB_ACTOR:-$(whoami)}"

DEPLOY_DIR="${MASTRO_DEPLOY_DIR:-/opt/apps/mastro}"
ENV_FILE="$DEPLOY_DIR/.env.prod"
DEPLOYED_JSON="$DEPLOY_DIR/DEPLOYED.json"
COMPOSE=(docker compose -f compose.prod.yaml --env-file .env.prod)

echo "==> deploying tag=$TAG sha=$SHA actor=$ACTOR -> $DEPLOY_DIR"

[ -d "$DEPLOY_DIR" ] || {
  echo "ERROR: $DEPLOY_DIR does not exist. Provision the host first (docs/deploy.md)." >&2
  exit 1
}
[ -f "$ENV_FILE" ] || {
  echo "ERROR: $ENV_FILE is missing. It holds the secrets and is never in git (docs/deploy.md)." >&2
  exit 1
}

# --- 1. sync source -------------------------------------------------------
#
# --checksum rather than rsync's default size-and-mtime quick check: a fresh
# checkout's timestamps have nothing to do with the box's, and two versions
# of a small config file can easily match on size.
#
# Every anchored exclude below protects something that exists only on the
# box and would otherwise be deleted by --delete: the secrets file, the
# documents directory (archived approvals and contracts, invariant 4), the
# backups, and this script's own record of what is live.
rsync -a --delete --checksum \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '/.env.prod' \
  --exclude '/data' \
  --exclude '/backups' \
  --exclude '/DEPLOYED.json' \
  "$REPO_ROOT/" "$DEPLOY_DIR/"

cd "$DEPLOY_DIR"

# --- 2. remember what is serving, then build ------------------------------
previous_image="$(docker inspect --format '{{.Image}}' mastro-prod-web-1 2>/dev/null || true)"
# Also remembered so step 3b can tell whether `up` actually recreated the
# `web` container (not just whether it rebuilt the image): `{{.Id}}` is the
# container's own identity, which changes on recreate and nowhere else.
previous_web_cid="$(docker inspect --format '{{.Id}}' mastro-prod-web-1 2>/dev/null || true)"
if [ -n "$previous_image" ]; then
  echo "==> current web image: $previous_image"
  docker tag "$previous_image" mastro-prod-web:rollback
else
  echo "==> no web container running yet: first deploy, nothing to roll back to"
fi

echo "==> building"
"${COMPOSE[@]}" build web runner
# The id of what was just built, read from the tag compose gives it
# (<project>-<service>), in the same full-digest form `docker inspect` puts
# on a container, so the two are actually comparable in the gate below.
built_image="$(docker image inspect -f '{{.Id}}' mastro-prod-web)"

# --- 3. up ----------------------------------------------------------------
#
# The bundled `proxy` service is deliberately not started here: this host
# already runs Caddy as its single edge for every app on it, and two
# processes cannot both hold 443. A host that has no edge proxy of its own
# starts the bundled one instead (docs/deploy.md covers both shapes).
#
# `scheduler` (#222) starts unconditionally, alongside `db`/`web`, unlike
# `runner` below: an unconfigured cron token makes it skip that one job
# and log why (`scripts/scheduler.ts`'s own comment), never crash-loop,
# so there is no "nothing to do" case worth leaving it stopped for.
#
# `runner` only starts when a model agent command is configured. With none,
# it has nothing to do, and a container restarting forever is worse than an
# absent one: #82's own acceptance is that the product degrades to manual
# entry when the runner is not there.
services=(db web scheduler)
if grep -qE '^RUNNER_AGENT_COMMAND=.+' "$ENV_FILE"; then
  services+=(runner)
  echo "==> runner: an agent command is configured, starting it"
else
  echo "==> runner: no agent command configured, leaving it stopped"
fi

rollback() {
  echo "::error::deploy failed, rolling back" >&2
  if [ -n "$previous_image" ]; then
    # compose builds `web` with no `image:` key, so the image it runs is
    # tagged <project>-<service>. Pointing that tag back at the previous
    # image and recreating without building is the whole rollback.
    docker tag mastro-prod-web:rollback mastro-prod-web:latest || true
    "${COMPOSE[@]}" up -d --no-build --force-recreate web || true
    # This recreate is exactly what #384 is about, just triggered by a
    # rollback instead of a forward deploy: `web`'s container identity
    # just changed again (back to the old image, but still a brand new
    # container), so `scheduler`'s reference to whatever it was pointed at
    # a moment ago is already stale. Skipping this here would fix the
    # forward path and reintroduce the exact same bug on every rollback.
    "${COMPOSE[@]}" up -d --no-deps --force-recreate scheduler || true
    echo "rolled back to $previous_image" >&2
  else
    echo "nothing to roll back to: this was the first deploy, leaving the stack down" >&2
    "${COMPOSE[@]}" down || true
  fi
  exit 1
}

echo "==> starting ${services[*]}"
"${COMPOSE[@]}" up -d --wait "${services[@]}" || rollback

# --- 3b. scheduler vs. a recreated web (#384) ------------------------------
#
# `scheduler` has been unconditionally in $services above since #222, but
# being *listed* in `up -d` is not being *recreated* by it: compose diffs
# each service's own inputs (image, env, config) and only recreates the
# ones that changed, which is exactly the property that keeps a
# web-only or runner-only release from restarting the rest of the stack.
# Nothing about scheduler's own inputs changes when only web's do, so
# compose leaves the running scheduler container exactly as it was —
# still holding whatever network reference it resolved `web` to at its
# own boot. Measured on v0.13.0 (#384): web recreated at 11:41, the
# scheduler's next tick at 11:53 threw `TypeError: fetch failed`, and
# nothing reported it, because the alert engine is one of the things that
# had just gone silent. `docker compose restart scheduler` fixed it by
# hand; this is that fix, automatic, and scoped to only the deploys that
# actually need it.
#
# Guarded on `previous_web_cid` being non-empty: an empty value means this
# is the first deploy, `web` had no prior container to hold a stale
# reference to, and scheduler is coming up fresh in the same `up` call
# above with nothing to re-resolve.
current_web_cid="$(docker inspect --format '{{.Id}}' mastro-prod-web-1 2>/dev/null || true)"
if [ -n "$previous_web_cid" ] && [ "$current_web_cid" != "$previous_web_cid" ]; then
  echo "==> web was recreated ($previous_web_cid -> $current_web_cid); recreating scheduler so it re-resolves it (#384)"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait scheduler || rollback
fi

# --- 4. health gate -------------------------------------------------------
#
# Two separate claims, both checked: the app answers, and the thing that
# answered is the build this run produced. A green /health alone would pass
# just as happily against yesterday's container.
web_port="$(grep -E '^WEB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
web_port="${web_port:-3001}"

health=''
for attempt in $(seq 1 30); do
  health="$(curl -fsS --max-time 5 "http://127.0.0.1:${web_port}/health" 2>/dev/null || true)"
  case "$health" in
  *'"status":"ok"'*) break ;;
  esac
  echo "   waiting for /health (attempt $attempt): ${health:-no answer}"
  sleep 2
done

case "$health" in
*'"status":"ok"'*'"database":"ok"'*) echo "==> /health: $health" ;;
*)
  echo "::error::/health never reported ok on 127.0.0.1:${web_port} (last answer: ${health:-none})" >&2
  rollback
  ;;
esac

serving_image="$(docker inspect --format '{{.Image}}' mastro-prod-web-1)"
if [ "$serving_image" != "$built_image" ]; then
  echo "::error::the running container serves $serving_image, not the image just built ($built_image)" >&2
  rollback
fi
echo "==> serving image: $serving_image (the one this run built)"

# --- 4b. scheduler reachability gate (#384) --------------------------------
#
# The /health check above proves `web` answers on the loopback port this
# host publishes, which is not the path that broke: the incident was
# `scheduler`'s own connection to `web` over the *compose* network going
# stale, and the host never has a reason to touch that network at all, so
# nothing above can see it. Exec into the `scheduler` container itself and
# make it call one of its own cron routes exactly the way its own ticks do
# — same shape as the `image` job's route check in ci.yml (bearer token,
# expect 200), just run from inside the container this time so it exercises
# the same DNS/connection path a real tick uses, and reading the token from
# that container's own environment rather than a value chosen here, so the
# check can never authenticate with a token production isn't actually
# configured with.
#
# Route choice is dynamic on purpose: `IMAP_POLL_CRON_TOKEN` and
# `ALERT_CRON_TOKEN` are both individually optional (`.env.prod.example`
# says so for mail explicitly, and every route treats an unset token as a
# bare 401, indistinguishable from a wrong one, by design — see
# cron-token.ts). An instance that has not configured a given job yet is
# not a reachability failure, so this only tests whichever job actually has
# a token to send; only if neither is configured does it skip, which is the
# one case where there is nothing this deploy could prove either way.
echo "==> checking scheduler can reach web (#384)"
"${COMPOSE[@]}" exec -T scheduler node -e "
  const routes = [
    { path: '/api/mail/poll', token: process.env.IMAP_POLL_CRON_TOKEN },
    { path: '/api/alerts/run/push', token: process.env.ALERT_CRON_TOKEN }
  ];
  const route = routes.find((r) => r.token);
  if (!route) {
    console.log('no cron token configured on this instance, nothing to poll, skipping');
    process.exit(0);
  }
  const base = process.env.SCHEDULER_BASE_URL || 'http://web:3000';
  fetch(base + route.path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + route.token }
  })
    .then((r) => {
      console.log('POST ' + route.path + ' -> ' + r.status);
      process.exit(r.status === 200 ? 0 : 1);
    })
    .catch((e) => {
      console.error('scheduler -> web fetch failed: ' + e);
      process.exit(1);
    });
" || {
  echo "::error::scheduler cannot reach web after this deploy (#384); refusing to report success" >&2
  rollback
}

# --- 5. record ------------------------------------------------------------
cat >"$DEPLOYED_JSON" <<JSON
{
  "tag": "$TAG",
  "commit": "$SHA",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "actor": "$ACTOR",
  "webImage": "$serving_image",
  "services": "${services[*]}"
}
JSON
docker image rm mastro-prod-web:rollback >/dev/null 2>&1 || true

echo "==> deployed $TAG ($SHA)"
cat "$DEPLOYED_JSON"
