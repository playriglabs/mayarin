#!/usr/bin/env bash
#
# Deploy + configure a chain's contracts (issues #29, #208).
#
# Three forge scripts in order, none of them optional:
#   1. DeployPaymentRouter          — router + timelock
#   2. DeployDepositForwarderFactory — the deposit path's CREATE2 factory, which
#                                      the API's config check requires of any
#                                      chain that has a router
#   3. ConfigurePaymentRouter        — the constructor whitelists settlement
#                                      assets only, so without this the first
#                                      swap payment reverts RouterNotWhitelisted
#
# Reads the repo-root .env. Forge only auto-loads a .env sitting next to
# foundry.toml, so this sources the root one explicitly and exports it.
#
#   ./scripts/deploy.sh ethereum-sepolia             # all three steps
#   ./scripts/deploy.sh base-sepolia                 # all three steps
#   ./scripts/deploy.sh arc-testnet --dry            # simulate, broadcast nothing
#   ./scripts/deploy.sh arc-testnet --factory-only   # router already deployed
#
# The per-chain values that are not addresses live in the table below; the
# addresses (MULTISIG, GUARDIAN, FEE_RECIPIENT, SIGNER, SETTLEMENT_TOKENS,
# DEX_ROUTERS) come from .env and are per-deployment, so a second chain is a
# second run with a different .env — never a second copy of this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$CONTRACT_DIR/../../.." && pwd)"

CHAIN="${1:-}"
[[ -n "$CHAIN" ]] || {
  echo "usage: $0 <ethereum-sepolia|base-sepolia|arc-testnet> [--dry] [--factory-only]"; exit 1; }

DRY_RUN=false
FACTORY_ONLY=false
for flag in "${@:2}"; do
  case "$flag" in
    --dry) DRY_RUN=true ;;
    # A chain whose router is already deployed and only needs the forwarder
    # factory — re-running the whole script would deploy a second router and
    # orphan the one the API is configured against.
    --factory-only) FACTORY_ONLY=true ;;
    *) echo "unknown flag \"$flag\""; exit 1 ;;
  esac
done

# macOS ships bash 3.2 — no associative arrays. One case, four facts.
case "$CHAIN" in
  ethereum-sepolia)
    CHAIN_ID=11155111
    RPC_VAR=ETHEREUM_SEPOLIA_RPC_URL
    EXPLORER="https://sepolia.etherscan.io/address"
    VERIFIER=etherscan
    ;;
  base-sepolia)
    CHAIN_ID=84532
    RPC_VAR=BASE_SEPOLIA_RPC_URL
    EXPLORER="https://sepolia.basescan.org/address"
    VERIFIER=etherscan
    ;;
  arc-testnet)
    CHAIN_ID=5042002
    RPC_VAR=ARC_TESTNET_RPC_URL
    EXPLORER="https://testnet.arcscan.app/address"
    # ArcScan is Blockscout, which verifies without an API key.
    VERIFIER=blockscout
    VERIFIER_URL="https://testnet.arcscan.app/api/"
    ;;
  *)
    echo "unknown chain \"$CHAIN\" — add it to the table in $0"; exit 1 ;;
esac

# --- Load env -----------------------------------------------------------------

ENV_FILE="$REPO_ROOT/.env"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

require() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { echo "missing $name in $ENV_FILE"; exit 1; }
}

# macOS ships bash 3.2, which has no `${var,,}`.
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

for var in DEPLOYER_PRIVATE_KEY "$RPC_VAR" MULTISIG GUARDIAN FEE_RECIPIENT SIGNER; do
  require "$var"
done

# The forwarder factory needs a sweep destination. It defaults to the operator's
# own address, so one of the two has to be set.
[[ -n "${DESTINATION:-}" || -n "${OPERATOR_PRIVATE_KEY:-}" ]] || {
  echo "missing DESTINATION or OPERATOR_PRIVATE_KEY in $ENV_FILE"; exit 1; }

