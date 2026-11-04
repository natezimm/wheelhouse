using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Reminders;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ReminderTests(ApiFactory factory)
{
    [Fact]
    public async Task A_browser_is_reminded_once_before_an_event_with_a_message_only_it_can_read()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();
        var family = await FamilyOf(visitor);
        var clara = family.Members.Single(m => m.DisplayName == "Clara").Id;

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(15, [clara]), ApiFactory.Json)).EnsureSuccessStatusCode();
        var startsAt = await AddEventAsync(family.Id, "Clara", "Reminder dentist", TimeSpan.FromMinutes(10), location: "Main St");
        await AddEventAsync(family.Id, "Clara", "Reminder later", TimeSpan.FromMinutes(40));

        await SendDueAsync(host);
        await SendDueAsync(host);

        var request = Assert.Single(push.To(browser));
        var message = browser.Read(request.Body);
        Assert.Equal("Reminder dentist", message.GetProperty("title").GetString());
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        Assert.Equal($"In 10 min · {ReminderSender.ClockText(TimeZoneInfo.ConvertTime(startsAt, zone))} · Main St", message.GetProperty("body").GetString());
        Assert.StartsWith("/?day=", message.GetProperty("url").GetString());
        Assert.Equal("aes128gcm", request.ContentEncoding);
        Assert.Equal("1800", request.Ttl);

        // Signed with the key the browser subscribed with, for the push service's origin.
        var key = (await visitor.GetFromJsonAsync<PushKeyResponse>("/api/reminders/key", ApiFactory.Json))!.PublicKey;
        Assert.Equal(key, request.VapidKey);
        var claims = VerifiedClaims(request.VapidToken, key);
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
    }

    [Fact]
    public async Task Only_the_chosen_peoples_events_and_the_whole_familys_are_reminded()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();
        var family = await FamilyOf(visitor);
        var clara = family.Members.Single(m => m.DisplayName == "Clara").Id;

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(30, [clara]), ApiFactory.Json)).EnsureSuccessStatusCode();
        await AddEventAsync(family.Id, "Clara", "Reminder Clara's", TimeSpan.FromMinutes(20));
        await AddEventAsync(family.Id, "Julian", "Reminder Julian's", TimeSpan.FromMinutes(20));
        await AddEventAsync(family.Id, "Julian", "Reminder Julian's with Clara", TimeSpan.FromMinutes(20), memberIds: [clara]);
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder everyone's", TimeSpan.FromMinutes(20));

        await SendDueAsync(host);

        var titles = push.To(browser).Select(r => browser.Read(r.Body).GetProperty("title").GetString()).Where(t => t!.StartsWith("Reminder"));
        Assert.Equal(["Reminder Clara's", "Reminder everyone's", "Reminder Julian's with Clara"], titles.Order(StringComparer.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task An_event_moved_to_another_time_is_reminded_again_and_a_longer_lead_reaches_further()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();
        var family = await FamilyOf(visitor);

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(10, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder moved", TimeSpan.FromMinutes(5));
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder far", TimeSpan.FromMinutes(50));
        await SendDueAsync(host);

        await using (var db = factory.DbContextFor(family.Id))
        {
            var moved = await db.EventInstances.SingleAsync(e => e.Title == "Reminder moved");
            moved.StartsAt = moved.StartsAt!.Value.AddMinutes(2);
            moved.EndsAt = moved.EndsAt!.Value.AddMinutes(2);
            await db.SaveChangesAsync();
        }

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(60, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        await SendDueAsync(host);

        var titles = push.To(browser).Select(r => browser.Read(r.Body).GetProperty("title").GetString()).Where(t => t!.StartsWith("Reminder"));
        Assert.Equal(2, titles.Count(t => t == "Reminder moved"));
        Assert.Equal(1, titles.Count(t => t == "Reminder far"));
    }

    [Fact]
    public async Task An_events_own_reminder_time_wins_over_the_phones_and_can_turn_its_reminder_off()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();
        var family = await FamilyOf(visitor);

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(10, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder plain", TimeSpan.FromMinutes(5));
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder an hour early", TimeSpan.FromMinutes(50), remind: 60);
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder a day early", TimeSpan.FromHours(24) - TimeSpan.FromSeconds(15), remind: 1440);
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder late", TimeSpan.FromMinutes(8), remind: 5);
        await AddEventAsync(family.Id, "Marlowe Household", "Reminder never", TimeSpan.FromMinutes(5), remind: EventReminders.None);

        await SendDueAsync(host);

        var sent = push.To(browser).Select(r => browser.Read(r.Body)).Where(m => m.GetProperty("title").GetString()!.StartsWith("Reminder"))
            .ToDictionary(m => m.GetProperty("title").GetString()!, m => m.GetProperty("body").GetString()!);
        Assert.Equal(["Reminder a day early", "Reminder an hour early", "Reminder plain"], sent.Keys.Order(StringComparer.Ordinal));
        Assert.StartsWith("In 1 day · ", sent["Reminder a day early"]);
        Assert.StartsWith("In 50 min · ", sent["Reminder an hour early"]);
    }

    [Fact]
    public async Task A_browser_its_push_service_no_longer_has_is_forgotten()
    {
        var push = new FakePushService { Answer = HttpStatusCode.Gone };
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();

        (await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(15, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await visitor.PostAsJsonAsync("/api/reminders/current", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await visitor.PostAsJsonAsync("/api/reminders/test", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
        Assert.Single(push.To(browser));
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.PostAsJsonAsync("/api/reminders/current", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
    }

    [Fact]
    public async Task A_test_reminder_goes_out_on_request_and_turning_reminders_off_forgets_the_browser()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var visitor = await VisitorAsync(host);
        var browser = new FakeBrowser();

        var saved = await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(30, [Guid.NewGuid()]), ApiFactory.Json);
        var settings = (await saved.Content.ReadFromJsonAsync<ReminderResponse>(ApiFactory.Json))!;
        Assert.Equal(30, settings.LeadMinutes);
        // Someone not in the family is left out.
        Assert.Empty(settings.MemberIds);

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.PostAsJsonAsync("/api/reminders/test", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
        Assert.Equal("Reminders are on", browser.Read(Assert.Single(push.To(browser)).Body).GetProperty("title").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.PostAsJsonAsync("/api/reminders/remove", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.PostAsJsonAsync("/api/reminders/current", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
    }

    [Fact]
    public async Task A_browser_moving_to_another_family_takes_its_subscription_with_it()
    {
        var push = new FakePushService();
        await using var host = HostWith(push);
        using var first = await VisitorAsync(host);
        using var second = await VisitorAsync(host);
        var browser = new FakeBrowser();

        (await first.PutAsJsonAsync("/api/reminders", browser.Subscribe(15, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        (await second.PutAsJsonAsync("/api/reminders", browser.Subscribe(5, []), ApiFactory.Json)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await first.PostAsJsonAsync("/api/reminders/current", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await second.PostAsJsonAsync("/api/reminders/current", new ReminderEndpointRequest(browser.Endpoint), ApiFactory.Json)).StatusCode);
    }

    [Fact]
    public async Task A_parent_who_loses_access_is_no_longer_reminded()
    {
        var push = new FakePushService();
        using var instance = factory.NewFamilyInstance("alex@example.com, sam@example.com");
        await using var host = instance.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddHttpClient<WebPush>().ConfigurePrimaryHttpMessageHandler(() => push)));
        using var alex = await ApiFactory.ParentAsync(host, new GoogleIdentity("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera"));
        using var sam = await ApiFactory.ParentAsync(host, new GoogleIdentity("google-sam", "sam@example.com", EmailVerified: true, "Sam", "Sam Rivera"));
        var alexBrowser = new FakeBrowser();
        var samBrowser = new FakeBrowser();
        (await alex.PutAsJsonAsync("/api/reminders", alexBrowser.Subscribe(15, []), ApiFactory.Json)).EnsureSuccessStatusCode();
        (await sam.PutAsJsonAsync("/api/reminders", samBrowser.Subscribe(15, []), ApiFactory.Json)).EnsureSuccessStatusCode();

        var family = await FamilyOf(sam);
        var alexMember = family.Members.Single(m => m.DisplayName == "Alex");
        (await sam.PutAsJsonAsync($"/api/family/members/{alexMember.Id}", new MemberRequest("Alex", alexMember.Color, MemberRole.Kid), ApiFactory.Json))
            .EnsureSuccessStatusCode();
        await SendDueAsync(host);

        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
        var left = await db.ReminderSubscriptions.IgnoreQueryFilters().Select(s => s.Endpoint).ToListAsync();
        Assert.Equal([samBrowser.Endpoint], left);
    }

    [Theory]
    [InlineData("http://fcm.googleapis.com/fcm/send/x", "endpoint")]
    [InlineData("https://fcm.googleapis.com.evil.example/x", "endpoint")]
    [InlineData("https://169.254.169.254/latest", "endpoint")]
    [InlineData("https://fcm.googleapis.com:8443/x", "endpoint")]
    public async Task Pushes_go_only_to_the_browsers_push_services(string endpoint, string field)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var browser = new FakeBrowser();

        var response = await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(15, []) with { Endpoint = endpoint }, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys);
    }

    [Fact]
    public async Task Keys_that_are_not_a_point_on_the_curve_and_odd_leads_are_refused()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var browser = new FakeBrowser();
        var offCurve = WebPush.Encode([4, .. new byte[64]]);

        var response = await visitor.PutAsJsonAsync("/api/reminders", browser.Subscribe(7, []) with { P256dh = offCurve }, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys;
        Assert.Contains("keys", errors);
        Assert.Contains("leadMinutes", errors);
    }

    [Theory]
    [InlineData(1, "Starting now")]
    [InlineData(15, "In 15 min")]
    [InlineData(60, "In 1 hr")]
    [InlineData(90, "In 1 hr 30 min")]
    public void A_reminder_says_how_soon(int minutes, string soon)
    {
        var now = new DateTimeOffset(2026, 11, 4, 20, 0, 0, TimeSpan.Zero);
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

        var message = ReminderSender.Message(Guid.NewGuid(), " Swim ", null, now.AddMinutes(minutes), now, zone);

        Assert.Equal("Swim", message.Title);
        Assert.StartsWith($"{soon} · ", message.Body);
        Assert.Equal("3:15 pm", ReminderSender.ClockText(new DateTimeOffset(2026, 11, 4, 15, 15, 0, TimeSpan.FromHours(-5))));
        Assert.Equal("12 am", ReminderSender.ClockText(new DateTimeOffset(2026, 11, 4, 0, 0, 0, TimeSpan.Zero)));
    }

    private WebApplicationFactory<Program> HostWith(FakePushService push) =>
        factory.Demo.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddHttpClient<WebPush>().ConfigurePrimaryHttpMessageHandler(() => push)));

    private static async Task<HttpClient> VisitorAsync(WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        (await client.PostAsync("/api/demo/visit", content: null)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    private static async Task SendDueAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ReminderSender>().SendDueAsync(CancellationToken.None);
    }

    /// <summary>Adds a timed event to the calendar named <paramref name="calendar"/>, starting <paramref name="from"/> now.</summary>
    private async Task<DateTimeOffset> AddEventAsync(Guid familyId, string calendar, string title, TimeSpan from,
        string? location = null, List<Guid>? memberIds = null, int remind = EventReminders.PhoneSetting)
    {
        await using var db = factory.DbContextFor(familyId);
        var source = await db.CalendarSources.SingleAsync(s => s.Name == calendar);
        // Whole seconds, as Google keeps them.
        var now = DateTimeOffset.UtcNow;
        var startsAt = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.TicksPerSecond, TimeSpan.Zero) + from;
        db.EventInstances.Add(new EventInstance
        {
            Id = Guid.NewGuid(),
            FamilyId = familyId,
            CalendarSourceId = source.Id,
            GoogleEventId = Guid.NewGuid().ToString("N"),
            Title = title,
            Location = location,
            StartsAt = startsAt,
            EndsAt = startsAt.AddHours(1),
            MemberIds = memberIds ?? [],
            Remind = remind,
        });
        await db.SaveChangesAsync();
        return startsAt;
    }

    private static JsonElement VerifiedClaims(string token, string publicKey)
    {
        var parts = token.Split('.');
        var point = WebPush.Decode(publicKey);
        using var key = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = point[1..33], Y = point[33..65] },
        });
        Assert.True(key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), WebPush.Decode(parts[2]), HashAlgorithmName.SHA256));
        return JsonDocument.Parse(WebPush.Decode(parts[1])).RootElement;
    }

    private sealed record PushRequest(string Endpoint, byte[] Body, string? ContentEncoding, string? Ttl, string VapidToken, string VapidKey);

    /// <summary>Stands in for the browser makers' push services, keeping what was sent to them.</summary>
    private sealed class FakePushService : HttpMessageHandler
    {
        private readonly ConcurrentQueue<PushRequest> _requests = new();

        public HttpStatusCode Answer { get; init; } = HttpStatusCode.Created;

        public IEnumerable<PushRequest> To(FakeBrowser browser) => _requests.Where(r => r.Endpoint == browser.Endpoint);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var vapid = request.Headers.Authorization!.Parameter!.Split(", ").Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => p[1]);
            _requests.Enqueue(new PushRequest(
                request.RequestUri!.ToString(),
                await request.Content!.ReadAsByteArrayAsync(cancellationToken),
                request.Content.Headers.ContentEncoding.SingleOrDefault(),
                request.Headers.TryGetValues("TTL", out var ttl) ? ttl.Single() : null,
                vapid["t"],
                vapid["k"]));
            return new HttpResponseMessage(Answer);
        }
    }

    /// <summary>A browser's side of Web Push: its key pair and secret, and decrypting what arrives (RFC 8291).</summary>
    private sealed class FakeBrowser
    {
        private readonly ECDiffieHellman _key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        private readonly byte[] _auth = RandomNumberGenerator.GetBytes(16);

        public string Endpoint { get; } = $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";

        private byte[] PublicKey
        {
            get
            {
                var q = _key.ExportParameters(false).Q;
                return [4, .. q.X!, .. q.Y!];
            }
        }

        public ReminderRequest Subscribe(int lead, List<Guid> memberIds) =>
            new(Endpoint, WebPush.Encode(PublicKey), WebPush.Encode(_auth), lead, memberIds);

        public JsonElement Read(byte[] body)
        {
            var salt = body[..16];
            Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16, 4)));
            var idLength = body[20];
            var serverKey = body[21..(21 + idLength)];
            var record = body[(21 + idLength)..];

            using var server = ECDiffieHellman.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = serverKey[1..33], Y = serverKey[33..65] },
            });
            var shared = _key.DeriveRawSecretAgreement(server.PublicKey);
            byte[] info = [.. "WebPush: info\0"u8, .. PublicKey, .. serverKey];
            var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, _auth, info);
            var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
            var contentKey = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, "Content-Encoding: aes128gcm\0"u8.ToArray());
            var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, "Content-Encoding: nonce\0"u8.ToArray());

            var plaintext = new byte[record.Length - 16];
            using var aes = new AesGcm(contentKey, 16);
            aes.Decrypt(nonce, record[..^16], record[^16..], plaintext);
            Assert.Equal(2, plaintext[^1]);
            return JsonDocument.Parse(plaintext[..^1]).RootElement;
        }
    }
}
