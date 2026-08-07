#!/usr/bin/env bash
#
# Deploy + configure PaymentRouter on Base Sepolia (issue #29).
#
# Runs both forge scripts in order, because the first alone leaves a router that
# reverts `RouterNotWhitelisted` on the first swap payment: the constructor
# whitelists settlement assets only, and DEX routers / input assets are
# CONFIG_ROLE calls held by the timelock.
#
# Reads the repo-root .env. Forge only auto-loads a .env sitting next to
# foundry.toml, so this sources the root one explicitly and exports it.
#
#   ./scripts/deploy-base-sepolia.sh          # deploy + configure
#   ./scripts/deploy-base-sepolia.sh --dry    # simulate, broadcast nothing
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$CONTRACT_DIR/../../.." && pwd)"
CHAIN_ID=84532

DRY_RUN=false
[[ "${1:-}" == "--dry" ]] && DRY_RUN=true

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

for var in DEPLOYER_PRIVATE_KEY BASE_SEPOLIA_RPC_URL MULTISIG GUARDIAN \
           FEE_RECIPIENT SIGNER SETTLEMENT_TOKENS DEX_ROUTERS; do
  require "$var"
done

command -v forge >/dev/null || { echo "forge not found — install Foundry: foundryup"; exit 1; }
command -v jq    >/dev/null || { echo "jq not found"; exit 1; }

# The scripts read TIMELOCK_DELAY via envOr; the 48h default would gate the
# configure step below for two days.
export TIMELOCK_DELAY="${TIMELOCK_DELAY:-0}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

echo "deployer:   $DEPLOYER_ADDRESS"
echo "chain:      base-sepolia ($CHAIN_ID)"
echo "delay:      ${TIMELOCK_DELAY}s"
echo "balance:    $(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL" --ether) ETH"
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

BROADCAST_FLAGS=(--rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY")
if [[ "$DRY_RUN" == false ]]; then
  BROADCAST_FLAGS+=(--broadcast)
  if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    BROADCAST_FLAGS+=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
  else
    echo "no ETHERSCAN_API_KEY — deploying unverified"
  fi
fi

# --- 1. Deploy ----------------------------------------------------------------

echo
echo "==> DeployPaymentRouter"
forge script scripts/DeployPaymentRouter.s.sol:DeployPaymentRouter "${BROADCAST_FLAGS[@]}"

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "dry run — nothing broadcast, configure step skipped"
  exit 0
fi

# Addresses come from the broadcast artifact rather than the console output:
# the artifact is structured and survives a re-read.
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

# --- 2. Configure -------------------------------------------------------------

# The timelock's only proposer and executor is MULTISIG, so this step must be
# signed by that key — not necessarily the deployer's.
if [[ "$(lower "$MULTISIG")" != "$(lower "$DEPLOYER_ADDRESS")" ]]; then
  echo
  echo "MULTISIG ($MULTISIG) is not the deployer — it alone can schedule config."
  echo "Run this with the multisig key:"
  echo "  TIMELOCK=$TIMELOCK PAYMENT_ROUTER=$PAYMENT_ROUTER \\"
  echo "  forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \\"
  echo "    --rpc-url \$BASE_SEPOLIA_RPC_URL --broadcast --sender \$MULTISIG"
  exit 0
fi

echo
echo "==> ConfigurePaymentRouter"
forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --sender "$MULTISIG"

# --- Output -------------------------------------------------------------------

cat <<EOF

Deployed. Put these in $ENV_FILE:

  PAYMENT_ROUTERS={"base-sepolia":"$PAYMENT_ROUTER"}
  CHAIN_START_BLOCKS={"base-sepolia":"$DEPLOY_BLOCK"}
  CONTRACT_PATH_ENABLED=true
  CHAIN_ENABLED=true
  QUOTE_ENABLED=true

  TIMELOCK=$TIMELOCK

https://sepolia.basescan.org/address/$PAYMENT_ROUTER
EOF
