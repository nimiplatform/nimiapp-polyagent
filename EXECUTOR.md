# Polymarket execution connection

The Host-managed local executor exposes fixed trading operations over Streamable HTTP MCP. Nimi owns the connection bearer and standing App permission. Polymarket signing belongs to this explicitly selected executor, using either a credential stored directly in macOS Keychain or a connected browser wallet. The App and executor must select the same signing method.

## Control the service in the App

With the existing public configuration loaded, use **策略与连接 → 本机交易服务**:

1. **启动观察服务** starts the loopback MCP service within PolyAgent's protected Electron Host. Then use **核对已保存连接的账户**; the invocation still goes through Nimi Integration.
2. To trade, save the real-account signing method and explicitly confirmed App limits. In Desktop, grant the required operations. Choose **启用实盘服务…**, review its confirmation and personally confirm. The Host verifies permission, bound wallet, method and executor ceilings before changing modes. This does not start the strategy.
3. Read the account and personally start the strategy. Its independent checks still apply.
4. Stop the strategy before **退回观察模式**. **停止本机服务** stops the strategy too, rejects new financial work and drains accepted requests. Existing exchange orders and holdings are not canceled or liquidated.

Service state, effective mode and conflicts are visible in the App. A conflicting developer CLI is never killed automatically. App exit and Nimi session invalidation retire the owned service; reopening starts with the service stopped, even if the imported config says live. There is no automatic live restart or unknown-order resubmission. Closing a window to its tray still keeps the Host running. macOS can request Keychain access when a different signed execution identity first reads credentials; complete that system prompt locally.

## Initial configuration and developer CLI

Node 24+ and macOS Keychain are required for this configuration workflow. Import only an explicitly selected local source file. The accepted fields are:

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

The command validates identities, imports the signer and service credentials into separate macOS Keychain items, and writes `.nimi/local/executor.json` with public addresses, credential references and explicit limits. The source file stays untouched and is never copied or logged. Runtime signing has no plaintext environment-key fallback. Existing output is never overwritten or used to reset a trading journal. For the browser-wallet path, use `--signing-method wallet`; that import does not read or store a signing key.

The prepared mode is **observe**. It permits actual CLOB authentication and account reads; it rejects buying, cancellation and redemption. Its signer accepts only the exact, fresh `ClobAuth` typed data for the configured address and refuses order/message/transaction signatures. Authentication can create or derive CLOB credentials, which remain in process memory. `disabled` does not authenticate or read private balances. The user-controlled `live` mode supports trading with the declared limits. The operator may explicitly select a mode with `--mode`; a later ordinary restart returns to the configuration's mode.

Limits apply independently of the App or Agent: all-in per-buy cost, open exposure, total buy budget and dispatched buy count. A dispatched attempt consumes its purchase slot even if no shares fill; an unknown effect retains its full reservation. Sell proceeds do not replenish the cumulative buy budget. When the purchase slots are exhausted, existing positions may be exited; the App stops after the final confirmed exit closes its positions. Never delete the journal to reset these controls.

## Connect through Nimi

1. In PolyAgent **策略与连接**, choose the signing path and load the generated JSON file in **本机执行器**. Loading reads public configuration and attaches references; it does not unseal the wallet key or enable trading. It clips the editable App limits to the executor ceilings.
2. Use **复制连接凭据** when adding the connection. The bearer goes directly to the OS clipboard, not renderer data or the chat. It is cleared after one minute if unchanged.
3. In Nimi Desktop's Integration management, add an MCP connection named PolyAgent with endpoint `http://127.0.0.1:17846/mcp` and the copied bearer credential. Desktop owns connection creation and standing App permission; PolyAgent cannot grant itself management authority.
4. Permit the operations required for the selected workflow, then refresh and select this connection in PolyAgent. Start with account/order reading in observation mode. Browser-wallet mode also needs the three wallet operations below.
5. Read the actual account and verify identity, funds, approvals and remaining budget. Live activation, App limit confirmation and strategy start are separate user actions; loading/saving setup never starts trading.

CLOB orders use only the appropriate exchange approvals for standard, neg-risk or V2 prediction markets. The executor does not require perps or unrelated position-management approvals. A finite collateral allowance is checked against the selected spend ceiling. Only owner signers are admitted by this setup; Session Key support is a separate future path. The specific market must have its own approved venue before an order can be prepared.

Keep the actual account wallet separate from its EOA signer. CLOB credentials are obtained through the official SDK, not copied from the website's Relayer-key panel. The executor never funds, automatically approves, or deliberately deploys a wallet. Use an existing deployed wallet and complete any necessary approval as a separate user action.

The config records the port and state directory (`~/.polyagent-executor/<wallet>/` by default). The private journal holds signed order material but no raw signing key. Keychain deletion blocks future signatures, not already issued signatures or accepted orders. Locked, denied or missing Keychain access fails closed. A production package must verify its signed execution identity separately from this development setup.

