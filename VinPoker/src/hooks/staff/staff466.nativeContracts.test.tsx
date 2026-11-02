import {createElement,type ReactNode} from 'react';
import {execFileSync} from 'node:child_process';
import {renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({actor:'',read:vi.fn(),rpc:vi.fn(),session:{access_token:'LOCAL_STAFF466_ONLY'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:f.actor},session:f.session,loading:false})}));
vi.mock('@/lib/staffApp/dataSource',()=>({staffDataSource:()=> 'live'}));
vi.mock('@/lib/staffApp/selectedClub',()=>({useSelectedStaffId:()=>null,setSelectedStaffId:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc,from:()=>{
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>f.read()};return q;
}}}));
import {useStaffLink} from './useStaffLink';
import {useStaffSalary} from './useStaffSalary';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
function sql(statement:string){return execFileSync('wsl',args,{input:statement,encoding:'utf8',timeout:10000}).trim();}
const uuid=(value:string)=>{if(!/^[a-f0-9-]{36}$/.test(value))throw new Error('native466 invalid identifier');return value;};
function authenticated(statement:string){return JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';
 SET LOCAL request.jwt.claim.sub='${uuid(f.actor)}';SET LOCAL ROLE authenticated;${statement}ROLLBACK;`));}
describe.skipIf(process.env.VINPOKER_NATIVE_DB_TEST!=='1')('Staff466 actual native contracts through product hooks',()=>{
 it.each([
  ['33850c0b-e668-4e21-b164-115c02f84fe8','bda5ba30-ce0c-455c-ac54-d22f1e4728d8'],
  ['654053ed-799d-4c98-b331-3f786d125709','c3e542e5-120a-45d9-920d-a66626429009'],
  ['ea832cf9-971b-468a-acfc-8f826b360585','4883d0f6-f58b-4fcf-a124-4aa2fed86c65'],
 ])('reads retained self staff %s and consumes canonical salary without fallback',async(staff,actor)=>{
  expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();")).toBe('vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
  f.actor=actor;f.session={access_token:`LOCAL_STAFF466_${actor}`};
  f.read.mockImplementation(async()=>({data:authenticated(`SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM
   (SELECT s.id,s.club_id,s.user_id,s.full_name,s.phone,s.department,s.employment_type,s.monthly_salary_vnd,s.hourly_rate_vnd,
    s.standard_hours_per_shift,s.status,jsonb_build_object('name',c.name) AS clubs
    FROM public.staff s LEFT JOIN public.clubs c ON c.id=s.club_id WHERE s.user_id='${uuid(actor)}' AND s.deleted_at IS NULL ORDER BY s.full_name) s;`),error:null}));
  let rawSalary:Record<string,unknown>|undefined;
  f.rpc.mockImplementation(async(name:string,body:{p_staff_id:string})=>{
   expect(name).toBe('get_my_staff_salary');expect(body.p_staff_id).toBe(staff);
   rawSalary=authenticated(`SELECT public.get_my_staff_salary('${uuid(staff)}');`);
   return {data:rawSalary,error:null};
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const wrapper=({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);
  const h=renderHook(()=>{const link=useStaffLink();return {link,salary:useStaffSalary(link.staff)};},{wrapper});
  try{
   await waitFor(()=>expect(h.result.current.salary.salary).not.toBeNull());
   expect(h.result.current.link.error).toBeNull();expect(h.result.current.link.staff?.staffId).toBe(staff);
   expect(h.result.current.link.staff?.userId).toBe(actor);
   expect(h.result.current.salary.salary?.balanceVnd).toBe(rawSalary?.balance_vnd);
   expect(h.result.current.salary.salary?.accruedMinutes).toBe(rawSalary?.accrued_minutes);
   expect(h.result.current.salary.salary?.monthlySalaryVnd).toBe(rawSalary?.monthly_salary_vnd);
  }finally{h.unmount();client.clear();}
 });
});
