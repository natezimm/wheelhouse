# Calendar parity checklist

A manual pass to run before a release that touches the calendar, and after anything changes how
events are read or written. It compares Wheelhouse with Google Calendar on the same account, since
Google is the source of truth, and with what a family expects from a wall calendar such as Skylight.
The automated tests check our own logic and the [live Google check](live-google-check.md) checks
the Google client; this checklist checks that the whole thing behaves the way people expect.

Use a family instance connected to a test Google account (never a family's), with Google Calendar
open in a browser beside the wall at http://…/wall and a phone at `/`. Each line passes when both
sides agree within a sync (two minutes, or at once for a change made in Wheelhouse).

## Reading

- [ ] A timed event made in Google appears at the same time on the wall, the desktop and the phone.
- [ ] An all-day event, and one spanning three days, show as bars in the all-day lane on the right days.
- [ ] An event crossing midnight shows on both days with the right times.
- [ ] An event made in another time zone shows at the family's time.
- [ ] The week of a clock change (March and November) shows events at their wall-clock times.
- [ ] A weekly event with one occurrence moved and one deleted in Google shows exactly that.
- [ ] Notes with links, bold text and line breaks in Google read as plain text in details.
- [ ] The repeat rule in details matches Google's wording in meaning (for example, "Every 2 weeks on Tuesday, 4 times").
- [ ] An event marked private in Google shows as Busy on the wall, and with its title on a parent's phone.
- [ ] Months beyond the sync window (more than 180 days ahead, more than 30 back) say so rather than looking empty.
- [ ] Three or more overlapping events stay readable on Week and Day, with the rest counted in "+N".
- [ ] Deleting a calendar's sharing with the account removes its events after the next sync.

## Writing from Wheelhouse

- [ ] Adding an event on the wall shows in Google within seconds, at the same time and on the right calendar.
- [ ] Editing title, place, time and notes shows in Google; notes written in Google with formatting stay untouched by a drag.
- [ ] Dragging an event on Week to another day and time matches in Google.
- [ ] Choosing a second person for an event shows them on both people's days, and the event in Google is otherwise unchanged.
- [ ] Making an event private on the phone hides it on the wall and sets it to Private in Google.
- [ ] A new repeating event (every 2 weeks, ending after 4) has the same occurrences in Google.
- [ ] "This event" on one occurrence changes only that one in Google.
- [ ] "This and following" ends the old series and starts a new one in Google from that day, keeping earlier occurrences.
- [ ] "All events" changes every occurrence in Google and keeps each on its own day.
- [ ] Undo after a delete or a move puts the event back in Google as it was.
- [ ] Editing an event on the phone while it was changed in Google shows Google's version instead of overwriting it.
- [ ] Turning off the network mid-save offers Check save, and checking does not create a duplicate in Google.

## Behaving like a family calendar

- [ ] Every button on the wall is easy to hit with a finger (at least 56 px), and on the phone at least 44 px.
- [ ] A tap opens details first; editing needs a second tap.
- [ ] The wall shows the current time, today's weather and the whole working day without scrolling.
- [ ] A change made on the phone appears on the wall within a few seconds, without touching the wall.
- [ ] Unplugging the wall's network shows Reconnecting, and plugging it back in catches up on its own.
- [ ] Each person's color is the same on the wall, the phone and in every theme, light and dark.
- [ ] Night mode switches at the family's hours and the wall stays readable from across the room.
- [ ] Typing an event's title on the wall works with the device's on-screen keyboard.
