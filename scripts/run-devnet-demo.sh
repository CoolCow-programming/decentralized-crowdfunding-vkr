#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/5] Switching Solana CLI to devnet"
solana config set --url devnet >/dev/null

echo "[2/5] Building Anchor program"
cd "${ROOT_DIR}"
anchor build

echo "[3/5] Deploying program to devnet"
anchor deploy --provider.cluster devnet

echo "[4/5] Initializing devnet config"
SOLANA_URL=https://api.devnet.solana.com node scripts/init-localnet-config.js

echo "[5/5] Starting frontend"
yarn --cwd app dev
