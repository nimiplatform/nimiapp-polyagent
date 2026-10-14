# Polymarket execution connection

PolyAgent's Host-managed local executor exposes fixed Polymarket trading operations over Streamable HTTP MCP. Nimi Desktop provides connection and permission management. Runtime keeps the configured MCP connection bearer and enforces standing integration permissions for the current account, App subject, selected connection, and operations. Polymarket signing stays inside the explicitly selected executor, using either a credential stored in macOS Keychain or a connected browser wallet. Both the App and the executor must use the same signing method.

## Control the service in the App

With a public configuration loaded, open **策略与连接 → 本机交易服务**:

1. **Start in observation mode**: Click **启动观察服务** to launch the loopback MCP service inside PolyAgent's protected Electron Host. Then click **核对已保存连接的账户**; this call still routes through Nimi Integration.
2. **Enable live trading**: Save the real-account signing method and explicitly confirmed App limits. In Nimi Desktop, permit the required MCP operations for the connection. Back in PolyAgent, choose **启用实盘服务…**, review the confirmation prompt, and confirm personally. Before switching modes, the Host verifies the permitted operations, bound wallet, signing method, and executor ceilings. Enabling the live service does not start the strategy.
3. **Run the strategy**: Read the account state and start the strategy manually. The strategy's own independent checks continue to apply.
4. **Step down or stop**: Stop the strategy before choosing **退回观察模式**. Choosing **停止本机服务** also stops the strategy, rejects new financial work, and drains in-flight requests. Existing exchange orders and holdings are neither canceled nor liquidated.

The App displays the current service state, effective mode, and any port conflicts. It never kills a conflicting developer CLI automatically. Exiting the App or invalidating the Nimi session retires the Host-owned service; reopening always starts with the service stopped, even if the imported configuration specifies `live`. The service never restarts in `live` mode automatically or resubmits orders in an unknown state. Closing the window to the tray keeps the Host running. If macOS prompts for Keychain access when a different signed execution identity first reads credentials, complete that system prompt locally.

## Initial configuration and developer CLI

This configuration workflow requires Node 24+ and macOS Keychain. Import only an explicitly selected local source file containing the following fields:

| Source field | Meaning |
| --- | --- |
| `POLYMARKET_DEV_ADDRESS` | Existing Polymarket account wallet holding funds |
| `POLYMARKET_RELAYER_ADDRESS` | Expected signer address; also the personal Relayer key address |
| `POLYMARKET_RELAYER_PRIVATE_KEY` | Owner signing key for `keychain` mode; not a separate Relayer private key |
| `POLYMARKET_RELAYER_API_KEY` | Optional gasless Relayer credential; ordinary CLOB trading does not inherently require it |

```sh
pnpm executor:prepare --source-env /absolute/path/to/.env \
  --max-order 5 --max-exposure 5 --max-buy-orders 1 --max-buy-budget 10
pnpm executor --config .nimi/local/executor.json
```

`executor:prepare` validates identities, imports the signer and service credentials into separate macOS Keychain items, and writes `.nimi/local/executor.json` with public addresses, credential references, and explicit limits. The source `.env` file is never modified, copied, or logged, and runtime signing has no plaintext environment-key fallback. Existing output files are never overwritten or used to reset a trading journal. For browser-wallet signing, pass `--signing-method wallet`; that path neither reads nor stores a private signing key.

### Execution modes and independent limits

- **`observe` (default prepared mode)**: Permits real CLOB authentication and account reads, but rejects buying, cancellation, and redemption. Its signer accepts only exact, fresh `ClobAuth` typed data for the configured address and refuses all order, message, and transaction signatures. Authentication may create or derive CLOB credentials held only in process memory.
- **`disabled`**: Does not authenticate or read private balances.
- **`live`**: User-controlled trading mode operating within declared ceilings.

A CLI operator may override the mode with `--mode`, while a subsequent ordinary restart returns to the mode recorded in the configuration file.

Executor limits are enforced independently of the App or Agent across four dimensions: all-in per-buy cost, open exposure, total buy budget, and dispatched buy count. Every dispatched buy attempt consumes a purchase slot even if no shares fill, and any submission with an unknown outcome retains its full budget reservation. Sell proceeds do not replenish the cumulative buy budget. Once purchase slots are exhausted, existing positions can still be exited; the App stops after the final confirmed exit closes its positions. Never delete the journal to reset these controls.

