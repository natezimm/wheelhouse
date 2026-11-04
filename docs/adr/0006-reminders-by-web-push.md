# 0006. Reminders by Web Push, with no third-party service

**Status:** Accepted, November 2026

## Context

A calendar on the kitchen wall only helps someone looking at it. Parents asked to be told on their phones before an event starts. Wheelhouse is a website, not an app in a store, and runs on one small server per family, set up by hand. Any reminder channel has to work without accounts at another company and without new secrets in an instance's `.env`.

The options were email, text messages, a push service such as Firebase Cloud Messaging used directly, or the standard Web Push protocol that browsers implement.

## Decision

Reminders use Web Push. A phone's browser subscribes with the browser maker's push service (Google's for Chrome and Android, Apple's for Safari, Mozilla's, Microsoft's) and gives the subscription to the API; the API sends each reminder there, encrypted for that browser (RFC 8291) and signed with the instance's VAPID key (RFC 8292).

- **No dependency.** The encryption and signing are about a hundred lines on .NET's own ECDH, HKDF, AES-GCM and ECDSA ([`WebPush`](../../src/Wheelhouse.Api/Reminders/WebPush.cs)). The tests decrypt what was sent with the browser's key, so the format is checked end to end.
- **Nothing to configure.** The VAPID key pair is made on first use and stored in the database, its private half encrypted with Data Protection like the Google token ([`VapidKeys`](../../src/Wheelhouse.Api/Reminders/VapidKeys.cs)). It survives releases and restores with the database and keys.
- **Per browser.** A subscription belongs to the browser, with its own lead time and people, so a demo visitor can try it and two phones of one parent can differ. A parent's subscriptions go with their account.
- **Only push services.** An endpoint must be on one of the browser makers' push hosts over HTTPS, so a signed-in visitor cannot make the server send requests elsewhere.
- **Once per event.** Sent reminders are kept by calendar, Google's event id and start, not the cache's row id, which a sync replaces.

## Consequences

- No accounts, keys or costs beyond the server, and the push service sees only ciphertext.
- An iPhone receives pushes only from a site added to its Home Screen, so the manifest asks to open `standalone`, and Settings tells an iPhone browser to add it first.
- A reminder can be up to the worker's 30-second interval late, and is lost if the phone is off for longer than the 30-minute time to live, which suits a reminder.
- All-day events are not reminded: they have no time to be early for. A morning summary could come later.
- Losing the database's VAPID key (or the Data Protection keys) means every phone has to turn reminders on again.
