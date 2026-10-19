using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGroceryWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CategoryId",
                table: "ListItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Quantity",
                table: "ListItems",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "ListItems",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsGrocery",
                table: "HouseholdLists",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "GroceryCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    HouseholdListId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsOther = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroceryCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroceryCategories_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroceryCategories_HouseholdLists_HouseholdListId",
                        column: x => x.HouseholdListId,
                        principalTable: "HouseholdLists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ListItems_CategoryId",
                table: "ListItems",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_HouseholdLists_FamilyId",
                table: "HouseholdLists",
                column: "FamilyId",
                unique: true,
                filter: "\"IsGrocery\"");

            migrationBuilder.CreateIndex(
                name: "IX_GroceryCategories_FamilyId",
                table: "GroceryCategories",
                column: "FamilyId");

            migrationBuilder.CreateIndex(
                name: "IX_GroceryCategories_HouseholdListId_SortOrder",
                table: "GroceryCategories",
                columns: new[] { "HouseholdListId", "SortOrder" });

            migrationBuilder.AddForeignKey(
                name: "FK_ListItems_GroceryCategories_CategoryId",
                table: "ListItems",
                column: "CategoryId",
                principalTable: "GroceryCategories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
            migrationBuilder.Sql("""
                INSERT INTO "HouseholdLists" ("Id", "FamilyId", "CreationId", "CreationRequest", "Name", "Archived", "IsGrocery", "Version")
                SELECT gen_random_uuid(), "Id", gen_random_uuid(), 'protected-grocery', 'Grocery', FALSE, TRUE, gen_random_uuid() FROM "Families";
                INSERT INTO "GroceryCategories" ("Id", "FamilyId", "HouseholdListId", "Name", "SortOrder", "IsOther")
                SELECT gen_random_uuid(), l."FamilyId", l."Id", c.name, c.position, c.name = 'Other'
                FROM "HouseholdLists" l
                CROSS JOIN (VALUES ('Produce', 0), ('Dairy', 1), ('Meat & fish', 2), ('Pantry', 3), ('Frozen', 4), ('Other', 5)) AS c(name, position)
                WHERE l."IsGrocery";
                UPDATE "Families" SET "ListsChangeNumber" = "ListsChangeNumber" + 1;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ListItems_GroceryCategories_CategoryId",
                table: "ListItems");

            migrationBuilder.DropTable(
                name: "GroceryCategories");

            migrationBuilder.DropIndex(
                name: "IX_ListItems_CategoryId",
                table: "ListItems");

            migrationBuilder.DropIndex(
                name: "IX_HouseholdLists_FamilyId",
                table: "HouseholdLists");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "ListItems");

            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "ListItems");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "ListItems");

            migrationBuilder.DropColumn(
                name: "IsGrocery",
                table: "HouseholdLists");
        }
    }
}
