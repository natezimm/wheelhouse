# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The commands, architecture and project rules are shared with other coding agents and live in AGENTS.md, imported here so there is one copy to keep current:

@AGENTS.md

## Checking UI changes

Start the app with `docker compose up --build -d` and look at both layouts before calling a UI change done: http://localhost:8080/wall at desktop size, and http://localhost:8080 at phone size.

## Plan and mockups

The new proposed plan for chores, lists and meals lives in [docs/household-roadmap.md](docs/household-roadmap.md). Read it before those increments; it defines their scope, sequencing, design workflow and completion criteria. It is a new plan created after calendar live updates, not a recovered historical roadmap. Follow its design workflow for new screens using the existing design system.

The earlier implementation plan and screen mockups for other milestones are kept outside this repository. When work depends on those external materials, read them first; if their links are missing, ask rather than inventing their scope or layout.

