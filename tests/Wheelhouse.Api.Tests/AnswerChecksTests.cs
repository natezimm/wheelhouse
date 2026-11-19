using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>How <see cref="AnswerChecks"/> holds Ask's sentence to the data it cites. No database, no model.</summary>
public sealed class AnswerChecksTests
{
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    // Wednesday, November 4, 2026; the slot is on Saturday the 7th.
    private static readonly DateOnly Today = new(2026, 11, 4);
    private static readonly DateOnly Saturday = new(2026, 11, 7);

    private static readonly DraftMember Clara = new("m1", Guid.NewGuid(), "Clara", MemberRole.Parent);
    private static readonly DraftMember Milo = new("m2", Guid.NewGuid(), "Milo", MemberRole.Kid);
    private static readonly DraftMember Nora = new("m3", Guid.NewGuid(), "Nora", MemberRole.Kid);

    private static readonly AskContext Context = new(
        Today, new TimeOnly(9, 0), NewYork, [Clara, Milo, Nora], 7, null, null, Today.AddDays(-90), Today.AddDays(400));

    private static DateTimeOffset At(int hour, int minute = 0, DateOnly? day = null) =>
        CalendarEndpoints.At(day ?? Saturday, new TimeOnly(hour, minute), NewYork);

    private static ShownSlot Slot(int fromHour, int fromMinute, int toHour, params Guid[] people) =>
        new("s1", new FreeSlot(At(fromHour, fromMinute), At(toHour)), people);

    private static ShownEvent Event(string title, int fromHour, int fromMinute, int toHour, int toMinute, DateOnly? day = null)
    {
        var start = At(fromHour, fromMinute, day);
        var end = At(toHour, toMinute, day);
        var e = new EventResponse(Guid.NewGuid(), Guid.NewGuid(), null, title, null, false, start, end, null, null, false);
        return new ShownEvent("e1", e, start, end, false);
    }

    private static CalendarTools Tools() => new(null!, Context);

    private static bool Fits(string sentence, ShownEvent[]? events = null, ShownSlot[]? slots = null) =>
        AnswerChecks.Fits(sentence, events ?? [], slots ?? [], Tools(), Context);

    [Theory]
    [InlineData("Everyone is free 1:30–4 pm on Saturday, Nov 7.")]
    [InlineData("You're all free from 1:30 to 4 p.m. on Saturday.")]
    [InlineData("Free 13:30-16:00, after soccer ends at 1:30 pm.")]
    [InlineData("Nov. 7 has a gap from 1:30 until 4pm.")]
    [InlineData("Soccer is 11 am–1:30 pm on Saturday, then everyone is free until 4.")]
    public void A_sentence_that_names_only_what_it_cites_is_kept(string sentence)
    {
        Assert.True(Fits(sentence, [Event("Soccer", 11, 0, 13, 30)], [Slot(13, 30, 16)]));
    }

    [Theory]
    [InlineData("Everyone is free 1:30–3 pm on Saturday.")]
    [InlineData("Everyone is free at noon.")]
    [InlineData("Soccer starts at 11 pm on Saturday.")]
    [InlineData("Everyone is free 1:30–4 am on Saturday.")]
    [InlineData("Everyone is free 1:30 to 4 a.m. on Saturday.")]
    [InlineData("Everyone is free 1:30–4 pm on Sunday.")]
    [InlineData("Everyone is free 1:30–4 pm on Nov 8.")]
    [InlineData("Everyone is free today from 1:30 to 4 pm.")]
    [InlineData("Everyone is free tomorrow.")]
    [InlineData("")]
    public void A_sentence_naming_anything_else_is_not(string sentence)
    {
        Assert.False(Fits(sentence, [Event("Soccer", 11, 0, 13, 30)], [Slot(13, 30, 16)]));
    }

    [Fact]
    public void Plain_numbers_are_not_times()
    {
        Assert.True(Fits("There are 3 events for the U10 team on Saturday.", [Event("Soccer", 11, 0, 13, 30)]));
    }

    [Fact]
    public void A_sentence_that_found_nothing_may_name_only_the_days_asked_about()
    {
        // No tool was asked about any day, so no weekday is one it looked at.
        Assert.False(Fits("Nothing on Wednesday."));
        Assert.True(Fits("Nothing on the calendar for that."));
    }

    [Fact]
    public void The_template_says_who_is_free_and_when()
    {
        Assert.Equal("Everyone is free 1:30–4 pm on Saturday, Nov 7.",
            AnswerChecks.Template("free", [], [Slot(13, 30, 16)], Context));
        Assert.Equal("Milo and Nora are free 11:30 am–1 pm on Saturday, Nov 7.",
            AnswerChecks.Template("free", [], [new ShownSlot("s1", new FreeSlot(At(11, 30), At(13)), [Milo.Id, Nora.Id])], Context));
        Assert.Equal("Nora is free 4–6 pm on Saturday, Nov 7.",
            AnswerChecks.Template("free", [], [Slot(16, 0, 18, Nora.Id)], Context));
    }

    [Fact]
    public void The_template_names_the_first_event()
    {
        Assert.Equal("Soccer is on Saturday, Nov 7 at 11 am.", AnswerChecks.Template("events", [Event("Soccer", 11, 0, 13, 30)], [], Context));
        Assert.Equal("2 events, starting with Soccer on Saturday, Nov 7 at 11 am.",
            AnswerChecks.Template("events", [Event("Soccer", 11, 0, 13, 30), Event("Swim", 16, 0, 17, 0)], [], Context));
        Assert.Equal(AnswerChecks.NoneSentence, AnswerChecks.Template("none", [], [], Context));
    }

    [Fact]
    public void Outside_the_window_names_the_last_synced_day_when_there_is_one()
    {
        Assert.Equal("That's further than the calendar reaches.", AnswerChecks.OutsideSentence(Context));
        Assert.Equal("That's past what's synced (through Dec 8).", AnswerChecks.OutsideSentence(Context with { SyncedTo = new DateOnly(2027, 12, 9) }));
    }

    [Fact]
    public void An_answer_with_no_kind_or_a_free_answer_with_no_slot_is_unknown()
    {
        Assert.Equal(AskKinds.Unknown, AnswerChecks.Check(null, Tools(), Context).Kind);
        Assert.Equal(AskKinds.Unknown, AnswerChecks.Check(new AskAnswerOutput("free", "Free all day!", [], []), Tools(), Context).Kind);
        var none = AnswerChecks.Check(new AskAnswerOutput("events", "Nothing.", [], []), Tools(), Context);
        Assert.Equal(AskKinds.None, none.Kind);
        Assert.Equal(7, none.ChangeNumber);
    }
}
