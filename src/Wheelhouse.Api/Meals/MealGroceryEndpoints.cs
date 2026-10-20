using System.Data;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Lists;

namespace Wheelhouse.Api.Meals;

public static class MealGroceryEndpoints
{
    public static IEndpointRouteBuilder MapMealGroceries(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/meals/groceries").RequireAuthorization(Policies.Family);
        group.MapGet("", Preview); group.MapPost("", Add); return app;
    }
    private static IResult Invalid() => Results.ValidationProblem(new Dictionary<string, string[]> {
        ["groceries"] = ["Choose 1–500 reviewed recipe ingredients. Use nonnegative decimal quantities up to 1,000,000,000,000 (four decimal places) or quantity text up to 100 characters. Review matching unchecked grocery items before combining."] });
    private static IResult Conflict() => Results.Conflict(new { message = "Meals, prior purchases or grocery items changed. Review the preview again." });
    private static async Task<IResult> Preview(DateOnly from, DateOnly to, WheelhouseDbContext db, CancellationToken ct)
    {
        if (from.Year is < 1900 or >= 2200 || to > new DateOnly(2200,1,1) || to.DayNumber - from.DayNumber is < 1 or > 7) return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var family = await db.Families.Select(f => new {f.MealsChangeNumber,f.ListsChangeNumber}).SingleAsync(ct);
        var grocery = await db.HouseholdLists.AsNoTracking().Include(l=>l.Items).ThenInclude(i=>i.Contributions)
            .Include(l=>l.Categories).AsSplitQuery().SingleAsync(l=>l.IsGrocery,ct);
        var slots = await db.MealSlots.AsNoTracking().Where(m=>m.Date>=from && m.Date<to && m.Title!=null)
            .OrderBy(m=>m.Date).ThenBy(m=>m.Slot=="Breakfast"?0:m.Slot=="Lunch"?1:2).ToArrayAsync(ct);
        var counts = await db.GroceryContributions.AsNoTracking().Where(c=>c.Date>=from && c.Date<to)
            .GroupBy(c=>new {c.Date,c.Slot,c.SnapshotKey,c.IngredientId}).Select(g=>new {g.Key,Count=g.Count()}).ToArrayAsync(ct);
        var bySource = counts.ToDictionary(c=>(c.Key.Date,c.Key.Slot,c.Key.SnapshotKey,c.Key.IngredientId),c=>c.Count);
        var meals = slots.Select(m=>{
            var recipe = m.RecipeData is {} json ? RecipeJson.Read<RecipeSnapshot>(json) : null;
            var key = recipe is null ? null : GrocerySources.Key(m);
            var ingredients = recipe?.Content.Ingredients.Select(i=>i.Scale(m.Servings!.Value,recipe.Content.DefaultServings))
                .Select(i=>new GroceryIngredient(i.Id,i.Name,i.Quantity,i.QuantityText,i.Unit,bySource.GetValueOrDefault((m.Date,m.Slot,key!,i.Id)))).ToArray() ?? [];
            return new GroceryMeal(m.Date,m.Slot,m.Version,m.Title!,key,m.Servings,ingredients);
        }).ToArray();
        await tx.CommitAsync(ct); return Results.Ok(new GroceryPreview(from,to,family.MealsChangeNumber,family.ListsChangeNumber,HouseholdListResponse.From(grocery),meals));
    }

