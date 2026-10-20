using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RecipeTests(ApiFactory factory)
{
    private static RecipeContent Content() => new("Tomato pasta", 4,
        [new(Guid.NewGuid(), "Pasta", 400m, null, "g"), new(Guid.NewGuid(), "Salt", null, "to taste", null)],
        ["Cook pasta.", "Season and serve."], "https://example.com/pasta", "Weeknight favorite");
    private static async Task<RecipesResponse> Read(HttpClient c) => (await c.GetFromJsonAsync<RecipesResponse>("/api/recipes"))!;
    private static async Task<RecipeResponse> Save(HttpClient c, Guid id, RecipeContent content, Guid? version = null, bool archived = false)
    {
        var response = await c.PutAsJsonAsync($"/api/recipes/{id}", new SaveRecipe(Guid.NewGuid(), version, archived, content));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<RecipesResponse>())!.Recipes.Single(r => r.Id == id);
    }
    private static async Task<MealResponse> Plan(HttpClient c, string day, SaveMeal request)
    {
        var response = await c.PutAsJsonAsync($"/api/meals/{day}/Dinner", request);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<MealsResponse>())!.Meals.Single(m => m.Slot == "Dinner");
    }
    [Fact]
    public async Task Recipe_create_edit_archive_receipts_never_reapply_old_commands_and_versions_guard_concurrent_edits()
    {
        using var c = await factory.DemoVisitorAsync(); var before = await Read(c); var id = Guid.NewGuid(); var content = Content();
        var command = new SaveRecipe(Guid.NewGuid(), null, false, content);
        var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => c.PutAsJsonAsync($"/api/recipes/{id}", command)));
        Assert.All(replies, r => Assert.True(r.IsSuccessStatusCode));
        var first = (await Read(c)).Recipes.Single(r => r.Id == id); Assert.Equal(before.ChangeNumber + 1, (await Read(c)).ChangeNumber);
        var edits = await Task.WhenAll(new[] { "A", "B" }.Select(title => c.PutAsJsonAsync($"/api/recipes/{id}",
            new SaveRecipe(Guid.NewGuid(), first.Version, false, content with { Title = title }))));
        Assert.Single(edits, r => r.IsSuccessStatusCode); Assert.Single(edits, r => r.StatusCode == HttpStatusCode.Conflict);
        var edited = (await Read(c)).Recipes.Single(r => r.Id == id);
        await Save(c, id, edited.Content, edited.Version, true); var revision = (await Read(c)).ChangeNumber;
        (await c.PutAsJsonAsync($"/api/recipes/{id}", command)).EnsureSuccessStatusCode();
        Assert.Equal(revision, (await Read(c)).ChangeNumber); Assert.True((await Read(c)).Recipes.Single(r => r.Id == id).Archived);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PutAsJsonAsync($"/api/recipes/{id}", command with { Content = content with { Title = "Reuse" } })).StatusCode);
        var archived = (await Read(c)).Recipes.Single(r => r.Id == id); await Save(c, id, archived.Content, archived.Version, true);
        Assert.Equal(revision, (await Read(c)).ChangeNumber);
    }
    [Fact]
    public async Task Planned_snapshot_survives_library_edits_archive_scaling_copy_and_receipted_retries()
    {
        using var c = await factory.DemoVisitorAsync(); var id = Guid.NewGuid(); var original = await Save(c,id,Content());
        var request = new SaveMeal(Guid.NewGuid(), null, original.Content.Title, "Dinner notes", new(id,original.Version), 6);
        var planned = await Plan(c,"2030-01-07",request);
        Assert.Equal(6,planned.Servings); Assert.Equal(600m,planned.Recipe!.Content.Ingredients[0].Scale(6,4).Quantity);
        Assert.Equal("to taste",planned.Recipe.Content.Ingredients[1].Scale(6,4).QuantityText);
        Assert.Equal(400m,(await Read(c)).Recipes.Single(r => r.Id == id).Content.Ingredients[0].Quantity);
        var edited = await Save(c,id,original.Content with { Title = "New pasta", Steps = ["New method"] },original.Version);
        var snapshot = (await c.GetFromJsonAsync<MealsResponse>("/api/meals?from=2030-01-07&to=2030-01-08"))!.Meals.Single(m => m.Slot == "Dinner");
        Assert.Equal("Tomato pasta",snapshot.Title); Assert.Equal("Cook pasta.",snapshot.Recipe!.Content.Steps[0]);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync("/api/meals/2030-01-08/Dinner",request with {CommandId=Guid.NewGuid()})).StatusCode);
        var refreshed = await Plan(c,"2030-01-07",request with {CommandId=Guid.NewGuid(),Version=planned.Version,Recipe=new(id,edited.Version),Servings=8});
        Assert.Equal("New pasta",refreshed.Title); Assert.Equal("New method",refreshed.Recipe!.Content.Steps[0]);
        await Save(c,id,edited.Content,edited.Version,true);
        var resized = await Plan(c,"2030-01-07",new(Guid.NewGuid(),refreshed.Version,refreshed.Title,"Dinner notes",Servings:2));
        Assert.Equal(200m,resized.Recipe!.Content.Ingredients[0].Scale(2,4).Quantity);
        var copy = new CopyMeals(Guid.NewGuid(),new(2030,1,7),new(2030,1,14),[new(new(2030,1,7),"Dinner",resized.Version!.Value,null)]);
        (await c.PostAsJsonAsync("/api/meals/copy",copy)).EnsureSuccessStatusCode();
        var copied = (await c.GetFromJsonAsync<MealsResponse>("/api/meals?from=2030-01-14&to=2030-01-15"))!.Meals.Single(m => m.Slot=="Dinner");
        Assert.Equal(RecipeJson.Write(resized.Recipe),RecipeJson.Write(copied.Recipe)); Assert.Equal(2,copied.Servings);
        (await c.PutAsJsonAsync("/api/meals/2030-01-07/Dinner",request)).EnsureSuccessStatusCode();
        var afterRetry = (await c.GetFromJsonAsync<MealsResponse>("/api/meals?from=2030-01-07&to=2030-01-08"))!.Meals.Single(m => m.Slot=="Dinner");
        Assert.Equal(resized.Version,afterRetry.Version);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync("/api/meals/2030-01-08/Dinner",
            request with {CommandId=Guid.NewGuid(),Recipe=new(id,(await Read(c)).Recipes.Single(r=>r.Id==id).Version)})).StatusCode);
        var detached = await Plan(c,"2030-01-07",new(Guid.NewGuid(),resized.Version,"Leftovers",null,RemoveRecipe:true));
        Assert.Null(detached.Recipe); Assert.Null(detached.Servings);
    }
    [Fact]
    public async Task Only_parents_manage_recipes_family_clients_choose_and_other_families_never_resolve_references()
    {
        using var c = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync(); using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await stranger.GetAsync("/api/recipes")).StatusCode);
        var id=Guid.NewGuid(); var recipe=await Save(c,id,Content());
        Assert.DoesNotContain((await Read(other)).Recipes,r=>r.Id==id);
        Assert.Equal(HttpStatusCode.Conflict,(await other.PutAsJsonAsync($"/api/recipes/{id}",new SaveRecipe(Guid.NewGuid(),recipe.Version,false,Content()))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await other.PutAsJsonAsync("/api/meals/2030-01-07/Dinner",new SaveMeal(Guid.NewGuid(),null,"Pasta",null,new(id,recipe.Version),4))).StatusCode);
        using var wall=factory.Demo.CreateClient(); var pairing=(await (await wall.PostAsync("/api/pairing",null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await c.PostAsJsonAsync("/api/devices",new PairDisplayRequest(pairing.Code,"Recipe wall"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{pairing.Id}/finish",null)).EnsureSuccessStatusCode();
        Assert.False((await Read(wall)).CanManage);
        Assert.Equal(HttpStatusCode.Forbidden,(await wall.PutAsJsonAsync($"/api/recipes/{id}",new SaveRecipe(Guid.NewGuid(),recipe.Version,true,recipe.Content))).StatusCode);
        await Plan(wall,"2030-01-07",new(Guid.NewGuid(),null,"Pasta",null,new(id,recipe.Version),3));
        // Even identical client-generated IDs and command IDs belong independently to each family.
        await Save(other,id,Content());
        Assert.Equal(2,(await Read(other)).Recipes.Single(r=>r.Id==id).Content.Ingredients.Length);
    }
    [Fact]
    public async Task Validation_keeps_decimal_and_text_quantities_distinct_and_rejects_unsafe_or_unbounded_content()
    {
        using var c=await factory.DemoVisitorAsync(); var content=Content();
        RecipeContent[] invalid=[
            content with {DefaultServings=0},content with {DefaultServings=101},content with {Title=" "},
            content with {SourceUrl="javascript:alert(1)"},content with {SourceUrl="https://user:password@example.com"},
            content with {Ingredients=[]},content with {Steps=[]},
            content with {Ingredients=[content.Ingredients[0] with {QuantityText="to taste"}]},
            content with {Ingredients=[content.Ingredients[0] with {Quantity=-1}]},
            content with {Ingredients=[content.Ingredients[0] with {Quantity=0.00001m}]},
            content with {Ingredients=[content.Ingredients[0],content.Ingredients[0]]}
        ];
        foreach(var bad in invalid)
            Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync($"/api/recipes/{Guid.NewGuid()}",new SaveRecipe(Guid.NewGuid(),null,false,bad))).StatusCode);
        var recipe=await Save(c,Guid.NewGuid(),content);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync("/api/meals/2030-01-07/Dinner",
            new SaveMeal(Guid.NewGuid(),null,"Pasta",null,new(recipe.Id,recipe.Version),101))).StatusCode);
        Assert.Equal(0.3333m,new Ingredient(Guid.NewGuid(),"Oil",1m,null,"tbsp").Scale(1,3).Quantity);
        Assert.Equal(0m,new Ingredient(Guid.NewGuid(),"Oil",0m,null,null).Scale(100,1).Quantity);
    }
    [Fact]
    public async Task Recipe_revisions_are_atomic_independent_and_demo_cleanup_cascades_every_recipe()
    {
        using var c=await factory.DemoVisitorAsync(); var f=(await c.GetFromJsonAsync<FamilyResponse>("/api/family",ApiFactory.Json))!;
        await using var db=factory.DbContextFor(f.Id);
        var before=await db.Families.Select(f=>new {f.MealsChangeNumber,f.CalendarChangeNumber,f.ChoresChangeNumber,f.ListsChangeNumber}).SingleAsync();
        await Save(c,Guid.NewGuid(),Content());
        var after=await db.Families.Select(f=>new {f.MealsChangeNumber,f.CalendarChangeNumber,f.ChoresChangeNumber,f.ListsChangeNumber}).SingleAsync();
        Assert.Equal(before.MealsChangeNumber+1,after.MealsChangeNumber); Assert.Equal(before.CalendarChangeNumber,after.CalendarChangeNumber);
        Assert.Equal(before.ChoresChangeNumber,after.ChoresChangeNumber); Assert.Equal(before.ListsChangeNumber,after.ListsChangeNumber);
        await using(var tx=await db.Database.BeginTransactionAsync()) {
            (await db.Recipes.FirstAsync()).Archived=true; await db.SaveChangesAsync();
            Assert.Equal(after.MealsChangeNumber+1,await db.Families.Select(f=>f.MealsChangeNumber).SingleAsync());
            await tx.RollbackAsync();
        }
        Assert.Equal(after.MealsChangeNumber,(await Read(c)).ChangeNumber);
        await using var unscoped=factory.DbContextFor(null); Assert.Empty(await unscoped.Recipes.ToArrayAsync());
        var seed=DemoFamily.Create(Guid.NewGuid(),DateTimeOffset.UtcNow); Assert.NotEmpty(seed.Recipes);
        Assert.Contains(seed.Meals,m=>m.RecipeData!=null && m.Servings==6);
        unscoped.Families.Add(seed); await unscoped.SaveChangesAsync();
        await unscoped.Families.IgnoreQueryFilters().Where(f=>f.Id==seed.Id).ExecuteDeleteAsync();
        Assert.Empty(await unscoped.Recipes.IgnoreQueryFilters().Where(r=>r.FamilyId==seed.Id).ToArrayAsync());
    }
}
