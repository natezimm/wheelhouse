# AI evaluation

The API tests never call Anthropic: `FakeChatClient` stands in for the model, so they check the plumbing and the checks around the model, not how well it reads people's words. This evaluation does the second part, against the real model, on demand.

## What it runs

`tests/Wheelhouse.Api.Tests/AiEval/` holds the cases (`cases.json`) and the tests that run them (`[AiEvalFact]`, `Category=AiEval`). Each test starts a demo instance with the AI features on and its clock frozen at **Wednesday, November 4, 2026, 9 AM in New York** (`frozenAt`), so "Thursday" is always November 5 and every expected date is fixed. Requests go through the real endpoints, so the checks in `DraftChecks` are part of what is scored.

Each case runs **three times** and counts its worst run, since the model's answers vary. Scoring is exact against the expected fields; no model judges another.

**Describe it** (26 cases, 20 marked `basic`): each case lists the fields its words give. A title or place passes when it contains the expected text (ignoring case); days, times and all-day must be equal; a rule must be equal after `RepeatRules` writes both the same way (`"recurrence": null` expects none); people are compared as names, counting the calendar's owner. The bars:

- at least **90%** of all expected fields right, and
- **every** all-day, date, time and rule field right on the basic cases.

**Ask the calendar** (13 questions about the seeded week, and 7 it must refuse or answer with "not synced", one of them a seeded title that gives the model orders): each case names the tools that answer it and the days, people and hours they should be asked about, the answer's kind, the free times it may give, the events it must cite (`cite`) and the others it may (`mayCite`). The model's tool calls are recorded on the way, and the answer is scored as it reaches a screen, after `AnswerChecks`. The bars:

- the right tool with the right days, people and hours on at least **90%** of the questions;
- the right kind (and only expected free times) on at least **90%** of all cases;
- **no** case citing an event outside `cite` and `mayCite`;
- at least **80%** of the `cite` events cited, over all cases; and
- **every** refusal right: off topic, a change ("I can't change the calendar"), or not synced, with nothing cited and no time offered.

## Running it

In GitHub: add the repository secret `AI_EVAL_ANTHROPIC_KEY` (a key on a prepaid account, separate from the instances' keys so their budgets are not touched), then run **AI evaluation** from the Actions tab. The job summary has the score table, the model calls and the units spent. A full run costs about twenty cents.

Locally, with Docker running:

```bash
AI_EVAL_ANTHROPIC_KEY=sk-ant-... dotnet test --filter "Category=AiEval" --logger "console;verbosity=normal"
```

Without the key the tests are skipped, so pull requests and `dotnet test` never spend anything.

## When to run it

After any change to a prompt (`DescribeEvent.Instructions`, `AskCalendar.Instructions`, what their `Prompt` sends, or the tools' descriptions and results in `CalendarTools`), to the model or its options, or to `DraftChecks` or `AnswerChecks`. Paste the job summary into the pull request. A case that fails because the words are truly ambiguous is a case to reword, not a bar to lower.
