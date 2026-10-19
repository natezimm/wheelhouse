using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedLists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "ListsChangeNumber",
                table: "Families",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "HouseholdLists",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationRequest = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HouseholdLists", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HouseholdLists_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ListItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    HouseholdListId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationRequest = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Checked = table.Column<bool>(type: "boolean", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<long>(type: "bigint", nullable: false),
                    Version = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ListItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ListItems_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ListItems_HouseholdLists_HouseholdListId",
                        column: x => x.HouseholdListId,
                        principalTable: "HouseholdLists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HouseholdLists_FamilyId_CreationId",
                table: "HouseholdLists",
                columns: new[] { "FamilyId", "CreationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ListItems_FamilyId_CreationId",
                table: "ListItems",
                columns: new[] { "FamilyId", "CreationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ListItems_HouseholdListId_SortOrder",
                table: "ListItems",
                columns: new[] { "HouseholdListId", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ListItems");

            migrationBuilder.DropTable(
                name: "HouseholdLists");

            migrationBuilder.DropColumn(
                name: "ListsChangeNumber",
                table: "Families");
        }
    }
}
