# obsidian-manager — project notes for Claude

## Terminology

**granularity** — a calendar/timeline time scale: `day`, `week`, `month`, `year`. Also includes `horizon` and `agenda` as display modes in the CalendarGrid. Used throughout the codebase as the `TargetGranularity` type and in view switching (`switchView`). When the user says "all granularities" they mean all of these views.
