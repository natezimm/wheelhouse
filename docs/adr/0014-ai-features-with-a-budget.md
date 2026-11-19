# 0014. AI features through Microsoft.Extensions.AI, behind a budget that cannot overspend

**Status:** Accepted, November 2026

## Context

Two features want a language model: **Describe it** (a parent types "Milo's dentist next Thursday at 3" and gets the event editor filled in, unsaved) and **Ask the calendar** ("when are we all free on Saturday?", answered from the family's own events). Wheelhouse is a public demo and a real family's private calendar on one small VM. A model call costs money on every request, a public demo invites scripts, and the family's calendar says where the children are. Whatever we add must not be able to run up a bill, must not send more of the calendar than a question needs, and must never change the calendar by itself.

## Decision

- **Microsoft.Extensions.AI, not Semantic Kernel.** Endpoints depend on `IChatClient`, with the Anthropic C# SDK's `AsIChatClient` as the model. M.E.AI gives typed structured output (`GetResponseAsync<T>`), a tool loop (`FunctionInvokingChatClient`) and a seam for tests, which is all two features need; Semantic Kernel's planners, memory and plugin model would be a framework to learn and keep current for none of it. Swapping models is a change to one factory.
- **Claude Haiku 5.5** (`claude-haiku-5-5`), low effort: the cheapest current model, quick enough for a screen someone is waiting on, and good at short extraction and tool use.
- **The model never writes.** Describe it returns a draft the editor shows unsaved; Ask's tools only read, scoped to the asking family. Every save still goes through `/api/calendar/events` and Google's `If-Match`.
- **Off unless turned on.** `Ai:Enabled` and `Ai:AnthropicApiKey` must both be set; the demo sets them, a family instance does not by default. Only parents may ask.
- **Spending is capped three times.** A prepaid Anthropic account with auto-reload off caps the worst case at its balance (about $10). A daily budget for the whole instance (`Ai:DailyUnits`, 2 million units of input tokens plus five times output tokens, about $0.20 a day) is kept in PostgreSQL (`AiUsage`, one row a UTC day), checked before every model call and charged after, inside the tool loop so every step counts. Rate limits (6 a minute, 40 an hour per caller, one in flight per caller, four per instance) keep one visitor from spending the day. A breaker stops calls for 10 minutes after Anthropic refuses the key or its credit.
- **Whole answers, no streaming, no embeddings.** Answers are short and checked before they are shown, which streaming would defeat. The family's events fit a question's window without a vector index; pgvector can come later if search outgrows it.
- **Privacy.** Send the typed words, member and calendar names, and for Ask only the events the tools read: a private event as "Busy", notes never. Never log or tag prompts, answers or an error's text.

## Consequences

- Anthropic is a new outside service with a secret in `.env` (docs/security.md). A leaked key spends at most the prepaid balance.
- The budget can be exceeded by one call's worth at the end of a day, since a call is charged after it answers.
- Rate limits are in memory, so a restart resets them; the budget is not.
- The AI client uses the SDK's own HttpClient, so `ArchitectureTests`' rule about HttpClient still holds without an exception.
- The tests never call Anthropic: `FakeChatClient` stands in for the model. Quality is checked by a separate evaluation run on demand with a real key.
- Memory: the SDK and M.E.AI add an estimated 10 to 20 MB to an API that uses them, inside the 160 MB limit; to be measured on the demo once the first feature ships.
