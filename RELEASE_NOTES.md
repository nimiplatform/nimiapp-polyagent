# PolyAgent 0.1.0 — development

- Standalone Nimi-supervised App with protected Agent work, storage, Activity and Integration.
- Near-deadline high-price strategy with exposure limits, observed-book simulation, reconciliation, exits and final-outcome settlement.
- Three choices: paper trading, imported Keychain key, or interactive browser-wallet signing through a matching Polymarket executor.
- One-use browser connection links, verified signer identity, explicit wallet confirmation, session expiry and no signer fallback.
- Authenticated observation mode, explicit Keychain configuration import, per-venue prediction approvals and durable single-round purchase limits.
- Trading starts stopped and remains stopped after restart or session invalidation.

Experimental development build. Simulation, live trading, installation, public release and profitability are separate claims.

## App-managed executor lifecycle

Settings now controls the local service: observation start, explicitly confirmed live enablement, return to observation and stop. The same service is bundled into the Electron Host; the CLI remains a developer tool. Nimi continues to own Integration permissions and calls. App exit/session invalidation stops the service, and restarts never restore live mode. Existing account configuration and trading journals are preserved. Real observation and stop/restart acceptance passed; actual financial execution remains user-run and unverified.