## Connect through Nimi

1. In PolyAgent **策略与连接**, select the signing path and load the generated JSON file under **本机执行器**. Loading reads only public configuration and attaches references—it does not unseal the wallet key or enable trading, and it clips editable App limits to the executor's ceilings.
2. Click **复制连接凭据** when setting up the connection. The bearer token is copied directly to the OS clipboard (never exposed to renderer data or chat) and is cleared after one minute if unchanged.
3. In Nimi Desktop's Integration management, add an MCP connection named `PolyAgent` with endpoint `http://127.0.0.1:17846/mcp` and paste the bearer credential. Desktop provides the authorized management surface; Runtime applies connection and permission policy. PolyAgent cannot approve its own access.
4. Permit the operations required for your workflow, then refresh and select the connection in PolyAgent. Start in observation mode with account and order read operations; for browser-wallet mode, also permit the three wallet operations listed below.
5. Read the live account to verify identity, funds, approvals, and remaining budget. Loading or saving setup never starts trading—live activation, App limit confirmation, and strategy start are separate user actions.

### Wallet, approval, and storage boundaries

- **Approvals and signers**: CLOB orders check only the exchange approvals required for standard, neg-risk, or V2 prediction markets (never perps or unrelated position-management approvals). Finite collateral allowances are checked against the selected spend ceiling, and each target market must have an approved venue before an order is prepared. Only owner signers are admitted; Session Key support is a separate future path.
- **Wallet separation**: Keep the funded account wallet separate from its EOA signer. CLOB credentials are derived via the official SDK rather than copied from the website's Relayer-key panel. The executor never funds, automatically approves, or deploys a wallet; use an already deployed wallet and complete token approvals separately.
- **State and locks**: The configuration records the listening port and state directory (`~/.polyagent-executor/<wallet>/` by default). The private journal stores signed order material but never raw signing keys. Deleting a Keychain item blocks future signatures without revoking already issued signatures or accepted orders; locked, denied, or missing Keychain access fails closed. Startup configuration or listen failures release the process lock, and a proven-dead PID lock is recovered automatically while a live or indeterminate owner blocks startup. The journal is always preserved. Production packages must verify their signed execution identity separately from this development setup.

## Browser-wallet session

The browser companion and MCP endpoint share the executor's loopback server, which binds only to loopback, rejects browser-originated MCP requests, and requires the bearer token (remote operation would require a separate authenticated HTTPS endpoint—never expose the loopback port publicly).

- **Session bootstrap**: Opening a wallet connection generates a single-use link valid for 60 seconds. Its capability token stays in the URL fragment, is stripped from browser history upon use, and is exchanged for an in-memory page token that authorizes the same-origin local channel. TheMCP bearer is never sent to the page. The companion page enforces a strict CSP with no external assets, no cookie/`localStorage`/`sessionStorage` persistence, and exact `Origin`/`Host` checks. Nimi's call log may record the short-lived opening link, which is single-use and not a wallet credential.
- **Signing and session lifecycle**: Wallet requests time out after 45 seconds and are never retried automatically. The official Polymarket `viem` adapter builds EIP-1193 requests; returned message or typed-data signatures must recover to the connected EOA. On-chain operations are restricted to Polygon, and observed transactions must match the requested sender, destination, calldata, and value. Any account or network change invalidates the session, a missing heartbeat expires it after 15 seconds, and reconnecting invalidates earlier signer handles. After wallet approval, the executor re-verifies market and account state before posting an order.
- **Failure isolation**: Only the browser's **Connect** action requests wallet permission; the App's connection opener never signs, spends, or approves tokens. Wallet rejection, timeout, or disconnection never falls back to the Keychain signer. If a transaction was already broadcast before an error occurred, its state remains uncertain and must be reconciled—disconnecting does not revoke it.

## Operations