    private static async Task<IResult> Add(AddMealGroceries request, WheelhouseDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (request.CommandId==Guid.Empty || request.GroceryListId==Guid.Empty || request.Items is not {Length:>0 and <=500}
            || request.Items.Any(i=>i is null || i.Date.Year is <1900 or >=2200 || !MealEndpoints.Slots.Contains(i.Slot) || i.MealVersion==Guid.Empty
                || i.SnapshotKey is not {Length:64} || i.IngredientId==Guid.Empty || i.PreviousCount<0
                || i.Quantity is <0 or >1000000000000m || i.Quantity is {} q && decimal.Round(q,4)!=q
                || i.QuantityText?.Trim().Length>100 || i.Quantity is not null && !string.IsNullOrWhiteSpace(i.QuantityText)
                || i.TargetItemId.HasValue != i.TargetVersion.HasValue)
            || request.Items.Select(i=>(i.Date,i.Slot,i.IngredientId)).Distinct().Count()!=request.Items.Length) return Invalid();
        var choices = request.Items.Select(i=>i with {QuantityText=string.IsNullOrWhiteSpace(i.QuantityText)?null:i.QuantityText.Trim()})
            .OrderBy(i=>i.Date).ThenBy(i=>i.Slot).ThenBy(i=>i.IngredientId).ToArray();
        var fingerprint = RecipeJson.Write(new {request.GroceryListId,request.CombineNew,items=choices});
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 51))",ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.CurrentFamilyId!.Value.ToString()}, 61))",ct);
        var receipt = await db.GroceryBatches.SingleOrDefaultAsync(b=>b.Id==request.CommandId,ct);
        if (receipt is not null)
        {
            if (receipt.Request!=fingerprint) return Conflict();
            var saved=RecipeJson.Read<GroceryBatchResponse>(receipt.Result); await tx.CommitAsync(ct); return Results.Ok(saved);
        }
        var grocery = await db.HouseholdLists.Include(l=>l.Items).Include(l=>l.Categories).AsSplitQuery()
            .SingleOrDefaultAsync(l=>l.Id==request.GroceryListId && l.IsGrocery,ct);
        if (grocery is null) return Results.NotFound();
        var from=choices.Min(i=>i.Date); var to=choices.Max(i=>i.Date).AddDays(1);
        if(to.DayNumber-from.DayNumber>7) return Invalid();
        var meals=await db.MealSlots.Where(m=>m.Date>=from && m.Date<to).ToArrayAsync(ct);
        var counts=await db.GroceryContributions.Where(c=>c.Date>=from && c.Date<to).GroupBy(c=>new {c.Date,c.Slot,c.SnapshotKey,c.IngredientId})
            .Select(g=>new {g.Key,Count=g.Count()}).ToArrayAsync(ct);
        var previous=counts.ToDictionary(c=>(c.Key.Date,c.Key.Slot,c.Key.SnapshotKey,c.Key.IngredientId),c=>c.Count);
        var reviewed=new List<(GroceryChoice Choice,MealSlot Meal,RecipeSnapshot Recipe,Ingredient Ingredient,ListItem? Target)>();
        foreach(var choice in choices)
        {
            var meal=meals.SingleOrDefault(m=>m.Date==choice.Date && m.Slot==choice.Slot);
            if(meal?.RecipeData is null || meal.Version!=choice.MealVersion || GrocerySources.Key(meal)!=choice.SnapshotKey) return Conflict();
            var recipe=RecipeJson.Read<RecipeSnapshot>(meal.RecipeData);
            var ingredient=recipe.Content.Ingredients.SingleOrDefault(i=>i.Id==choice.IngredientId);
            if(ingredient is null) return Results.NotFound();
            var count=previous.GetValueOrDefault((choice.Date,choice.Slot,choice.SnapshotKey,choice.IngredientId));
            if(count!=choice.PreviousCount || count>0 && !choice.AllowAdditional) return Conflict();
            ListItem? target=null;
            if(choice.TargetItemId is {} targetId)
            {
                target=grocery.Items.SingleOrDefault(i=>i.Id==targetId);
                if(target is null) return Results.NotFound();
                if(target.Checked || target.Deleted || target.Version!=choice.TargetVersion) return Conflict();
                if(choice.Quantity is null || target.QuantityIsText || !GrocerySources.Number(target.Quantity,out _)
                    || GrocerySources.Normalize(target.Text)!=GrocerySources.Normalize(ingredient.Name)
                    || GrocerySources.Normalize(target.Unit)!=GrocerySources.Normalize(ingredient.Unit)) return Invalid();
            }
            reviewed.Add((choice,meal,recipe,ingredient,target));
        }
        var targets=new Dictionary<string,ListItem>(); var itemIds=new HashSet<Guid>();
        foreach(var (choice,meal,recipe,ingredient,existing) in reviewed)
        {
            var key=existing is not null ? existing.Id.ToString() : request.CombineNew && choice.Quantity is not null
                ? "new:"+RecipeJson.Write(new[]{GrocerySources.Normalize(ingredient.Name),GrocerySources.Normalize(ingredient.Unit)})
                : Guid.NewGuid().ToString();
            if(!targets.TryGetValue(key,out var item))
            {
                item=existing ?? new ListItem {Id=Guid.CreateVersion7(),FamilyId=grocery.FamilyId,HouseholdListId=grocery.Id,
                    CreationId=Guid.NewGuid(),CreationRequest="meal-batch:"+request.CommandId,Text=ingredient.Name,Unit=ingredient.Unit,
                    Quantity=choice.Quantity is null ? choice.QuantityText : "0",QuantityIsText=choice.Quantity is null && choice.QuantityText is not null,
                    CategoryId=grocery.Categories.Single(c=>c.IsOther).Id,SortOrder=grocery.Items.Count==0?0:grocery.Items.Max(i=>i.SortOrder)+1};
                if(existing is null){grocery.Items.Add(item);db.ListItems.Add(item);}
                targets.Add(key,item);
            }
            if(choice.Quantity is {} quantity)
            {
                GrocerySources.Number(item.Quantity,out var current); var total=current+quantity;
                if(total>1000000000000m) return Invalid();
                item.Quantity=GrocerySources.Format(total);
            }
            item.Version=Guid.NewGuid(); itemIds.Add(item.Id);
            db.GroceryContributions.Add(new GroceryContribution {Id=Guid.CreateVersion7(),FamilyId=grocery.FamilyId,ListItemId=item.Id,
                Date=meal.Date,Slot=meal.Slot,SnapshotKey=choice.SnapshotKey,IngredientId=ingredient.Id,
                SourceData=RecipeJson.Write(new GroceryOrigin(request.CommandId,meal.Date,meal.Slot,meal.Title!,ingredient.Name,
                    recipe.Id,recipe.Version,meal.Servings!.Value,choice.Quantity,choice.QuantityText,ingredient.Unit))});
        }
        grocery.Version=Guid.NewGuid();
        var result=new GroceryBatchResponse(request.CommandId,time.GetUtcNow(),choices.Length,itemIds.Order().ToArray());
        db.GroceryBatches.Add(new GroceryBatch {Id=request.CommandId,FamilyId=grocery.FamilyId,Request=fingerprint,Result=RecipeJson.Write(result)});
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Results.Ok(result);
    }
}
