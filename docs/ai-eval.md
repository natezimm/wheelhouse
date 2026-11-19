# AI evaluation

The API tests never call Anthropic: `FakeChatClient` stands in for the model, so they check the plumbing and the checks around the model, not how well it reads people's words. This evaluation does the second part, against the real model, on demand.

## What it runs

`tests/Wheelhouse.Api.Tests/AiEval/` holds the cases (`cases.json`) and the tests that run them (`[AiEvalFact]`, `Category=AiEval`). Each test starts a demo instance with the AI features on and its clock frozen at **Wednesday, November 4, 2026, 9 AM in New York** (`frozenAt`), so "Thursday" is always November 5 and every expected date is fixed. Requests go through the real endpoints, so the checks in `DraftChecks` are part of what is scored.

Each case runs **three times** and counts its worst run, since the model's answers vary. Scoring is exact against the expected fields; no model judges another.

**Describe it** (26 cases, 20 marked `basic`): each case lists the fields its words give. A title or place passes when it contains the expected text (ignoring case); days, times and all-day must be equal; a rule must be equal after `RepeatRules` writes both the same way (`"recurrence": null` expects none); people are compared as names, counting the calendar's owner. The bars:

- at least **90%** of all expected fields right, and
- **every** all-day, date, time and rule field right on the basic cases.

## Running it

In GitHub: add the repository secret `AI_EVAL_ANTHROPIC_KEY` (a key on a prepaid account, separate from the instances' keys so their budgets are not touched), then run **AI evaluation** from the Actions tab. The job summary has the score table, the model calls and the units spent. A full run costs about ten cents.

Locally, with Docker running:

```bash
AI_EVAL_ANTHROPIC_KEY=sk-ant-... dotnet test --filter "Category=AiEval" --logger "console;verbosity=normal"
```

Without the key the tests are skipped, so pull requests and `dotnet test` never spend anything.

## When to run it

After any change to a prompt (`DescribeEvent.Instructions` or what `DescribeEvent.Prompt` sends), to the model or its options, or to `DraftChecks`. Paste the job summary into the pull request. A case that fails because the words are truly ambiguous is a case to reword, not a bar to lower.
