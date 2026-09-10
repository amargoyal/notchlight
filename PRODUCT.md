<!-- impeccable:product-schema: 1 -->
# Notchlight

## Purpose and audience
A quiet macOS notch companion for people using Claude Code while listening to music and moving files between apps. The live application combines three focused views and a separate customization window.

## Operating context
Electron, React, and TypeScript on macOS. The physical camera cutout must remain unobstructed. Existing Claude transcripts, hooks, permissions, and status meanings remain authoritative.

## Capabilities and constraints
The native application monitors real Claude activity, controls Spotify after opt-in, and keeps persisted file references and preferences. Native drags retain shelf references; Save copy can remove a reference after a confirmed copy without deleting originals. Gallery and browser-only customization use sample data. Packaged distribution remains future work.

## Brand commitments
Keep the Notchlight name, pixel buddy, black hardware-integrated notch, warm typography, and green/amber/red status language. Extend the established identity.

## Principles
- Glance first, interact on demand.
- Keep each task in a focused view.
- Surface attention without stealing the selected view.
- Preview changes immediately and make reset easy.
- Never present sample activity as live activity.

## Codex extension

The current working tree extends the agent view to **Agents**, alongside Music
and Tray. Local Claude and Codex Desktop/CLI tasks retain separate identities,
provider labels, **All / Claude / Codex** filters, and distinct companions:
Claude's terracotta buddy and Codex's cool ivory robot.

Codex monitoring requires explicit opt-in; answering Codex approvals is a
second opt-in, both off by default. Hook installation, trust review and session
reload are separate setup steps. Only a supported live permission request is
answerable; defer, expiry or unavailable integration returns no decision to
Codex. Questions continue in Codex. Existing approval policies remain in force.

Unknown and interrupted states stay neutral. Local transcript observations do
not establish process liveness, and unknown usage is not a zero or a comparable
combined provider total. One selected local Codex home is monitored; remote-only
tasks and arbitrary Codex versions are outside the established coverage.

See [Codex setup and limits](docs/codex-integration.md), including what the
integration suite and the native smoke checks have and have not established.
