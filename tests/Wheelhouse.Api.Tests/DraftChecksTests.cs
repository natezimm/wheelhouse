using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>What <see cref="DraftChecks"/> does with each kind of wrong or missing answer from the model. No database.</summary>
public sealed class DraftChecksTests
{
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    // Wednesday, November 4, 2026: the day the evaluation is frozen at.
    private static readonly DateOnly Today = new(2026, 11, 4);

    private static readonly DraftMember Clara = new("m1", Guid.NewGuid(), "Clara", MemberRole.Parent);
    private static readonly DraftMember Milo = new("m3", Guid.NewGuid(), "Milo", MemberRole.Kid);
    private static readonly DraftMember Nora = new("m4", Guid.NewGuid(), "Nora", MemberRole.Kid);

    private static readonly DraftCalendar ClaraCalendar = new(Guid.NewGuid(), Clara.Id, true);
    private static readonly DraftCalendar FamilyCalendar = new(Guid.NewGuid(), null, true);
    private static readonly DraftCalendar MiloCalendar = new(Guid.NewGuid(), Milo.Id, true);
    private static readonly DraftCalendar School = new(Guid.NewGuid(), null, false);

    private static DraftContext Context(DateOnly? syncedTo = null) =>
        new(Today, NewYork, [Clara, Milo, Nora], [ClaraCalendar, School, FamilyCalendar, MiloCalendar], syncedTo);

    private static EventDraftOutput Output(
        string? title = "Swim", bool allDay = false, string? startDate = "2026-11-10", string? startTime = "17:15",
        string? endDate = null, string? endTime = "18:15", string? recurrence = null, string[]? people = null,
        string? weekday = null, string? location = null) =>
        new(title, location, allDay, startDate, startTime, endDate, endTime, recurrence, people, weekday);

    private static EventDraftResponse Check(EventDraftOutput? output, DraftContext? context = null) =>
        DraftChecks.Check(output, "the words", context ?? Context());

