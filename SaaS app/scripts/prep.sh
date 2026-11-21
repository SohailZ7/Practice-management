#!/usr/bin/env bash
# Prep a fresh worktree so tsc/vitest/playwright run: installs deps and generates the Prisma client. Run from "SaaS app".
set -euo pipefail
npm ci
npx prisma generate
