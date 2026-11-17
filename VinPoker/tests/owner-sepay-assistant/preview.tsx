// Isolated visual fixture only. No real accounts, network credentials or bank calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/i18n';
import i18n from '@/i18n';
import '@/index.css';
import OwnerAssistantPanel from '@/components/finance/OwnerAssistantPanel';
import { businessDay } from '../../supabase/functions/owner-sepay-assistant/contracts';
void i18n.changeLanguage('vi');
const client = { functions: { invoke: async (_name: string, options: { body: { clubId: string; requestId: string; question: string } }) => {
  const day = businessDay(new Date());
  return { error: null, data: { version: 'owner-sepay-assistant-v1', clubId: options.body.clubId, requestId: options.body.requestId,
    plan: { intent: 'cashflow', from: day.slice(0,7) + '-01', to: day, search: null },
    evidence: { source: 'sepay-api-v2', accountLast4: '0000', from: day.slice(0,7) + '-01', to: day, fetchedAt: new Date().toISOString(), complete: true, transactions: [],
      totals: { incoming: 12000000, outgoing: 4250000, net: 7750000, countIn: 12, countOut: 7, withoutCode: 2 } } } };
} } };
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl space-y-5 px-4 py-8"><p className="text-xs text-muted-foreground">BẢN KIỂM TRA GIAO DIỆN · DỮ LIỆU MINH HỌA</p><h1 className="text-2xl font-semibold text-primary">Tài chính &amp; Đối soát</h1><OwnerAssistantPanel client={client as never} clubId="22222222-2222-4222-8222-222222222222" clubName="CLB minh họa" actorId="owner-fixture" sessionToken="not-a-real-session" /></main>);
