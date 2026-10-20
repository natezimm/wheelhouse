using System;
using System.Collections.Generic;
using System.Linq;

namespace Wheelhouse.Api.Demo;

/// <summary>
/// Dynamic, self-healing demo seed generator for the fictional Marlowe family.
/// Every date is computed relative to the family-local date when the demo copy is created,
/// ensuring appointments, recurring events, chores, meal plans, and grocery batches never go stale.
/// </summary>
public static class DemoSeedData
{
    public const string DefaultTimeZoneId = "America/New_York";

    /// <summary>
    /// Builds a complete, cohesive demo dataset anchored to <paramref name="utcNow"/> in the family's time zone.
    /// </summary>
    public static DemoHouseholdSnapshot Build(DateTimeOffset utcNow, string timeZoneId = DefaultTimeZoneId)
    {
        var anchor = new DemoDateAnchor(utcNow, timeZoneId);
        var family = BuildFamily(anchor);
        var members = BuildMembers(family.Id);

        var clara = members.Single(m => m.Name == "Clara");
        var julian = members.Single(m => m.Name == "Julian");
        var milo = members.Single(m => m.Name == "Milo");
        var nora = members.Single(m => m.Name == "Nora");

        var calendars = BuildCalendarSources(family.Id, clara.Id, julian.Id, milo.Id, nora.Id);
        var events = BuildEvents(anchor, family.Id, calendars);
        var chores = BuildChores(anchor, family.Id, clara.Id, julian.Id, milo.Id, nora.Id);
        var recipes = BuildRecipes(anchor, family.Id);
        var meals = BuildMealPlan(anchor, family.Id, recipes);
        var (lists, groceryBatches) = BuildListsAndGroceries(anchor, family.Id, recipes, meals);

        return new DemoHouseholdSnapshot(
            anchor.Today,
            family,
            members,
            calendars,
            events,
            chores.Definitions,
            chores.Plans,
            chores.Completions,
            lists,
            recipes,
            meals,
            groceryBatches);
    }

    // -------------------------------------------------------------------------
    // 1. FAMILY & MEMBERS
    // -------------------------------------------------------------------------

    private static DemoFamilySeed BuildFamily(DemoDateAnchor anchor) => new(
        Id: Guid.NewGuid(),
        Name: "The Marlowe Family",
        TimeZoneId: anchor.TimeZone.Id,
        LocationName: "Maplewood, NJ",
        Latitude: 40.73m,
        Longitude: -74.27m,
        CreatedAtUtc: anchor.UtcNow,
        ExpiresAtUtc: anchor.UtcNow.AddHours(24),
        CalendarChangeNumber: 1,
        ChoresChangeNumber: 1,
        ListsChangeNumber: 1,
        MealsChangeNumber: 1);

    private static IReadOnlyList<DemoMemberSeed> BuildMembers(Guid familyId) =>
    [
        new(Guid.NewGuid(), familyId, "Clara",  Role: "Parent", ColorHex: "#2563eb", SortOrder: 1),
        new(Guid.NewGuid(), familyId, "Julian", Role: "Parent", ColorHex: "#0d9488", SortOrder: 2),
        new(Guid.NewGuid(), familyId, "Milo",   Role: "Child",  ColorHex: "#d97706", SortOrder: 3),
        new(Guid.NewGuid(), familyId, "Nora",   Role: "Child",  ColorHex: "#db2777", SortOrder: 4)
    ];

    // -------------------------------------------------------------------------
    // 2. CALENDAR SOURCES & DYNAMIC EVENTS
    // -------------------------------------------------------------------------

    private static DemoCalendarSet BuildCalendarSources(
        Guid familyId,
        Guid claraId,
        Guid julianId,
        Guid miloId,
        Guid noraId) => new(
        Family:   new(Guid.NewGuid(), familyId, MemberId: null,     Name: "Marlowe Household",      CanWrite: true,  IsSelected: true),
        Clara:    new(Guid.NewGuid(), familyId, MemberId: claraId,  Name: "Clara",                  CanWrite: true,  IsSelected: true),
        Julian:   new(Guid.NewGuid(), familyId, MemberId: julianId, Name: "Julian",                 CanWrite: true,  IsSelected: true),
        Milo:     new(Guid.NewGuid(), familyId, MemberId: miloId,   Name: "Milo — School & Sports", CanWrite: true,  IsSelected: true),
        Nora:     new(Guid.NewGuid(), familyId, MemberId: noraId,   Name: "Nora — Activities",      CanWrite: true,  IsSelected: true),
        District: new(Guid.NewGuid(), familyId, MemberId: null,     Name: "Maplewood School District", CanWrite: false, IsSelected: true));

