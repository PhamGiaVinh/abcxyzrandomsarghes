export type BookingCashierTarget = {kind:'none'}|{kind:'invalid'}|{kind:'target';clubId:string;tournamentId:string;registrationId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A read/selection hint only. Never authority, payment intent, amount or generation inference. */
export function parseBookingCashierTarget(params:URLSearchParams,clubId:string|null):BookingCashierTarget {
 const tour=params.getAll('bookingTour'),registration=params.getAll('bookingRegistration'),clubs=params.getAll('club');
 if(!tour.length&&!registration.length)return {kind:'none'};
 if(tour.length!==1||registration.length!==1||clubs.length!==1||clubs[0]!==clubId
  ||![tour[0],registration[0],clubs[0]].every(value=>uuid.test(value)))return {kind:'invalid'};
 return {kind:'target',clubId:clubs[0],tournamentId:tour[0],registrationId:registration[0]};
}
export function bookingCashierUrl(clubId:string,tournamentId:string,registrationId:string):string {
 const params=new URLSearchParams({club:clubId,bookingTour:tournamentId,bookingRegistration:registrationId});
 if(parseBookingCashierTarget(params,clubId).kind!=='target')throw new Error('invalid_booking_cashier_target');
 return '/ops/cashier/tour?'+params.toString();
}
