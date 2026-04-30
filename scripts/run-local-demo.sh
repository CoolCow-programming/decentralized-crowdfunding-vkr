#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR_PID=""
APP_PID=""

cleanup() {
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
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

echo "[4/6] Building and deploying Anchor program"
cd "${ROOT_DIR}"
anchor build >/dev/null
anchor deploy --provider.cluster localnet >/dev/null

echo "[5/6] Initializing local config"
node scripts/init-localnet-config.js >/dev/null

echo "[6/6] Starting frontend on Vite"
yarn --cwd app dev &
APP_PID=$!

echo
echo "Local demo is running."
echo "Frontend: http://127.0.0.1:5173"
echo "Validator log: ${ROOT_DIR}/.local-validator.log"
echo "Press Ctrl+C to stop."

wait "${APP_PID}"
