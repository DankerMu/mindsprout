#!/usr/bin/env python3
"""fix_gate.py - mechanical fix-pass counter for the subagent workflow.

The orchestrator records every cross-review round here. Each not-clean round
buys one implementer fix pass; after `maxFixPasses` (default 2) the next
not-clean round locks the gate. The state lives in <project>/.review-gate.json,
which the optional `review-gate` PreToolUse hook reads: while `locked` is true
it denies `implementer`/`reviewer` subagent spawns, so a third fix pass cannot
start until a user decision is recorded with `extend --user-approved`.

Commands:
  open         --pr N [--max-fix-passes 2]        create the state file
  record-round --sha SHA --clean|--not-clean       record a review round; exit 2 when it locks
  extend       --user-approved "<decision>"        grant one more fix pass, unlock
  status                                           print the state; exit 2 while locked
  close                                            delete the state file after merge/abandon

Exit codes: 0 ok, 1 usage/state error, 2 gate locked.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_NAME = ".review-gate.json"
DEFAULT_MAX_FIX_PASSES = 2
BLOCKED_SUBAGENTS = ["implementer", "reviewer"]


def state_path(root: Path) -> Path:
    return root / STATE_NAME


def load_state(root: Path) -> dict:
    path = state_path(root)
    if not path.is_file():
        raise SystemExit(f"fix_gate: no {STATE_NAME} in {root}; run `open --pr <N>` first")
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(root: Path, state: dict) -> None:
    state_path(root).write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def not_clean_rounds(state: dict) -> int:
    return sum(1 for r in state["rounds"] if not r["clean"])


def recompute_lock(state: dict) -> None:
    used = not_clean_rounds(state)
    if used > state["maxFixPasses"]:
        state["locked"] = True
        state["lockReason"] = (
            f"PR #{state['pr']} has used {state['maxFixPasses']}/{state['maxFixPasses']} fix passes "
            f"and round {len(state['rounds'])} is still not clean. Stop and report to the user "
            "(open findings + split/descope recommendation); a recorded user decision "
            "(`fix_gate.py extend --user-approved \"<decision>\"`) grants one more pass."
        )
    else:
        state["locked"] = False
        state["lockReason"] = ""


def cmd_open(args: argparse.Namespace) -> int:
    root = args.root
    path = state_path(root)
    if path.is_file():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing.get("pr") == args.pr:
            print(f"fix_gate: PR #{args.pr} already open ({len(existing['rounds'])} rounds recorded)")
            return 0
        raise SystemExit(
            f"fix_gate: {STATE_NAME} belongs to PR #{existing.get('pr')}; run `close` for it first"
        )
    state = {
        "enabled": True,
        "pr": args.pr,
        "maxFixPasses": args.max_fix_passes,
        "rounds": [],
        "approvals": [],
        "locked": False,
        "lockReason": "",
        "blockedSubagents": BLOCKED_SUBAGENTS,
        "openedAt": now(),
    }
    save_state(root, state)
    print(f"fix_gate: opened PR #{args.pr} with {args.max_fix_passes} fix passes")
    return 0


def cmd_record_round(args: argparse.Namespace) -> int:
    state = load_state(args.root)
    if state["locked"]:
        print(f"fix_gate: LOCKED - {state['lockReason']}", file=sys.stderr)
        return 2
    state["rounds"].append(
        {"n": len(state["rounds"]) + 1, "sha": args.sha, "clean": args.clean, "at": now()}
    )
    recompute_lock(state)
    save_state(args.root, state)
    used = not_clean_rounds(state)
    if state["locked"]:
        print(f"fix_gate: LOCKED - {state['lockReason']}", file=sys.stderr)
        return 2
    if args.clean:
        print(f"fix_gate: round {len(state['rounds'])} clean; proceed to merge gate")
    else:
        print(
            f"fix_gate: round {len(state['rounds'])} not clean; fix pass {used}/{state['maxFixPasses']} may start"
        )
    return 0


def cmd_extend(args: argparse.Namespace) -> int:
    state = load_state(args.root)
    state["maxFixPasses"] += 1
    state["approvals"].append({"decision": args.user_approved, "at": now()})
    recompute_lock(state)
    save_state(args.root, state)
    print(f"fix_gate: extended to {state['maxFixPasses']} fix passes on user decision")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    state = load_state(args.root)
    print(json.dumps(state, indent=2))
    return 2 if state["locked"] else 0


def cmd_close(args: argparse.Namespace) -> int:
    path = state_path(args.root)
    if path.is_file():
        path.unlink()
        print("fix_gate: closed")
    else:
        print("fix_gate: nothing to close")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="project root (default: cwd)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_open = sub.add_parser("open")
    p_open.add_argument("--pr", type=int, required=True)
    p_open.add_argument("--max-fix-passes", type=int, default=DEFAULT_MAX_FIX_PASSES)
    p_open.set_defaults(func=cmd_open)

    p_round = sub.add_parser("record-round")
    p_round.add_argument("--sha", required=True)
    verdict = p_round.add_mutually_exclusive_group(required=True)
    verdict.add_argument("--clean", action="store_true")
    verdict.add_argument("--not-clean", dest="clean", action="store_false")
    p_round.set_defaults(func=cmd_record_round)

    p_extend = sub.add_parser("extend")
    p_extend.add_argument("--user-approved", required=True, help="one-line user decision")
    p_extend.set_defaults(func=cmd_extend)

    sub.add_parser("status").set_defaults(func=cmd_status)
    sub.add_parser("close").set_defaults(func=cmd_close)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.root = args.root.resolve()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
