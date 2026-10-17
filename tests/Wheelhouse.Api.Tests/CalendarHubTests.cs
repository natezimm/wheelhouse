using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Threading.Channels;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

/// <summary>Real SignalR clients over TestServer WebSockets, against the shared PostgreSQL.</summary>
[Collection(ApiCollection.Name)]
public sealed class CalendarHubTests(ApiFactory factory)
{
    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", true, "Alex", "Alex Rivera");
    private static readonly DateOnly Day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3);

    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    private static async Task<CalendarResponse> CalendarOf(HttpClient client) =>
        (await client.GetFromJsonAsync<CalendarResponse>($"/api/calendar?from={Day:yyyy-MM-dd}&to={Day.AddDays(1):yyyy-MM-dd}", ApiFactory.Json))!;

    private static Task Publish(WebApplicationFactory<Program> host) => host.Services.GetRequiredService<CalendarConnections>().PublishAsync();

    private static string Cookie(WebApplicationFactory<Program> host, ClaimsPrincipal user, DateTimeOffset? expires = null)
    {
        var options = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var ticket = new AuthenticationTicket(user,
            new AuthenticationProperties { ExpiresUtc = expires ?? DateTimeOffset.UtcNow.AddMinutes(10) },
            CookieAuthenticationDefaults.AuthenticationScheme);
        return $"wheelhouse={options.TicketDataFormat.Protect(ticket)}";
    }

    private static async Task<EventResponse> Add(HttpClient client, string title)
    {
        var calendar = await CalendarOf(client);
        var request = new EventRequest(calendar.Calendars[0].Id, title, null, true, Day, null, Day.AddDays(1), null);
        var response = await client.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
    }

    private async Task<DeviceResponse> Pair(HttpClient parent, HttpClient wall)
    {
        var code = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>(ApiFactory.Json))!;
        var paired = await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(code.Code, "Kitchen"), ApiFactory.Json);
        paired.EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{code.Id}/finish", null)).EnsureSuccessStatusCode();
        return (await paired.Content.ReadFromJsonAsync<DeviceResponse>(ApiFactory.Json))!;
    }

    [Fact]
    public async Task Negotiation_needs_a_cookie_and_browser_origins_must_match_the_site()
    {
        using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.PostAsync("/hubs/calendar/negotiate?negotiateVersion=1", null)).StatusCode);
        using var parent = await factory.DemoVisitorAsync();
        foreach (var origin in new[] { "https://unrelated.example", "null", "http://localhost.evil.example", "http://localhost/path" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/calendar/negotiate?negotiateVersion=1");
            request.Headers.TryAddWithoutValidation("Origin", origin);
            Assert.Equal(HttpStatusCode.Forbidden, (await parent.SendAsync(request)).StatusCode);
        }

        using var same = new HttpRequestMessage(HttpMethod.Post, "/hubs/calendar/negotiate?negotiateVersion=1");
        same.Headers.Add("Origin", "http://localhost");
        Assert.Equal(HttpStatusCode.OK, (await parent.SendAsync(same)).StatusCode);
        using var forwarded = new HttpRequestMessage(HttpMethod.Post, "/hubs/calendar/negotiate?negotiateVersion=1");
        forwarded.Headers.Add("Origin", "https://localhost");
        forwarded.Headers.Add("X-Forwarded-Proto", "https");
        Assert.Equal(HttpStatusCode.OK, (await parent.SendAsync(forwarded)).StatusCode);
    }

    [Fact]
    public async Task A_phone_and_paired_wall_receive_only_their_familys_committed_changes()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        using var wall = factory.Demo.CreateClient();
        var family = await FamilyOf(parent);
        var otherFamily = await FamilyOf(other);
        var device = await Pair(parent, wall);
        var before = (await CalendarOf(parent)).ChangeNumber;
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)),
            $"?familyId={otherFamily.Id}");
        await using var display = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)));
        await using var outsider = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(otherFamily.Id)));
        Assert.Equal(before, (await phone.Next()).ChangeNumber);
        Assert.Equal(before, (await display.Next()).ChangeNumber);
        await outsider.Next();

        await Assert.ThrowsAsync<HubException>(() => phone.Connection.InvokeAsync("JoinFamily", otherFamily.Id));
        await Add(parent, "Added from the phone");
        await Publish(factory.Demo);
        Assert.Equal(before + 1, (await phone.Next()).ChangeNumber);
        Assert.Equal(before + 1, (await display.Next()).ChangeNumber);
        await outsider.Quiet();

        var added = await Add(wall, "Added from the wall");
        await Publish(factory.Demo);
        Assert.Equal(before + 2, (await phone.Next()).ChangeNumber);
        Assert.Equal(before + 2, (await display.Next()).ChangeNumber);
        Assert.Contains((await CalendarOf(parent)).Events, e => e.Id == added.Id);
        await Publish(factory.Demo);
        await phone.Quiet();
        await display.Quiet();
        await outsider.Quiet();
    }

    [Fact]
    public async Task Uncommitted_changes_and_rollbacks_are_not_published()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        var before = (await CalendarOf(parent)).ChangeNumber;
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await phone.Next();
        await using (var db = factory.DbContextFor(family.Id))
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            (await db.EventInstances.FirstAsync()).Title = "Never committed";
            await db.SaveChangesAsync();
            await Publish(factory.Demo);
            await phone.Quiet();
            await transaction.RollbackAsync();
        }

        await Publish(factory.Demo);
        await phone.Quiet();
        await using (var db = factory.DbContextFor(family.Id))
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            (await db.EventInstances.FirstAsync()).Title = "Committed by another context";
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }

        await Publish(factory.Demo);
        Assert.Equal(before + 1, (await phone.Next()).ChangeNumber);
    }

    [Fact]
    public async Task A_reconnected_client_gets_the_latest_number_after_missing_changes()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        var cookie = Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id));
        var before = (await CalendarOf(parent)).ChangeNumber;
        await using (var phone = await Observer.Connect(factory.Demo, cookie))
        {
            Assert.Equal(before, (await phone.Next()).ChangeNumber);
        }

        await Add(parent, "Missed one");
        await Add(parent, "Missed two");
        await Add(parent, "Missed three");
        // A new host also proves that recovery does not rely on an in-memory event log.
        await using var restarted = factory.InMode(InstanceMode.Demo);
        await using var reconnected = await Observer.Connect(restarted, Cookie(restarted, WheelhousePrincipal.Parent(family.Id)));
        Assert.Equal(before + 3, (await reconnected.Next()).ChangeNumber);
        await Publish(restarted);
        await reconnected.Quiet();
    }

    [Fact]
    public async Task Signing_out_closes_existing_sockets_for_that_identity()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        await using var first = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await using var second = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await first.Next();
        await second.Next();

        (await parent.PostAsync("/api/auth/sign-out", null)).EnsureSuccessStatusCode();
        await first.Closed.WaitAsync(TimeSpan.FromSeconds(10));
        await second.Closed.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Removing_a_display_closes_its_existing_socket_and_refuses_reconnection()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var wall = factory.Demo.CreateClient();
        var family = await FamilyOf(parent);
        var device = await Pair(parent, wall);
        await using var display = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)));
        await display.Next();

        (await parent.DeleteAsync($"/api/devices/{device.Id}")).EnsureSuccessStatusCode();
        await display.Closed.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(HttpStatusCode.Unauthorized, (await wall.PostAsync("/hubs/calendar/negotiate?negotiateVersion=1", null)).StatusCode);
        await Publish(factory.Demo);
        await display.Quiet();
    }

    [Fact]
    public async Task Pairing_an_existing_demo_wall_closes_its_old_family_subscription()
    {
        using var phone = await factory.DemoVisitorAsync();
        using var wall = await factory.DemoVisitorAsync();
        var oldFamily = await FamilyOf(wall);
        await using var oldSubscription = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(oldFamily.Id)));
        await oldSubscription.Next();

        var device = await Pair(phone, wall);
        await oldSubscription.Closed.WaitAsync(TimeSpan.FromSeconds(10));
        var newFamily = await FamilyOf(wall);
        Assert.Equal((await FamilyOf(phone)).Id, newFamily.Id);
        Assert.NotEqual(oldFamily.Id, newFamily.Id);
        await using var newSubscription = await Observer.Connect(factory.Demo,
            Cookie(factory.Demo, WheelhousePrincipal.Device(newFamily.Id, device.Id)));
        var before = (await newSubscription.Next()).ChangeNumber;
        await Add(phone, "Now shared with the phone");
        await Publish(factory.Demo);
        Assert.Equal(before + 1, (await newSubscription.Next()).ChangeNumber);
    }

    [Fact]
    public async Task An_expired_demo_copy_loses_its_subscription_before_cleanup_deletes_it()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await phone.Next();
        await using var db = factory.DbContextFor(family.Id);
        await db.Families.ExecuteUpdateAsync(set => set.SetProperty(f => f.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        await Publish(factory.Demo);
        await phone.Closed.WaitAsync(TimeSpan.FromSeconds(10));
        await phone.Quiet();
    }

    [Theory]
    [InlineData("account")]
    [InlineData("role")]
    [InlineData("allowlist")]
    public async Task A_private_parent_is_revalidated_even_without_a_calendar_change(string revoke)
    {
        await using var family = await GoogleFamily.StartAsync(factory, Alex);
        var cookie = family.Parent.DefaultRequestHeaders.GetValues("Cookie").Single();
        await using var phone = await Observer.Connect(family.WithFake, cookie);
        var before = (await phone.Next()).ChangeNumber;
        if (revoke == "allowlist")
        {
            family.WithFake.Services.GetRequiredService<IOptionsMonitor<InstanceOptions>>().CurrentValue.ParentEmails = "";
        }
        else
        {
            await using var scope = family.WithFake.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
            if (revoke == "account")
            {
                await db.UserAccounts.IgnoreQueryFilters().ExecuteDeleteAsync();
            }
            else
            {
                await db.Members.IgnoreQueryFilters().ExecuteUpdateAsync(set => set.SetProperty(m => m.Role, MemberRole.Kid));
            }
        }

        await Publish(family.WithFake);
        await phone.Closed.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(0, before);
        await phone.Quiet();
    }

    [Fact]
    public async Task Google_sync_and_reconnect_status_changes_reach_an_open_private_parent_socket()
    {
        await using var family = await GoogleFamily.StartAsync(factory, Alex);
        await GoogleFamily.ConnectAsync(family.Parent);
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest([new("alex-cal", null)]), ApiFactory.Json)).EnsureSuccessStatusCode();
        await using var phone = await Observer.Connect(family.WithFake, family.Parent.DefaultRequestHeaders.GetValues("Cookie").Single());
        var before = (await phone.Next()).ChangeNumber;
        family.Google.Put("alex-cal", new GoogleEvent("swim", null, "Swim", null, null, null, Day, Day.AddDays(1)));
        await family.SyncAsync();
        await Publish(family.WithFake);
        Assert.Equal(before + 1, (await phone.Next()).ChangeNumber);
        await family.SyncAsync();
        await Publish(family.WithFake);
        await phone.Quiet();

        family.Google.Revoked = true;
        await family.SyncAsync();
        await Publish(family.WithFake);
        Assert.Equal(before + 2, (await phone.Next()).ChangeNumber);
        Assert.True((await CalendarOf(family.Parent)).NeedsReconnect);
    }

    [Fact]
    public async Task The_background_publisher_delivers_changes_without_an_explicit_publish()
    {
        await using var host = factory.InMode(InstanceMode.Demo).WithWebHostBuilder(builder => builder.UseSetting("CalendarLive:Enabled", true));
        using var parent = host.CreateClient();
        (await parent.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        var family = await FamilyOf(parent);
        await using var phone = await Observer.Connect(host, Cookie(host, WheelhousePrincipal.Parent(family.Id)));
        var before = (await phone.Next()).ChangeNumber;
        await Add(parent, "Pushed by the worker");
        Assert.Equal(before + 1, (await phone.Next()).ChangeNumber);
    }

    private sealed class Observer : IAsyncDisposable
    {
        private readonly Channel<CalendarChanged> _changes = Channel.CreateUnbounded<CalendarChanged>();
        private readonly TaskCompletionSource _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public required HubConnection Connection { get; init; }
        public Task Closed => _closed.Task;

        public static async Task<Observer> Connect(WebApplicationFactory<Program> host, string cookie, string query = "")
        {
            var connection = new HubConnectionBuilder().WithUrl($"http://localhost/hubs/calendar{query}", options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.WebSocketFactory = async (context, cancellationToken) =>
                {
                    var socket = host.Server.CreateWebSocketClient();
                    socket.ConfigureRequest = request => request.Headers.Cookie = cookie;
                    return await socket.ConnectAsync(context.Uri, cancellationToken);
                };
            }).Build();
            var observer = new Observer { Connection = connection };
            connection.On<CalendarChanged>("CalendarChanged", change => observer._changes.Writer.TryWrite(change));
            connection.Closed += _ => { observer._closed.TrySetResult(); return Task.CompletedTask; };
            await connection.StartAsync();
            return observer;
        }

        public Task<CalendarChanged> Next() => _changes.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));

        public async Task Quiet()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _changes.Reader.ReadAsync(timeout.Token).AsTask());
        }

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }
}
