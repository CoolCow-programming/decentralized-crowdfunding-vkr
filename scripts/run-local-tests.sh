#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR_PID=""

cleanup() {
  if [[ -n "${VALIDATOR_PID}" ]] && kill -0 "${VALIDATOR_PID}" 2>/dev/null; then
    kill "${VALIDATOR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[1/6] Switching Solana CLI to localnet"
solana config set --url localhost >/dev/null

echo "[2/6] Starting local validator"
solana-test-validator --reset >"${ROOT_DIR}/.local-validator.log" 2>&1 &
VALIDATOR_PID=$!

for _ in {1..20}; do
  if solana cluster-version --url localhost >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! solana cluster-version --url localhost >/dev/null 2>&1; then
  echo "Local validator did not start. Check ${ROOT_DIR}/.local-validator.log"
  exit 1
fi

echo "[3/6] Airdropping local SOL"
solana airdrop 100 --url localhost >/dev/null

cd "${ROOT_DIR}"

echo "[4/6] Building Anchor program"
anchor build >/dev/null

echo "[5/6] Deploying program to localnet"
anchor deploy --provider.cluster localnet >/dev/null

echo "[6/6] Running Anchor tests"
anchor test --skip-local-validator
