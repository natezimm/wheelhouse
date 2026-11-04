namespace Wheelhouse.Api.Calendar;

/// <summary>
/// When the phones are reminded of an event (<see cref="EventInstance.Remind"/>), kept in Google as
/// the event's own reminders, so a change in Google Calendar reaches the phones and one made here
/// shows there: Google's default means each phone's own lead time, no reminders means none, and a
/// pop-up reminder is the minutes before it starts.
/// </summary>
public static class EventReminders
{
    /// <summary>Each phone's own lead time, as the phone chose in Settings; Google's default.</summary>
    public const int PhoneSetting = 0;

    /// <summary>No reminder for this event on any phone.</summary>
    public const int None = -1;

    /// <summary>The longest lead Google allows, four weeks.</summary>
    public const int MaxMinutes = 40320;

    /// <summary>Whether a screen may set <paramref name="remind"/>.</summary>
    public static bool IsValid(int remind) => remind is PhoneSetting or None or (> 0 and <= MaxMinutes);

    /// <summary>
    /// Google's reminders as a lead: the default as the phone's setting, none as none, and the
    /// soonest pop-up as its minutes, since that one is the reminder to leave. A pop-up at the start
    /// itself, or only e-mails, count as none, as no phone reminder can come with no lead.
    /// </summary>
    public static int FromGoogle(bool? useDefault, IEnumerable<(string? Method, int Minutes)>? overrides)
    {
        if (useDefault is not false)
        {
            return PhoneSetting;
        }

        var popups = (overrides ?? []).Where(o => o.Method == "popup" && o.Minutes > 0).Select(o => o.Minutes).ToList();
        return popups.Count > 0 ? popups.Min() : None;
    }

    /// <summary>The reminders Google is sent for <paramref name="remind"/>.</summary>
    public static Dictionary<string, object> ToGoogle(int remind) => remind switch
    {
        PhoneSetting => new() { ["useDefault"] = true },
        None => new() { ["useDefault"] = false, ["overrides"] = Array.Empty<object>() },
        _ => new() { ["useDefault"] = false, ["overrides"] = new[] { new Dictionary<string, object> { ["method"] = "popup", ["minutes"] = remind } } },
    };
}