    private static IReadOnlyList<DemoEventSeed> BuildEvents(
        DemoDateAnchor anchor,
        Guid familyId,
        DemoCalendarSet calendars)
    {
        var events = new List<DemoEventSeed>();
        var today = anchor.Today;

        // --- TODAY (Always immediately visible on Phone Today & Wall Day/Week) ---
        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Product architecture sync",
            date: today, start: new(9, 30), end: new(10, 15),
            location: "Home office / Meet",
            description: "Review Q4 milestone checklist with design lead."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Coffee & grocery pickup run",
            date: today, start: new(12, 15), end: new(13, 0),
            location: "Village Market"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "After-school robotics club",
            date: today, start: new(15, 30), end: new(17, 0),
            location: "Middle School Lab 204",
            description: "Julian picking up on the way back."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Family Taco Night & porch hangout",
            date: today, start: new(18, 15), end: new(19, 30),
            location: "Home"));

        // --- TOMORROW ---
        var tomorrow = today.AddDays(1);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "Piano lesson with Ms. Alvarez",
            date: tomorrow, start: new(16, 0), end: new(16, 45),
            location: "Community Music Studio",
            description: "Bring level 2 sight-reading book."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Julian.Id,
            title: "Client site walkthrough",
            date: tomorrow, start: new(10, 30), end: new(12, 0),
            location: "Summit Ave Renovation"));

        // --- RELATIVE WEEKDAY ANCHORS (Always in the future, never stale) ---
        // Example requested: "A doctor's appointment is always next Tuesday"
        var nextTuesday = anchor.NextWeekday(DayOfWeek.Tuesday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Milo.Id,
            title: "Pediatric checkup — Dr. Patel",
            date: nextTuesday, start: new(10, 30), end: new(11, 30),
            location: "Maplewood Pediatrics, Suite 300",
            description: "Bring signed school sports physical form."));

        var nextWednesday = anchor.NextWeekday(DayOfWeek.Wednesday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Clara.Id,
            title: "Dental cleaning — Dr. Lin",
            date: nextWednesday, start: new(14, 0), end: new(15, 0),
            location: "Parkside Dental"));

        var nextThursday = anchor.NextWeekday(DayOfWeek.Thursday);
        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Vet booster visit for Barnaby",
            date: nextThursday, start: new(16, 30), end: new(17, 15),
            location: "Valley Veterinary Clinic",
            description: "Annual Bordetella & heartworm check."));

        var nextFriday = anchor.NextWeekday(DayOfWeek.Friday);
        events.Add(anchor.AllDayEvent(
            familyId, calendars.District.Id,
            title: "School Spirit Day — Wear Blue & Gold",
            startDate: nextFriday,
            endDateExclusive: nextFriday.AddDays(1),
            description: "Read-only event from Maplewood School District feed."));

        // --- UPCOMING WEEKEND ---
        var comingSaturday = anchor.UpcomingWeekend(DayOfWeek.Saturday);
        var comingSunday = comingSaturday.AddDays(1);

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Farmers market & bakery run",
            date: comingSaturday, start: new(9, 0), end: new(10, 30),
            location: "Springfield Ave Farmers Market"));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Nora.Id,
            title: "U10 Rec Soccer vs. South Orange",
            date: comingSaturday, start: new(11, 0), end: new(12, 15),
            location: "Memorial Park Field 2",
            description: "Nora is on orange-slice snack duty."));

        events.Add(anchor.TimedEvent(
            familyId, calendars.Family.Id,
            title: "Sunday roast dinner with Grandma Evelyn",
            date: comingSunday, start: new(17, 0), end: new(19, 30),
            location: "Home"));

        // --- NEXT WEEKEND MULTI-DAY ALL-DAY TRIP ---
        var nextWeekendSat = comingSaturday.AddDays(7);
        events.Add(anchor.AllDayEvent(
            familyId, calendars.Family.Id,
            title: "Catskills Cabin Weekend",
            startDate: nextWeekendSat,
            endDateExclusive: nextWeekendSat.AddDays(2), // Exclusive Monday end, matching Google Calendar
            location: "Phoenicia, NY",
            description: "Check-in after 3 PM Saturday; pack hiking boots and board games."));

        // --- EXPANDED RECURRING SERIES (-14 days to +42 days) ---
        // 1. Nora's Tue/Thu Soccer Practice (Weekly series)
        var soccerSeriesId = Guid.NewGuid().ToString("N");
        for (var offset = -14; offset <= 42; offset++)
        {
            var d = today.AddDays(offset);
            if (d.DayOfWeek is DayOfWeek.Tuesday or DayOfWeek.Thursday)
            {
                events.Add(anchor.TimedEvent(
                    familyId, calendars.Nora.Id,
                    title: "Soccer practice",
                    date: d, start: new(17, 15), end: new(18, 30),
                    location: "Dehart Park Turf",
                    seriesId: soccerSeriesId,
                    repeatRule: "Weekly"));
            }
        }

        // 2. Garbage & Recycling Night (Weekly on Wednesday evening)
        var trashSeriesId = Guid.NewGuid().ToString("N");
        for (var offset = -14; offset <= 42; offset++)
        {
            var d = today.AddDays(offset);
            if (d.DayOfWeek == DayOfWeek.Wednesday)
            {
                events.Add(anchor.TimedEvent(
                    familyId, calendars.Family.Id,
                    title: "Roll trash & recycling barrels to curb",
                    date: d, start: new(19, 30), end: new(20, 0),
                    seriesId: trashSeriesId,
                    repeatRule: "Weekly"));
            }
        }

        return events;
    }

    // -------------------------------------------------------------------------
    // 3. CHORES (ONE-TIME, REPEATING, OVERDUE, COMPLETED & HISTORY)
    // -------------------------------------------------------------------------

    private static DemoChoreSet BuildChores(
        DemoDateAnchor anchor,
        Guid familyId,
        Guid claraId,
        Guid julianId,
        Guid miloId,
        Guid noraId)
    {
        var today = anchor.Today;
        var seriesStart = anchor.StartOfWeek(today.AddDays(-14)); // Anchored to a Monday 2+ weeks ago

        var definitions = new List<DemoChoreDefinitionSeed>();
        var plans = new List<DemoChorePlanSeed>();
        var completions = new List<DemoChoreCompletionSeed>();

        // 1. Daily repeating chore (Milo) — due today (incomplete), completed yesterday & 3 days ago, missed 2 days ago
        var miloBrushId = Guid.NewGuid();
        definitions.Add(new(miloBrushId, familyId, IsRepeating: true, IsArchived: false, DefinitionVersion: 1));
        plans.Add(new(
            Id: Guid.NewGuid(),
            ChoreId: miloBrushId,
            FamilyId: familyId,
            EffectiveFrom: seriesStart,
            EndsOn: null,
            Title: "Brush teeth & make bed",
            Notes: "Put laundry in the hamper before heading downstairs.",
            AssignedMemberId: miloId,
            Frequency: "Daily",
            IntervalWeeks: 1,
            Weekdays: [0, 1, 2, 3, 4, 5, 6],
            PlanVersion: 1));

        completions.Add(new(miloBrushId, familyId, today.AddDays(-1), CompletedAtUtc: anchor.AtLocalTime(today.AddDays(-1), 7, 42), Version: 2));
        completions.Add(new(miloBrushId, familyId, today.AddDays(-3), CompletedAtUtc: anchor.AtLocalTime(today.AddDays(-3), 7, 50), Version: 2));
        // Note: today.AddDays(-2) intentionally has no completion row so History surfaces it as "Missed"

        // 2. Daily repeating chore (Nora) — already completed this morning!
        var noraDishwasherId = Guid.NewGuid();
        definitions.Add(new(noraDishwasherId, familyId, IsRepeating: true, IsArchived: false, DefinitionVersion: 1));
        plans.Add(new(
            Id: Guid.NewGuid(),
            ChoreId: noraDishwasherId,
            FamilyId: familyId,
            EffectiveFrom: seriesStart,
            EndsOn: null,
            Title: "Unload clean dishwasher rack",
            Notes: "Leave high-shelf mugs on the counter for Clara or Julian.",
            AssignedMemberId: noraId,
            Frequency: "Daily",
            IntervalWeeks: 1,
            Weekdays: [0, 1, 2, 3, 4, 5, 6],
            PlanVersion: 1));

        completions.Add(new(noraDishwasherId, familyId, today, CompletedAtUtc: anchor.AtLocalTime(today, 7, 55), Version: 2));
        completions.Add(new(noraDishwasherId, familyId, today.AddDays(-1), CompletedAtUtc: anchor.AtLocalTime(today.AddDays(-1), 8, 05), Version: 2));

        // 3. Selected-weekday repeating chore (Mon–Fri — Milo)
        var lunchBagId = Guid.NewGuid();
        definitions.Add(new(lunchBagId, familyId, IsRepeating: true, IsArchived: false, DefinitionVersion: 1));
        plans.Add(new(
            Id: Guid.NewGuid(),
            ChoreId: lunchBagId,
            FamilyId: familyId,
            EffectiveFrom: seriesStart,
            EndsOn: null,
            Title: "Empty school lunch bag & ice pack",
            Notes: "Put the ice pack back in the freezer drawer.",
            AssignedMemberId: miloId,
            Frequency: "Weekly",
            IntervalWeeks: 1,
            Weekdays: [1, 2, 3, 4, 5], // Mon–Fri
            PlanVersion: 1));

        // 4. Fortnightly repeating chore (Every 2 weeks on Saturday — Household)
        var dogBlanketsId = Guid.NewGuid();
        definitions.Add(new(dogBlanketsId, familyId, IsRepeating: true, IsArchived: false, DefinitionVersion: 1));
        plans.Add(new(
            Id: Guid.NewGuid(),
            ChoreId: dogBlanketsId,
            FamilyId: familyId,
            EffectiveFrom: seriesStart,
            EndsOn: null,
            Title: "Wash Barnaby's crate & couch blankets",
            Notes: "Warm cycle with extra rinse.",
            AssignedMemberId: null, // Household
            Frequency: "Weekly",
            IntervalWeeks: 2,
            Weekdays: [6], // Saturday
            PlanVersion: 1));

        // 5. One-time chore due TODAY (incomplete — Clara)
        definitions.Add(new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            IsRepeating: false,
            IsArchived: false,
            DefinitionVersion: 1,
            OneTimeTitle: "Sign Milo's science museum permission slip",
            OneTimeNotes: "Check is in the kitchen desk tray.",
            OneTimeAssigneeId: claraId,
            OneTimeDueDate: today,
            OneTimeCompletedAtUtc: null));

        // 6. One-time chore due TODAY (incomplete — Household)
        definitions.Add(new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            IsRepeating: false,
            IsArchived: false,
            DefinitionVersion: 1,
            OneTimeTitle: "Wipe down mudroom bench & sort sneakers",
            OneTimeNotes: "Match soccer cleats before tomorrow's practice.",
            OneTimeAssigneeId: null,
            OneTimeDueDate: today,
            OneTimeCompletedAtUtc: null));

        // 7. One-time OVERDUE chore (Due 2 days ago, still incomplete — Nora)
        definitions.Add(new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            IsRepeating: false,
            IsArchived: false,
            DefinitionVersion: 1,
            OneTimeTitle: "Return library graphic novels to drop box",
            OneTimeNotes: "3 books on the entryway shelf.",
            OneTimeAssigneeId: noraId,
            OneTimeDueDate: today.AddDays(-2),
            OneTimeCompletedAtUtc: null));

        // 8. One-time OVERDUE chore (Due yesterday, still incomplete — Julian)
        definitions.Add(new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            IsRepeating: false,
            IsArchived: false,
            DefinitionVersion: 1,
            OneTimeTitle: "Replace kitchen under-sink water filter",
            OneTimeNotes: "Replacement cartridge is in the basement utility bin.",
            OneTimeAssigneeId: julianId,
            OneTimeDueDate: today.AddDays(-1),
            OneTimeCompletedAtUtc: null));

        // 9. Archived one-time completed chore (4 days ago — visible in 31-day History as read-only)
        definitions.Add(new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            IsRepeating: false,
            IsArchived: true,
            DefinitionVersion: 2,
            OneTimeTitle: "Winterize backyard hose bib & store reel",
            OneTimeNotes: "Shut-off valve turned in basement.",
            OneTimeAssigneeId: julianId,
            OneTimeDueDate: today.AddDays(-4),
            OneTimeCompletedAtUtc: anchor.AtLocalTime(today.AddDays(-4), 16, 20)));

        return new DemoChoreSet(definitions, plans, completions);
    }

    // -------------------------------------------------------------------------
    // 4. SAVED RECIPES (SCALABLE NUMERIC + FREE-TEXT INGREDIENTS)
    // -------------------------------------------------------------------------

    private static IReadOnlyList<DemoRecipeSeed> BuildRecipes(DemoDateAnchor anchor, Guid familyId) =>
    [
        new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            Title: "Black Bean & Sweet Potato Tacos",
            DefaultServings: 4,
            SourceUrl: "https://example.com/recipes/sweet-potato-black-bean-tacos",
            Notes: "Milo likes extra lime wedges; keep jalapeños on the side.",
            Steps:
            [
                "Peel and cube sweet potatoes into 1/2-inch dice; toss with olive oil, cumin, and smoked paprika.",
                "Roast at 425°F for 25 minutes until caramelized and tender.",
                "Warm black beans with garlic and a splash of vegetable broth.",
                "Char corn tortillas briefly over a dry skillet and top with avocado, cotija, and cilantro."
            ],
            Ingredients:
            [
                new("Sweet potatoes",       Quantity: 1.5m,  QuantityText: "1.5",  Unit: "lb",      Category: "Produce"),
                new("Black beans",          Quantity: 2m,    QuantityText: "2",    Unit: "can",     Category: "Pantry"),
                new("Corn tortillas",       Quantity: 12m,   QuantityText: "12",   Unit: "count",   Category: "Pantry"),
                new("Ripe avocados",        Quantity: 2m,    QuantityText: "2",    Unit: "count",   Category: "Produce"),
                new("Cotija cheese",        Quantity: 4m,    QuantityText: "4",    Unit: "oz",      Category: "Dairy"),
                new("Fresh cilantro & lime",Quantity: null,  QuantityText: "to taste", Unit: null,  Category: "Produce")
            ],
            IsArchived: false,
            Version: 1),

        new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            Title: "Sheet-Pan Honey Mustard Salmon",
            DefaultServings: 4,
            SourceUrl: "https://example.com/recipes/sheet-pan-honey-mustard-salmon",
            Notes: "Quick weeknight dinner after soccer practice.",
            Steps:
            [
                "Preheat oven to 400°F and line a rimmed baking sheet with parchment.",
                "Toss trimmed green beans and halved baby potatoes with olive oil, salt, and pepper; roast 12 minutes.",
                "Whisk Dijon mustard, honey, lemon juice, and grated garlic; brush over salmon fillets.",
                "Nestle salmon onto the sheet pan and roast 10–12 minutes more until flaky."
            ],
            Ingredients:
            [
                new("Wild salmon fillets",  Quantity: 1.5m,  QuantityText: "1.5",  Unit: "lb",      Category: "Meat & fish"),
                new("Green beans",          Quantity: 1m,    QuantityText: "1",    Unit: "lb",      Category: "Produce"),
                new("Baby gold potatoes",   Quantity: 1.5m,  QuantityText: "1.5",  Unit: "lb",      Category: "Produce"),
                new("Dijon mustard",        Quantity: 2m,    QuantityText: "2",    Unit: "tbsp",    Category: "Pantry"),
                new("Honey",                Quantity: 1.5m,  QuantityText: "1.5",  Unit: "tbsp",    Category: "Pantry"),
                new("Flaky sea salt",       Quantity: null,  QuantityText: "to taste", Unit: null,  Category: "Pantry")
            ],
            IsArchived: false,
            Version: 1),

        new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            Title: "Sunday Herb Roast Chicken & Root Vegetables",
            DefaultServings: 6,
            SourceUrl: "https://example.com/recipes/sunday-herb-roast-chicken",
            Notes: "Scale to 6 servings when Grandma Evelyn joins on Sunday.",
            Steps:
            [
                "Pat whole chicken dry and season generously inside and out with salt, pepper, thyme, and rosemary.",
                "Scatter carrots, parsnips, and quartered shallots in a Dutch oven or roasting pan.",
                "Roast at 425°F for 70–80 minutes until thigh reaches 165°F; rest 15 minutes before carving."
            ],
            Ingredients:
            [
                new("Whole roasting chicken", Quantity: 4.5m, QuantityText: "4.5", Unit: "lb",      Category: "Meat & fish"),
                new("Carrots",                Quantity: 1m,   QuantityText: "1",   Unit: "lb",      Category: "Produce"),
                new("Parsnips",               Quantity: 1m,   QuantityText: "1",   Unit: "lb",      Category: "Produce"),
                new("Unsalted butter",        Quantity: 3m,   QuantityText: "3",   Unit: "tbsp",    Category: "Dairy"),
                new("Fresh thyme & rosemary", Quantity: 1m,   QuantityText: "1",   Unit: "bunch",   Category: "Produce")
            ],
            IsArchived: false,
            Version: 1),

        new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            Title: "Blueberry Buttermilk Pancakes",
            DefaultServings: 4,
            SourceUrl: null,
            Notes: "Weekend staple. Frozen wild blueberries work great too.",
            Steps:
            [
                "Whisk flour, baking powder, baking soda, and pinch of salt.",
                "Whisk buttermilk, eggs, and melted butter; fold gently into dry ingredients.",
                "Cook on a buttered griddle at 350°F, dotting each pancake with blueberries."
            ],
            Ingredients:
            [
                new("Buttermilk",           Quantity: 2m,    QuantityText: "2",    Unit: "cup",     Category: "Dairy"),
                new("Fresh blueberries",    Quantity: 1m,    QuantityText: "1",    Unit: "pint",    Category: "Produce"),
                new("Large eggs",           Quantity: 2m,    QuantityText: "2",    Unit: "count",   Category: "Dairy"),
                new("Pure maple syrup",     Quantity: null,  QuantityText: "for serving", Unit: null, Category: "Pantry")
            ],
            IsArchived: false,
            Version: 1),

        // Archived recipe to verify past planned slots keep their saved snapshot safely
        new(
            Id: Guid.NewGuid(),
            FamilyId: familyId,
            Title: "Summer Heirloom Tomato Galette",
            DefaultServings: 4,
            SourceUrl: null,
            Notes: "Archived at end of tomato season.",
            Steps: ["Roll pastry, layer ricotta and sliced heirloom tomatoes, bake at 400°F for 40 minutes."],
            Ingredients:
            [
                new("Heirloom tomatoes",    Quantity: 1.5m,  QuantityText: "1.5",  Unit: "lb",      Category: "Produce"),
                new("Whole-milk ricotta",   Quantity: 8m,    QuantityText: "8",    Unit: "oz",      Category: "Dairy")
            ],
            IsArchived: true,
            Version: 2)
    ];

    // -------------------------------------------------------------------------
    // 5. WEEKLY MEAL PLAN (DYNAMIC CURRENT WEEK + TODAY + PREVIOUS WEEK)
    // -------------------------------------------------------------------------

    private static IReadOnlyList<DemoMealSlotSeed> BuildMealPlan(
        DemoDateAnchor anchor,
        Guid familyId,
        IReadOnlyList<DemoRecipeSeed> recipes)
    {
        var tacos = recipes.Single(r => r.Title.StartsWith("Black Bean"));
        var salmon = recipes.Single(r => r.Title.StartsWith("Sheet-Pan Honey"));
        var chicken = recipes.Single(r => r.Title.StartsWith("Sunday Herb"));
        var pancakes = recipes.Single(r => r.Title.StartsWith("Blueberry"));
        var archivedGalette = recipes.Single(r => r.IsArchived);

        var today = anchor.Today;
        var tomorrow = today.AddDays(1);
        var weekStart = anchor.StartOfWeek(today); // Monday of current week
        var slots = new Dictionary<(DateOnly Date, string MealType), DemoMealSlotSeed>();

        void SetSlot(DateOnly date, string mealType, string title, string? notes = null, DemoRecipeSeed? recipe = null, int? servings = null)
        {
            var effectiveServings = servings ?? recipe?.DefaultServings;
            slots[(date, mealType)] = new DemoMealSlotSeed(
                Id: Guid.NewGuid(),
                FamilyId: familyId,
                Date: date,
                MealType: mealType,
                Title: title,
                Notes: notes,
                RecipeId: recipe?.Id,
                Servings: effectiveServings,
                IngredientSnapshot: recipe?.Ingredients,
                Version: 1);
        }

        // Baseline current week (Mon–Sun)
        SetSlot(weekStart.AddDays(0), "Breakfast", "Greek yogurt parfaits & granola");
        SetSlot(weekStart.AddDays(0), "Dinner",    salmon.Title, "Roast extra green beans for lunches", salmon, servings: 4);

        SetSlot(weekStart.AddDays(1), "Breakfast", "Scrambled eggs & sourdough toast");
        SetSlot(weekStart.AddDays(1), "Dinner",    tacos.Title, "Warm tortillas right before serving", tacos, servings: 4);

        SetSlot(weekStart.AddDays(2), "Lunch",     "Turkey & cheddar paninis with apple slices");
        SetSlot(weekStart.AddDays(2), "Dinner",    "Pesto tortellini with roasted broccoli", "Quick meal before trash night");

        SetSlot(weekStart.AddDays(3), "Dinner",    "Leftover buffet / clean out the fridge");

        SetSlot(weekStart.AddDays(4), "Dinner",    "Pizza Friday from Luigi's", "Order by 5:30 PM — half margherita, half mushroom");

        SetSlot(weekStart.AddDays(5), "Breakfast", pancakes.Title, "Milo flipping pancakes", pancakes, servings: 4);
        SetSlot(weekStart.AddDays(5), "Dinner",    "Grilled burgers & sweet potato fries");

        SetSlot(weekStart.AddDays(6), "Breakfast", "Everything bagels & cream cheese");
        SetSlot(weekStart.AddDays(6), "Dinner",    chicken.Title, "Grandma Evelyn visiting at 5 PM", chicken, servings: 6);

        // Guarantee TODAY always has Breakfast, Lunch, and a Recipe Dinner populated
        // so Phone Today ("Today's Meals") and "Meals to Groceries" always have rich data on any day of the week!
        SetSlot(today, "Breakfast", "Overnight oats with raspberries & chia seeds", "In mason jars on top shelf");
        SetSlot(today, "Lunch",     "Roasted veggie wraps & hummus", "Pack extra carrots for Milo");
        SetSlot(today, "Dinner",    tacos.Title, "Family Taco Night — slice avocados right before serving", tacos, servings: 4);

        // Guarantee TOMORROW has a Recipe Dinner so selecting Today + Tomorrow in "Add groceries from meals" scales & combines
        SetSlot(tomorrow, "Dinner", salmon.Title, "Quick sheet-pan dinner after piano lesson", salmon, servings: 4);

        // Seed a couple of slots in LAST WEEK so "Copy previous week" & archived recipe snapshots are testable immediately
        var prevWeekStart = weekStart.AddDays(-7);
        SetSlot(prevWeekStart.AddDays(1), "Dinner", tacos.Title, "Everyone loved the smoky sweet potatoes", tacos, servings: 4);
        SetSlot(prevWeekStart.AddDays(3), "Dinner", archivedGalette.Title, "Last heirloom tomatoes from the market", archivedGalette, servings: 4);
        SetSlot(prevWeekStart.AddDays(6), "Dinner", chicken.Title, "Saved carcass for homemade stock", chicken, servings: 6);

        return slots.Values.OrderBy(s => s.Date).ThenBy(s => s.MealType).ToList();
    }

    // -------------------------------------------------------------------------
    // 6. SHARED CHECKLISTS, PROTECTED GROCERY LIST & MEAL-TO-GROCERY BATCH
    // -------------------------------------------------------------------------

    private static (IReadOnlyList<DemoHouseholdListSeed> Lists, IReadOnlyList<DemoGroceryBatchSeed> Batches) BuildListsAndGroceries(
        DemoDateAnchor anchor,
        Guid familyId,
        IReadOnlyList<DemoRecipeSeed> recipes,
        IReadOnlyList<DemoMealSlotSeed> meals)
    {
        var today = anchor.Today;
        var todayDinner = meals.Single(m => m.Date == today && m.MealType == "Dinner");

        var groceryListId = Guid.NewGuid();
        var batchId = Guid.NewGuid();

        // Pre-seed a committed GroceryBatch from Today's Taco Dinner so reopening the meal-to-grocery
        // preview shows "Already added to groceries" badges and prevents accidental double-adding.
        var batch = new DemoGroceryBatchSeed(
            Id: batchId,
            FamilyId: familyId,
            OperationId: $"demo-batch-{today:yyyyMMdd}",
            CreatedAtUtc: anchor.AtLocalTime(today, 8, 30),
            SourceMealSlotIds: [todayDinner.Id]);

        var groceryItems = new List<DemoListItemSeed>
        {
            // Produce (mix of meal-sourced and manual items)
            new(Guid.NewGuid(), groceryListId, familyId, "Sweet potatoes",       Notes: "From Black Bean Tacos", Checked: false, SortOrder: 10, Category: "Produce",     Quantity: 1.5m, QuantityText: "1.5", Unit: "lb",    SourceBatchId: batchId, SourceMealSlotId: todayDinner.Id),
            new(Guid.NewGuid(), groceryListId, familyId, "Ripe avocados",        Notes: "From Black Bean Tacos", Checked: false, SortOrder: 20, Category: "Produce",     Quantity: 2m,   QuantityText: "2",   Unit: "count", SourceBatchId: batchId, SourceMealSlotId: todayDinner.Id),
            new(Guid.NewGuid(), groceryListId, familyId, "Honeycrisp apples",    Notes: "For school lunchboxes", Checked: false, SortOrder: 30, Category: "Produce",     Quantity: 6m,   QuantityText: "6",   Unit: "count"),
            new(Guid.NewGuid(), groceryListId, familyId, "Baby spinach",         Notes: null,                    Checked: true,  SortOrder: 40, Category: "Produce",     Quantity: 1m,   QuantityText: "1",   Unit: "box"),

            // Dairy
            new(Guid.NewGuid(), groceryListId, familyId, "Cotija cheese",        Notes: "From Black Bean Tacos", Checked: false, SortOrder: 50, Category: "Dairy",       Quantity: 4m,   QuantityText: "4",   Unit: "oz",    SourceBatchId: batchId, SourceMealSlotId: todayDinner.Id),
            new(Guid.NewGuid(), groceryListId, familyId, "Whole milk",           Notes: "Organic half-gallon",   Checked: false, SortOrder: 60, Category: "Dairy",       Quantity: 1m,   QuantityText: "1",   Unit: "half-gallon"),
            new(Guid.NewGuid(), groceryListId, familyId, "Unsalted butter",      Notes: null,                    Checked: true,  SortOrder: 70, Category: "Dairy",       Quantity: 1m,   QuantityText: "1",   Unit: "lb"),

            // Meat & fish
            new(Guid.NewGuid(), groceryListId, familyId, "Wild salmon fillets",  Notes: "For tomorrow's dinner", Checked: false, SortOrder: 80, Category: "Meat & fish", Quantity: 1.5m, QuantityText: "1.5", Unit: "lb"),

            // Pantry
            new(Guid.NewGuid(), groceryListId, familyId, "Black beans",          Notes: "Low sodium",            Checked: false, SortOrder: 90, Category: "Pantry",      Quantity: 2m,   QuantityText: "2",   Unit: "can",   SourceBatchId: batchId, SourceMealSlotId: todayDinner.Id),
            new(Guid.NewGuid(), groceryListId, familyId, "Corn tortillas",       Notes: "White or yellow corn",  Checked: false, SortOrder: 100, Category: "Pantry",     Quantity: 12m,  QuantityText: "12",  Unit: "count", SourceBatchId: batchId, SourceMealSlotId: todayDinner.Id),
            new(Guid.NewGuid(), groceryListId, familyId, "Whole-bean espresso",  Notes: "Counter Culture",       Checked: false, SortOrder: 110, Category: "Pantry",     Quantity: 1m,   QuantityText: "1",   Unit: "bag"),
            new(Guid.NewGuid(), groceryListId, familyId, "Crunchy peanut butter",Notes: null,                    Checked: true,  SortOrder: 120, Category: "Pantry",     Quantity: 1m,   QuantityText: "1",   Unit: "jar"),

            // Frozen
            new(Guid.NewGuid(), groceryListId, familyId, "Frozen mango chunks",  Notes: "For smoothies",         Checked: false, SortOrder: 130, Category: "Frozen",     Quantity: 1m,   QuantityText: "1",   Unit: "bag"),

            // Other
            new(Guid.NewGuid(), groceryListId, familyId, "Dishwasher pods",      Notes: "Fragrance-free",        Checked: false, SortOrder: 140, Category: "Other",      Quantity: 1m,   QuantityText: "1",   Unit: "tub")
        };

        var errandsListId = Guid.NewGuid();
        var packingListId = Guid.NewGuid();

        var lists = new List<DemoHouseholdListSeed>
        {
            new(
                Id: groceryListId,
                FamilyId: familyId,
                Name: "Grocery",
                IsGrocery: true, // Protected per-family grocery list (cannot be archived)
                IsArchived: false,
                SortOrder: 1,
                Version: 1,
                Items: groceryItems),

            new(
                Id: errandsListId,
                FamilyId: familyId,
                Name: "Weekend Errands",
                IsGrocery: false,
                IsArchived: false,
                SortOrder: 2,
                Version: 1,
                Items:
                [
                    new(Guid.NewGuid(), errandsListId, familyId, "Drop off Goodwill donation box",   Notes: "2 bags in trunk",               Checked: false, SortOrder: 10),
                    new(Guid.NewGuid(), errandsListId, familyId, "Pick up dry cleaning on Maple Ave",Notes: "Ticket is in Julian's wallet",  Checked: false, SortOrder: 20),
                    new(Guid.NewGuid(), errandsListId, familyId, "Buy 9V batteries for smoke alarms",Notes: "Need 4 pack",                   Checked: false, SortOrder: 30),
                    new(Guid.NewGuid(), errandsListId, familyId, "Refill library printer card",      Notes: null,                            Checked: true,  SortOrder: 40)
                ]),

            new(
                Id: packingListId,
                FamilyId: familyId,
                Name: "Catskills Cabin Packing",
                IsGrocery: false,
                IsArchived: false,
                SortOrder: 3,
                Version: 1,
                Items:
                [
                    new(Guid.NewGuid(), packingListId, familyId, "Rain shells & fleece layers",      Notes: "Check kids' sleeve lengths",    Checked: false, SortOrder: 10),
                    new(Guid.NewGuid(), packingListId, familyId, "Barnaby's travel bowl, leash & food", Notes: "Pack 4 days of kibble",      Checked: false, SortOrder: 20),
                    new(Guid.NewGuid(), packingListId, familyId, "Headlamps & trail map",            Notes: null,                            Checked: false, SortOrder: 30),
                    new(Guid.NewGuid(), packingListId, familyId, "Catan & Wingspan board games",     Notes: "Already stacked by front door", Checked: true,  SortOrder: 40)
                ])
        };

        return (lists, [batch]);
    }
}

