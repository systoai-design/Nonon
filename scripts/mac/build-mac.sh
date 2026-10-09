#!/bin/zsh
# Runs ON a Mac (macOS, Apple silicon). Builds NONON from ~/Code/nonon.
#   build-mac.sh unsigned   ad-hoc build, no Developer ID, no notarization (Gatekeeper warns)
#   build-mac.sh signed     signs with your own Developer ID and builds the dmg for notarization
# Signing settings are read from $NONON_SIGNING_ENV (default ~/Code/signing/nonon-signing.env), a file that is NOT in this
# repository and defines: NONON_CSC_NAME (the exact Developer ID Application identity), NONON_TEAM_ID (the 10-character
# team id that identity must contain) and NONON_KEYCHAIN (keychain file holding the certificate, optional), plus
# NONON_KEYCHAIN_PASSWORD_FILE (path to a file holding that keychain's password, optional).
set -eu
export PATH=$HOME/.local/node/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
MODE=${1:-unsigned}
cd "$HOME/Code/nonon/app"

pnpm install --frozen-lockfile > "$HOME/Code/nonon-install.log" 2>&1 || { tail -30 "$HOME/Code/nonon-install.log"; exit 1; }
rm -rf release

if [ "$MODE" = "signed" ]; then
  source "${NONON_SIGNING_ENV:-$HOME/Code/signing/nonon-signing.env}"
  : "${NONON_CSC_NAME:?set NONON_CSC_NAME in the signing env file}" "${NONON_TEAM_ID:?set NONON_TEAM_ID in the signing env file}"
  case "$NONON_CSC_NAME" in *"$NONON_TEAM_ID"*) ;; *) echo "refusing: the identity does not belong to team $NONON_TEAM_ID"; exit 1;; esac
  if [ -n "${NONON_KEYCHAIN:-}" ]; then
    [ -z "${NONON_KEYCHAIN_PASSWORD_FILE:-}" ] || security unlock-keychain -p "$(cat "$NONON_KEYCHAIN_PASSWORD_FILE")" "$NONON_KEYCHAIN"
    export CSC_KEYCHAIN="$NONON_KEYCHAIN"
  fi
  export CSC_NAME="$NONON_CSC_NAME"
  # identity: null in electron-builder.yml means unsigned; override for this build only.
  pnpm build > "$HOME/Code/nonon-build.log" 2>&1
  pnpm exec electron-builder --mac --publish never -c.mac.identity="$CSC_NAME" >> "$HOME/Code/nonon-build.log" 2>&1 || { tail -40 "$HOME/Code/nonon-build.log"; exit 1; }
  APP=$(ls -d release/mac-arm64/NONON.app)
  codesign --verify --deep --strict "$APP"
  codesign -dv "$APP" 2>&1 | grep -E "TeamIdentifier|Authority=Developer ID Application" | head -3
  echo "SIGNED-BUILD-DONE (not notarized yet: run notarize step)"
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  pnpm build > "$HOME/Code/nonon-build.log" 2>&1
  pnpm exec electron-builder --mac --publish never >> "$HOME/Code/nonon-build.log" 2>&1 || { tail -40 "$HOME/Code/nonon-build.log"; exit 1; }
  echo "UNSIGNED-BUILD-DONE"
fi
ls -la release | grep -E "dmg|zip" || true
