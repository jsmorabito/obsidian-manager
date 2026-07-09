# obsidian-manager — project notes for Claude

## Releases

GitHub releases and git tags must **not** use a `v` prefix — use bare version numbers (e.g. `0.3.0`, not `v0.3.0`). BRAT and the Obsidian plugin installer sort releases lexicographically and the `v` prefix breaks ordering.

## Terminology

**granularity** — a calendar/timeline time scale: `day`, `week`, `month`, `year`. Also includes `horizon` and `agenda` as display modes in the CalendarGrid. Used throughout the codebase as the `TargetGranularity` type and in view switching (`switchView`). When the user says "all granularities" they mean all of these views.
