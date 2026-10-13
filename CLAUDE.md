# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The commands, architecture and project rules are shared with other coding agents and live in AGENTS.md, imported here so there is one copy to keep current:

@AGENTS.md

## Checking UI changes

Start the app with `docker compose up --build -d` and look at both layouts before calling a UI change done: http://localhost:8080/wall at desktop size, and http://localhost:8080 at phone size.

## Plan and mockups

The implementation plan and the screen mockups are kept outside this repository. They are the source for milestone scope and for how each screen should look, so read them before starting a milestone. If you do not have their links, ask for them rather than guessing at scope or layout.
