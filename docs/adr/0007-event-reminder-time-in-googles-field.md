# 0007. An event's own reminder time lives in Google's reminders field

**Status:** Accepted, November 2026

## Context

[0006](0006-reminders-by-web-push.md) gives each phone one lead time. Some events want their own ("an hour before the soccer game", none for a standing lunch). Google events already carry a reminders field, `{useDefault, overrides: [{method, minutes}]}`, and Google Calendar has its own notifications, so a family using both could be reminded twice.

The options were Google's reminders field, or a hidden extended property of Wheelhouse's own, as the event's people are kept (`wheelhouseMembers`).

## Decision

The time is kept in Google's reminders field, read into `EventInstance.Remind` ([`EventReminders`](../../src/Wheelhouse.Api/Calendar/EventReminders.cs)): `useDefault` means each phone's own lead, no overrides means no reminder, otherwise the shortest pop-up's minutes before the start. Wheelhouse writes the field only when the time is changed in an editor.

Google keeps an event's reminders per person: the field is the shared family account's, and each parent's own Google account uses the notification setting it has for the subscribed calendar, whatever the event says. So which field Wheelhouse uses does not decide whether a parent is told twice; their Google Calendar notifications do. A hidden property would only help a phone signed in to the shared account in Google Calendar, which the family does not need.

## Consequences

- A time set in Google Calendar on the shared account carries over, and one set in Wheelhouse shows there, so Google stays the one source of truth ([0001](0001-google-calendar-is-the-source-of-truth.md)).
- To be reminded once, a family picks Wheelhouse and sets notifications for the family calendars to none in each parent's Google Calendar. Reminders in Settings says so once a phone turns them on.
- Google allows several pop-ups per event; Wheelhouse keeps the shortest and shows any time it does not offer as its own choice, so an edit never loses it unasked.
