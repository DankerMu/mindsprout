---
id: 0033
title: Frame measured content in the canvas viewport
kind: bug-fix
status: implemented
date: 2026-11-22
---

# Frame measured content in the canvas viewport

## Problem

A layout anchored at the primary root can extend above or beyond the default viewport. Fitting estimates can still clip rendered nodes, and fitting every change would override the user's navigation.

## Decision

React Flow owns the transient viewport for each mounted map identity. Opening and manual fit use the same bounds from the layout projection. Opening waits for the current map's complete rendered measurements and fits once at 25–100%, with a single node at 100%. If content cannot fit at 25%, the zoom floor takes precedence and the bounds stay centered.

Starting or continuing inline creation or title editing may pan a clipped target using its rendered size and layout position, but cannot change zoom or write to the map. A fully visible target leaves the viewport unchanged. The editor store owns selection and the edit target, not viewport coordinates.

## Alternatives considered

- **Control the viewport through the editor store:** creates a second state path for pan and zoom gestures with no persistence or business logic consumer. Reading the current React Flow transform when acting avoids feedback during navigation.
- **Use React Flow's automatic `fitView`:** derives separate bounds from React Flow's node model rather than using the same measured layout projection as manual fit.
- **Refit on layout updates or center each edit target:** discards manual framing and moves more than visibility requires.

## Consequences

- A replacement map starts with a fresh viewport and measurement observer, including when node IDs overlap. A late measurement from the previous map cannot reframe the replacement.
- Map records and layout coordinates do not carry viewport state. The existing manual fit and navigation limits still apply.
- No active decision is superseded.