# The addresses the constructor and the configure step whitelist are derived
# from CHAIN_ASSETS, which is where this deployment already names its tokens per
# chain. A second list of the same addresses is a list that can disagree with
# the first, and the disagreement only shows when a payment reverts — or when a
# router is deployed whitelisting an address with no code on the chain it landed
# on, which the timelock delay makes expensive to correct.
#
#   SETTLEMENT_TOKENS — the settlement assets, as addresses on this chain
#   INPUT_ASSETS      — every token this chain knows, as things a payer may pay with
# `source` above strips the double quotes JSON is made of — bash reads them as
# its own quoting — so the JSON-valued keys are read back from the file verbatim
# instead of from the environment.
raw_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
CHAIN_ASSETS_JSON="$(raw_env CHAIN_ASSETS)"
SETTLEMENT_ASSETS_JSON="$(raw_env SETTLEMENT_ASSETS)"

CHAIN_TOKENS="$(printf '%s' "${CHAIN_ASSETS_JSON:-{\}}" | jq -c --arg c "$CHAIN" '.[$c] // {}')"
SETTLEMENT_TOKENS="$(jq -rn \
  --argjson tokens "$CHAIN_TOKENS" \
  --argjson codes "${SETTLEMENT_ASSETS_JSON:-[\"USDC\"]}" \
  --arg fallback "${SETTLEMENT_ASSET:-}" \
  '($codes + (if $fallback == "" then [] else [$fallback] end) | unique) as $wanted
   | [$wanted[] | $tokens[.] // empty] | unique | join(",")')"
INPUT_ASSETS="$(jq -rn --argjson tokens "$CHAIN_TOKENS" '[$tokens[]] | unique | join(",")')"
export SETTLEMENT_TOKENS INPUT_ASSETS

[[ -n "$SETTLEMENT_TOKENS" ]] || {
  echo "CHAIN_ASSETS has no settlement-asset address for $CHAIN."
  echo "Add one, e.g. CHAIN_ASSETS={\"$CHAIN\":{\"USDC\":\"0x...\"}}"; exit 1; }

# DEX routers are not tokens, so they are not in CHAIN_ASSETS, and they are per
# chain: `ARC_TESTNET_DEX_ROUTERS` wins over `DEX_ROUTERS` when it is set.
CHAIN_PREFIX="$(printf '%s' "$CHAIN" | tr '[:lower:]-' '[:upper:]_')"
SCOPED_ROUTERS="${CHAIN_PREFIX}_DEX_ROUTERS"
if [[ -n "${!SCOPED_ROUTERS+x}" ]]; then
  export DEX_ROUTERS="${!SCOPED_ROUTERS}"
fi

# DEX_ROUTERS is deliberately not required. A chain with no swap venue still
# settles same-asset payments and still serves x402; a placeholder address here
# would be whitelisted for real.
if [[ -z "${DEX_ROUTERS:-}" ]]; then
  echo "no DEX_ROUTERS for $CHAIN — same-asset settlement only, no swap path"
fi

# A one-run override is useful for preflight/dry-runs when the configured
# provider is rate-limited or has not enabled this network. It is never written
# back to .env and the chain-id guard below still proves the target.
RPC_URL="${RPC_URL_OVERRIDE:-${!RPC_VAR}}"

# A key that signs against the wrong chain deploys a router nobody is looking
# for, and the failure is silent until the first payment.
ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$ACTUAL_CHAIN_ID" == "$CHAIN_ID" ]] || {
  echo "$RPC_VAR reports chain $ACTUAL_CHAIN_ID, but $CHAIN is $CHAIN_ID"; exit 1; }

# A settlement token with no code on this chain is the one mistake the timelock
# cannot undo cheaply, so it is checked before anything is broadcast.
for token in ${SETTLEMENT_TOKENS//,/ }; do
  code="$(cast code "$token" --rpc-url "$RPC_URL")"
  [[ "$code" != "0x" && -n "$code" ]] || {
    echo "SETTLEMENT_TOKENS names $token, which has no code on $CHAIN"; exit 1; }
done

# Input assets and DEX routers become privileged allowlist entries. Checking
# their code here prevents a per-chain address copied from another network from
# being admitted successfully and failing only at the first payer transaction.
for token in ${INPUT_ASSETS//,/ }; do
  code="$(cast code "$token" --rpc-url "$RPC_URL")"
  [[ "$code" != "0x" && -n "$code" ]] || {
    echo "INPUT_ASSETS names $token, which has no code on $CHAIN"; exit 1; }
done
ROUTERS_TO_CHECK="${DEX_ROUTERS:-}"
for router in ${ROUTERS_TO_CHECK//,/ }; do
  code="$(cast code "$router" --rpc-url "$RPC_URL")"
  [[ "$code" != "0x" && -n "$code" ]] || {
    echo "DEX_ROUTERS names $router, which has no code on $CHAIN"; exit 1; }
done

command -v forge >/dev/null || { echo "forge not found — install Foundry: foundryup"; exit 1; }
command -v jq    >/dev/null || { echo "jq not found"; exit 1; }

# The scripts read TIMELOCK_DELAY via envOr; the 48h default would gate the
# configure step below for two days.
export TIMELOCK_DELAY="${TIMELOCK_DELAY:-0}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

echo "deployer:   $DEPLOYER_ADDRESS"
echo "chain:      $CHAIN ($CHAIN_ID)"
echo "settlement: $SETTLEMENT_TOKENS"
echo "inputs:     ${INPUT_ASSETS:-<none>}"
echo "routers:    ${DEX_ROUTERS:-<none>}"
echo "delay:      ${TIMELOCK_DELAY}s"
echo "balance:    $(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL" --ether)"
echo

# The SIGNER baked into the constructor must be the address the API signs
# orders with, or every payment reverts InvalidSigner.
if [[ "${QUOTE_SIGNER:-local}" == "local" && -n "${QUOTE_SIGNER_PRIVATE_KEY:-}" ]]; then
  EXPECTED_SIGNER="$(cast wallet address --private-key "$QUOTE_SIGNER_PRIVATE_KEY")"
  if [[ "$(lower "$EXPECTED_SIGNER")" != "$(lower "$SIGNER")" ]]; then
    echo "SIGNER ($SIGNER) != address of QUOTE_SIGNER_PRIVATE_KEY ($EXPECTED_SIGNER)."
    echo "Every payment would revert InvalidSigner. Fix SIGNER and re-run."
    exit 1
  fi
fi

cd "$CONTRACT_DIR"

# --- Build + test -------------------------------------------------------------

forge build
forge test

BROADCAST_FLAGS=(--rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY")
if [[ "$DRY_RUN" == false ]]; then
  BROADCAST_FLAGS+=(--broadcast)
  if [[ "$VERIFIER" == "blockscout" ]]; then
    BROADCAST_FLAGS+=(--verify --verifier blockscout --verifier-url "$VERIFIER_URL")
  elif [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    BROADCAST_FLAGS+=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
  else
    echo "no ETHERSCAN_API_KEY — deploying unverified"
  fi
fi

# --- 1. Deploy ----------------------------------------------------------------

if [[ "$FACTORY_ONLY" == false ]]; then
  echo
  echo "==> DeployPaymentRouter"
  forge script scripts/DeployPaymentRouter.s.sol:DeployPaymentRouter "${BROADCAST_FLAGS[@]}"
fi

# --- 1b. Deposit forwarder factory --------------------------------------------

# Not optional, and not a separate errand: a chain with a PaymentRouter and no
# DEPOSIT_FORWARDERS entry fails the API's own configuration check at boot.
#
# `destination` is the operator that sweeps every forwarder, and it is baked
# into the forwarder's init code — so it decides INIT_CODE_HASH, which decides
# every deposit address the API derives. Deploying a chain with a different
# destination gives that chain a different hash, and
# DEPOSIT_FORWARDER_INIT_CODE_HASH holds exactly one. The check after the
# broadcast is what catches it, because the symptom otherwise is a payer sending
# to an address nothing can sweep.
echo
echo "==> DeployDepositForwarderFactory"
export DESTINATION="${DESTINATION:-$(cast wallet address --private-key "$OPERATOR_PRIVATE_KEY")}"
echo "destination: $DESTINATION"
forge script scripts/DeployDepositForwarderFactory.s.sol:DeployDepositForwarderFactory \
  "${BROADCAST_FLAGS[@]}"

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "dry run — nothing broadcast, configure step skipped"
  exit 0
fi

# Addresses come from the broadcast artifact rather than the console output:
# the artifact is structured and survives a re-read. --factory-only reads the
# same artifact from the run that deployed the router.
RUN_LATEST="broadcast/DeployPaymentRouter.s.sol/$CHAIN_ID/run-latest.json"
address_of() {
  jq -r --arg name "$1" \
    'first(.transactions[] | select(.contractName == $name) | .contractAddress)' "$RUN_LATEST"
}

export TIMELOCK="$(address_of TimelockController)"
export PAYMENT_ROUTER="$(address_of PaymentRouter)"
DEPLOY_BLOCK="$(jq -r 'first(.receipts[].blockNumber)' "$RUN_LATEST" | xargs printf '%d\n')"

[[ "$PAYMENT_ROUTER" != "null" && -n "$PAYMENT_ROUTER" ]] || {
  echo "could not read PaymentRouter address from $RUN_LATEST"; exit 1; }

FORWARDER_RUN="broadcast/DeployDepositForwarderFactory.s.sol/$CHAIN_ID/run-latest.json"
FORWARDER_FACTORY="$(jq -r \
  'first(.transactions[] | select(.contractName == "DepositForwarderFactory") | .contractAddress)' \
  "$FORWARDER_RUN")"
[[ "$FORWARDER_FACTORY" != "null" && -n "$FORWARDER_FACTORY" ]] || {
  echo "could not read DepositForwarderFactory address from $FORWARDER_RUN"; exit 1; }

# One hash serves every chain, so a chain that produced a different one would
# make the API derive deposit addresses this factory cannot sweep.
FORWARDER_HASH="$(cast call "$FORWARDER_FACTORY" 'INIT_CODE_HASH()(bytes32)' --rpc-url "$RPC_URL")"
EXPECTED_HASH="${DEPOSIT_FORWARDER_INIT_CODE_HASH:-}"
if [[ -n "$EXPECTED_HASH" && "$(lower "$FORWARDER_HASH")" != "$(lower "$EXPECTED_HASH")" ]]; then
  echo
  echo "INIT_CODE_HASH on $CHAIN is $FORWARDER_HASH"
  echo "but DEPOSIT_FORWARDER_INIT_CODE_HASH is $EXPECTED_HASH."
  echo "One hash serves every chain. Deposit addresses derived for $CHAIN would"
  echo "point at forwarders this factory cannot deploy, and funds sent to them"
  echo "would be unsweepable. Check DESTINATION matches the other chains."
  exit 1
fi

if [[ "$FACTORY_ONLY" == true ]]; then
  cat <<EOF

DepositForwarderFactory: $FORWARDER_FACTORY
INIT_CODE_HASH:          $FORWARDER_HASH

Merge into $ENV_FILE — add a key, do not replace the object:

  DEPOSIT_FORWARDERS={"$CHAIN":"$FORWARDER_FACTORY"}

$EXPLORER/$FORWARDER_FACTORY
EOF
  exit 0
fi

# --- 2. Configure -------------------------------------------------------------

# The timelock's only proposer and executor is MULTISIG, so this step must be
# signed by that key — not necessarily the deployer's.
if [[ "$(lower "$MULTISIG")" != "$(lower "$DEPLOYER_ADDRESS")" ]]; then
  echo
  echo "MULTISIG ($MULTISIG) is not the deployer — it alone can schedule config."
  echo "Run this with the multisig key:"
  echo "  TIMELOCK=$TIMELOCK PAYMENT_ROUTER=$PAYMENT_ROUTER \\"
  echo "  forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \\"
  echo "    --rpc-url \$$RPC_VAR --broadcast --sender \$MULTISIG"
  exit 0
fi

echo
echo "==> ConfigurePaymentRouter"
forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --sender "$MULTISIG"

# --- Output -------------------------------------------------------------------

cat <<EOF

Deployed. Merge these into $ENV_FILE — the maps are per chain, so add a key
rather than replacing the object:

  PAYMENT_ROUTERS={"$CHAIN":"$PAYMENT_ROUTER"}
  CHAIN_START_BLOCKS={"$CHAIN":"$DEPLOY_BLOCK"}
  DEPOSIT_FORWARDERS={"$CHAIN":"$FORWARDER_FACTORY"}
  CONTRACT_PATH_ENABLED=true
  CHAIN_ENABLED=true
  QUOTE_ENABLED=true

  TIMELOCK=$TIMELOCK
  DEPOSIT_FORWARDER_INIT_CODE_HASH=$FORWARDER_HASH

And into packages/subgraph/networks.json, so the subgraph indexes this router:

  "$CHAIN": { "PaymentRouter": { "address": "$PAYMENT_ROUTER", "startBlock": $DEPLOY_BLOCK } }

$EXPLORER/$PAYMENT_ROUTER
EOF
