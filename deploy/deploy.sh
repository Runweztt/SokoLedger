#!/usr/bin/env bash
# Deploys the current checkout to one app server and reloads it under pm2.
# Run once per host: ./deploy/deploy.sh web-01.example.internal
#                     ./deploy/deploy.sh web-02.example.internal
#
# Assumes: SSH key access as $REMOTE_USER, node/npm/pm2 already installed
# on the target, and /opt/sokoledger already `git clone`'d there once
# (this script updates it, it doesn't do first-time provisioning).

set -euo pipefail

REMOTE_HOST="${1:?Usage: deploy.sh <host>}"
REMOTE_USER="${REMOTE_USER:-sokoledger}"
REMOTE_PATH="${REMOTE_PATH:-/opt/sokoledger}"

echo "Deploying to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}"

rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.git' \
  ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

ssh "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<'EOF'
  set -euo pipefail
  cd /opt/sokoledger/server
  npm ci --omit=dev
  pm2 reload ecosystem.config.js --update-env
  pm2 save
EOF

echo "Deployed. Check: curl -s http://${REMOTE_HOST}:3000/healthz"
