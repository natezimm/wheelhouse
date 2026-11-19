using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;
using Xunit.Abstractions;

namespace Wheelhouse.Api.Tests.AiEval;

/// <summary>
/// A test that runs only against the real model, with <c>AI_EVAL_ANTHROPIC_KEY</c> set (docs/ai-eval.md).
/// Without it it is skipped, so pull requests and local runs never call Anthropic or spend anything.
/// </summary>
public sealed class AiEvalFactAttribute : FactAttribute
{
    public static readonly string? Key = Environment.GetEnvironmentVariable("AI_EVAL_ANTHROPIC_KEY");

    public AiEvalFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Key))
        {
            Skip = "Set AI_EVAL_ANTHROPIC_KEY to run the AI evaluation.";
        }
    }
}

/// <summary>
/// Describe it against Claude, on a demo copy made with the clock frozen at Wednesday, November 4, 2026,
/// 9 AM in New York, so every expected date is fixed. Each case runs three times and counts its worst
/// run, since answers vary. Scoring is exact against the expected fields; no model judges another.
/// Pass: at least 90% of all fields, and every date, time and rule field of the basic cases.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "AiEval")]
public sealed class DescribeEval(ApiFactory factory, ITestOutputHelper output)
{
    private const int Runs = 3;

    /// <summary>The fields that must all be right on the basic cases.</summary>
    private static readonly string[] Exact = ["allDay", "startDate", "startTime", "endDate", "endTime", "recurrence"];

    public static JsonDocument Cases() => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AiEval", "cases.json")));

