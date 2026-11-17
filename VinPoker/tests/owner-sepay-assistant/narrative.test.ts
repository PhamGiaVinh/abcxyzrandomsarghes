import { describe, expect, it } from 'vitest';
import { fillAnswer, validateAnswerTemplate } from '../../supabase/functions/owner-sepay-assistant/geminiPlanner';
const template='Từ {{from}} đến {{to}}, tiền vào là {{incoming}}, tiền ra là {{outgoing}}. Chênh lệch vào trừ ra là {{net}}.';
describe('generative financial narrative numeric boundary',()=>{
  it('substitutes source amounts only after validating the generated template',()=>{
    expect(fillAnswer(template,{from:'2026-11-01',to:'2026-11-17',incoming:'500.000 ₫',outgoing:'100.000 ₫',net:'400.000 ₫'})).toContain('500.000 ₫');
  });
  it('rejects invented numbers, references, HTML and unsupported financial conclusions',()=>{
    for(const suffix of [' Có 7 giao dịch.',' https://evil.test',' <script>',' Lợi nhuận tăng trưởng.',' {{secret}}']) expect(()=>validateAnswerTemplate(template+suffix)).toThrow();
    expect(()=>validateAnswerTemplate(template.replace('{{net}}','một triệu'))).toThrow();
    expect(()=>validateAnswerTemplate('Từ {{from}} đến {{to}}, tiền vào là {{outgoing}}, tiền ra là {{incoming}}. Chênh lệch vào trừ ra là {{net}}.')).toThrow();
    expect(()=>validateAnswerTemplate(template+' Tài khoản an toàn.')).toThrow();
  });
});