| Tool | Effect |
| --- | --- |
| `polyagent.wallet.open` | Issue a one-use local browser connection link; no signature |
| `polyagent.wallet.status` | Read connected signer and pending request status |
| `polyagent.wallet.disconnect` | End the browser session and reject pending signing requests |
| `polyagent.account` | Read actual balance, approval/eligibility status, exposure and ceilings |
| `polyagent.order.submit` | Persist a unique submission, prepare/sign, persist, then post one bounded FAK order |
| `polyagent.order.get` | Reconcile the exact submission against exchange orders and confirmed trades |
| `polyagent.order.cancel` | Cancel that order's remaining amount and reconcile fills |
| `polyagent.position.redeem` | Submit one resolved-market redemption and wait for actual settlement |
| `polyagent.position.redemption` | Read/reconcile an existing redemption without sending another transaction |

### Order and redemption reconciliation

- **Minimum lot constraints**: A partial FAK buy can leave a position smaller than the venue minimum. Because such a holding cannot be exited via a minimum-size order, the App reports the constraint before creating a record and retains the position for eventual market settlement.
- **Accounting and uncertainty**: Order acceptance does not mean a fill occurred; the ledger records only confirmed trade quantities, and the venue account balance remains authoritative over estimated live fees. An uncertain submission is retained and freezes new buy readiness. Reusing a submission ID with different parameters fails, while repeating an existing ID with identical parameters never double-posts. Never delete the journal or generate a fresh ID to bypass uncertainty. If no exchange order ID was returned, inspect the venue account manually—missing local correlation does not prove that no trade occurred.
- **Pre-dispatch refusals**: When a valid wallet-bound submission is refused or canceled before dispatch, the executor writes a durable receipt without consuming a dispatched-buy slot. The App can query that receipt using the original submission ID even if the initial submit response was lost. However, a missing journal record still does not prove that an external write failed.
- **Redemption verification**: Direct on-chain redemptions record the expected chain, sender, destination, calldata, and value before calling the signer. Both initial confirmation and crash recovery verify the exact transaction identity and require a successful receipt with two additional confirmation blocks. Every transaction in a multi-transaction redemption must confirm; partially submitted workflows remain unconfirmed, and neither an unrelated successful transaction nor a bare hash can settle the ledger. Relayer-backed recovery preserves the original SDK transaction ID.

The service binds loopback only, rejects browser-origin requests and requires the bearer. Remote operation requires a separately operated authenticated HTTPS endpoint; do not expose the loopback port publicly.

## Verification

72 focused App and executor tests pass, covering MCP HTTP transport, per-venue approvals, finite allowance checks, observation-mode write rejection, signer restrictions, independent budgets, restart behavior, and stopping after a completed permitted round trip. Recovery regressions cover storage failure during stop, lost refusal responses, durable rejection receipts, cancellation immediately before dispatch, and transaction identity/depth checks across multi-transaction redemptions and restarts. Explicit venue test doubles exercise failure and uncertainty paths and do not certify real exchange trades.

On 2026-09-28, the supervised App was exercised end to end for App-managed observation startup, port-owner conflict detection, live-dialog cancellation, service stop/restart, and authenticated account reads after restart. Live trading mode was not enabled.

Completed checks with real credentials include: importing a real signer into macOS Keychain, loading public configuration in the supervised App, authenticating against CLOB via the authentication-only signer, reading an authenticated account with a funded $10 balance and zero initial exposure through the running MCP executor, and verifying prediction-market approvals without granting missing perps approvals. No order or on-chain transaction was signed or submitted. The browser companion also detected installed MetaMask and OKX extensions without requesting wallet access.

On 2026-09-27, Nimi-managed integration acceptance passed: Desktop saved the local MCP connection, permitted only `polyagent.account` for the PolyAgent development instance, and recorded the live call as `Completed`. The supervised App displayed the funded $10 account in observation mode, and connection credentials traveled through the native clipboard without entering renderer state or chat.

**NOT-VERIFIED:** real browser-wallet authorization and signing; real order fills, cancellation, and redemption; Relayer acceptance of a gasless transaction; signed or installed production packages. Desktop owns connection management and operation permission via its owner UI, and macOS may prompt the user to authorize the Electron process's first Keychain access.

References: [API authentication](https://docs.polymarket.com/getting-started/api#authentication), [first order](https://docs.polymarket.com/trading/quickstart), [wallets](https://docs.polymarket.com/trading/wallets-auth), [contracts](https://docs.polymarket.com/resources/contracts), [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963).
