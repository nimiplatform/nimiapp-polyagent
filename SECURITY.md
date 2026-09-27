# Security

PolyAgent uses Nimi public SDK/Kit services for protected App sessions, Agent work, managed storage and Integration permissions. App Access declarations describe requested capabilities; they do not authorize operations by themselves.

- Wallet keys are imported directly to macOS Keychain and never saved to ordinary configuration, ledger exports, logs or Agent context. No renderer private-key getter is exposed.
- Observation mode permits only fresh ClobAuth for the expected identity; it rejects order/transaction signatures and all financial write operations.
- The separately operated executor holds only a Keychain reference in configuration, reads credentials for each signing operation, and enforces its own explicit limits and wallet binding.
- Browser-wallet mode uses same-origin, token-authenticated, memory-only pairing and an official signer adapter. The page never receives the MCP bearer or wallet keys; returned signatures are checked against the connected EOA.
- The loopback MCP server requires its bearer and rejects browser Origin requests. Nimi owns its configured connection bearer and permissions. Keep executor service/relayer credentials out of Git and logs.
- Signed order material in the private executor journal is sensitive. Retain it to reconcile unknown submissions; never resend an ambiguous write under a new identifier.
- Restart/session invalidation stops the strategy. Stopping new work does not cancel already accepted external effects. Confirm fills and redemptions through their original records.
- Stop revokes in-memory trading permission before awaiting cancellation or storage. Failed ledger writes cannot re-arm the scheduler or prevent the Host from attempting executor shutdown.
- A direct redemption's transaction intent is saved before signing/broadcast. Recovery must match that intent and confirm the entire submitted workflow before crediting settlement.

This experimental development build has not completed real-wallet, signed-package or public-release acceptance. See README.md and EXECUTOR.md for the actual boundaries.
