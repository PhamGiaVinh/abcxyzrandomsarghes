import {describe,it,expect,vi} from 'vitest';
import {tournamentStatusCategory,tournamentStatusLabel} from './statusPresentation';
import viLocale from '@/i18n/locales/vi.json';
import enLocale from '@/i18n/locales/en.json';
import zhLocale from '@/i18n/locales/zh-CN.json';
import koLocale from '@/i18n/locales/ko.json';
import jaLocale from '@/i18n/locales/ja.json';
import thLocale from '@/i18n/locales/th.json';

describe('read-only tournament status presentation',()=>{
 it.each([
  ['scheduled','upcoming','upcoming'],['upcoming','upcoming','upcoming'],
  ['registration_open','upcoming','registering'],['registering','upcoming','registering'],['drawing','upcoming','drawing'],
  ['active','running','active'],['playing','running','playing'],['running','running','playing'],['live','running','live'],['final_table','running','final_table'],
  ['break','break','break'],['paused','break','paused'],
  ['finished','closed','completed'],['completed','closed','completed'],['cancelled','closed','cancelled'],
 ])('presents %s without changing its writer value',(status,category,label)=>{
  const translate=vi.fn(key=>key);
  expect(tournamentStatusCategory(status)).toBe(category);
  expect(tournamentStatusLabel(status,translate)).toBe(`tournamentLive.statusLabels.${label}`);
  for(const locale of [viLocale,enLocale,zhLocale,koLocale,jaLocale,thLocale]) {
   const labels=locale.tournamentLive.statusLabels as Record<string,string>;
   expect(labels[label]).toBeTypeOf('string');expect(labels[label].trim()).not.toBe('');
  }
 });
 it.each([null,undefined,0,'',' '])('does not claim missing status %s is completed',status=>{
  expect(tournamentStatusCategory(status)).toBe('unknown');
  expect(tournamentStatusLabel(status,key=>key)).toBe('tournamentLive.statusLabels.unknown');
 });
 it.each(['future_status','constructor','toString','__proto__'])('retains unknown %s as text, not completed',status=>{
  const translate=vi.fn();
  expect(tournamentStatusCategory(status)).toBe('unknown');
  expect(tournamentStatusLabel(status,translate)).toBe(status.replace(/_/g,' '));
  expect(translate).not.toHaveBeenCalled();
 });
});
