#!/usr/bin/env bash
#
# Mainnet addresses, written to a file instead of a terminal.
#
# Reads .env.mainnet and writes ../../../mainnet-addresses.json (repo root, mode 600,
# gitignored): the deployer, every role already set, any keystore this script
# creates, the tokens a chain admits, and the contract addresses the deployer will
# produce on each chain. No address is printed; only the path is.
#
#   ./scripts/mainnet-wallets.sh                    # write the file from what exists
#   ./scripts/mainnet-wallets.sh --guardian         # also create a guardian keystore
#   ./scripts/mainnet-wallets.sh --owners 3         # also create three Safe-owner keystores
#   ./scripts/mainnet-wallets.sh --adopt mayarin-mainnet-guardian   # record a keystore that already exists
#   ./scripts/mainnet-wallets.sh --sync-env         # copy what the file knows into .env.mainnet
#
# A keystore is a Foundry encrypted JSON file in ~/.foundry/keystores, made with
# `cast wallet new`, which asks for its password on the terminal (hidden). The
# private key is never printed and never written in clear. Run this in your own
# terminal, not through an assistant: the prompt is interactive.
#
# --adopt <name> records the address of a keystore made earlier (it asks that keystore's
# password; the address is not stored in the keystore file). --sync-env fills the blank
# GUARDIAN, MULTISIG, FEE_RECIPIENT and TREASURY_ADDRESS of .env.mainnet from this file:
# the guardian from its keystore, the two Safes only once scripts/mainnet-safes.sh has
# found them deployed on every chain. It never overwrites a value that is set and
# prints no value.
#
# What this does NOT make, on purpose:
#   MULTISIG and FEE_RECIPIENT are Safes (contracts): scripts/deploy-treasury-safe.ts.
#   SIGNER (the order signer) and DESTINATION (the operator) live in Turnkey or KMS,
#   not in a file on this machine.
#
# --owners is for a rehearsal or a single founder's own devices. A Safe whose owners
# were all made on one laptop is one key with extra steps: real owners are separate
# people on separate devices.
#
# The contract addresses are a prediction: CREATE from the deployer's nonce, in the
# order deploy.sh sends them (timelock, router, forwarder factory). They hold only if
# nothing else is sent from the deployer first. With no <CHAIN>_RPC_URL set, the
# nonce is assumed to be 0 and the file says so.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$REPO_ROOT/.env.mainnet}"
OUT="${MAINNET_ADDRESSES_FILE:-$REPO_ROOT/mainnet-addresses.json}"
KEYSTORES="${FOUNDRY_KEYSTORES_DIR:-$HOME/.foundry/keystores}"

MAKE_GUARDIAN=false
OWNERS=0
ADOPT=()
SYNC_ENV=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --guardian) MAKE_GUARDIAN=true ;;
    --owners) OWNERS="${2:-}"; shift ;;
    --adopt) ADOPT+=("${2:-}"); shift ;;
    --sync-env) SYNC_ENV=true ;;
    *) echo "unknown flag \"$1\""; exit 1 ;;
  esac
  shift
done
[[ "$OWNERS" =~ ^[0-9]+$ ]] || { echo "--owners takes a number"; exit 1; }

