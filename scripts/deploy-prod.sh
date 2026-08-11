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
#   3. Bring the stack up and wait for it to be healthy.
#   4. Health-gate it: /health has to answer ok *and* the container that
#      answered has to be running the image just built. A green /health on
#      its own proves nothing about which build served it.
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
# `runner` only starts when a model agent command is configured. With none,
# it has nothing to do, and a container restarting forever is worse than an
# absent one: #82's own acceptance is that the product degrades to manual
# entry when the runner is not there.
services=(db web)
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
    echo "rolled back to $previous_image" >&2
  else
    echo "nothing to roll back to: this was the first deploy, leaving the stack down" >&2
    "${COMPOSE[@]}" down || true
  fi
  exit 1
}

echo "==> starting ${services[*]}"
"${COMPOSE[@]}" up -d --wait "${services[@]}" || rollback

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
