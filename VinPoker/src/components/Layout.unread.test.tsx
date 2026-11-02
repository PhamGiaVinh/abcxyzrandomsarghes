import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const h=vi.hoisted(()=>({user:{id:'test-actor'} as {id:string}|null,unread:{count:42,error:null as string|null}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.user,signOut:vi.fn()})}));
vi.mock('@/hooks/useUnreadChats',()=>({useUnreadChats:()=>h.unread}));
vi.mock('@/hooks/useAdminPendingCounts',()=>({useAdminPendingCounts:()=>({total:0})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/components/ErrorBoundary',()=>({ErrorBoundary:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('@/components/LanguageSwitcher',()=>({LanguageSwitcher:()=>null}));
vi.mock('@/components/NotificationBell',()=>({NotificationBell:()=>null}));
vi.mock('@/components/DuplicateNameGuard',()=>({DuplicateNameGuard:()=>null}));
vi.mock('@/components/SupportFloatingButton',()=>({SupportFloatingButton:()=>null}));
vi.mock('@/components/InstallPWAButton',()=>({InstallPWAButton:()=><button aria-label="Install test"/>}));
vi.mock('@/components/ThemeSwitcher',()=>({ThemeSwitcher:()=>null}));
vi.mock('@/components/MyQrSheet',()=>({MyQrSheet:()=>null}));
vi.mock('@/components/LogoFanButton',()=>({LogoFanButton:()=>null}));
vi.mock('@/components/RegisteredBadge',()=>({RegisteredBadge:({placement}:{placement?:string})=><span data-testid="registration-placement">{placement??'floating'}</span>}));
import {Layout} from './Layout';
describe('Layout unread availability',()=>{
 it.each(['/tournament/test-tour','/tournament/test-tour/'])('keeps the install floater away from fixed tournament actions on %s',(route)=>{
  render(<MemoryRouter initialEntries={[route]}><Layout/></MemoryRouter>);
  expect(screen.queryByRole('button',{name:'Install test'})).toBeNull();
 });
 it.each(['/','/club/test-club'])('retains the install entry point on %s',(route)=>{
  render(<MemoryRouter initialEntries={[route]}><Layout/></MemoryRouter>);
  expect(screen.getByRole('button',{name:'Install test'})).toBeTruthy();
 });
 it('keeps the DM registration notice in content, not floating over the composer',()=>{
  render(<MemoryRouter initialEntries={['/dm/test-peer']}><Layout/></MemoryRouter>);
  const notice=screen.getByTestId('registration-placement');
  expect(notice).toHaveTextContent('inline');
  expect(notice.closest('main')).not.toBeNull();
  expect(notice.closest('nav')).toBeNull();
 });
 beforeEach(()=>{h.user={id:'test-actor'};h.unread={count:42,error:null};});
 it('marks desktop and mobile unread as unverified instead of presenting a retained count as current',async()=>{
  h.unread.error='Không xác minh được số tin nhắn chưa đọc.';
  render(<MemoryRouter><Layout/></MemoryRouter>);
  const inbox=screen.getByRole('link',{name:`layout.inbox: ${h.unread.error}`});
  expect(inbox).toHaveAttribute('href','/inbox');expect(inbox).toHaveTextContent('!');expect(inbox).not.toHaveTextContent('42');
  fireEvent.keyDown(screen.getByRole('button',{name:'Menu'}),{key:'Enter'});
  expect(await screen.findByRole('menuitem',{name:new RegExp(h.unread.error)})).toHaveTextContent('!');
 });
 it('preserves the healthy count and hides private unread indicators after logout',()=>{
  h.unread.count=103;const mounted=render(<MemoryRouter><Layout/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'layout.inbox: 99+'})).toHaveTextContent('99+');
  h.user=null;h.unread.error='unavailable';mounted.rerender(<MemoryRouter><Layout/></MemoryRouter>);
  expect(screen.queryByRole('link',{name:/layout.inbox/})).toBeNull();expect(screen.queryByText('!')).toBeNull();
 });
 it('shows unknown even before a first successful count and restores a real count after recovery',()=>{
  h.unread={count:0,error:'Unread unavailable'};const mounted=render(<MemoryRouter><Layout/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'layout.inbox: Unread unavailable'})).toHaveTextContent('!');
  h.unread={count:3,error:null};mounted.rerender(<MemoryRouter><Layout/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'layout.inbox: 3'})).toHaveTextContent('3');
  expect(screen.queryByText('!')).toBeNull();
 });
});
