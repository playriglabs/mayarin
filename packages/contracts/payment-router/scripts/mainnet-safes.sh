#!/usr/bin/env bash
#
# The two mainnet Safes, predicted and deployed, recorded in a file and never printed.
#
#   MULTISIG       the timelock's proposer and executor (the router's config authority)
#   FEE_RECIPIENT  the treasury that receives the fees
#
# Both are threshold Safes (Safe 1.4.1, canonical contracts) owned by the
# mayarin-mainnet-safe-owner-* keystores that scripts/mainnet-wallets.sh recorded in
# mainnet-addresses.json. They differ by salt, so they are different addresses, and
# each address is the same on every chain.
#
#   ./scripts/mainnet-safes.sh all                 # predict on all five chains; sends nothing
#   ./scripts/mainnet-safes.sh base                # predict on one
#   ./scripts/mainnet-safes.sh base --execute      # deploy on one: asks for the typed word
#   ./scripts/mainnet-safes.sh all --threshold 3   # default 2
#
# Predicting reads a chain and sends nothing. Deploying needs a funded key to pay the
# gas (it has no authority over a Safe once the Safe exists): the deployer keystore's,
# decrypted by `cast wallet decrypt-keystore` (hidden password prompt) into the
# environment of one process, never printed and never written. Run --execute in your
# own terminal.
#
# Writes mainnet-addresses.json -> safes.<multisig|treasury>.{address, deployed.<chain>};
# after every chain says deployed, `mainnet-wallets.sh --sync-env` fills MULTISIG,
# FEE_RECIPIENT and TREASURY_ADDRESS in .env.mainnet. No address is printed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$REPO_ROOT/.env.mainnet}"
OUT="${MAINNET_ADDRESSES_FILE:-$REPO_ROOT/mainnet-addresses.json}"

TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "usage: $0 <ethereum|base|arbitrum|polygon|bsc|all> [--execute] [--threshold N]"; exit 1; }
shift
EXECUTE=false
THRESHOLD=2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true ;;
    --threshold) THRESHOLD="${2:-}"; shift ;;
    *) echo "unknown flag \"$1\""; exit 1 ;;
  esac
  shift
done
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] || { echo "--threshold takes a number"; exit 1; }

command -v jq  >/dev/null || { echo "jq not found"; exit 1; }
command -v bun >/dev/null || { echo "bun not found"; exit 1; }
[[ -f "$OUT" ]] || { echo "missing $OUT — run scripts/mainnet-wallets.sh first"; exit 1; }

case "$TARGET" in
  all) CHAINS="ethereum base arbitrum polygon bsc" ;;
  ethereum|base|arbitrum|polygon|bsc) CHAINS="$TARGET" ;;
  *) echo "chain is ethereum, base, arbitrum, polygon, bsc or all"; exit 1 ;;
esac

# --- Owners come from the file; their addresses are never echoed ----------------------

OWNER_ARGS=()
while IFS= read -r address; do
  [[ -n "$address" ]] && OWNER_ARGS+=(--owner "$address")