// =============================================================================
// DYNAMIC DATE ANCHOR HELPER
// =============================================================================

/// <summary>
/// Resolves all demo dates and instants relative to the family's local time zone at seed time,
/// handling DST transitions (spring-forward gaps and fall-back overlaps) deterministically.
/// </summary>
public sealed class DemoDateAnchor
{
    public DateTimeOffset UtcNow { get; }
    public TimeZoneInfo TimeZone { get; }
    public DateOnly Today { get; }

    public DemoDateAnchor(DateTimeOffset utcNow, string timeZoneId)
    {
        UtcNow = utcNow;
        TimeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var localNow = TimeZoneInfo.ConvertTime(utcNow, TimeZone);
        Today = DateOnly.FromDateTime(localNow.DateTime);
    }

    /// <summary>
    /// Returns the next occurrence of <paramref name="targetDay"/> strictly after <see cref="Today"/>
    /// (1 to 7 days in the future), plus optional extra weeks.
    /// For example, "a doctor's appointment is always next Tuesday" is never in the past.
    /// </summary>
    public DateOnly NextWeekday(DayOfWeek targetDay, int extraWeeks = 0)
    {
        var daysAhead = ((int)targetDay - (int)Today.DayOfWeek + 7) % 7;
        if (daysAhead == 0)
        {
            daysAhead = 7; // Strictly in the future so an appointment is never earlier today/past
        }

        return Today.AddDays(daysAhead + (extraWeeks * 7));
    }

