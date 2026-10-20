import { GroceryPreview } from '../core/meal-groceries';
export function groceryPreview(revision=1,from='2026-11-02'):GroceryPreview {
  const to=new Date(Date.parse(from)+7*86400000).toISOString().slice(0,10);
  return {from,to,mealsChangeNumber:revision,listsChangeNumber:revision,
    grocery:{id:'grocery',creationId:'grocery-created',name:'Grocery',isGrocery:true,archived:false,version:'g1',categories:[{id:'other',name:'Other',isOther:true}],
      items:[{id:'pasta',creationId:'pasta-created',text:'Pasta',quantity:'2',unit:'g',notes:null,categoryId:'other',checked:false,deleted:false,sortOrder:0,version:'p1'}]},
    meals:[{date:from,slot:'Dinner',version:'meal1',title:'Tomato pasta',snapshotKey:'a'.repeat(64),servings:6,
      ingredients:[{id:'i1',name:'Pasta',quantity:600,quantityText:null,unit:'g',previousCount:0},{id:'i2',name:'Salt',quantity:null,quantityText:'to taste',unit:null,previousCount:0}]},
      {date:from,slot:'Lunch',version:'meal2',title:'Sandwiches',snapshotKey:null,servings:null,ingredients:[]}]};
}
