using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// A wall display shows a code, a parent types it on their phone, and the display is then
/// signed in to the family. A demo visitor is a parent of their own copy, so each test pairs
/// displays with a fresh visitor's family.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class PairingTests(ApiFactory factory)
{
    /// <summary>A browser that opened /wall and is not signed in to anything.</summary>
    private HttpClient NewDisplay() => factory.Demo.CreateClient();

    private static async Task<PairingResponse> ShowCodeAsync(HttpClient display)
    {
        var response = await display.PostAsync("/api/pairing", content: null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PairingResponse>(ApiFactory.Json))!;
    }

    private static Task<HttpResponseMessage> EnterCodeAsync(HttpClient parent, string code, string name = "Hall display") =>
        parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(code, name), ApiFactory.Json);

    private static Task<HttpResponseMessage> FinishAsync(HttpClient display, PairingResponse pairing) =>
        display.PostAsync($"/api/pairing/{pairing.Id}/finish", content: null);

    /// <summary>A display paired with <paramref name="parent"/>'s family, and its device.</summary>
    private async Task<(HttpClient Display, DeviceResponse Device)> PairedDisplayAsync(HttpClient parent)
    {
        var display = NewDisplay();
        var pairing = await ShowCodeAsync(display);
        var device = (await (await EnterCodeAsync(parent, pairing.Code)).Content.ReadFromJsonAsync<DeviceResponse>(ApiFactory.Json))!;
        Assert.Equal(HttpStatusCode.NoContent, (await FinishAsync(display, pairing)).StatusCode);
        return (display, device);
    }

    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    private static async Task<List<DeviceResponse>> DevicesOf(HttpClient parent) =>
        (await parent.GetFromJsonAsync<List<DeviceResponse>>("/api/devices", ApiFactory.Json))!;

    [Fact]
    public async Task A_display_shows_the_family_once_a_parent_enters_its_code()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var display = NewDisplay();
        var pairing = await ShowCodeAsync(display);

        Assert.Matches("^[0-9]{6}$", pairing.Code);
        Assert.Equal(HttpStatusCode.Accepted, (await FinishAsync(display, pairing)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await display.GetAsync("/api/family")).StatusCode);

        // People type codes the way they read them off the screen.
        var entered = await EnterCodeAsync(parent, $"{pairing.Code[..3]} {pairing.Code[3..]}", "  Hall display ");

        Assert.Equal(HttpStatusCode.Created, entered.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await FinishAsync(display, pairing)).StatusCode);
        Assert.Equal((await FamilyOf(parent)).Id, (await FamilyOf(display)).Id);
        var device = Assert.Single(await DevicesOf(parent), d => d.Name == "Hall display");
        Assert.NotNull(device.LastSeenAt);
    }

    [Fact]
    public async Task A_code_pairs_one_display_once()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var display = NewDisplay();
        var pairing = await ShowCodeAsync(display);
        await EnterCodeAsync(parent, pairing.Code);

        var again = await EnterCodeAsync(parent, pairing.Code);
        Assert.Equal(HttpStatusCode.NoContent, (await FinishAsync(display, pairing)).StatusCode);
        var collectedTwice = await FinishAsync(NewDisplay(), pairing);

        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, collectedTwice.StatusCode);
        Assert.Single(await DevicesOf(parent), d => d.Name == "Hall display");
    }

    [Fact]
    public async Task A_wrong_or_expired_code_pairs_nothing()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var display = NewDisplay();
        var pairing = await ShowCodeAsync(display);
        await using (var db = factory.DbContextFor(null))
        {
            await db.PairingCodes.Where(p => p.Id == pairing.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }

        var expired = await EnterCodeAsync(parent, pairing.Code);
        var malformed = await EnterCodeAsync(parent, "12345", name: "");

        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.Contains("code", (await expired.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys);
        Assert.Equal(["code", "name"], (await malformed.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys.Order());
        Assert.Equal(HttpStatusCode.NotFound, (await FinishAsync(display, pairing)).StatusCode);
        Assert.DoesNotContain(await DevicesOf(parent), d => d.Name == "Hall display");
    }

    [Fact]
    public async Task Removing_a_display_signs_it_out_at_once()
    {
        using var parent = await factory.DemoVisitorAsync();
        var (display, device) = await PairedDisplayAsync(parent);
        using var _ = display;
        Assert.Equal(HttpStatusCode.OK, (await display.GetAsync("/api/family")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await parent.DeleteAsync($"/api/devices/{device.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await display.GetAsync("/api/family")).StatusCode);
        Assert.DoesNotContain(await DevicesOf(parent), d => d.Id == device.Id);
    }

    [Fact]
    public async Task A_display_reads_the_family_but_manages_nothing()
    {
        using var parent = await factory.DemoVisitorAsync();
        var (display, _) = await PairedDisplayAsync(parent);
        using var __ = display;
        var member = (await FamilyOf(display)).Members[0];

        var rename = await display.PutAsJsonAsync(
            $"/api/family/members/{member.Id}", new MemberRequest("Renamed", member.Color, member.Role), ApiFactory.Json);
        var list = await display.GetAsync("/api/devices");
        var pair = await EnterCodeAsync(display, "123456");

        Assert.Equal(HttpStatusCode.Forbidden, rename.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, pair.StatusCode);
    }

    [Fact]
    public async Task One_family_cannot_see_or_remove_another_familys_displays()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var (display, device) = await PairedDisplayAsync(parent);
        using var _ = display;

        Assert.DoesNotContain(await DevicesOf(other), d => d.Id == device.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/devices/{device.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await display.GetAsync("/api/family")).StatusCode);
    }

    [Fact]
    public async Task A_demo_wall_paired_with_a_phone_joins_the_phones_copy_and_keeps_it()
    {
        using var phone = await factory.DemoVisitorAsync();
        // A demo wall checks in like any visitor, so it starts with a copy of its own.
        using var wall = await factory.DemoVisitorAsync();
        Assert.NotEqual((await FamilyOf(phone)).Id, (await FamilyOf(wall)).Id);

        var pairing = await ShowCodeAsync(wall);
        await EnterCodeAsync(phone, pairing.Code);
        await FinishAsync(wall, pairing);
        var revisit = await wall.PostAsync("/api/demo/visit", content: null);

        Assert.Equal(HttpStatusCode.NoContent, revisit.StatusCode);
        Assert.Equal((await FamilyOf(phone)).Id, (await FamilyOf(wall)).Id);
    }

    [Fact]
    public async Task A_demo_copy_comes_with_a_display_for_the_phone_to_show()
    {
        using var visitor = await factory.DemoVisitorAsync();

        var display = Assert.Single(await DevicesOf(visitor));

        Assert.Equal("Kitchen wall", display.Name);
        Assert.NotNull(display.LastSeenAt);
    }

    [Fact]
    public async Task A_family_can_only_guess_at_codes_a_few_times_a_minute()
    {
        using var parent = await factory.DemoVisitorAsync();

        var statuses = new List<HttpStatusCode>();
        for (var guess = 0; guess < 11; guess++)
        {
            statuses.Add((await EnterCodeAsync(parent, "000000")).StatusCode);
        }

        Assert.All(statuses[..10], status => Assert.NotEqual(HttpStatusCode.TooManyRequests, status));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[10]);
    }

    [Fact]
    public async Task One_address_can_only_ask_for_a_few_codes()
    {
        var address = IPAddress.Parse($"203.0.113.{Random.Shared.Next(1, 255)}");

        var statuses = new List<int>();
        for (var request = 0; request < 11; request++)
        {
            var context = await factory.Demo.Server.SendAsync(http =>
            {
                http.Request.Method = HttpMethods.Post;
                http.Request.Path = "/api/pairing";
                http.Connection.RemoteIpAddress = address;
            });
            statuses.Add(context.Response.StatusCode);
        }

        Assert.All(statuses[..10], status => Assert.Equal(StatusCodes.Status200OK, status));
        Assert.Equal(StatusCodes.Status429TooManyRequests, statuses[10]);
    }
}
