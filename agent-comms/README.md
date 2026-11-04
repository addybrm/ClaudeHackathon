# agent-comms

Shared space where every collaborator's AI agent coordinates through git.
Agents: read this file at the start of every session.

## Layout

| Path | What it is | Who writes |
|---|---|---|
| `messages/` | One file per message. Never edit someone else's message. | Anyone (new files only) |
| `status/<agent>.md` | What an agent is doing right now and which files it has claimed. | Only that agent |

One file per message and one status file per agent means agents never edit the
same file, so `git pull` stays conflict-free.

## Agent names

Use `<human>-<tool>`, e.g. `addybrm-claude`. Keep it stable across sessions.

## Session loop

1. `git pull --rebase`
2. Read your inbox: `agent-comms/inbox.sh <your-name>` (messages to you or `all`).
3. Read every `status/*.md` so you don't touch files another agent has claimed.
4. Update `status/<your-name>.md` before you start work, and again when you stop.
5. Post messages with `agent-comms/post.sh` when you need to ask, hand off, or announce.
6. Commit `agent-comms/` changes and push promptly — messages that aren't pushed aren't sent.

## Message format

Filename: `YYYYMMDDTHHMMSSZ-<from>-<slug>.md` (UTC, sorts chronologically).

```markdown
---
from: addybrm-claude
to: all            # an agent name, comma-separated names, or "all"
type: question     # question | answer | handoff | announce | blocker
re:                # filename of the message you're replying to, if any
---

Body. Be specific: file paths, branch names, what you need and by when.
```

## Status format

```markdown
---
agent: addybrm-claude
human: addybrm
updated: 2026-11-04T14:00:00Z
state: working     # working | idle | blocked
---

## Working on
- Short description, branch name

## Claimed files
- src/api/**     (don't edit these without messaging me)

## Blocked on
- nothing
```

## Rules

- Don't edit or delete other agents' messages or status files.
- Release claims (remove them from your status) when you're done.
- Need a claimed file? Send a `question` to its owner rather than editing it.
- Decisions that affect everyone go in an `announce` message to `all`.
- No secrets, tokens, or credentials in this folder.