command -v cast >/dev/null || { echo "cast not found — install Foundry: foundryup"; exit 1; }
command -v jq   >/dev/null || { echo "jq not found"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for var in DEPLOYER_ACCOUNT DEPLOYER_ADDRESS; do
  [[ -n "${!var:-}" ]] || { echo "missing $var in $ENV_FILE"; exit 1; }
done

# --- Keystores this script creates --------------------------------------------

mkdir -p "$KEYSTORES"
# Keystores recorded by an earlier run stay in the file: a second run must not forget them.
CREATED='[]'
if [[ -f "$OUT" ]]; then CREATED="$(jq -c '.createdKeystores // []' "$OUT" 2>/dev/null || echo '[]')"; fi
PREVIOUS_SAFES='null'
if [[ -f "$OUT" ]]; then PREVIOUS_SAFES="$(jq -c '.safes // null' "$OUT" 2>/dev/null || echo 'null')"; fi

# new_keystore <name>: makes the keystore and records its address, never printing it.
new_keystore() {
  local name="$1" file="$KEYSTORES/$1" out address
  if [[ -e "$file" ]]; then
    echo "keystore $name already exists — not overwritten (record it with --adopt $name)"
    return 0
  fi
  # The password prompt reads the terminal; only the summary line is captured here.
  out="$(cast wallet new "$KEYSTORES" "$name")"
  address="$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
  [[ -n "$address" ]] || { echo "could not read the address of $name"; exit 1; }
  CREATED="$(jq -c --arg name "$name" --arg address "$address" '. + [{account: $name, address: $address}]' <<<"$CREATED")"
}

# adopt <name>: records an existing keystore's address. The password prompt is cast's.
adopt() {
  local name="$1" address
  [[ -e "$KEYSTORES/$name" ]] || { echo "no keystore named $name"; exit 1; }
  if [[ "$(jq --arg n "$name" '[.[] | select(.account == $n)] | length' <<<"$CREATED")" != "0" ]]; then return 0; fi
  address="$(cast wallet address --account "$name" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
  [[ -n "$address" ]] || { echo "could not read the address of $name"; exit 1; }
  CREATED="$(jq -c --arg name "$name" --arg address "$address" '. + [{account: $name, address: $address}]' <<<"$CREATED")"
}

[[ "$MAKE_GUARDIAN" == true ]] && new_keystore mayarin-mainnet-guardian
for name in ${ADOPT[@]+"${ADOPT[@]}"}; do adopt "$name"; done
for ((i = 1; i <= OWNERS; i++)); do new_keystore "mayarin-mainnet-safe-owner-$i"; done

# --- Fill .env.mainnet from what is known ------------------------------------------

# set_blank <VAR> <value>: sets VAR only if it is blank in the file. Prints nothing.
set_blank() {
  local var="$1" value="$2" current
  [[ -n "$value" && "$value" != "null" ]] || return 0
  current="$(sed -n "s/^$var=//p" "$ENV_FILE" | sed -E 's/[[:space:]]+#.*//' | tail -1 | tr -d '[:space:]')"
  [[ -z "$current" ]] || return 0
  VALUE="$value" perl -pi -e 's/^('"$var"'=)[ \t]*([^#\n]*)/$1.$ENV{VALUE}.($2 =~ m{\S} ? "" : "   ")/e' "$ENV_FILE"
  SYNCED+=("$var")
}
SYNCED=()
if [[ "$SYNC_ENV" == true ]]; then
  set_blank GUARDIAN "$(jq -r '[.[] | select(.account == "mayarin-mainnet-guardian")][0].address // empty' <<<"$CREATED")"
  for role in multisig:MULTISIG treasury:FEE_RECIPIENT treasury:TREASURY_ADDRESS; do
    key="${role%%:*}"; var="${role##*:}"
    everywhere="$(jq -r --arg k "$key" '.[$k] | if . == null then false else ([.deployed[]?] | length == 4 and all) end' <<<"$PREVIOUS_SAFES")"
    [[ "$everywhere" == "true" ]] && set_blank "$var" "$(jq -r --arg k "$key" '.[$k].address' <<<"$PREVIOUS_SAFES")"
  done
  # What the file now says must be what the file now holds.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# --- Contract addresses per chain ------------------------------------------------

# predicted <chain> <rpc var>: the three contracts a first deploy produces.
predicted() {
  local chain="$1" rpc_var="$2" rpc nonce source
  rpc="${!rpc_var:-}"
  if [[ -n "$rpc" ]] && nonce="$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$rpc" 2>/dev/null)"; then
    source="rpc"
  else
    nonce=0
    source="assumed"
  fi
  local timelock router factory
  timelock="$(cast compute-address "$DEPLOYER_ADDRESS" --nonce "$nonce" | grep -oE '0x[0-9a-fA-F]{40}')"
  router="$(cast compute-address "$DEPLOYER_ADDRESS" --nonce $((nonce + 1)) | grep -oE '0x[0-9a-fA-F]{40}')"
  factory="$(cast compute-address "$DEPLOYER_ADDRESS" --nonce $((nonce + 2)) | grep -oE '0x[0-9a-fA-F]{40}')"
  jq -n --arg chain "$chain" --argjson nonce "$nonce" --arg source "$source" \
    --arg timelock "$timelock" --arg router "$router" --arg factory "$factory" \
    '{($chain): {deployerNonce: $nonce, nonceSource: $source,
      predicted: {TimelockController: $timelock, PaymentRouter: $router, DepositForwarderFactory: $factory}}}'
}

