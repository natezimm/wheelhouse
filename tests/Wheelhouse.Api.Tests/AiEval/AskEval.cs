using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Anthropic;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;
using Xunit.Abstractions;

namespace Wheelhouse.Api.Tests.AiEval;

/// <summary>
/// Ask the calendar against Claude, on demo copies made with the clock frozen at Wednesday, November 4,
/// 2026, 9 AM in New York, as <see cref="DescribeEval"/> is. Each case runs three times and counts its
/// worst run. Scoring is exact against the seeded calendar; no model judges another. Pass: the right tool
/// with the right days, people and hours on at least 90% of Ask cases, the right kind on at least 90%,
/// no event cited that does not answer the question, at least 80% of the events that do, and every
/// refusal right.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "AiEval")]
public sealed class AskEval(ApiFactory factory, ITestOutputHelper output)
{
    private const int Runs = 3;

    private sealed record Run(bool ToolOk, bool KindOk, bool Precise, int Recalled, int Expected, bool SlotsOk, string Notes);

    [AiEvalFact]
    public async Task Ask_answers_from_the_calendar_and_refuses_what_it_cannot()
    {
        using var cases = DescribeEval.Cases();
        var frozenAt = cases.RootElement.GetProperty("frozenAt").GetDateTimeOffset();
        var calls = new ConcurrentQueue<FunctionCallContent>();
        var usage = new ConcurrentQueue<UsageDetails>();
        await using var host = factory.Demo.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Ai:Enabled", true).UseSetting("Ai:AnthropicApiKey", AiEvalFactAttribute.Key!);
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<TimeProvider>(new FrozenTime(frozenAt));
                services.AddKeyedSingleton<IChatClient>(AiSetup.ModelKey, (_, _) => new Recorder(
                    new AnthropicClient { ApiKey = AiEvalFactAttribute.Key!, MaxRetries = 1, Timeout = new AiOptions().Timeout }.AsIChatClient(new AiOptions().Model),
                    calls,
                    usage));
            });
        });

        var rows = new List<(string Id, bool Refusal, Run Worst)>();
        HttpClient? visitor = null;
        var asked = 0;
        foreach (var (group, refusal) in new[] { ("ask", false), ("refuse", true) })
        {
            foreach (var testCase in cases.RootElement.GetProperty(group).EnumerateArray())
            {
                var id = testCase.GetProperty("id").GetString()!;
                var expect = testCase.GetProperty("expect");
                var setup = testCase.TryGetProperty("setup", out var s) ? s : (JsonElement?)null;
                Run? worst = null;
                for (var run = 0; run < Runs; run++)
                {
                    // A fresh copy for a case that adds events, and every few questions, so one caller's AI limit is never reached.
                    if (setup is not null || visitor is null || asked % (AiLimits.PerMinute - 1) == 0)
                    {
                        visitor?.Dispose();
                        visitor = await DescribeEval.FrozenVisitorAsync(host);
                        if (setup is { } events)
                        {
                            await SetUpAsync(visitor, events);
                        }
                    }

                    asked++;
                    var family = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
                    calls.Clear();
                    var response = await visitor.PostAsJsonAsync("/api/ai/ask", new AskRequest(testCase.GetProperty("question").GetString()), ApiFactory.Json);
                    response.EnsureSuccessStatusCode();
                    var answer = (await response.Content.ReadFromJsonAsync<AskResponse>(ApiFactory.Json))!;
                    var score = Score(expect, answer, [.. calls], family);
                    if (worst is null || Rank(score) < Rank(worst))
                    {
                        worst = score;
                    }

                    if (setup is not null)
                    {
                        visitor.Dispose();
                        visitor = null;
                    }
                }

                rows.Add((id, refusal, worst!));
            }
        }

        visitor?.Dispose();
        var askRows = rows.Where(r => !r.Refusal).ToList();
        var toolRight = askRows.Count(r => r.Worst.ToolOk);
        var kindRight = rows.Count(r => r.Worst.KindOk && r.Worst.SlotsOk);
        var imprecise = rows.Where(r => !r.Worst.Precise).Select(r => r.Id).ToList();
        var recalled = rows.Sum(r => r.Worst.Recalled);
        var expected = rows.Sum(r => r.Worst.Expected);
        var refusalsWrong = rows.Where(r => r.Refusal && !(r.Worst.KindOk && r.Worst.SlotsOk && r.Worst.Precise)).Select(r => r.Id).ToList();
        var input = usage.Sum(u => u.InputTokenCount ?? 0);
        var outputTokens = usage.Sum(u => u.OutputTokenCount ?? 0);

        var summary = new StringBuilder()
            .AppendLine("### Ask the calendar evaluation")
            .AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"Right tool and arguments (worst of {Runs} runs): **{toolRight}/{askRows.Count}** (bar 90%)  ")
            .AppendLine(CultureInfo.InvariantCulture, $"Right kind and free times: **{kindRight}/{rows.Count}** (bar 90%)  ")
            .AppendLine(CultureInfo.InvariantCulture, $"Cases citing an event that does not answer: **{imprecise.Count}** (bar 0)  ")
            .AppendLine(CultureInfo.InvariantCulture, $"Events that answer, cited: **{recalled}/{expected}** (bar 80%)  ")
            .AppendLine(CultureInfo.InvariantCulture, $"Refusals wrong: **{refusalsWrong.Count}** (bar 0)  ")
            .AppendLine(CultureInfo.InvariantCulture, $"Model calls: {usage.Count}, tokens in {input:N0}, out {outputTokens:N0} (about ${(input * 0.10 + outputTokens * 0.50) / 1_000_000:F3})")
            .AppendLine()
            .AppendLine("| Case | Tool | Kind | Precise | Recall | Notes |")
            .AppendLine("| --- | --- | --- | --- | --- | --- |");
        foreach (var (id, refusal, worst) in rows)
        {
            summary.AppendLine(CultureInfo.InvariantCulture,
                $"| {id} | {(refusal ? "" : worst.ToolOk ? "yes" : "**no**")} | {(worst.KindOk && worst.SlotsOk ? "yes" : "**no**")} | {(worst.Precise ? "yes" : "**no**")} | {worst.Recalled}/{worst.Expected} | {worst.Notes.Replace("|", "/")} |");
        }

        output.WriteLine(summary.ToString());
        if (Environment.GetEnvironmentVariable("GITHUB_STEP_SUMMARY") is { Length: > 0 } path)
        {
            await File.AppendAllTextAsync(path, summary.ToString());
        }

        Assert.True(toolRight >= 0.9 * askRows.Count, $"Right tool on {toolRight}/{askRows.Count}, under 90%.");
        Assert.True(kindRight >= 0.9 * rows.Count, $"Right kind on {kindRight}/{rows.Count}, under 90%.");
        Assert.True(imprecise.Count == 0, $"Cited events that do not answer: {string.Join(", ", imprecise)}");
        Assert.True(recalled >= 0.8 * expected, $"Cited {recalled}/{expected} of the events that answer, under 80%.");
        Assert.True(refusalsWrong.Count == 0, $"Refusals wrong: {string.Join(", ", refusalsWrong)}");
    }

    /// <summary>How good a run was, lowest worst, so the worst of a case's runs is the one counted.</summary>
    private static int Rank(Run run) =>
        (run.Precise ? 8 : 0) + (run.KindOk && run.SlotsOk ? 4 : 0) + (run.ToolOk ? 2 : 0) + (run.Recalled == run.Expected ? 1 : 0);

    private static Run Score(JsonElement expect, AskResponse answer, IReadOnlyList<FunctionCallContent> calls, FamilyResponse family)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var notes = new List<string>();
        var kind = expect.GetProperty("kind").GetString();
        var kindOk = kind == "change"
            ? answer.Kind == AskKinds.OffTopic && answer.Sentence == AnswerChecks.ChangeSentence
            : answer.Kind == kind;
        if (!kindOk)
        {
            notes.Add($"kind {answer.Kind}: {answer.Sentence}");
        }

        var toolOk = !expect.TryGetProperty("tool", out var tools)
            || calls.Any(call => tools.EnumerateArray().Any(t => t.GetString() == call.Name) && Arguments(call, expect, family));
        if (!toolOk)
        {
            notes.Add("calls " + string.Join("; ", calls.Select(c => $"{c.Name}({JsonSerializer.Serialize(c.Arguments)})")));
        }

        var cite = Strings(expect, "cite");
        var may = Strings(expect, "mayCite");
        var cited = answer.Events.Select(e => e.Title).ToHashSet();
        var stray = cited.Where(t => !cite.Contains(t) && !may.Contains(t)).ToList();
        if (stray.Count > 0)
        {
            notes.Add("cited " + string.Join(", ", stray));
        }

        // Refusals must cite nothing and offer no time at all.
        var slotsOk = true;
        var expectedSlots = Strings(expect, "slots");
        var shownSlots = answer.Slots.Select(s => $"{TimeZoneInfo.ConvertTime(s.Start, zone):HH:mm}-{TimeZoneInfo.ConvertTime(s.End, zone):HH:mm}").ToList();
        if (kind == "free")
        {
            slotsOk = shownSlots.Count > 0 && shownSlots.All(expectedSlots.Contains);
        }
        else if (shownSlots.Count > 0)
        {
            slotsOk = false;
        }

        if (!slotsOk)
        {
            notes.Add("slots " + string.Join(", ", shownSlots));
        }

        return new Run(toolOk, kindOk, stray.Count == 0, cite.Count(cited.Contains), cite.Count, slotsOk, string.Join("; ", notes));
    }

    /// <summary>Whether a tool call's days, people and hours are the ones the case asks about.</summary>
    private static bool Arguments(FunctionCallContent call, JsonElement expect, FamilyResponse family)
    {
        string? Arg(string name) => call.Arguments?.TryGetValue(name, out var value) == true ? value?.ToString() : null;

        var days = Strings(expect, "days").Select(d => DateOnly.ParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture)).ToList();
        switch (call.Name)
        {
            case "get_events" when days.Count > 0:
                if (!DateOnly.TryParse(Arg("from"), CultureInfo.InvariantCulture, out var from) || !DateOnly.TryParse(Arg("to"), CultureInfo.InvariantCulture, out var to)
                    || days.Any(d => d < from || d > to))
                {
                    return false;
                }

                break;
            case "find_free_time":
                if (!DateOnly.TryParse(Arg("date"), CultureInfo.InvariantCulture, out var date) || (days.Count > 0 && !days.Contains(date)))
                {
                    return false;
                }

                if (expect.TryGetProperty("within", out var within) && within.EnumerateArray().Select(w => w.GetString()).ToList() is [var earliest, var latest]
                    && (string.CompareOrdinal(Arg("from"), earliest) < 0 || string.CompareOrdinal(Arg("to") ?? "24:00", latest) > 0))
                {
                    return false;
                }

                break;
        }

        if (!expect.TryGetProperty("people", out _) || call.Name == "search_events")
        {
            return true;
        }

        var aliases = family.Members.Select((m, i) => (Alias: $"m{i + 1}", m.DisplayName)).ToDictionary(m => m.Alias, m => m.DisplayName);
        var named = Arg("people") is { } people && people.StartsWith('[')
            ? JsonSerializer.Deserialize<string[]>(people)!.Select(a => aliases.GetValueOrDefault(a, a)).ToHashSet()
            : [];
        var wanted = Strings(expect, "people");
        // Everyone may be asked for by naming no one or by naming them all.
        return wanted.Count == 0
            ? named.Count == 0 || named.Count == family.Members.Count
            : named.SetEquals(wanted);
    }

    private static HashSet<string> Strings(JsonElement expect, string name) =>
        expect.TryGetProperty(name, out var values) ? values.EnumerateArray().Select(v => v.GetString()!).ToHashSet() : [];

    /// <summary>Adds a case's events to the family's own calendar.</summary>
    private static async Task SetUpAsync(HttpClient visitor, JsonElement events)
    {
        var calendars = (await visitor.GetFromJsonAsync<CalendarResponse>("/api/calendar?from=2026-11-04&to=2026-11-05", ApiFactory.Json))!.Calendars;
        var familyCalendar = calendars.First(c => c.MemberId is null && c.CanWrite);
        foreach (var e in events.EnumerateArray())
        {
            var day = DateOnly.ParseExact(e.GetProperty("date").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var request = new EventRequest(familyCalendar.Id, e.GetProperty("title").GetString(), null, false, day,
                TimeOnly.Parse(e.GetProperty("start").GetString()!, CultureInfo.InvariantCulture), day,
                TimeOnly.Parse(e.GetProperty("end").GetString()!, CultureInfo.InvariantCulture));
            (await visitor.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json)).EnsureSuccessStatusCode();
        }
    }

    /// <summary>The real model, with the tool calls it asks for and its usage kept for scoring.</summary>
    private sealed class Recorder(IChatClient inner, ConcurrentQueue<FunctionCallContent> calls, ConcurrentQueue<UsageDetails> usage) : DelegatingChatClient(inner)
    {
        public override async Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        {
            var response = await base.GetResponseAsync(messages, options, cancellationToken);
            foreach (var call in response.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>())
            {
                calls.Enqueue(call);
            }

            if (response.Usage is { } used)
            {
                usage.Enqueue(used);
            }

            return response;
        }
    }

    private sealed class FrozenTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
