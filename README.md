# PolyAgent

> A personal Polymarket research and trading assistant powered by Nimi Agents and local risk boundaries.

PolyAgent brings prediction market analytics into your local desktop workspace. By appointing a dedicated Nimi AI Agent as your market researcher, you can scan upcoming resolution markets, evaluate liquidity and probability spreads, and run rule-bounded trading strategies—starting with simulated paper trading that uses no real funds.

---

## Key Capabilities

### 1. Market Scanning & In-Depth Analysis
- Scan live Polymarket order books, volume, rules, and upcoming deadlines.
- Appoint your favorite Nimi Agent to review candidate markets, evaluate context, and assess probability anomalies before any decision is made.

### 2. Three Operational Modes

| Mode | Funds & Signing | Security & Custody |
| :--- | :--- | :--- |
| **Paper Trading (模拟交易)** | Real market data against an isolated virtual ledger ($100 starting cash) | No real funds are spent; fills and fees are simulated assumptions, not exchange results |
| **Observation Mode (观察模式)** | Reads live account balance and order statuses | Authenticated read-only; denies all trade execution |
| **Live Trading (实盘交易)** | Dispatches real orders within strict user-approved limits | Automatic signing via a key stored in macOS Keychain, or interactive confirmations via an EIP-1193 browser wallet; live trading must be enabled separately |

### 3. Rigorous Safety & Risk Safeguards
- **Zero Key Exposure to AI**: Private keys never enter Agent prompts or the App ledger. Signing happens strictly inside the configured local executor or wallet, while authentication, account-read and trading requests are sent to the service without including the private key.
- **Fail-Closed Strategy Bounds**: A deterministic kernel enforces configured budgets, exposure limits, data freshness, and exit conditions before any order is sent. Note that stop and exit rules govern order submission—they are not a guaranteed fill or a maximum-loss guarantee.
- **Never Auto-Arms**: Relaunching the application preserves historical logs but **never automatically re-arms trading**. You retain 100% control over execution.

---

## Architecture & Ownership

- **Nimi Platform**: Manages protected app authentication, local Agent execution (`agentWork`), managed App storage, and integration permissions.
- **PolyAgent Workbench**: Orchestrates strategy logic, orderbook feeds, paper simulation, position management, and P&L journals.
- **Local MCP Executor**: Isolates signing custody and execution boundaries from application renderers.

---

## Getting Started & Development

### Prerequisites
- Node.js ≥ 24, pnpm ≥ 10
- Running Nimi Desktop / Runtime instance

### Running Locally
```bash
# Install dependencies cleanly
pnpm install --frozen-lockfile

# Sync managed configuration
pnpm exec nimi-app sync
pnpm exec nimi-app check

# Launch in Desktop-supervised Electron shell
pnpm dev
```

To list or resume an existing registration session:
```bash
pnpm dev -- --list-registrations
pnpm dev -- --resume <selector>
```

### Building & Packaging
```bash
# Typecheck and run app tests
pnpm typecheck
pnpm run test:app

# Build application and executor
pnpm run build
pnpm run executor:build

# Package for target platform
pnpm exec nimi-app build --target macos-aarch64 --production
pnpm exec nimi-app pack --target macos-aarch64 --production
```

---

## Financial & Operational Disclaimer

PolyAgent is an experimental analytical and trading tool. Prediction markets carry significant financial risks. High displayed prices do not guarantee real-world event outcomes, and market resolution schedules are subject to platform oracle conditions.

Always test strategies extensively in **Paper Trading mode** before connecting real capital.

---

## Release & Verification Status

- **Verified Publisher Release**: [v0.1.0](https://github.com/nimiplatform/nimiapp-polyagent/releases/tag/v0.1.0)
- **Registry Admission**: [#88](https://github.com/nimiplatform/nimi-app-registry/pull/88) (macOS arm64 and Windows x64)
- **Recorded Toolchain Combination**: SDK 0.21.0, Kit/native 0.19.3, App Tools 0.12.1, Nimi Coding 0.6.5
- **Previously Recorded Platform Checks**: macOS arm64 Catalog install, public market scanning, Nimi Agent analysis turn, $5 paper entry simulation, position persistence across restarts, and Keychain observation verified. (Windows GUI and real live order placement marked as `NOT-VERIFIED`).
