import {describe,it,expect} from 'vitest';
import {bookingCashierUrl,parseBookingCashierTarget} from './bookingCashierTarget';
const club='b1150000-0000-4000-8000-000000000001',tour='b1150000-0000-4000-8000-000000000002',registration='b1150000-0000-4000-8000-000000000003';
const valid=()=>new URLSearchParams({club,bookingTour:tour,bookingRegistration:registration});
describe('booking Cashier read-only routing hint',()=>{
 it('round trips the exact tuple without amount or a mutation intent',()=>{
  const url=bookingCashierUrl(club,tour,registration);expect(url.startsWith('/ops/cashier/tour?')).toBe(true);
  expect(parseBookingCashierTarget(new URLSearchParams(url.split('?')[1]),club)).toEqual({kind:'target',clubId:club,tournamentId:tour,registrationId:registration});
  expect([...new URLSearchParams(url.split('?')[1]).keys()].sort()).toEqual(['bookingRegistration','bookingTour','club']);
 });
 it('leaves the ordinary Cashier route unchanged',()=>expect(parseBookingCashierTarget(new URLSearchParams({club}),club)).toEqual({kind:'none'}));
 it.each(['bookingTour','bookingRegistration','club'])('rejects duplicate %s even if values match',key=>{
  const params=valid();params.append(key,params.get(key)!);expect(parseBookingCashierTarget(params,club)).toEqual({kind:'invalid'});
 });
 it.each(['bookingTour','bookingRegistration','club'])('rejects missing %s',key=>{
  const params=valid();params.delete(key);expect(parseBookingCashierTarget(params,club)).toEqual({kind:'invalid'});
 });
 it('rejects a different current club, no club, and malformed identities',()=>{
  expect(parseBookingCashierTarget(valid(),tour)).toEqual({kind:'invalid'});
  expect(parseBookingCashierTarget(valid(),null)).toEqual({kind:'invalid'});
  const params=valid();params.set('bookingRegistration','reference-not-registration-uuid');
  expect(parseBookingCashierTarget(params,club)).toEqual({kind:'invalid'});
  expect(()=>bookingCashierUrl(club,tour,'reference-not-registration-uuid')).toThrow('invalid_booking_cashier_target');
 });
});
