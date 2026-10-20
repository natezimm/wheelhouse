using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// A demo visitor is a parent of their own copy of the demo family, so each test acts as a
/// parent through a fresh visitor and starts from an untouched family.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class FamilySettingsTests(ApiFactory factory) : IAsyncLifetime
{
    private static readonly FamilySettingsRequest ValidSettings = new(
        "The Marlowe Crew", "Europe/Paris", DayOfWeek.Sunday, new TimeOnly(22, 0), new TimeOnly(7, 0), Units.Metric);

    private HttpClient _parent = null!;

    public async Task InitializeAsync() => _parent = await factory.DemoVisitorAsync();

    public Task DisposeAsync()
    {
        _parent.Dispose();
        return Task.CompletedTask;
    }

    private async Task<FamilyResponse> GetFamily() =>
        (await _parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    [Fact]
    public async Task A_parent_can_change_the_family_settings()
    {
        var response = await _parent.PutAsJsonAsync("/api/family", ValidSettings, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var family = await GetFamily();
        Assert.Equal("The Marlowe Crew", family.Name);
        Assert.Equal("Europe/Paris", family.TimeZone);
        Assert.Equal(DayOfWeek.Sunday, family.WeekStartsOn);
        Assert.Equal(new TimeOnly(22, 0), family.NightModeFrom);
        Assert.Equal(new TimeOnly(7, 0), family.NightModeTo);
        Assert.Equal(Units.Metric, family.Units);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], family.Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task Settings_that_make_no_sense_are_refused_field_by_field_and_nothing_changes()
    {
        var bad = ValidSettings with
        {
            Name = "   ",
            TimeZone = "Mars/Olympus_Mons",
            WeekStartsOn = DayOfWeek.Wednesday,
            NightModeTo = ValidSettings.NightModeFrom,
        };

        var response = await _parent.PutAsJsonAsync("/api/family", bad, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["name", "nightModeTo", "timeZone", "weekStartsOn"], problem!.Errors.Keys.Order());
        Assert.Equal("The Marlowe Family", (await GetFamily()).Name);
    }

    [Fact]
    public async Task A_new_member_goes_last_with_an_initial_taken_from_the_name()
    {
        var response = await _parent.PostAsJsonAsync(
            "/api/family/members", new MemberRequest("  ada ", "#7243b8", MemberRole.Kid), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MemberResponse>(ApiFactory.Json);
        var family = await GetFamily();
        Assert.Equal(["Clara", "Julian", "Milo", "Nora", "ada"], family.Members.Select(member => member.DisplayName));
        Assert.Equal(new MemberResponse(created!.Id, "ada", "#7243B8", "A", MemberRole.Kid), family.Members[^1]);
    }

    [Theory]
    [InlineData("", "#2F5FC4", "displayName")]
    [InlineData("Ada", "purple", "color")]
    [InlineData("Ada", "#12345", "color")]
    public async Task A_member_needs_a_name_and_a_hex_color(string name, string color, string field)
    {
        var response = await _parent.PostAsJsonAsync(
            "/api/family/members", new MemberRequest(name, color, MemberRole.Kid), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([field], problem!.Errors.Keys);
        Assert.Equal(4, (await GetFamily()).Members.Count);
    }

    [Fact]
    public async Task A_parent_can_rename_and_recolor_a_member_without_moving_them()
    {
        var milo = (await GetFamily()).Members.Single(member => member.DisplayName == "Milo");

        var response = await _parent.PutAsJsonAsync(
            $"/api/family/members/{milo.Id}", new MemberRequest("Miles", "#A8326E", MemberRole.Kid), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var family = await GetFamily();
        Assert.Equal(["Clara", "Julian", "Miles", "Nora"], family.Members.Select(member => member.DisplayName));
        Assert.Equal(new MemberResponse(milo.Id, "Miles", "#A8326E", "M", MemberRole.Kid), family.Members[2]);
    }

    [Fact]
    public async Task A_parent_can_remove_a_member()
    {
        var milo = (await GetFamily()).Members.Single(member => member.DisplayName == "Milo");

        var response = await _parent.DeleteAsync($"/api/family/members/{milo.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(["Clara", "Julian", "Nora"], (await GetFamily()).Members.Select(member => member.DisplayName));
    }

    [Fact]
    public async Task The_last_parent_can_neither_be_removed_nor_turned_into_a_kid()
    {
        var family = await GetFamily();
        var clara = family.Members.Single(member => member.DisplayName == "Clara");
        var julian = family.Members.Single(member => member.DisplayName == "Julian");
        Assert.Equal(HttpStatusCode.NoContent, (await _parent.DeleteAsync($"/api/family/members/{julian.Id}")).StatusCode);

        var remove = await _parent.DeleteAsync($"/api/family/members/{clara.Id}");
        var demote = await _parent.PutAsJsonAsync(
            $"/api/family/members/{clara.Id}", new MemberRequest("Clara", clara.Color, MemberRole.Kid), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, remove.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, demote.StatusCode);
        var stillThere = (await GetFamily()).Members.Single(member => member.Id == clara.Id);
        Assert.Equal(MemberRole.Parent, stillThere.Role);
    }

    [Fact]
    public async Task Another_familys_member_cannot_be_changed_or_removed()
    {
        var otherFamilyId = Guid.NewGuid();
        var zedId = Guid.NewGuid();
        await using (var anyone = factory.DbContextFor(familyId: null))
        {
            var other = new Family { Id = otherFamilyId, Name = "The Others", TimeZone = "Europe/Paris" };
            other.Members.Add(new Member { Id = zedId, FamilyId = otherFamilyId, DisplayName = "Zed", Color = "#7243B8", Initial = "Z" });
            anyone.Families.Add(other);
            await anyone.SaveChangesAsync();
        }

        var update = await _parent.PutAsJsonAsync(
            $"/api/family/members/{zedId}", new MemberRequest("Hacked", "#2F5FC4", MemberRole.Kid), ApiFactory.Json);
        var remove = await _parent.DeleteAsync($"/api/family/members/{zedId}");

        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, remove.StatusCode);
        await using var asOther = factory.DbContextFor(otherFamilyId);
        Assert.Equal("Zed", (await asOther.Members.FindAsync(zedId))!.DisplayName);
    }

    [Theory]
    [InlineData("PUT", "/api/family")]
    [InlineData("POST", "/api/family/members")]
    [InlineData("PUT", "/api/family/members/{member}")]
    [InlineData("DELETE", "/api/family/members/{member}")]
    public async Task Nothing_can_be_changed_on_a_family_instance_without_signing_in(string method, string url)
    {
        // Aim at a member that really exists, so only the missing sign-in can explain the refusal.
        var clara = (await GetFamily()).Members[0];
        using var stranger = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), url.Replace("{member}", clara.Id.ToString()))
        {
            Content = JsonContent.Create(new MemberRequest("Hacked", "#2F5FC4", MemberRole.Parent), options: ApiFactory.Json),
        };

        var response = await stranger.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], (await GetFamily()).Members.Select(member => member.DisplayName));
    }
}
