# PolyAgent

A standalone Nimi App for a personal Polymarket trading assistant. Appoint an existing Nimi Agent, inspect near-deadline markets, run a bounded strategy, and follow orders, positions and decisions in one local workspace.

This experimental version starts in **paper trading** with $100 virtual cash. Markets, books and final resolution records come from the official Polymarket TypeScript SDK. Paper fills consume observed depth and estimate fees; they are explicitly simulated, not exchange trades. High prices are not guaranteed probabilities. A scheduled market end is not necessarily its resolution time.

## Development

Node 24+, pnpm 10+, and a signed-in Nimi Desktop/Runtime are required. This repository has its own App Tools lifecycle and lockfile; it does not use Nimi's root workspace.

```sh
pnpm install
pnpm exec nimi-app sync
pnpm exec nimi-app check
pnpm dev -- --list-registrations
pnpm dev -- --resume <current-selector>
# Only if no registration exists:
pnpm dev
```

The current combination is SDK 0.19.0, Kit/native 0.16.0 and App Tools 0.11.4 with the additional declared pair. Complete local tarballs are selected in `pnpm-workspace.yaml` from `.nimi/local/packages`. A fresh checkout must receive those four artifacts before installation. These are development resolutions, not source links or public publication claims. Public-release preparation requires compatible published versions and registry resolutions.

## First journey

1. Scan markets and inspect source time, book depth, rules and failed checks.
2. In 策略与连接, appoint a Nimi Agent, review the paper limits and save.
3. Start the strategy. A candidate must pass deterministic checks, receive a complete saved Agent review, and pass a fresh check immediately before entry.
4. Paper entries consume only available book depth within the limit. Unfilled FAK remainder is canceled; no resting fill is invented.
5. While running, the strategy checks take-profit and stop-loss conditions. You can stop and explicitly close positions. Paper settlement requires final payout records; `closed` alone is insufficient.
6. Export the ledger when useful. Restart retains records but never silently re-arms trading. Unconfirmed live orders must be reconciled before new entries.

Closing the window keeps the supervised Host running when the tray is available. Use **退出并停止** to terminate it. A real Nimi session invalidation retires old execution; reconnect does not resume trading.

## Wallet and live execution

In **策略与连接**, choose one of three operating paths:

| Choice | Funds and signing | User interaction |
| --- | --- | --- |
| 模拟交易 | Real market data, isolated virtual ledger | No wallet required |
| 导入私钥 | One-time import into macOS Keychain; executor reads the item per signature | Automatic within explicitly approved limits |
| 连接钱包 | An EIP-1193/EIP-6963 browser wallet, through a local browser companion | Confirm authentication, order signatures and transactions in the wallet |

The imported-key path stores only public wallet/signer addresses and a credential reference in App state. There is no private-key read command, plaintext key file, environment-key fallback, or key in Agent context. The wallet path uses the official Polymarket `signerFrom` adapter and never obtains the wallet's private key. It currently supports browser-extension providers, not mobile WalletConnect pairing.

Both real-money paths use the Nimi MCP Integration connection and an explicitly configured executor. See [EXECUTOR.md](EXECUTOR.md). Its declared signing method must match the App selection; refusal or disconnection never falls back to an imported key. A connected wallet requires its signing window to remain open and is not an unattended delegation.

Use **本机交易服务 → 启动观察服务** to start the local executor without a terminal. **启用实盘服务…** checks saved limits, wallet and Nimi permissions and requires explicit user confirmation; strategy start is separate. **退回观察模式** and **停止本机服务** are also in Settings. App restart/session invalidation never restores live service automatically.

Save a connection before approving live limits. Saving settings never starts trading. The live ledger binds to its first verified wallet; each order/redemption request includes the expected identity, and incomplete orders/open positions prevent switching connections or signing methods. Switching to paper preserves its separate existing ledger.

Current development acceptance covers **paper trading and authenticated observation**. The provided owner key has been imported into Keychain, and actual account reads have passed. Order signatures, funding, approvals, trades and redemption remain user-executed steps. JavaScript/native signing necessarily holds key material temporarily in process memory; Keychain storage is not a promise of memory zeroization or automatic per-trade biometrics.

## Ownership

- Nimi owns protected App authentication, LocalAgent execution, managed App storage, Integration permissions and Activity.
- PolyAgent owns strategy, market data, orders, simulation, positions, scheduling and recovery.
- The selected Polymarket executor owns its business signing custody and submission journal. Its Keychain helper is specific to this account workflow; it is not a generic Nimi secret-reading API.
- Agent tools record reviews only. They cannot raise budgets, switch wallet, enable live mode or directly submit trades. Business records do not become canonical chat or long-term Agent memory.

## Checks and package

```sh
pnpm typecheck
pnpm run test:app
pnpm run build
pnpm run build:electron
pnpm run executor:build
pnpm exec nimi-app check
pnpm exec nimi-app build --target macos-aarch64
pnpm exec nimi-app pack --target macos-aarch64
```

