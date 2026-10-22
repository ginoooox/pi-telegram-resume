# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

## Transit Thread lifecycle

An All input's temporary routing Thread must outlive its pending choice and leave no residue.

- [ ] A Thread with a pending Reroute/Restore choice is never deleted by unbound-topic reconciliation; only its own Reroute, cancel or expiry removes it.
- [ ] Cancel resolves from the durable journal, so it still works after the tab or chooser message is gone.
- [ ] Expiry reports a visible "prompt not delivered" result instead of silently discarding the input as `routing-expiry`.
