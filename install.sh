#!/usr/bin/env bash
set -e

echo ""
echo "  Installing nclaw..."
echo ""

# Check for node
if ! command -v node &>/dev/null; then
  echo "  Error: Node.js is required. Install it from https://nodejs.org and retry."
  exit 1
fi

# Check for npm
if ! command -v npm &>/dev/null; then
  echo "  Error: npm is required. It comes with Node.js — please reinstall Node."
  exit 1
fi

npm install -g nclaw

echo ""
echo "  Done! Run 'nclaw' to start."
echo ""
