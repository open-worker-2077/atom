# Verification Evidence

## Verified revisions

- `a745d05` — simplify ordinary path-label authorization and acceleration fallback.
- `cb30552` — isolate Program-local context-free preparation failures from global startup.
- The deployed runtime was started from clean revision `cb3055259e4323156f51fd55ad24b388d5a45ea3`.

## Automated verification

- Focused permission, projection lifecycle, legacy runtime, service, and CLI suite: `112/112` passed.
- System regression suite: `158/158` passed.
- Deployment acceptance selection: `3/3` passed:
  - cold startup publishes when disposable acceleration persistence is unavailable;
  - a matching Agent key can satisfy its own node lock and reconfigure within existing authority;
  - an escalating replacement is rejected and the original Agent declaration is preserved.
- `openspec validate simplify-path-label-authorization-cache-fallback --strict`: passed.
- `git diff --check`: passed; only the repository's Windows line-ending notices were reported.

## Local deployment observation

- Checked at `2026-08-28T16:25:41+08:00`.
- Atom `0.3.0` was listening on `127.0.0.1:4784` in process `29504`.
- Health API returned `ok: true`, world revision `6306`, and projection status `published`.
- Published projection expected revision: `19e20f6eb6bf9a937aa04391a279fcc2e2a258ade1b769eb29f4e2c3551c26a0`.
- No private Atom facts, business content, credentials, or backing files are included in this evidence.

## GitHub publication state

The three verified commits were pushed to `origin/backup/web-convergence-checkpoint-20260817-154248`. The public-safe evidence was recorded on [GitHub Issue #13](https://github.com/open-worker-2077/atom/issues/13#issuecomment-5450281976), completing task 5.3.

## Issue #13 comment draft

Implemented and locally deployed the path-label authorization and acceleration-fallback correction in `a745d05` and `cb30552`.

- Agent self/descendant reconfiguration now reaches the ordinary Transform path matcher. Agent key labels and applicable contain/node lock labels remain separate facts; matching locks authorize, while delegation validation still rejects authority escalation atomically.
- Permission and Program projection indexes remain disposable acceleration. Missing, stale, unreadable, or unpersistable state falls back to current-fact computation.
- A Program-local context-free preparation failure remains visible for that Program but no longer prevents the world and unrelated projections from publishing. Actual invocation still enforces the Program failure.
- Verification: focused suite `112/112`, system suite `158/158`, deployment acceptance `3/3`, and strict OpenSpec validation passed.
- Local shared runtime observation: Atom `0.3.0`, world revision `6306`, health `ok`, projection `published`.

No private Atom facts or backing data are included.