    [Fact]
    public void A_clean_answer_passes_as_it_is()
    {
        var draft = Check(Output(people: ["m4"], location: "Riverside Park", recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270601"));

        Assert.Equal("Swim", draft.Title);
        Assert.Equal("Riverside Park", draft.Location);
        Assert.Equal(new DateOnly(2026, 11, 10), draft.StartDate);
        Assert.Equal(new TimeOnly(17, 15), draft.StartTime);
        Assert.Equal(new DateOnly(2026, 11, 10), draft.EndDate);
        Assert.Equal(new TimeOnly(18, 15), draft.EndTime);
        Assert.StartsWith("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270602T", draft.Recurrence);
        Assert.Equal(FamilyCalendar.Id, draft.CalendarId);
        Assert.Equal([Nora.Id], draft.MemberIds);
        Assert.Empty(draft.Unclear);
    }

    [Fact]
    public void A_rule_the_screens_cannot_show_is_dropped()
    {
        var draft = Check(Output(recurrence: "RRULE:FREQ=HOURLY"));

        Assert.Null(draft.Recurrence);
        Assert.Contains("repeat", draft.Unclear);
    }

    [Fact]
    public void A_weekly_rule_starts_on_one_of_its_weekdays()
    {
        // The model gave Monday the 9th for "every Tuesday".
        var draft = Check(Output(startDate: "2026-11-09", recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU"));

        Assert.Equal(new DateOnly(2026, 11, 10), draft.StartDate);
        Assert.Equal(new DateOnly(2026, 11, 10), draft.EndDate);
        Assert.Contains("day", draft.Unclear);
    }

    [Fact]
    public void An_until_before_the_start_is_dropped() =>
        Assert.Equal("RRULE:FREQ=DAILY", Check(Output(recurrence: "RRULE:FREQ=DAILY;UNTIL=20261101")).Recurrence);

    [Fact]
    public void Unknown_people_are_dropped()
    {
        var draft = Check(Output(people: ["m3", "m9", "Barnaby"]));

        // Milo alone: his own calendar, with no one else on it.
        Assert.Equal(MiloCalendar.Id, draft.CalendarId);
        Assert.Empty(draft.MemberIds);
        Assert.Contains("people", draft.Unclear);
    }

    [Fact]
    public void Several_people_go_on_the_family_calendar()
    {
        var draft = Check(Output(people: ["m3", "m4", "m3"]));

        Assert.Equal(FamilyCalendar.Id, draft.CalendarId);
        Assert.Equal([Milo.Id, Nora.Id], draft.MemberIds);
    }

    [Fact]
    public void A_weekday_that_does_not_match_the_date_is_flagged()
    {
        Assert.Contains("weekday", Check(Output(startDate: "2026-11-12", weekday: "Friday")).Unclear);
        Assert.DoesNotContain("weekday", Check(Output(startDate: "2026-11-13", weekday: "friday")).Unclear);
        Assert.DoesNotContain("weekday", Check(Output(weekday: "3")).Unclear);
    }

    [Fact]
    public void A_time_the_clocks_skip_moves_past_the_gap()
    {
        var draft = Check(Output(startDate: "2027-03-14", startTime: "02:30", endTime: "03:30"));

        Assert.Equal(new TimeOnly(3, 0), draft.StartTime);
        Assert.Equal(new TimeOnly(3, 30), draft.EndTime);
        Assert.Contains("time", draft.Unclear);
    }

    [Theory]
    [InlineData("2026-11-01")]
    [InlineData("2028-01-01")]
    [InlineData("next week")]
    [InlineData(null)]
    public void A_day_in_the_past_too_far_ahead_or_unreadable_becomes_today(string? day)
    {
        var draft = Check(Output(startDate: day));

        Assert.Equal(Today, draft.StartDate);
        Assert.Contains("day", draft.Unclear);
    }

    [Fact]
    public void Yesterday_is_still_allowed() =>
        Assert.Equal(Today.AddDays(-1), Check(Output(startDate: "2026-11-03")).StartDate);

    [Fact]
    public void A_day_past_the_synced_days_becomes_today() =>
        Assert.Equal(Today, Check(Output(startDate: "2027-01-10"), Context(syncedTo: new DateOnly(2027, 1, 1))).StartDate);

    [Fact]
    public void An_end_before_the_start_becomes_an_hour_after()
    {
        var draft = Check(Output(startTime: "15:00", endTime: "14:00", endDate: "2026-11-10"));

        Assert.Equal(new TimeOnly(16, 0), draft.EndTime);
        Assert.Contains("end", draft.Unclear);
    }

    [Fact]
    public void A_missing_end_is_an_hour_without_a_hint()
    {
        var draft = Check(Output(endTime: null));

        Assert.Equal(new TimeOnly(18, 15), draft.EndTime);
        Assert.DoesNotContain("end", draft.Unclear);
    }

    [Fact]
    public void An_evening_that_runs_past_midnight_ends_the_next_day()
    {
        var draft = Check(Output(startTime: "22:00", endTime: "01:00"));

        Assert.Equal(new DateOnly(2026, 11, 11), draft.EndDate);
        Assert.Equal(new TimeOnly(1, 0), draft.EndTime);
    }

    [Fact]
    public void A_missing_time_starts_at_nine()
    {
        var draft = Check(Output(startTime: null, endTime: null));

        Assert.Equal(DraftChecks.DefaultStart, draft.StartTime);
        Assert.Equal(new TimeOnly(10, 0), draft.EndTime);
        Assert.Contains("time", draft.Unclear);
    }

    [Fact]
    public void An_all_day_event_has_no_times_and_an_exclusive_end()
    {
        var one = Check(Output(allDay: true, startTime: "10:00", endDate: null));
        Assert.Null(one.StartTime);
        Assert.Null(one.EndTime);
        Assert.Equal(new DateOnly(2026, 11, 11), one.EndDate);

        Assert.Equal(new DateOnly(2026, 11, 13), Check(Output(allDay: true, endDate: "2026-11-13")).EndDate);
        Assert.Equal(new DateOnly(2026, 11, 11), Check(Output(allDay: true, endDate: "2026-11-10")).EndDate);
    }

    [Fact]
    public void No_answer_at_all_keeps_the_words_as_the_title()
    {
        var draft = Check(null);

        Assert.Equal("the words", draft.Title);
        Assert.Null(draft.Location);
        Assert.Equal(Today, draft.StartDate);
        Assert.Equal(["title", "day", "time"], draft.Unclear);
        Assert.Equal(FamilyCalendar.Id, draft.CalendarId);
    }

    [Fact]
    public void Long_titles_and_places_are_cut()
    {
        var draft = Check(Output(title: new string('t', 500), location: " " + new string('p', 500)));

        Assert.Equal(DraftChecks.MaxTitle, draft.Title.Length);
        Assert.Equal(DraftChecks.MaxLocation, draft.Location!.Length);
    }

    [Fact]
    public void Without_a_family_calendar_it_takes_the_first_that_takes_new_events()
    {
        Assert.Equal(ClaraCalendar.Id, DraftChecks.Calendar([], [School, ClaraCalendar, MiloCalendar])!.Id);
        Assert.Null(DraftChecks.Calendar([], [School]));
    }
}
