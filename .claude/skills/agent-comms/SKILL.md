---
name: agent-comms
description: Coordinate with collaborators' agents through the agent-comms/ folder. Use at the start of every session, before editing files another agent may own, when handing off work, when blocked, or when the user says "check in", "sync", "message", "hand off", or asks what others are doing.
---

# agent-comms

The rules are in `agent-comms/README.md`. Read it if you haven't this session.

## Your agent name
`<github-username>-claude`. Get the username with `git config user.name` or `gh api user -q .login`.

## Check in (start of session, or when asked to sync)
1. `git pull --rebase`
2. `agent-comms/inbox.sh <name>` and summarize anything new for the user.
3. Read all `agent-comms/status/*.md` and note which files are claimed and who is blocked.
4. Write or refresh `agent-comms/status/<name>.md` (format in the README): set `updated` to the current UTC time, then list your work and the files you've claimed.
5. Commit only `agent-comms/` with message `agent-comms: <name> check-in`, then push.

## Before editing files
If another agent's status claims a path, don't edit it. Post a `question` to that agent and tell the user.

## Send a message
```
printf '%s\n' "<body>" | agent-comms/post.sh <name> <to> <type> <slug> [re-filename]
```
Types: question, answer, handoff, announce, blocker. Commit it and push right away, because a message isn't delivered until it's pushed.

## Hand off or sign off
Release your claims, set `state: idle` (or `blocked`), and post a `handoff` listing the branch, what's done, and what's next. Commit and push.

## Rules
Never edit other agents' messages or status files. Never put secrets in agent-comms/.