    /// <summary>
    /// Returns the upcoming Saturday or Sunday (including today if today is already that weekend day).
    /// </summary>
    public DateOnly UpcomingWeekend(DayOfWeek weekendDay)
    {
        var daysAhead = ((int)weekendDay - (int)Today.DayOfWeek + 7) % 7;
        return Today.AddDays(daysAhead);
    }

    /// <summary>
    /// Returns the Monday of the week containing <paramref name="date"/> (matching Wheelhouse's Monday week anchor).
    /// </summary>
    public DateOnly StartOfWeek(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return date.AddDays(-diff);
    }

    /// <summary>
    /// Converts a family-local <see cref="DateOnly"/> and wall-clock time to a UTC <see cref="DateTimeOffset"/>,
    /// shifting forward across spring-forward DST gaps and choosing the standard offset on fall-back overlaps.
    /// </summary>
    public DateTimeOffset AtLocalTime(DateOnly date, int hour, int minute)
    {
        var unspecified = date.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Unspecified);
        if (TimeZone.IsInvalidTime(unspecified))
        {
            unspecified = unspecified.AddHours(1);
        }

        var offset = TimeZone.IsAmbiguousTime(unspecified)
            ? TimeZone.GetAmbiguousTimeOffsets(unspecified).Min()
            : TimeZone.GetUtcOffset(unspecified);
        return new DateTimeOffset(unspecified, offset).ToUniversalTime();
    }

    public DemoEventSeed TimedEvent(
        Guid familyId,
        Guid calendarSourceId,
        string title,
        DateOnly date,
        TimeOnly start,
        TimeOnly end,
        string? location = null,
        string? description = null,
        string? seriesId = null,
        string? repeatRule = null) => new(
        Id: Guid.NewGuid(),
        FamilyId: familyId,
        CalendarSourceId: calendarSourceId,
        Title: title,
        IsAllDay: false,
        StartUtc: AtLocalTime(date, start.Hour, start.Minute),
        EndUtc: AtLocalTime(date, end.Hour, end.Minute),
        StartDate: null,
        EndDateExclusive: null,
        Location: location,
        Description: description,
        SeriesId: seriesId,
        RepeatFrequency: repeatRule,
        ETag: $"\"demo-{Guid.NewGuid():N}\"");

    public DemoEventSeed AllDayEvent(
        Guid familyId,
        Guid calendarSourceId,
        string title,
        DateOnly startDate,
        DateOnly endDateExclusive,
        string? location = null,
        string? description = null) => new(
        Id: Guid.NewGuid(),
        FamilyId: familyId,
        CalendarSourceId: calendarSourceId,
        Title: title,
        IsAllDay: true,
        StartUtc: null,
        EndUtc: null,
        StartDate: startDate,
        EndDateExclusive: endDateExclusive,
        Location: location,
        Description: description,
        SeriesId: null,
        RepeatFrequency: null,
        ETag: $"\"demo-{Guid.NewGuid():N}\"");
}

