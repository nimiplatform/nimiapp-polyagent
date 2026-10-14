# Security

PolyAgent uses Nimi public SDK/Kit services for protected App sessions, Agent work, managed storage, and Integration standing permissions.

- **App Access vs. Integration standing permissions**: App Access declarations describe requested capabilities and do not authorize operations by themselves. Integration standing permissions are managed and enforced by Nimi Runtime per `account + consumer + operation + connection/target`, with user-facing management UI in Nimi Desktop; they are distinct from generic App session admission.
- **Executor supervision and developer CLI**: The local trading executor is managed by the App Host by default, and a standalone developer CLI entry point is also available for explicit developer operation.
- **User-selected signing posture**: Users choose between macOS Keychain signing and browser-wallet signing. Configuration stores only public identifiers and credential/signer references, never raw private keys, and no renderer private-key getter is exposed.
- **Keychain mode**: Wallet keys are imported directly into macOS Keychain and never saved to ordinary configuration, ledger exports, logs, or Agent context. The executor holds only a Keychain reference in configuration, reads credentials per signing operation, and enforces its own explicit limits and wallet binding.
- **Browser-wallet mode**: Pairing uses same-origin, token-authenticated, memory-only state and an official signer adapter. The page never receives the MCP bearer or wallet keys, and returned signatures are verified against the connected EOA.
- **Observation mode**: Permits only fresh `ClobAuth` for the expected identity; it rejects order/transaction signatures and all financial write operations.
- **Loopback MCP boundary**: The loopback MCP server requires its bearer token and rejects browser `Origin` requests. Nimi owns its configured connection bearer and permissions. Keep executor service and relayer credentials out of Git and logs.
- **Ambiguous write reconciliation**: Signed order material in the private executor journal is sensitive. Retain it to reconcile unknown submissions; never resend an ambiguous write under a new identifier.
- **Session invalidation and external effects**: Restart or session invalidation stops the strategy. Stopping new work does not cancel already accepted external effects. Confirm fills and redemptions through their original records.
- **Fail-safe stop sequence**: Stop revokes in-memory trading permission before awaiting cancellation or storage. Failed ledger writes cannot re-arm the scheduler or prevent the Host from attempting executor shutdown.
- **Redemption recovery**: A direct redemption's transaction intent is saved before signing or broadcast. Recovery must match that intent and confirm the entire submitted workflow before crediting settlement.

This experimental development build has not completed real-wallet, signed-package, or public-release acceptance. See `README.md` and `EXECUTOR.md` for the actual boundaries.
