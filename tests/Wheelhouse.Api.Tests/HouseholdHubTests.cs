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
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Household;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class HouseholdHubTests(ApiFactory factory)
{
    private static string Cookie(WebApplicationFactory<Program> host, ClaimsPrincipal user)
    {
        var options = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var ticket = new AuthenticationTicket(user, new AuthenticationProperties
            { ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(10) }, CookieAuthenticationDefaults.AuthenticationScheme);
        return $"wheelhouse={options.TicketDataFormat.Protect(ticket)}";
    }
    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
    private static Task Publish(WebApplicationFactory<Program> host) => host.Services.GetRequiredService<HouseholdConnections>().PublishAsync();
    private static async Task Add(HttpClient client) => (await client.PostAsJsonAsync("/api/chores",
        new CreateChore(Guid.NewGuid(), "Live chore", null, null, new DateOnly(2026, 11, 1)))).EnsureSuccessStatusCode();

    [Fact]
    public async Task A_phone_and_wall_receive_only_committed_chores_for_their_own_family()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        var otherFamily = await FamilyOf(other);
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)), $"?familyId={otherFamily.Id}");
        var device = (await parent.GetFromJsonAsync<DeviceResponse[]>("/api/devices"))!.First();
        await using var wall = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)));
        await using var outsider = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(otherFamily.Id)));
        var before = await phone.Next();
        Assert.Equal("chores", before.Domain);
        await wall.Next(); await outsider.Next();
        await Assert.ThrowsAsync<HubException>(() => phone.Connection.InvokeAsync("JoinFamily", otherFamily.Id));
        await Add(parent); await Publish(factory.Demo);
        Assert.Equal(before.ChangeNumber + 1, (await phone.Next()).ChangeNumber);
        Assert.Equal(before.ChangeNumber + 1, (await wall.Next()).ChangeNumber);
        await outsider.Quiet();
        await using var db = factory.DbContextFor(family.Id);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var chore = await db.Chores.FirstAsync(); chore.Title = "Uncommitted";
            await db.SaveChangesAsync(); await Publish(factory.Demo); await phone.Quiet();
            await tx.RollbackAsync();
        }
        await Publish(factory.Demo); await phone.Quiet();
    }

    [Fact]
    public async Task Household_negotiation_requires_authentication_and_a_same_site_browser_origin()
    {
        using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.PostAsync("/hubs/household/negotiate?negotiateVersion=1", null)).StatusCode);
        using var parent = await factory.DemoVisitorAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/household/negotiate?negotiateVersion=1");
        request.Headers.Add("Origin", "https://unrelated.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await parent.SendAsync(request)).StatusCode);
        using var same = new HttpRequestMessage(HttpMethod.Post, "/hubs/household/negotiate?negotiateVersion=1");
        same.Headers.Add("Origin", "http://localhost");
        Assert.Equal(HttpStatusCode.OK, (await parent.SendAsync(same)).StatusCode);
    }

    [Fact]
    public async Task Lists_publish_independently_to_phone_and_wall_without_cross_family_or_rollback_leaks()
    {
        using var parent = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent); var outsiderFamily = await FamilyOf(other);
        var device = (await parent.GetFromJsonAsync<DeviceResponse[]>("/api/devices"))!.First();
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)), domain: "lists");
        await using var wall = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)), domain: "lists");
        await using var outsider = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(outsiderFamily.Id)), domain: "lists");
        var before = await phone.Next(); await wall.Next(); await outsider.Next();
        Assert.Equal("lists", before.Domain);
        await Add(parent); await Publish(factory.Demo); await phone.Quiet();
        (await parent.PostAsJsonAsync("/api/lists", new Wheelhouse.Api.Lists.CreateList(Guid.NewGuid(), "Live errands"))).EnsureSuccessStatusCode();
        await Publish(factory.Demo);
        Assert.Equal(before.ChangeNumber + 1, (await phone.Next()).ChangeNumber);
        Assert.Equal(before.ChangeNumber + 1, (await wall.Next()).ChangeNumber); await outsider.Quiet();
        await using var db = factory.DbContextFor(family.Id);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            (await db.HouseholdLists.FirstAsync()).Name = "Uncommitted"; await db.SaveChangesAsync();
            await Publish(factory.Demo); await phone.Quiet(); await tx.RollbackAsync();
        }
        await Publish(factory.Demo); await phone.Quiet();
    }

    [Fact]
    public async Task Removing_a_wall_closes_its_household_socket_immediately()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        var device = (await parent.GetFromJsonAsync<DeviceResponse[]>("/api/devices"))!.First();
        await using var wall = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)));
        await wall.Next();
        (await parent.DeleteAsync($"/api/devices/{device.Id}")).EnsureSuccessStatusCode();
        await wall.Closed.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Meals_publish_only_committed_independent_family_revisions_to_phone_and_wall()
    {
        using var parent = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent); var otherFamily = await FamilyOf(other);
        var device = (await parent.GetFromJsonAsync<DeviceResponse[]>("/api/devices"))!.First();
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)), domain:"meals");
        await using var wall = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Device(family.Id, device.Id)), domain:"meals");
        await using var outsider = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(otherFamily.Id)), domain:"meals");
        var before = await phone.Next(); await wall.Next(); await outsider.Next();
        await Add(parent); await Publish(factory.Demo); await phone.Quiet();
        (await parent.PutAsJsonAsync("/api/meals/2030-01-07/Dinner", new Wheelhouse.Api.Meals.SaveMeal(Guid.NewGuid(), null, "Live dinner", null))).EnsureSuccessStatusCode();
        await Publish(factory.Demo);
        Assert.Equal(before.ChangeNumber + 1, (await phone.Next()).ChangeNumber);
        Assert.Equal(before.ChangeNumber + 1, (await wall.Next()).ChangeNumber); await outsider.Quiet();
        var recipe = (await parent.GetFromJsonAsync<Wheelhouse.Api.Meals.RecipesResponse>("/api/recipes"))!.Recipes.First(r => !r.Archived);
        (await parent.PutAsJsonAsync($"/api/recipes/{recipe.Id}", new Wheelhouse.Api.Meals.SaveRecipe(Guid.NewGuid(), recipe.Version, true, recipe.Content))).EnsureSuccessStatusCode();
        await Publish(factory.Demo);
        Assert.Equal(before.ChangeNumber + 2, (await phone.Next()).ChangeNumber);
        Assert.Equal(before.ChangeNumber + 2, (await wall.Next()).ChangeNumber); await outsider.Quiet();
        await using var db = factory.DbContextFor(family.Id);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            (await db.MealSlots.FirstAsync()).Title = "Uncommitted meal"; await db.SaveChangesAsync();
            await Publish(factory.Demo); await phone.Quiet(); await tx.RollbackAsync();
        }
        await Publish(factory.Demo); await phone.Quiet();
    }

    [Fact]
    public async Task A_grocery_batch_publishes_both_committed_domains_without_leaking_source_counts_to_another_family()
    {
        using var parent=await factory.DemoVisitorAsync();using var other=await factory.DemoVisitorAsync();
        var family=await FamilyOf(parent);var otherFamily=await FamilyOf(other);
        await using var meals=await Observer.Connect(factory.Demo,Cookie(factory.Demo,WheelhousePrincipal.Parent(family.Id)),domain:"meals");
        await using var lists=await Observer.Connect(factory.Demo,Cookie(factory.Demo,WheelhousePrincipal.Parent(family.Id)),domain:"lists");
        await using var outsider=await Observer.Connect(factory.Demo,Cookie(factory.Demo,WheelhousePrincipal.Parent(otherFamily.Id)),domain:"lists");
        var beforeMeals=await meals.Next();var beforeLists=await lists.Next();await outsider.Next();
        // Use the current demo's saved recipe meal, including its seeded prior purchase.
        await using var db=factory.DbContextFor(family.Id);
        var day=await db.MealSlots.Where(m=>m.RecipeData!=null).OrderByDescending(m=>m.Date).Select(m=>m.Date).FirstAsync();
        var p=(await parent.GetFromJsonAsync<Wheelhouse.Api.Meals.GroceryPreview>($"/api/meals/groceries?from={day:yyyy-MM-dd}&to={day.AddDays(1):yyyy-MM-dd}"))!;
        var meal=p.Meals.First(m=>m.SnapshotKey!=null);var ingredient=meal.Ingredients.First(i=>i.PreviousCount==0);
        var choice=new Wheelhouse.Api.Meals.GroceryChoice(meal.Date,meal.Slot,meal.Version,meal.SnapshotKey!,ingredient.Id,ingredient.Quantity,ingredient.QuantityText,0,false);
        (await parent.PostAsJsonAsync("/api/meals/groceries",new Wheelhouse.Api.Meals.AddMealGroceries(Guid.NewGuid(),p.Grocery.Id,false,[choice]))).EnsureSuccessStatusCode();
        await Publish(factory.Demo);
        Assert.Equal(beforeMeals.ChangeNumber+1,(await meals.Next()).ChangeNumber);
        Assert.Equal(beforeLists.ChangeNumber+1,(await lists.Next()).ChangeNumber);await outsider.Quiet();
    }
    [Fact]
    public async Task Expired_demo_subscriptions_are_closed_before_cleanup()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await phone.Next();
        await using var db = factory.DbContextFor(family.Id);
        await db.Families.ExecuteUpdateAsync(set => set.SetProperty(f => f.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        await Publish(factory.Demo);
        await phone.Closed.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Background_publishing_reaches_an_open_socket_without_an_explicit_send()
    {
        await using var host = factory.InMode(InstanceMode.Demo).WithWebHostBuilder(b => b.UseSetting("HouseholdLive:Enabled", true));
        using var parent = host.CreateClient();
        (await parent.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        var family = await FamilyOf(parent);
        await using var phone = await Observer.Connect(host, Cookie(host, WheelhousePrincipal.Parent(family.Id)));
        var before = (await phone.Next()).ChangeNumber;
        await Add(parent);
        Assert.Equal(before + 1, (await phone.Next()).ChangeNumber);
    }
    [Fact]
    public async Task Sign_out_closes_existing_household_subscriptions_for_that_identity()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = await FamilyOf(parent);
        await using var phone = await Observer.Connect(factory.Demo, Cookie(factory.Demo, WheelhousePrincipal.Parent(family.Id)));
        await phone.Next();
        (await parent.PostAsync("/api/auth/sign-out", null)).EnsureSuccessStatusCode();
        await phone.Closed.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private sealed class Observer : IAsyncDisposable
    {
        private readonly Channel<HouseholdChanged> _changes = Channel.CreateUnbounded<HouseholdChanged>();
        private readonly TaskCompletionSource _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public required HubConnection Connection { get; init; }
        public Task Closed => _closed.Task;

        public static async Task<Observer> Connect(WebApplicationFactory<Program> host, string cookie, string query = "", string domain = "chores")
        {
            var connection = new HubConnectionBuilder().WithUrl($"http://localhost/hubs/household{query}", options =>
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
            connection.On<HouseholdChanged>("HouseholdChanged", change => { if (change.Domain == domain) observer._changes.Writer.TryWrite(change); });
            connection.Closed += _ => { observer._closed.TrySetResult(); return Task.CompletedTask; };
            await connection.StartAsync();
            return observer;
        }

        public Task<HouseholdChanged> Next() => _changes.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));

        public async Task Quiet()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _changes.Reader.ReadAsync(timeout.Token).AsTask());
        }

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }
}

