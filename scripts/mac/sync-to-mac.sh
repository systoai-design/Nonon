#!/usr/bin/env bash
# Copies the NONON source (no node_modules/out/release/.git/site) to a Mac at ~/Code/nonon over SSH.
# Run from Git Bash on the PC: bash scripts/mac/sync-to-mac.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# Host and key come from the environment or from scripts/mac/local.env (git-ignored): NONON_MAC_HOST, NONON_MAC_KEY.
[ -f scripts/mac/local.env ] && source scripts/mac/local.env
: "${NONON_MAC_HOST:?set NONON_MAC_HOST (for example you@your-mac.local) or create scripts/mac/local.env}" "${NONON_MAC_KEY:?set NONON_MAC_KEY (path to the ssh key)}"
SSH="ssh -i $NONON_MAC_KEY -o IdentitiesOnly=yes -o BatchMode=yes $NONON_MAC_HOST"
$SSH 'mkdir -p ~/Code/nonon && cd ~/Code/nonon && rm -rf app/src app/resources app/build app/scripts'
tar -cf - --exclude=node_modules --exclude=out --exclude=release --exclude=.git --exclude=models app LICENSE NOTICE | $SSH 'cd ~/Code/nonon && tar -xf -'
$SSH 'cd ~/Code/nonon && ls && du -sh app'