    [AiEvalFact]
    public async Task Describe_it_fills_in_the_fields_the_words_give()
    {
        using var cases = Cases();
        var frozenAt = cases.RootElement.GetProperty("frozenAt").GetDateTimeOffset();
        await using var host = factory.Demo.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Ai:Enabled", true).UseSetting("Ai:AnthropicApiKey", AiEvalFactAttribute.Key!);
            builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FrozenTime(frozenAt)));
        });

        var rows = new List<(string Id, bool Basic, int Right, int Fields, List<string> Wrong, List<string> Missed)>();
        HttpClient? visitor = null;
        FamilyResponse? family = null;
        IReadOnlyList<CalendarSourceResponse> calendars = [];
        var calls = 0;
        foreach (var testCase in cases.RootElement.GetProperty("describe").EnumerateArray())
        {
            var id = testCase.GetProperty("id").GetString()!;
            var basic = testCase.TryGetProperty("basic", out var b) && b.GetBoolean();
            var expect = testCase.GetProperty("expect");
            (int Right, int Fields, List<string> Wrong)? worst = null;
            // A date, time or rule a basic case gets wrong in any run counts, not only the worst run's.
            var missed = new SortedSet<string>(StringComparer.Ordinal);
            for (var run = 0; run < Runs; run++)
            {
                // A fresh copy every few calls, so the AI rate limit of one caller is never reached.
                if (calls++ % (AiLimits.PerMinute - 1) == 0)
                {
                    visitor?.Dispose();
                    visitor = await FrozenVisitorAsync(host);
                    family = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
                    calendars = (await visitor.GetFromJsonAsync<CalendarResponse>("/api/calendar?from=2026-11-04&to=2026-11-05", ApiFactory.Json))!.Calendars;
                }

                var response = await visitor!.PostAsJsonAsync("/api/ai/describe", new DescribeRequest(testCase.GetProperty("text").GetString()), ApiFactory.Json);
                response.EnsureSuccessStatusCode();
                var draft = (await response.Content.ReadFromJsonAsync<EventDraftResponse>(ApiFactory.Json))!;
                var score = Score(expect, draft, family!, calendars);
                missed.UnionWith(score.Wrong.Where(w => Exact.Contains(w)));
                if (worst is null || score.Right * worst.Value.Fields < worst.Value.Right * score.Fields)
                {
                    worst = score;
                }
            }

            rows.Add((id, basic, worst!.Value.Right, worst.Value.Fields, worst.Value.Wrong, [.. missed]));
        }

        visitor?.Dispose();
        long units, modelCalls;
        await using (var db = factory.DbContextFor(null))
        {
            var day = await db.AiUsage.AsNoTracking().SingleAsync(u => u.Day == DateOnly.FromDateTime(frozenAt.UtcDateTime));
            (units, modelCalls) = (day.Units, day.Calls);
        }

        var right = rows.Sum(r => r.Right);
        var fields = rows.Sum(r => r.Fields);
        var exactMisses = rows.Where(r => r.Basic).SelectMany(r => r.Missed.Select(w => $"{r.Id}.{w}")).ToList();
        var summary = new StringBuilder()
            .AppendLine("### Describe it evaluation")
            .AppendLine()
            .AppendLine($"Field accuracy (worst of {Runs} runs): **{right}/{fields} = {100.0 * right / fields:F1}%** (bar 90%)  ")
            .AppendLine($"Basic cases' date, time and rule fields wrong in any run: **{exactMisses.Count}** (bar 0)  ")
            .AppendLine($"Model calls: {modelCalls}, budget units: {units:N0} (about ${units / 1_000_000.0 * 0.10:F3})")
            .AppendLine()
            .AppendLine("| Case | Basic | Right | Wrong fields |")
            .AppendLine("| --- | --- | --- | --- |");
        foreach (var row in rows)
        {
            summary.AppendLine($"| {row.Id} | {(row.Basic ? "yes" : "")} | {row.Right}/{row.Fields} | {string.Join(", ", row.Wrong)} |");
        }

        output.WriteLine(summary.ToString());
        if (Environment.GetEnvironmentVariable("GITHUB_STEP_SUMMARY") is { Length: > 0 } path)
        {
            await File.AppendAllTextAsync(path, summary.ToString());
        }

        Assert.True(right >= 0.9 * fields, $"Field accuracy {right}/{fields} is under 90%.");
        Assert.True(exactMisses.Count == 0, $"Basic cases got dates, times or rules wrong: {string.Join(", ", exactMisses)}");
    }

    /// <summary>The expected fields this draft got right, and the names of those it got wrong.</summary>
    public static (int Right, int Fields, List<string> Wrong) Score(
        JsonElement expect, EventDraftResponse draft, FamilyResponse family, IReadOnlyList<CalendarSourceResponse> calendars)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var wrong = new List<string>();
        var fields = 0;
        foreach (var field in expect.EnumerateObject())
        {
            fields++;
            var value = field.Value;
            var ok = field.Name switch
            {
                "title" => draft.Title.Contains(value.GetString()!, StringComparison.OrdinalIgnoreCase),
                "location" => draft.Location?.Contains(value.GetString()!, StringComparison.OrdinalIgnoreCase) == true,
                "allDay" => draft.AllDay == value.GetBoolean(),
                "startDate" => draft.StartDate.ToString("yyyy-MM-dd") == value.GetString(),
                "endDate" => draft.EndDate.ToString("yyyy-MM-dd") == value.GetString(),
                "startTime" => draft.StartTime?.ToString("HH:mm") == value.GetString(),
                "endTime" => draft.EndTime?.ToString("HH:mm") == value.GetString(),
                "recurrence" => value.ValueKind == JsonValueKind.Null
                    ? draft.Recurrence is null
                    : RepeatRules.Parse(value.GetString(), zone) is { } rule && draft.Recurrence == RepeatRules.Format(rule, draft.AllDay, zone),
                "people" => People(draft, family, calendars).SetEquals(value.EnumerateArray().Select(v => v.GetString()!)),
                _ => throw new InvalidOperationException($"Unknown expected field {field.Name}."),
            };
            if (!ok)
            {
                wrong.Add(field.Name);
            }
        }

        return (fields - wrong.Count, fields, wrong);
    }

    private static HashSet<string> People(EventDraftResponse draft, FamilyResponse family, IReadOnlyList<CalendarSourceResponse> calendars)
    {
        var ids = draft.MemberIds.ToHashSet();
        if (calendars.FirstOrDefault(c => c.Id == draft.CalendarId)?.MemberId is { } owner)
        {
            ids.Add(owner);
        }

        return family.Members.Where(m => ids.Contains(m.Id)).Select(m => m.DisplayName).ToHashSet();
    }

    /// <summary>
    /// A demo visitor on a host whose clock is frozen in the past. Its cookie's expiry is in the past by
    /// the real clock, which the test client's cookie jar would drop, so the cookie is carried by hand;
    /// the API checks it against its own, frozen, clock.
    /// </summary>
    public static async Task<HttpClient> FrozenVisitorAsync(WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var visit = await client.PostAsync("/api/demo/visit", content: null);
        visit.EnsureSuccessStatusCode();
        var cookie = visit.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("wheelhouse=", StringComparison.Ordinal));
        client.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        return client;
    }

    private sealed class FrozenTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
