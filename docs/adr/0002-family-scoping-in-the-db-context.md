# 0002. Family scoping by query filter in the DbContext

**Status:** Accepted, October 2026

## Context

One database serves many families: every demo visitor is a family of their own, and a family instance may hold more than one family over time. Each endpoint adding `Where(x => x.FamilyId == ...)` by hand is one forgotten clause away from showing a family another family's calendar, and that mistake would not fail any test that only uses one family.

## Decision

Every table that holds a family's data implements `IFamilyOwned`, and [`WheelhouseDbContext`](../../src/Wheelhouse.Api/Data/WheelhouseDbContext.cs) gives each of them a global query filter on `CurrentFamilyId`. That id comes only from the signed-in principal's `wheelhouse:family` claim, through `ICurrentFamily`.

Outside a request there is no current family, so filtered queries return nothing. Code that legitimately runs across families, such as the demo seeder, cleanup and the sync worker, opts out with `IgnoreQueryFilters()` by name.

## Consequences

- The safe behavior is the default. A query that forgets about families returns nothing instead of everything.
- Cross-family code is easy to find and review: search for `IgnoreQueryFilters`.
- Tests check the boundary directly, for example `A_family_sees_only_its_own_rows`, and each test acts in its own fresh demo copy so tests cannot see each other's data.
- Background work has to set or bypass the family deliberately, which is a little more code in the sync and live-notification services.