// =============================================================================
// SEED DATA RECORDS
// =============================================================================

public sealed record DemoHouseholdSnapshot(
    DateOnly AnchorDate,
    DemoFamilySeed Family,
    IReadOnlyList<DemoMemberSeed> Members,
    DemoCalendarSet Calendars,
    IReadOnlyList<DemoEventSeed> Events,
    IReadOnlyList<DemoChoreDefinitionSeed> ChoreDefinitions,
    IReadOnlyList<DemoChorePlanSeed> ChorePlans,
    IReadOnlyList<DemoChoreCompletionSeed> ChoreCompletions,
    IReadOnlyList<DemoHouseholdListSeed> Lists,
    IReadOnlyList<DemoRecipeSeed> Recipes,
    IReadOnlyList<DemoMealSlotSeed> MealSlots,
    IReadOnlyList<DemoGroceryBatchSeed> GroceryBatches);

public sealed record DemoFamilySeed(
    Guid Id,
    string Name,
    string TimeZoneId,
    string LocationName,
    decimal Latitude,
    decimal Longitude,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    long CalendarChangeNumber,
    long ChoresChangeNumber,
    long ListsChangeNumber,
    long MealsChangeNumber);

public sealed record DemoMemberSeed(
    Guid Id,
    Guid FamilyId,
    string Name,
    string Role,
    string ColorHex,
    int SortOrder);