done < <(jq -r '.createdKeystores[] | select(.account | startswith("mayarin-mainnet-safe-owner-")) | .address' "$OUT")
OWNER_COUNT=$(( ${#OWNER_ARGS[@]} / 2 ))
(( OWNER_COUNT >= THRESHOLD && THRESHOLD >= 2 )) || {
  echo "$OWNER_COUNT Safe owner(s) recorded for a threshold of $THRESHOLD. Run mainnet-wallets.sh --owners N (a threshold under 2 is refused)."; exit 1; }

# --- A funded key to pay the deployment gas, only for --execute -----------------------

if [[ "$EXECUTE" == true ]]; then
  command -v cast >/dev/null || { echo "cast not found — install Foundry: foundryup"; exit 1; }
  # shellcheck disable=SC1090
  DEPLOYER_ACCOUNT="$(sed -n 's/^DEPLOYER_ACCOUNT=//p' "$ENV_FILE" | sed -E 's/[[:space:]]+#.*//' | tail -1 | tr -d '[:space:]')"
  [[ -n "$DEPLOYER_ACCOUNT" ]] || { echo "DEPLOYER_ACCOUNT is blank in $ENV_FILE"; exit 1; }
  echo "This DEPLOYS two Safes ($THRESHOLD of $OWNER_COUNT) on: $CHAINS — mainnet, real gas."
  read -r -p "Type the word 'execute' to continue: " CONFIRM
  [[ "$CONFIRM" == "execute" ]] || { echo "not confirmed"; exit 1; }
  KEY="$(cast wallet decrypt-keystore "$DEPLOYER_ACCOUNT" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)"
  [[ -n "$KEY" ]] || { echo "could not decrypt the keystore"; exit 1; }
fi

# --- Run, one Safe on one chain at a time ------------------------------------------------

# Public endpoints are enough to predict; a deploy uses the RPC in the env file.
public_rpc() {
  case "$1" in
    ethereum) echo "https://ethereum-rpc.publicnode.com" ;;
    base) echo "https://base-rpc.publicnode.com" ;;
    arbitrum) echo "https://arbitrum-one-rpc.publicnode.com" ;;
    polygon) echo "https://polygon-bor-rpc.publicnode.com" ;;
    bsc) echo "https://bsc-rpc.publicnode.com" ;;
  esac
}
env_rpc() {
  local var
  var="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')_RPC_URL"
  sed -n "s/^$var=//p" "$ENV_FILE" | sed -E 's/[[:space:]]+#.*//' | tail -1 | tr -d '[:space:]'
}

record() { # record <role> <chain> <address> <deployed true|false>
  local tmp known
  # One set of owners, one threshold and one salt give one address on every chain.
  known="$(jq -r --arg r "$1" '.safes[$r].address // empty' "$OUT")"
  if [[ -n "$known" && "$(printf '%s' "$known" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')" ]]; then
    echo "$1 on $2: the address differs from the one recorded for another chain — the owners, threshold or salt changed. Stop."
    return 1
  fi
  tmp="$(mktemp)"
  jq --arg role "$1" --arg chain "$2" --arg address "$3" --argjson deployed "$4" --argjson threshold "$THRESHOLD" --argjson owners "$OWNER_COUNT" \
    '.safes = ((.safes // {}) | .[$role] = ((.[$role] // {}) + {address: $address, threshold: $threshold, owners: $owners})
       | .[$role].deployed = ((.[$role].deployed // {}) + {($chain): $deployed}))' "$OUT" >"$tmp"
  mv "$tmp" "$OUT"
  chmod 600 "$OUT"
}

FAILED=0
for chain in $CHAINS; do
  rpc="$(env_rpc "$chain")"
  [[ -n "$rpc" ]] || rpc="$(public_rpc "$chain")"
  for role in multisig treasury; do
    salt="mayarin-mainnet-$role-1"
    cmd=(bun --env-file="$ENV_FILE" run "$REPO_ROOT/scripts/deploy-treasury-safe.ts"
         --chain "$chain" --rpc "$rpc" "${OWNER_ARGS[@]}" --threshold "$THRESHOLD" --salt "$salt")
    if [[ "$EXECUTE" == true ]]; then
      result="$(cd "$REPO_ROOT" && SAFE_DEPLOYER_PRIVATE_KEY="$KEY" "${cmd[@]}" --execute 2>&1)" || { echo "$role on $chain: FAILED ($(printf '%s' "$result" | tail -1 | cut -c1-100))"; FAILED=1; continue; }
      address="$(printf '%s' "$result" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
      deployed=true
    else
      result="$(cd "$REPO_ROOT" && "${cmd[@]}" 2>&1)" || { echo "$role on $chain: FAILED ($(printf '%s' "$result" | tail -1 | cut -c1-100))"; FAILED=1; continue; }
      address="$(printf '%s' "$result" | sed -n 's/^address[[:space:]]*//p' | head -1)"
      if printf '%s' "$result" | grep -qE '^deployed[[:space:]]+yes'; then deployed=true; else deployed=false; fi
    fi
    [[ -n "$address" ]] || { echo "$role on $chain: could not read the address"; FAILED=1; continue; }
    record "$role" "$chain" "$address" "$deployed" || { FAILED=1; continue; }
    echo "$role on $chain: $([[ "$EXECUTE" == true ]] && echo deployed || echo "predicted, deployed=$deployed")"
  done
done
unset KEY 2>/dev/null || true

echo "recorded in $OUT. No address printed."
exit "$FAILED"
