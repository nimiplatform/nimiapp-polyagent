# PolyAgent

<!-- impeccable:product-schema 1 -->

## Platform

web — a desktop application rendered with React inside Nimi-supervised Electron.

## Stack

Delegated by the user: standalone pnpm App Tools project, public Nimi SDK/Kit packages, React, TypeScript and Electron. Reuse the generated protected Host; this repository is independent of the Nimi monorepo.

## User and job

A person appoints an existing Nimi Agent as a Polymarket trading assistant. The assistant monitors markets, explains candidate decisions, and operates a bounded strategy through actual order, fill, position, exit and settlement records. The user needs to see what is running, what money is committed, and how to stop it.

## Confirmed scope

Build the complete automatic trading path. Initial strategy considers markets approaching their scheduled end with a highly priced outcome. High prices are market observations, not guaranteed probabilities or safe returns. Profitability is not this iteration's acceptance criterion.

Automated acceptance uses simulation and authenticated observation. The user supplied local credentials and a $10 total test budget, with the first round limited to one buy, $5 per-order/$5 exposure, then stopping after exit. The executor can authenticate/read in observation mode while rejecting financial writes and non-authentication signatures. Actual order/transaction signing, funding, approvals and redemption remain user-executed. The funded account, imported-key setup and read-only Nimi connection are configured; financial write permission and live activation remain separate user actions. Live mode never inherits paper balances or paper orders. Users explicitly choose among paper trading, an imported Keychain private key for automatic signing, and a connected browser wallet for interactive signing. Session Key delegation remains deferred; an ordinary connected wallet does not promise unattended signing.

## Product decisions delegated to this implementation

- A deterministic strategy/risk kernel governs money, freshness, liquidity, price limits, exposure, exits and order reconciliation. The appointed Agent reviews candidates and explains decisions; model output cannot increase budget or override risk checks.
- Paper trading consumes actual market/order-book observations and records explicit simulated fills and their assumptions. It is never presented as exchange execution.
- Polymarket signing and private account access run in a Host-managed local trading service exposed through the existing Nimi MCP Integration carrier. The executor declares its signing method and rejects a different requested method. Browser-wallet mode uses a local browser companion and the official Polymarket viem signer adapter with EIP-1193/EIP-6963 providers. It keeps its ephemeral connection in memory, requires user wallet confirmations, validates returned signatures against the connected signer, and invalidates outstanding requests when the account or connection changes. A one-time App import passes the user's key to macOS Keychain and immediately clears the input; the App ledger retains only public wallet identity and a credential reference. The executor reads the Keychain item on each signing operation. There is no renderer private-key getter, plaintext key file, environment-key fallback, or key in AI context. The executor uses the official Polymarket SDK and applies its own configured ceilings.
- The App owns local executor lifecycle. Users start observation, explicitly enable live service, return to observation, or stop the service in Settings. Host exit/session invalidation stops the service; reopening never restores live authorization. The development CLI uses the same service implementation. Runtime still owns MCP credentials/permissions; no private Runtime management bypass is added.
- Public market data, strategy state, order ledger, positions, simulation, execution schedules and recovery belong to PolyAgent. Nimi owns its identity/authentication, selected Agent, bounded Agent work, managed App storage, Integration permission/custody, and Activity delivery.
- Ambiguous submission is reconciled, never blindly retried. Stop prevents new entries while preserving positions and offering explicit exit/cancel controls. Restart and session changes do not silently re-arm trading.

## Success

The supervised desktop App can load real markets; select a Nimi Agent; configure a paper mandate; assess candidates; simulate constrained entry and exit against observed order books; retain a durable ledger; stop and reopen safely. The live executor implements account checks, signed order preparation/submission, order/trade reconciliation, cancellation, positions and redemption, verified without spending real funds.

## Voice and interface

Chinese-first, concise operational copy. Show source time, simulated versus live state, money at risk, decisions and next action. Do not claim low-risk or guaranteed profit. Important failures preserve the user's work and explain recovery.

## Open user-owned configuration

The funded account and observation connection are configured. First-round limits are recorded; financial write permissions and final live enabling remain unset. This is an experimental prerelease with no public release claim.