public sealed record DemoCalendarSourceSeed(
    Guid Id,
    Guid FamilyId,
    Guid? MemberId,
    string Name,
    bool CanWrite,
    bool IsSelected);

public sealed record DemoCalendarSet(
    DemoCalendarSourceSeed Family,
    DemoCalendarSourceSeed Clara,
    DemoCalendarSourceSeed Julian,
    DemoCalendarSourceSeed Milo,
    DemoCalendarSourceSeed Nora,
    DemoCalendarSourceSeed District)
{
    public IReadOnlyList<DemoCalendarSourceSeed> All => [Family, Clara, Julian, Milo, Nora, District];
}

public sealed record DemoEventSeed(
    Guid Id,
    Guid FamilyId,
    Guid CalendarSourceId,
    string Title,
    bool IsAllDay,
    DateTimeOffset? StartUtc,
    DateTimeOffset? EndUtc,
    DateOnly? StartDate,
    DateOnly? EndDateExclusive,
    string? Location,
    string? Description,
    string? SeriesId,
    string? RepeatFrequency,
    string ETag);

public sealed record DemoChoreDefinitionSeed(
    Guid Id,
    Guid FamilyId,
    bool IsRepeating,
    bool IsArchived,
    int DefinitionVersion,
    string? OneTimeTitle = null,
    string? OneTimeNotes = null,
    Guid? OneTimeAssigneeId = null,
    DateOnly? OneTimeDueDate = null,
    DateTimeOffset? OneTimeCompletedAtUtc = null);

