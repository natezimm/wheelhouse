# Live Google check

The API tests talk to a fake Google (`FakeGoogle`, and a stand-in for Google's HTTP endpoints in
`GoogleCalendarApiTests`). Those fakes are only as right as what we assumed about Google. The live
check runs the real client (`GoogleCalendarApi`) against a real calendar, so a change on Google's
side, or a wrong assumption, shows up as a red run here instead of on a family's wall.

`LiveGoogleTests` covers what the screens rely on:

- notes (HTML kept as sent), the hidden people tag and private visibility survive a read and a patch that does not name them, and can be cleared;
- a stale etag is refused with 412 for a change and a delete;
- an all-day event's exclusive end, and a change from all-day to timed;
- a repeat rule with an interval and a count expands to the right days at the same wall-clock time; "this and following" ends a series with `UNTIL` and starts a new one; one occurrence can move or be deleted alone;
- a sync token reports no change, then a change after an insert and a delete;
- a create retried with the same explicit id returns the first event instead of a second copy.

The tests only touch events whose titles start with `Wheelhouse live check`, three to nine weeks
ahead, and delete them afterwards; a failed run's leftovers are deleted by the next run.

## Running it

The workflow `.github/workflows/live-google.yml` runs on demand from the Actions tab (**Live Google
check**, **Run workflow**), for example before a release that changes how events are read or
written. It has no schedule yet, so it does not fail every night while its four secrets are unset.
Once they are set, add a schedule to run it nightly:

```yaml
on:
  schedule:
    - cron: '17 9 * * *'
  workflow_dispatch:
```

A run fails until its four secrets are set.

Locally, set the same four variables and run:

```sh
dotnet test --filter "Category=LiveGoogle"
```

Without them the tests are skipped, so `dotnet test` and pull requests never call Google.

## Setting it up

Use a Google account made for this, never a family's.

1. Create a Google account for testing, sign in to Google Calendar with it, and add a calendar
   named, say, "Wheelhouse live check". In the calendar's settings, copy its **Calendar ID**
   (it ends in `@group.calendar.google.com`).
2. In the Google Cloud project that has the Calendar API enabled, open **APIs & Services >
   Credentials** and create an OAuth client of type **Web application** with
   `https://developers.google.com/oauthplayground` as an authorized redirect URI. A separate client
   keeps the family's sign-in client unchanged.
3. The OAuth consent screen must be **In production**. In Testing, Google expires refresh tokens
   after seven days and the check would start failing a week later. If it must stay in Testing,
   add the test account as a test user and expect to repeat step 4 weekly.
4. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), choose the gear,
   tick **Use your own OAuth credentials** and enter the client id and secret. Authorize the scope
   `https://www.googleapis.com/auth/calendar` signed in as the test account, then **Exchange
   authorization code for tokens** and copy the refresh token.
5. In the repository's **Settings > Secrets and variables > Actions**, add:

   | Secret | Value |
   | --- | --- |
   | `LIVE_GOOGLE_CLIENT_ID` | the client id from step 2 |
   | `LIVE_GOOGLE_CLIENT_SECRET` | its secret |
   | `LIVE_GOOGLE_REFRESH_TOKEN` | the refresh token from step 4 |
   | `LIVE_GOOGLE_CALENDAR_ID` | the calendar id from step 1 |

6. Run **Live Google check** from the Actions tab once to see it pass.
7. To run it nightly, add the schedule shown above. GitHub emails the person who last changed the
   workflow's schedule when a scheduled run fails.

## When it fails

Read which assertion failed before changing code. If Google changed, fix `GoogleCalendarApi`
and update `FakeGoogle` and `GoogleCalendarApiTests` to match, so the everyday tests learn the new
behavior too. A `GoogleGrantRevokedException` (Google's `invalid_grant`) means the refresh token was
revoked or expired: repeat step 4 and replace `LIVE_GOOGLE_REFRESH_TOKEN`.
