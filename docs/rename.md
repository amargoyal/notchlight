# Notchlight rename

The owner selected Notchlight on September 9, 2026.

- Repository: https://github.com/amargoyal/notchlight
- Checkout on this Mac: `/Users/amargoyal/Github/notchlight`
- Display name: **Notchlight**; renderer bridge: `window.notchlight`.
- Saved state: `~/.notchlight`; hook socket: `~/.notchlight/notchlight.sock`.
- Login service: `com.notchlight.island`.
- Hook entry: `bin/notchlight-hook.mjs`.

Claude remains the Claude view, and its transcript directory and permission
semantics are unchanged. The native runtime is still an unpackaged Electron
app; a signed Notchlight app bundle and its permission attribution remain
distribution work.

## Existing-install migration

`npm run service:restart` rebuilds, stops the previous service, migrates its
data directory without overwriting a destination, backs up the old LaunchAgent
under `~/.notchlight/migration`, and installs the new service using the actual
checkout path. It rewrites the plist on restart so future folder moves do not
leave a stale launch path. Run `npm run install-hooks` afterwards to update
Claude's global settings; it preserves unrelated hooks and backs up the file.
Project-specific hook installations can be updated with
`node bin/install-hooks.mjs --project` from that project.

On this Mac, the previous checkout path is a symlink to the renamed folder.
`~/.claude-light` likewise aliases the migrated data, and `bin/cl-hook.mjs`
forwards to the new hook client. These compatibility references let already-open
Claude sessions and saved workspace paths continue working. There is one real
checkout, one data directory, and one active service. Fresh installations do not
create an old data alias. Migration refuses two independent data directories
rather than guessing which should win.

The old spellings remain only in migration/compatibility code, migration tests,
and historical naming notes. They are not alternate product names.

## Verification and rollback

`npm run test:rename` exercises data preservation, retry, conflict refusal,
and a clean fresh installation in temporary directories. `npm run test:liveness` verifies that
transcripts retaining the old checkout path match the renamed process directory
and that both spellings share one session budget. Existing companion and
preview checks still cover behavior. Validate the real migration by comparing
saved-data hashes, checking the installed hook commands and launchd state, and
confirming the new socket accepts connections.

To roll back an installation, stop/uninstall the new service first. Preserve
the current `~/.notchlight` directory; the old data alias can continue pointing
to it. Restore the previous application revision and use its service installer
and hook installer from the checkout path you intend to keep. Do not bootstrap
both launch agents. The saved old plist and settings backup are available for
inspection if manual recovery is needed. Do not delete saved data or shelf
originals as part of rollback.