public sealed record DemoChorePlanSeed(
    Guid Id,
    Guid ChoreId,
    Guid FamilyId,
    DateOnly EffectiveFrom,
    DateOnly? EndsOn,
    string Title,
    string? Notes,
    Guid? AssignedMemberId,
    string Frequency,
    int IntervalWeeks,
    IReadOnlyList<int> Weekdays,
    int PlanVersion);

public sealed record DemoChoreCompletionSeed(
    Guid ChoreId,
    Guid FamilyId,
    DateOnly DueDate,
    DateTimeOffset CompletedAtUtc,
    int Version);

public sealed record DemoChoreSet(
    IReadOnlyList<DemoChoreDefinitionSeed> Definitions,
    IReadOnlyList<DemoChorePlanSeed> Plans,
    IReadOnlyList<DemoChoreCompletionSeed> Completions);

public sealed record DemoRecipeIngredientSeed(
    string Name,
    decimal? Quantity,
    string QuantityText,
    string? Unit,
    string Category);

public sealed record DemoRecipeSeed(
    Guid Id,
    Guid FamilyId,
    string Title,
    int DefaultServings,
    string? SourceUrl,
    string? Notes,
    IReadOnlyList<string> Steps,
    IReadOnlyList<DemoRecipeIngredientSeed> Ingredients,
    bool IsArchived,
    int Version);

public sealed record DemoMealSlotSeed(
    Guid Id,
    Guid FamilyId,
    DateOnly Date,
    string MealType,
    string Title,
    string? Notes,
    Guid? RecipeId,
    int? Servings,
    IReadOnlyList<DemoRecipeIngredientSeed>? IngredientSnapshot,
    int Version);

public sealed record DemoListItemSeed(
    Guid Id,
    Guid ListId,
    Guid FamilyId,
    string Text,
    string? Notes,
    bool Checked,
    int SortOrder,
    string? Category = null,
    decimal? Quantity = null,
    string? QuantityText = null,
    string? Unit = null,
    Guid? SourceBatchId = null,
    Guid? SourceMealSlotId = null,
    int Version = 1);

public sealed record DemoHouseholdListSeed(
    Guid Id,
    Guid FamilyId,
    string Name,
    bool IsGrocery,
    bool IsArchived,
    int SortOrder,
    int Version,
    IReadOnlyList<DemoListItemSeed> Items);

public sealed record DemoGroceryBatchSeed(
    Guid Id,
    Guid FamilyId,
    string OperationId,
    DateTimeOffset CreatedAtUtc,
    IReadOnlyList<Guid> SourceMealSlotIds);