CHAINS="$(
  { predicted base BASE_RPC_URL; predicted arbitrum ARBITRUM_RPC_URL
    predicted polygon POLYGON_RPC_URL; predicted bsc BSC_RPC_URL; } | jq -s 'add'
)"

# The deterministic singletons share one address on every chain (CREATE2 through
# the canonical deployer, fixed salts), so they are listed once.
SINGLETONS='{"EscrowFactory":"0xCB6dd0781D36FE95a5ff69248498E48909BB4e1B","EscrowFactoryV2":"0xB14EEab74d84F900132632ff9dAcDe26C5043cad","PayoutBatcher":"0x78F0C40E1Aa5a63DD71E58334586461eB3EB6312"}'

# `source` strips the double quotes JSON is made of, so the map is read back from the
# file itself, as deploy.sh does.
TOKENS="$(sed -n 's/^CHAIN_ASSETS=//p' "$ENV_FILE" | tail -1 | jq -c '.' 2>/dev/null || true)"
[[ -n "$TOKENS" ]] || TOKENS='{}'

# --- Write ---------------------------------------------------------------------------

role() { [[ -n "${!1:-}" ]] && printf '%s' "${!1}" || printf ''; }

umask 077
jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg deployerAccount "$DEPLOYER_ACCOUNT" --arg deployerAddress "$DEPLOYER_ADDRESS" \
  --arg multisig "$(role MULTISIG)" --arg guardian "$(role GUARDIAN)" \
  --arg feeRecipient "$(role FEE_RECIPIENT)" --arg signer "$(role SIGNER)" \
  --arg destination "$(role DESTINATION)" \
  --argjson created "$CREATED" --argjson chains "$CHAINS" --argjson safes "$PREVIOUS_SAFES" \
  --argjson singletons "$SINGLETONS" --argjson tokens "$TOKENS" \
  '{
    generatedAt: $generatedAt,
    note: "Addresses only; no key is written here. Contract addresses are predictions from the deployer nonce.",
    deployer: {account: $deployerAccount, address: $deployerAddress},
    roles: {
      MULTISIG: $multisig, GUARDIAN: $guardian, FEE_RECIPIENT: $feeRecipient,
      SIGNER: $signer, DESTINATION: $destination
    },
    createdKeystores: $created,
    safes: $safes,
    tokens: $tokens,
    deterministicSingletons: $singletons,
    chains: $chains
  }' >"$OUT"
chmod 600 "$OUT"

echo "wrote $OUT ($(jq '[.createdKeystores[]] | length' "$OUT") keystore(s) recorded, mode 600). No address printed."
if [[ "$SYNC_ENV" == true ]]; then
  if [[ ${#SYNCED[@]} -eq 0 ]]; then echo "$ENV_FILE: nothing to fill (set already, or not known yet)."
  else echo "$ENV_FILE: filled ${SYNCED[*]}."; fi
fi
