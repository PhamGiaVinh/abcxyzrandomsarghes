import {render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {describe,expect,it} from 'vitest';
import {LegacyGroupNotificationRedirect} from './LegacyGroupNotificationRedirect';
function Destination(){const location=useLocation();return <p>{location.pathname}</p>;}
describe('previously issued group notification links',()=>{
  for(const [id,target] of [['ad82bc10-27a1-4aab-8efa-2c0d01a621cb','/group/ad82bc10-27a1-4aab-8efa-2c0d01a621cb'],['bad-id','/inbox']]){
    it(`redirects ${id} to the canonical route`,()=>{
      render(<MemoryRouter initialEntries={[`/chat/groups/${id}`]}><Routes>
        <Route path='/chat/groups/:groupId' element={<LegacyGroupNotificationRedirect/>}/>
        <Route path='/group/:groupId' element={<Destination/>}/>
        <Route path='/inbox' element={<Destination/>}/>
      </Routes></MemoryRouter>);
      expect(screen.getByText(target)).toBeTruthy();
    });
  }
});