Startup configuration/listen failures release the process lock. A proven-dead PID lock can be recovered on startup; a live or indeterminate owner blocks startup. The journal is always preserved.

## Browser-wallet session

The browser companion and MCP endpoint share the executor's loopback server. The MCP bearer is never sent to the page. Opening a connection creates a one-use link valid for 60 seconds; its capability lives in the URL fragment and is removed from browser history after consumption. A separate in-memory page token authorizes the same-origin local channel. The page has a strict CSP, no external assets, no cookie/localStorage/sessionStorage persistence, and exact Origin/Host checks. Nimi's call record may contain the short-lived opening link; it is consumed once and is not a wallet credential.

Wallet requests last at most 45 seconds. The companion never automatically repeats a signing request. The official Polymarket viem adapter generates EIP-1193 requests; returned message/typed-data signatures must recover to the connected EOA. Chain operations are restricted to Polygon and the observed transaction must match the requested sender, destination, data and value. Account/network changes invalidate the session; a missing heartbeat expires it after 15 seconds. Reconnecting invalidates prior signer handles. Wallet approval is followed by fresh market/account checks before an order is posted.

Only the browser's Connect action requests wallet permission. The App's connection opener does not sign, spend, or approve tokens. Rejection, timeout and disconnection never select the Keychain signer as a fallback. A transaction already broadcast before an error remains uncertain and must be reconciled; disconnecting does not revoke it.

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

A partial FAK buy can leave a holding smaller than the venue minimum. Such a holding cannot produce an exit order at that minimum; the App reports the constraint before creating a record and retains the position for eventual settlement.

Accepted is not filled. The ledger records confirmed trade quantities. Live fee values are estimates; the venue account balance is authoritative. An uncertain submission is retained and freezes new buy readiness. Reusing its ID with different input fails; repeating an existing ID never posts again. Never delete the journal or choose a new ID to evade uncertainty. If no exchange order ID was received, inspect the actual venue account manually. Missing local correlation is not proof that no trade occurred.

A valid wallet-bound submission refused before dispatch now leaves a durable rejected or canceled receipt. The App can read that receipt using the original submission ID, including after losing the submit response. These refusals do not consume a dispatched-buy slot. A missing journal record still does not prove that an external write failed.

Direct on-chain redemptions save the expected chain, sender, destination, calldata and value before invoking the signer. Initial confirmation and recovery check the same transaction identity and require a successful receipt with two further blocks. Every transaction in a multi-transaction redemption must be confirmed, and a partially submitted workflow remains unconfirmed. A successful unrelated transaction or a bare hash cannot settle the ledger. Relayer-backed recovery retains the original SDK transaction ID.

The service binds loopback only, rejects browser-origin requests and requires the bearer. Remote operation requires a separately operated authenticated HTTPS endpoint; do not simply expose the loopback port publicly.

## Verification

72 focused App/executor tests pass, including actual MCP HTTP transport, per-venue approvals, finite allowance checks, observation-mode write rejection, signer restrictions, independent budgets, restart behavior, and stopping after a completed permitted round trip. Recovery regressions cover storage failure during stop, lost refusal responses, durable rejection receipts, cancellation immediately before dispatch, and transaction identity/depth checks across a multi-transaction redemption and reopening. Explicit venue doubles test failure/uncertainty paths; they do not certify real trades.

The App-managed observation start, port-owner conflict, live-dialog cancellation, service stop/restart and authenticated account read after restart were exercised in the real supervised App on 2026-09-28. No real live-mode enablement was performed.

Actual checks completed: real signer import into Keychain; loading public configuration in the supervised App; CLOB authentication through the authentication-only signer; authenticated account reads through the running MCP executor; actual funded balance and zero initial exposure; prediction approvals without granting the missing perps approval. No order or on-chain transaction was signed or submitted. The browser companion previously discovered installed MetaMask and OKX without requesting wallet access.

Nimi-managed acceptance also passed on 2026-09-27: Desktop saved the local MCP connection, granted only `polyagent.account` to the original PolyAgent development instance, and recorded its actual call as Completed. The supervised App displayed the funded $10 account in observation mode. Connection credentials passed through the native clipboard without entering renderer data or the chat.

**NOT-VERIFIED:** real browser-wallet authorization/signing; real order fills/cancellation/redemption; Relayer acceptance of a gasless transaction; signed/installed packages. Desktop owns connection management and standing permission; the completed flow used its owner UI. macOS may require the user to authorize the Electron process's first Keychain access.

References: [API authentication](https://docs.polymarket.com/getting-started/api#authentication), [first order](https://docs.polymarket.com/trading/quickstart), [wallets](https://docs.polymarket.com/trading/wallets-auth), [contracts](https://docs.polymarket.com/resources/contracts), [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963).