Unit tests use explicit doubles and do not prove real model or exchange execution. Development packages, installed packages and public releases have separate acceptance. Windows packaging and live Keychain signing require their own applicable environment verification.

## Acceptance status

Initial paper journey verified on 2026-09-26; wallet-choice extension verified on 2026-09-27 in the real Desktop-supervised macOS App, using its exact development CDP target:

- Protected Nimi session and managed App storage loaded successfully. The selected existing Agent, 栖澜, produced a real bounded review through `agentWork`; no fixture supplied that product decision.
- Public Polymarket scanning returned 80 candidates. The strategy automatically simulated a buy and a subsequent sell against actual observed books. The $100 virtual ledger ended at approximately **$99.84**, with **-$0.16** realized paper P&L and no open position. The exit was exercised by temporarily tightening the paper stop, then restoring the default policy. This demonstrates the execution workflow, not profitability or a live fill.
- Runtime/Desktop restarts preserved both orders and funds. Resuming the same App registration kept automatic trading stopped. Source-time/quote availability remains explicit after reopening.
- The real settings form saves correctly; order details open and Escape returns keyboard focus. Invalid private-key input is rejected and cleared. The initial disposable Keychain round trip passed; the later explicitly supplied real signer was imported to Keychain and authenticated for observation.
- Typecheck and 72 focused App/executor tests pass, including wallet binding, journal persistence, uncertainty, partial fills, the actual local MCP HTTP transport, and browser-wallet signature verification using deterministic test-only keys. Recovery tests cover failed stop saves, stale writes, pre-dispatch rejection and lost responses, cancellation at the dispatch boundary, and redemption transaction correlation across restart. The focused shared App Tools suite passed 129 tests with 11 environment skips. These automated checks are distinct from the real App journey above.
- The supervised App displays and persists all three choices, allows saving wallet setup without approving a trading budget, and restores the original stopped paper ledger. The real Chrome companion discovered installed MetaMask and OKX providers without requesting account access. Link consumption, origin checks, signature validation, rejection, timeout, disconnection and replay were exercised through actual local HTTP transport with synthetic test identities.
- Actual CLOB authentication and funded-account reads passed through the local MCP executor in observation mode. The App loads public executor configuration and signer references without unsealing the wallet key. The tested mandate permits at most one dispatched buy, $5 per buy/$5 exposure and $10 cumulative buy budget; the executor independently enforces these bounds, and the final confirmed exit stops the strategy.
- App-owned executor lifecycle was verified on 2026-09-28 in supervised Electron: a developer-process conflict is reported, observation starts from Settings, actual account reading succeeds through Nimi, the live confirmation can be canceled without enabling it, and stop/restart followed by account reading succeeds.
- After the recovery fixes, the original supervised App registration retained its ledger and connection and restarted with strategy and service stopped. Observation start, actual $10 account reading, service stop and restart, and another actual account read passed. Two earlier reads returned `INTEGRATION_PROVIDER_FAILED`; reads succeeded after restarting observation, and the exact transient cause was not identified. No financial write permission or live service was enabled.
- The Nimi-managed MCP connection and App-to-executor account call passed on 2026-09-27. Desktop granted only `polyagent.account` to the original PolyAgent development instance and recorded the actual call as Completed; the App displayed $10 cash in observation mode. Restarting the same App registration retained the connection and allowed another real account read while keeping the strategy stopped and live limits unconfirmed. The executor still denies all financial writes.
- The existing macOS arm64 development `.nimiapp` archive under `dist/nimi-app` predates these recovery fixes; rebuild it before using it. It is development-unsigned and uses the explicit complete local Nimi tarballs. The executor is now managed within the App Host; Settings owns service start/stop and explicit observation/live switching. The optional `pnpm executor` command remains a developer entry point. It is not an OS background daemon.

**NOT-VERIFIED:** real order/transaction signing; real browser-wallet account permission and signing; real order fills/cancellation/redemption; installed-package lifecycle; signed/public release; Windows. Narrow native-window acceptance also remains unverified: the computer-use selector resolves the shared Electron binary to Desktop, so the completed visual check uses the actual 1400×868 PolyAgent window without renderer viewport emulation.

At handoff, App trading remains stopped. Real credentials are in Keychain and the executor configuration defaults to observation mode. Nimi Desktop connection and account-read permission are configured; the eventual user-executed live test remains outstanding; the source `.env` was left untouched. See [EXECUTOR.md](EXECUTOR.md) for current commands and boundaries.

Official references: [market data](https://docs.polymarket.com/market-data/overview), [orders](https://docs.polymarket.com/trading/place-orders), [fees](https://docs.polymarket.com/trading/fees), [resolution](https://docs.polymarket.com/concepts/resolution).

Apache-2.0. Dependencies retain their respective licenses.
