using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Tests;
[Collection(ApiCollection.Name)]
public sealed class MealGroceryTests(ApiFactory factory)
{
    private const string From="2030-01-07";
    private static Task<GroceryPreview?> Preview(HttpClient c)=>c.GetFromJsonAsync<GroceryPreview>("/api/meals/groceries?from="+From+"&to=2030-01-14");
    private static async Task<HouseholdListResponse> Grocery(HttpClient c)=>(await c.GetFromJsonAsync<ListsResponse>("/api/lists"))!.Lists.Single(l=>l.IsGrocery);
    private static async Task<RecipeResponse> Recipe(HttpClient c,params Ingredient[] ingredients)
    {
        var id=Guid.NewGuid();var content=new RecipeContent("Test pasta",4,ingredients,["Cook and serve"],null,null);
        var response=await c.PutAsJsonAsync($"/api/recipes/{id}",new SaveRecipe(Guid.NewGuid(),null,false,content));response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<RecipesResponse>())!.Recipes.Single(r=>r.Id==id);
    }
    private static async Task<MealResponse> Plan(HttpClient c,RecipeResponse r,string date=From,int servings=6,Guid? version=null)
    {
        var response=await c.PutAsJsonAsync($"/api/meals/{date}/Dinner",new SaveMeal(Guid.NewGuid(),version,r.Content.Title,null,new(r.Id,r.Version),servings));
        response.EnsureSuccessStatusCode();return (await response.Content.ReadFromJsonAsync<MealsResponse>())!.Meals.Single(m=>m.Slot=="Dinner");
    }
    private static Ingredient Numeric(string name="Pasta",decimal quantity=400,string? unit="g")=>new(Guid.NewGuid(),name,quantity,null,unit);
    private static GroceryChoice Choice(GroceryMeal meal,int index=0)=>new(meal.Date,meal.Slot,meal.Version,meal.SnapshotKey!,meal.Ingredients[index].Id,
        meal.Ingredients[index].Quantity,meal.Ingredients[index].QuantityText,meal.Ingredients[index].PreviousCount,false);
    private static AddMealGroceries Command(GroceryPreview p,params GroceryChoice[] choices)=>new(Guid.NewGuid(),p.Grocery.Id,false,choices);
    private static async Task<GroceryBatchResponse> Add(HttpClient c,AddMealGroceries command)
    {
        var response=await c.PostAsJsonAsync("/api/meals/groceries",command);
        Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());return (await response.Content.ReadFromJsonAsync<GroceryBatchResponse>())!;
    }
    [Fact]
    public async Task Preview_scales_saved_contents_without_writes_and_free_text_and_archived_recipes_remain_understandable()
    {
        using var c=await factory.DemoVisitorAsync();var r=await Recipe(c,Numeric(),new(Guid.NewGuid(),"Salt",null,new string('x',100),null));
        var meal=await Plan(c,r);
        (await c.PutAsJsonAsync("/api/meals/2030-01-08/Lunch",new SaveMeal(Guid.NewGuid(),null,"Sandwiches",null))).EnsureSuccessStatusCode();
        (await c.PutAsJsonAsync($"/api/recipes/{r.Id}",new SaveRecipe(Guid.NewGuid(),r.Version,true,r.Content with {Title="Changed library"}))).EnsureSuccessStatusCode();
        var before=await Preview(c);var after=await Preview(c);Assert.Equal(before!.MealsChangeNumber,after!.MealsChangeNumber);
        var saved=after.Meals.Single(m=>m.Date==meal.Date);Assert.Equal("Test pasta",saved.Title);Assert.Equal(600,saved.Ingredients[0].Quantity);
        Assert.Equal(new string('x',100),saved.Ingredients[1].QuantityText);
        Assert.Null(after.Meals.Single(m=>m.Slot=="Lunch").SnapshotKey);
        var batch=await Add(c,Command(after,Choice(saved,1)));
        var item=(await Grocery(c)).Items.Single(i=>i.Id==batch.ItemIds.Single());
        Assert.Equal(new string('x',100),item.Quantity);Assert.Equal("Test pasta",item.Sources!.Single().MealTitle);
    }
    [Fact]
    public async Task Exact_retries_return_the_same_batch_after_later_edits_without_readding_and_changed_body_reuse_conflicts()
    {
        using var c=await factory.DemoVisitorAsync();var recipe=await Recipe(c,Numeric());await Plan(c,recipe);
        var p=(await Preview(c))!;var command=Command(p,Choice(p.Meals.Single()));var batch=await Add(c,command);
        var item=(await Grocery(c)).Items.Single(i=>i.Id==batch.ItemIds.Single());
        (await c.PutAsJsonAsync($"/api/lists/{p.Grocery.Id}/items/{item.Id}",new EditListItem(item.Version,"Manually changed",null,"3","boxes",item.CategoryId))).EnsureSuccessStatusCode();
        var revision=(await Preview(c))!.ListsChangeNumber;
        var retries=await Task.WhenAll(Enumerable.Range(0,3).Select(_=>Add(c,command)));
        Assert.All(retries,result=>Assert.Equal(RecipeJson.Write(batch),RecipeJson.Write(result)));
        Assert.Equal(revision,(await Preview(c))!.ListsChangeNumber);
        Assert.Equal("3",(await Grocery(c)).Items.Single(i=>i.Id==item.Id).Quantity);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/meals/groceries",command with {CombineNew=true})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/meals/groceries",command with {CommandId=Guid.NewGuid()})).StatusCode);
    }
    [Fact]
    public async Task Prior_purchase_counts_survive_check_clear_and_notes_changes_additional_purchases_are_explicit_and_reviewed()
    {
        using var c=await factory.DemoVisitorAsync();var recipe=await Recipe(c,Numeric());var planned=await Plan(c,recipe);
        var p=(await Preview(c))!;var batch=await Add(c,Command(p,Choice(p.Meals.Single())));
        var item=(await Grocery(c)).Items.Single(i=>i.Id==batch.ItemIds.Single());
        (await c.PutAsJsonAsync($"/api/lists/{p.Grocery.Id}/items/{item.Id}/checked",new CheckListItem(item.Version,true))).EnsureSuccessStatusCode();
        item=(await Grocery(c)).Items.Single(i=>i.Id==item.Id);
        (await c.PutAsJsonAsync($"/api/lists/{p.Grocery.Id}/clear-checked",new ClearCheckedItems([new(item.Id,item.Version)]))).EnsureSuccessStatusCode();
        (await c.PutAsJsonAsync("/api/meals/"+From+"/Dinner",new SaveMeal(Guid.NewGuid(),planned.Version,planned.Title,"New notes",Servings:6))).EnsureSuccessStatusCode();
        p=(await Preview(c))!;var line=Choice(p.Meals.Single());Assert.Equal(1,line.PreviousCount);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/meals/groceries",Command(p,line))).StatusCode);
        var additional=Command(p,line with {AllowAdditional=true});
        var replies=await Task.WhenAll(new[]{additional,additional with {CommandId=Guid.NewGuid()}}.Select(body=>c.PostAsJsonAsync("/api/meals/groceries",body)));
        Assert.Single(replies,r=>r.IsSuccessStatusCode);Assert.Single(replies,r=>r.StatusCode==HttpStatusCode.Conflict);
        Assert.Equal(2,(await Preview(c))!.Meals.Single().Ingredients.Single().PreviousCount);
    }
    [Fact]
    public async Task Only_exact_numeric_name_and_unit_matches_combine_and_multiple_sources_keep_their_provenance()
    {
        using var c=await factory.DemoVisitorAsync();var recipe=await Recipe(c,Numeric("Beans",2,"cups"),Numeric(" beans ",3," CUPS "),
            Numeric("Beans",4,"g"),new(Guid.NewGuid(),"Beans",null,"to taste","cups"));
        await Plan(c,recipe,servings:4);var p=(await Preview(c))!;var meal=p.Meals.Single();
        var batch=await Add(c,Command(p,meal.Ingredients.Select((_,i)=>Choice(meal,i)).ToArray()) with {CombineNew=true});
        Assert.Equal(3,batch.ItemIds.Length);
        var items=(await Grocery(c)).Items.Where(i=>batch.ItemIds.Contains(i.Id)).ToArray();
        var combined=items.Single(i=>i.Sources!.Length==2);Assert.Equal("5",combined.Quantity);
        Assert.Contains(items,i=>i.Quantity=="4"&&i.Unit=="g");Assert.Contains(items,i=>i.Quantity=="to taste");
        Assert.Equal(4,items.Sum(i=>i.Sources!.Length));
        // Merge into the reviewed unchecked numeric row; manual same-name incompatible units remain separate.
        await Plan(c,recipe,"2030-01-08",4);p=(await Preview(c))!;var next=p.Meals.Single(m=>m.Date.Day==8);
        var merge=Choice(next) with {TargetItemId=combined.Id,TargetVersion=combined.Version};
        await Add(c,Command(p,merge));
        combined=(await Grocery(c)).Items.Single(i=>i.Id==combined.Id);Assert.Equal("7",combined.Quantity);Assert.Equal(3,combined.Sources!.Length);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/meals/groceries",Command(p,Choice(next,2) with {TargetItemId=combined.Id,TargetVersion=combined.Version}))).StatusCode);
    }
    [Fact]
    public async Task Changed_source_or_merge_target_refuses_the_entire_batch_and_new_servings_require_a_fresh_preview()
    {
        using var c=await factory.DemoVisitorAsync();var recipe=await Recipe(c,Numeric("Rice",2,"cups"),Numeric("Oil",1,"tbsp"));var planned=await Plan(c,recipe);
        var p=(await Preview(c))!;var original=Command(p,Choice(p.Meals.Single()),Choice(p.Meals.Single(),1));
        var changed=await Plan(c,recipe,servings:8,version:planned.Version);
        var before=(await Grocery(c)).Items.Length;
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/meals/groceries",original)).StatusCode);
        Assert.Equal(before,(await Grocery(c)).Items.Length);
        p=(await Preview(c))!;Assert.Equal(4,p.Meals.Single().Ingredients[0].Quantity);Assert.Equal(0,p.Meals.Single().Ingredients[0].PreviousCount);
        var first=await Add(c,Command(p,Choice(p.Meals.Single())));
        var item=(await Grocery(c)).Items.Single(i=>i.Id==first.ItemIds.Single());
        await Plan(c,recipe,"2030-01-08",4);p=(await Preview(c))!;var next=p.Meals.Single(m=>m.Date.Day==8);
        var merge=Command(p,Choice(next) with {TargetItemId=item.Id,TargetVersion=item.Version},Choice(next,1));
        (await c.PutAsJsonAsync($"/api/lists/{p.Grocery.Id}/items/{item.Id}/checked",new CheckListItem(item.Version,true))).EnsureSuccessStatusCode();
        before=(await Grocery(c)).Items.Length;
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/meals/groceries",merge)).StatusCode);
        Assert.Equal(before,(await Grocery(c)).Items.Length);
        Assert.All((await Preview(c))!.Meals.Single(m=>m.Date.Day==8).Ingredients,i=>Assert.Equal(0,i.PreviousCount));
    }
    [Fact]
    public async Task Commands_and_source_refs_are_family_scoped_wall_can_add_and_cleanup_removes_receipts_and_sources()
    {
        using var c=await factory.DemoVisitorAsync();using var other=await factory.DemoVisitorAsync();using var stranger=factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await stranger.GetAsync("/api/meals/groceries?from="+From+"&to=2030-01-14")).StatusCode);
        var recipe=await Recipe(c,Numeric());await Plan(c,recipe);var p=(await Preview(c))!;var command=Command(p,Choice(p.Meals.Single()));
        Assert.Equal(HttpStatusCode.NotFound,(await other.PostAsJsonAsync("/api/meals/groceries",command)).StatusCode);
        using var wall=factory.Demo.CreateClient();var pairing=(await (await wall.PostAsync("/api/pairing",null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await c.PostAsJsonAsync("/api/devices",new PairDisplayRequest(pairing.Code,"Grocery wall"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{pairing.Id}/finish",null)).EnsureSuccessStatusCode();
        var batch=await Add(wall,command);
        var otherRecipe=await Recipe(other,Numeric());await Plan(other,otherRecipe);var op=(await Preview(other))!;
        var foreignTarget=Command(op,Choice(op.Meals.Single()) with {TargetItemId=batch.ItemIds.Single(),TargetVersion=Guid.NewGuid()});
        Assert.Equal(HttpStatusCode.NotFound,(await other.PostAsJsonAsync("/api/meals/groceries",foreignTarget)).StatusCode);
        await Add(other,Command(op,Choice(op.Meals.Single())) with {CommandId=command.CommandId});
        await using var unscoped=factory.DbContextFor(null);
        Assert.Empty(await unscoped.GroceryBatches.ToArrayAsync());Assert.Empty(await unscoped.GroceryContributions.ToArrayAsync());
        var seed=DemoFamily.Create(Guid.NewGuid(),DateTimeOffset.UtcNow);Assert.NotEmpty(seed.GroceryBatches);
        Assert.Contains(seed.Lists.SelectMany(l=>l.Items),i=>i.Contributions.Count>0);
        unscoped.Families.Add(seed);await unscoped.SaveChangesAsync();
        await unscoped.Families.IgnoreQueryFilters().Where(f=>f.Id==seed.Id).ExecuteDeleteAsync();
        Assert.Empty(await unscoped.GroceryBatches.IgnoreQueryFilters().Where(b=>b.FamilyId==seed.Id).ToArrayAsync());
        Assert.Empty(await unscoped.GroceryContributions.IgnoreQueryFilters().Where(b=>b.FamilyId==seed.Id).ToArrayAsync());
    }
    [Fact]
    public async Task Numeric_looking_recipe_text_stays_text_and_unsupported_manual_precision_never_loses_digits_in_a_merge()
    {
        using var c=await factory.DemoVisitorAsync();
        var recipe=await Recipe(c,Numeric("Beans",0,"cups"),new(Guid.NewGuid(),"Beans",null,"2","cups"));await Plan(c,recipe,servings:4);
        var p=(await Preview(c))!;var meal=p.Meals.Single();var batch=await Add(c,Command(p,Choice(meal,1)));
        var text=(await Grocery(c)).Items.Single(i=>i.Id==batch.ItemIds.Single());
        Assert.True(text.QuantityIsText);Assert.Equal("2",text.Quantity);Assert.Null(text.Sources!.Single().Quantity);
        var merge=Choice(meal) with {TargetItemId=text.Id,TargetVersion=text.Version};
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/meals/groceries",Command(p,merge))).StatusCode);
        var creationId=Guid.NewGuid();
        (await c.PostAsJsonAsync($"/api/lists/{p.Grocery.Id}/items",new CreateListItem(creationId,"Beans",null,"0.12345","cups"))).EnsureSuccessStatusCode();
        var precise=(await Grocery(c)).Items.Single(i=>i.CreationId==creationId);
        merge=Choice(meal) with {TargetItemId=precise.Id,TargetVersion=precise.Version};
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/meals/groceries",Command(p,merge))).StatusCode);
        Assert.Equal("0.12345",(await Grocery(c)).Items.Single(i=>i.Id==precise.Id).Quantity);
    }
    [Fact]
    public async Task Batch_revisions_commit_atomically_in_both_domains_and_validation_rejects_unreviewed_or_invalid_values()
    {
        using var c=await factory.DemoVisitorAsync();var recipe=await Recipe(c,Numeric());await Plan(c,recipe);var p=(await Preview(c))!;
        var command=Command(p,Choice(p.Meals.Single()));
        foreach(var bad in new[]{command with {Items=[]},command with {CommandId=Guid.Empty},command with {Items=[command.Items[0],command.Items[0]]},
            command with {Items=[command.Items[0] with {Quantity=-1}]},command with {Items=[command.Items[0] with {Quantity=0.00001m}]},
            command with {Items=[command.Items[0] with {QuantityText="to taste"}]}})
            Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/meals/groceries",bad)).StatusCode);
        await Add(c,command);var after=(await Preview(c))!;Assert.Equal(p.MealsChangeNumber+1,after.MealsChangeNumber);Assert.Equal(p.ListsChangeNumber+1,after.ListsChangeNumber);
        var family=(await c.GetFromJsonAsync<FamilyResponse>("/api/family",ApiFactory.Json))!;
        await using var db=factory.DbContextFor(family.Id);
        await using(var tx=await db.Database.BeginTransactionAsync()){
            db.GroceryContributions.Add(new GroceryContribution {Id=Guid.NewGuid(),FamilyId=family.Id,ListItemId=after.Grocery.Items.First().Id,
                Date=new(2030,1,7),Slot="Dinner",SnapshotKey=new string('a',64),IngredientId=Guid.NewGuid(),SourceData="{}"});
            await db.SaveChangesAsync();Assert.Equal(after.MealsChangeNumber+1,await db.Families.Select(f=>f.MealsChangeNumber).SingleAsync());
            Assert.Equal(after.ListsChangeNumber+1,await db.Families.Select(f=>f.ListsChangeNumber).SingleAsync());await tx.RollbackAsync();
        }
        Assert.Equal(after.MealsChangeNumber,(await Preview(c))!.MealsChangeNumber);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.GetAsync("/api/meals/groceries?from=2030-01-07&to=2030-02-01")).StatusCode);
    }
}
