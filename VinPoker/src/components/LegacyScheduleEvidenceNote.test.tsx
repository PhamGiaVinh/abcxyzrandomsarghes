// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import i18n from '@/i18n';
import {LegacyScheduleEvidenceNote} from './LegacyScheduleEvidenceNote';
afterEach(async()=>{cleanup();await i18n.changeLanguage('vi');});
describe('legacy schedule evidence disclosure',()=>{
 for(const locale of ['vi','en','zh-CN','ko','ja','th'])it(`renders actual ${locale} disclosure without inventing a date or approval`,async()=>{
  await i18n.changeLanguage(locale);render(<LegacyScheduleEvidenceNote/>);
  const text=i18n.getResource(locale,'translation','legacyScheduleEvidence');
  expect(typeof text).toBe('string');expect(text.length).toBeGreaterThan(20);
  expect(screen.getByRole('note')).toHaveTextContent(text);
  expect(screen.getByRole('note').querySelector('time')).toBeNull();
 });
});
