using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NetArchTest.Rules;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Rules from AGENTS.md that the compiler cannot hold: family scoping, the legacy household types and
/// where outside services are called from. Like <see cref="AccessTests"/>, a new exception is a change
/// to this file, which a review sees.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ArchitectureTests(ApiFactory factory)
{
    private static readonly System.Reflection.Assembly Api = typeof(WheelhouseDbContext).Assembly;

    /// <summary>Our own types only: coverage instrumentation adds a tracker type to the assembly.</summary>
    private static PredicateList Ours() => Types.InAssembly(Api).That().ResideInNamespaceStartingWith("Wheelhouse");

    private static void Holds(TestResult result, string rule) =>
        Assert.True(result.IsSuccessful, $"{rule}: {string.Join(", ", result.FailingTypeNames ?? [])}");

    [Fact]
    public void Every_table_with_a_family_id_is_family_owned_and_filtered()
    {
        using var scope = factory.Services.CreateScope();
        var model = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>().Model;

        var unscoped = model.GetEntityTypes()
            .Where(e => e.FindProperty(nameof(IFamilyOwned.FamilyId)) is not null && !e.IsOwned())
            .Where(e => !typeof(IFamilyOwned).IsAssignableFrom(e.ClrType) || !e.GetDeclaredQueryFilters().Any())
            .Select(e => e.ClrType.Name);

        Assert.Empty(unscoped);
    }

    [Fact]
    public void The_legacy_household_types_are_used_only_by_the_database_mapping() =>
        Holds(Ours()
            .And().DoNotResideInNamespace("Wheelhouse.Api.Chores")
            .And().DoNotResideInNamespace("Wheelhouse.Api.Lists")
            .And().DoNotResideInNamespace("Wheelhouse.Api.Meals")
            .And().DoNotResideInNamespaceStartingWith("Wheelhouse.Api.Data")
            // Family keeps the navigation collections the mapping needs.
            .And().DoNotHaveName(nameof(Family))
            .ShouldNot().HaveDependencyOnAny("Wheelhouse.Api.Chores", "Wheelhouse.Api.Lists", "Wheelhouse.Api.Meals")
            .GetResult(), "Calendar-first scope: these types gained a use outside the mapping");

    [Fact]
    public void Outside_services_are_called_only_from_their_clients() =>
        Holds(Ours()
            // Google Calendar through IGoogleCalendar, Open-Meteo, and the browsers' push services.
            .And().DoNotHaveName("GoogleCalendarApi", "OpenMeteo", "WebPush")
            // These register those clients with AddHttpClient and set their timeouts; they send nothing.
            .And().DoNotHaveName("GoogleConnectionEndpoints", "WeatherEndpoints", "ReminderEndpoints")
            .ShouldNot().HaveDependencyOn("System.Net.Http.HttpClient")
            .GetResult(), "A type other than an outside service's client uses HttpClient");
}
