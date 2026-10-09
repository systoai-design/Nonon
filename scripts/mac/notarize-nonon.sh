#!/bin/zsh
# Runs ON a Mac after `build-mac.sh signed`. Notarizes the dmg and zip with an App Store Connect API key, staples the ticket,
# re-zips the stapled app, and prints Gatekeeper's verdict. Reads APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER and
# APPLE_TEAM_ID from $NONON_NOTARY_ENV (default ~/Code/signing/notary.env, not in this repository) and refuses to run unless
# APPLE_TEAM_ID equals NONON_TEAM_ID from the signing env file.
set -eu
export PATH=$HOME/.local/node/bin:$PATH
source "${NONON_NOTARY_ENV:-$HOME/Code/signing/notary.env}"
source "${NONON_SIGNING_ENV:-$HOME/Code/signing/nonon-signing.env}"
[ "$APPLE_TEAM_ID" = "${NONON_TEAM_ID:?set NONON_TEAM_ID in the signing env file}" ] || { echo "refusing: the notary key is for a different team than the signing identity"; exit 1; }
cd $HOME/Code/nonon/app
v=$(node -p 'require("./package.json").version')
APP=release/mac-arm64/NONON.app
for f in release/NONON-$v-mac-arm64.dmg release/NONON-$v-mac-arm64.zip; do
  ok=0
  for attempt in 1 2 3; do
    out=$(xcrun notarytool submit "$f" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --no-s3-acceleration --wait 2>&1) || true
    echo "$f (attempt $attempt)"; echo "$out" | grep -E "id:|status:" | tail -2
    if echo "$out" | grep -q "status: Accepted"; then ok=1; break; fi
    if echo "$out" | grep -qE "status: (Invalid|Rejected)"; then echo "$out" | tail -20; break; fi
    echo "$out" | tail -3
  done
  [ $ok = 1 ] || { echo "NOT ACCEPTED: $f"; exit 1; }
done
xcrun stapler staple "release/NONON-$v-mac-arm64.dmg"
xcrun stapler staple "$APP"
rm -f "release/NONON-$v-mac-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "release/NONON-$v-mac-arm64.zip"
echo "--- Gatekeeper checks"
spctl -a -vvv -t exec "$APP" 2>&1
spctl -a -vvv -t open --context context:primary-signature "release/NONON-$v-mac-arm64.dmg" 2>&1
xcrun stapler validate "release/NONON-$v-mac-arm64.dmg"
shasum -a 256 release/NONON-$v-mac-arm64.dmg release/NONON-$v-mac-arm64.zip
echo NOTARIZE-DONE
