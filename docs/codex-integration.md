# Codex integration

This guide describes the current source and records what has been validated
against it (see the last section). It does not claim release readiness.

## Enable local monitoring

1. Run Notchlight and open **Customize Notchlight… → Agents**.
2. Under **Codex**, enable **Monitor local Codex**. Monitoring is
   off by default. It reads local Codex Desktop and CLI activity on this Mac.
3. If Codex uses a different home, choose **Choose Codex home…** under
   **Codex setup** and select the directory containing `sessions`, not a
   project checkout. **Use default** returns to `CODEX_HOME` or `~/.codex`.
4. Optionally click **Install Codex hooks** for lifecycle notifications.
   Review and trust the new or changed definitions in Codex's `/hooks` browser,
   then reload or restart existing Codex sessions.

Transcript monitoring can run without hooks. Installing hooks does not turn on
monitoring or approvals. Both preferences are saved under `preferences` in
`~/.notchlight/companion.json`: `codexEnabled` and `codexApprovals` default to
`false`. The Claude `gateTools` setting is separate.

The app resolves the home from its saved `codexHome`, then its `CODEX_HOME`
environment variable, then `~/.codex`. A login service may have a different
environment from your terminal; selecting the home explicitly avoids that
mismatch. The adapter watches one home at a time. Changing it releases held
requests and resets monitoring; it does not move or remove hooks in the old
home. Remove those separately if needed.

## Install or remove hooks from the terminal

Run these commands from the Notchlight checkout:

```sh
node bin/install-codex-hooks.mjs
node bin/install-codex-hooks.mjs --remove

# Use the same absolute home for installation and removal.
node bin/install-codex-hooks.mjs --home "/absolute/path/to/codex-home"
node bin/install-codex-hooks.mjs --home "/absolute/path/to/codex-home" --remove
```

Without `--home`, the installer uses the terminal's `CODEX_HOME`, or `~/.codex`
when unset. It does not read the app's saved `codexHome`; select the same home
in the app and installer. Node must be available to Codex's hook command
environment. Installed commands contain the absolute client path in this
checkout; reinstall and review trust after moving the checkout.

The installer merges `<home>/hooks.json`, replacing only handlers identified
by the `notchlight-codex-hook.mjs` filename. Unrelated fields, matcher metadata,
other handlers and plugin configuration are preserved. Invalid JSON or an
incompatible configuration shape is rejected before writing. Repeating an
unchanged installation or removal is a semantic no-op.

Before changing an existing file, it creates
`hooks.json.notchlight-backup-<timestamp>-<uuid>` beside it, then writes through
a temporary file and atomic rename. The CLI prints the backup path. A new file
or a no-op has no backup. Removal uses the same backup policy and removes only
Notchlight's Codex handlers; it leaves the client files and monitoring
preference in place. Backups remain available after removal. Review a backup
before restoring it wholesale, since later unrelated edits may need merging.

