/** Shared by the ordinary cost entry and the explicitly funded Cashier entry. */
export function parseExpenseAmount(input:string):number|null{
 const value=input.trim();
 if(!/^-?(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(value))return null;
 const amount=Number(value.replace(/\./g,''));
 return Number.isSafeInteger(amount)?amount:null;
}