Neither action edits `config.toml` or grants hook trust. Codex requires review
of new or changed hook definitions; see the [official hook documentation](https://learn.chatgpt.com/docs/hooks).
Reload or restart sessions after installation or removal. To stop monitoring
as well, turn off **Monitor local Codex** in Notchlight.

## Optional approvals

After monitoring and trusted hooks are set up, enable **Answer Codex approvals
in Notchlight** if you want to answer supported permission requests here.
Only a live `PermissionRequest` held by the companion gets **Allow once**,
**Deny**, and **Answer in Codex** controls. This does not add a gate to every
tool call. Questions such as `request_user_input` remain read-only notices
directing you to Codex.

**Answer in Codex** returns no decision. An unanswered request is released
after 55 seconds by the companion; the client has a 56-second overall approval
deadline. Disconnection, shutdown, disabling monitoring or approvals, and
changing home also release held requests without deciding. Codex then applies
its normal approval flow and any other hooks or policies. Returning no decision
does not itself grant permission. Expired requests cannot be answered from an
old card. The button hands back the decision; it does not navigate or focus a
Codex task.

The bridge uses `~/.notchlight/codex.sock`, separate from Claude's socket, with
a `provider: "codex"` envelope. Hooks forward events even with monitoring off;
the backend filters them. The client waits for an approval only when both
saved preferences are true. Other events send and exit, with no logs or extra
model context. `Stop` and `SubagentStop` output `{}`; other non-decision paths
are empty. Allow/deny responses use the documented
`hookSpecificOutput.hookEventName: "PermissionRequest"` and
`decision.behavior` shape.

Registered events are `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `PermissionRequest`, `Interrupt`, `SubagentStart`,
`SubagentStop`, and `Stop`. Installer timeouts are three seconds except for
`PermissionRequest` at 63 seconds. The socket client has a 600 ms connect
deadline and a 400 ms normal-event budget; these run concurrently.

## Agents and status

The shared face is **Agents**, beside Music and Tray, with **All**, **Claude**,
and **Codex** filters. Task titles, provider labels, project and status identify
rows; Desktop or CLI is shown only when the source metadata establishes it.
Internal identities include the provider (`claude:<id>` / `codex:<id>`), so a
shared directory or matching raw ID does not merge the providers' tasks.
Available child transcripts attach to their recorded parent.

Claude retains its terracotta buddy. Codex has a cool ivory robot with an
antenna, square visor and two feet, drawn from two-point cells so its eyes keep
Claude's weight at 18, 22, 24 and 44 points. Each provider has its own buddy,
pulse and **Rest on the bar** switches under **Customize → Agents**; Music and
Tray keep theirs under Appearance. When both appear, `Cl` and `Cx` labels distinguish
their lights; attention remains accessible across filters and other faces.
Hiding a resting provider does not suppress its asking state.

| State | Interpretation |
| --- | --- |
| Working, green | Recent observed work or a lifecycle signal |
| Asking, amber | An observed permission request or question; controls depend on a live held request |
| Done / failed, red | A recorded completion or failure, distinguished by text and expression |
| Idle / interrupted / unknown, neutral | No current work, an interruption, or insufficient fresh evidence |

An unfinished turn replayed at startup is `unknown`; fresh activity can make it
working. Working activity with no update for 15 minutes becomes `unknown`.
Silence alone does not prove success or a permission request. `Stop` triggers
a transcript refresh rather than declaring completion, and subagent stop
hooks do not finish the parent. `SessionEnd` finishes the row the way Claude's
does: a recorded failure or interruption keeps its status, anything else turns
red as done, and the row stays until you dismiss it or it ages out. A task
that fails with an explicit terminal error shows that error's first line. Unknown activity says **Waiting for fresh
activity**. Missing or unsupported transcript data has a connection message.
These signals are observations, not a guarantee that a process is still alive.

Unknown token counts display an em dash. Codex uses reported input minus cached
input, plus output, when available. Combined Claude/Codex totals are marked
unknown instead of presenting unlike usage measurements as equivalent billing.

## Current limits and validation still needed

- The reader targets the local rollout shape described in source as `0.153.4`;
  compatibility with other versions is not established. It reads `sessions`
  JSONL files and optional titles from `session_index.jsonl`. It does not use
  a cloud API, read remote-only tasks, or write Codex's private database.
- Discovery runs about every five seconds, up to three directory levels below
  `sessions`, for files modified within three hours. Existing readers refresh
  about every 900 ms. Old sessions age out unless a request is held. An empty
  readable folder can report ready; that does not prove a hook was delivered.
- Reads are incremental and bounded to 8 MiB per file per refresh. Very large
  lines can be skipped; only the last 1 MiB of the title index is read. Activity
  and titles may lag, and missing metadata limits source labels and subagents.
  A long-lived Desktop thread (one local rollout is 14 MB) needs a few refresh
  passes after startup before its latest turn is visible. A child whose parent
  rollout is in view is nested under it; a child whose parent has aged out is
  shown as its own row so its activity is not lost.
- The client reports its parent as `reporterPid`, not `ownerPid`. The Codex
  adapter does not verify process ownership or infer session closure from PID
  death. A missed end hook can leave a task visible until dismissal or aging.
- Only permission requests Codex delivers through the hook are answerable.
  The card truncates long commands/arguments to 4,000 characters and reasons
  to 1,000; review the full operation in Codex when needed. Multiple requests
  can be held, but the current session card presents the first held request.
- Gallery and browser customization are sample surfaces. They do not install
  hooks, enable real monitoring, or prove native approval behavior.

## Validation record

Recorded September 9, 2026 on this Mac with Codex CLI `0.153.4` and Codex
Desktop rollouts from the same version.

Automated, all passing: `npm run typecheck`, `npm run build`,
`npm run test:companion`, `npm run test:preview`, `npm run test:liveness`,
`npm run test:rename`, and `npm run test:codex`. The Codex suite covers
incremental replay and partial writes, terminal precedence across turns, the
real `session_meta` shapes (Desktop `vscode`, `codex-tui` `cli`, `exec`,
subagent thread spawns with the parent's `session_id`), token accounting from
`token_count`, `task_complete` with an error object, `turn_aborted`,
`request_user_input` and its async variant as read-only questions, unknown
record types, shared raw IDs across providers, decision routing and validation,
restart reconstruction, a missing home, `SessionEnd` retention and dismissal,
allow / deny / defer / timeout / simultaneous / stale / shutdown approvals, the
hook client's documented `PermissionRequest` output and its no-companion
behavior, and installer merging beside another product's trusted handlers.

Native, read-only: `npm run smoke:codex replay` against the real `~/.codex`
reproduced the Desktop task "Design multipurpose app views" as failed (usage
limit) with two subagent threads nested under it, plus a second Desktop task
as done, all labelled Desktop.

Native, live (`npm run smoke:codex live`, isolated `CODEX_HOME`, hooks
installed only there): three `codex exec` runs each delivered `SessionStart`,
`UserPromptSubmit` and `SessionEnd` through the installed hooks to the private
socket, and the adapter labelled the session CLI and moved it through idle,
working and finished. Every turn then failed inside Codex with "You've hit
your usage limit", so no `PermissionRequest` was raised and the allow / deny /
defer outcomes were not observed natively. The hook-level allow and deny shapes
are verified by the suite; rerun the live smoke once the quota resets to
confirm them end to end. Another hook denying the same operation is Codex's
documented behavior (any deny wins) and is not reproduced here.

Not yet verified natively: a Desktop-initiated approval, reduced-motion changes
at runtime on the real notch, and varied camera dimensions beyond the gallery
scenarios.
