import {useMemo} from 'react';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import {TvBrandingEditorWorkspace} from '@/components/cashier/tournament-live/TvBrandingEditor';

const canonical='https://orlesggcjamwuknxwcpk.supabase.co';
const api='http://127.0.0.1:54329';
const publicPath='/storage/v1/object/public/backing-proofs/';
const previewUrl=(value:string|null)=>{
 if(!value)return null;
 const url=new URL(value);
 if(url.origin!==canonical||!url.pathname.startsWith(publicPath))throw Error('Unexpected TEST asset origin.');
 return api+url.pathname;
};

export default function TvAssetNativePreview({tour,actor,token,epoch}:{tour:string;actor:string;token:string;epoch:number}){
 const client=useMemo(()=>createClient<Database>(canonical,'local-test-key',{
  auth:{storageKey:'vinpoker-native-tv-assets258',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>{
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
   if(url.origin!==canonical)throw Error('TEST SDK must use canonical origin.');
   return fetch(api+url.pathname+url.search,init);
  }},
 }),[token]);
 return <SupabaseClientProvider client={client} backendScope="LOCAL_TV258_CANONICAL_REQUESTS_REAL_PG_BLOB_MODEL">
  <p>Canonical references stay in PostgreSQL. Preview bytes use the local blob-provider model; no hosted Storage request.</p>
  <TvBrandingEditorWorkspace tournamentId={tour} actorId={actor} sessionEpoch={epoch} assetPreviewUrl={previewUrl}/>
 </SupabaseClientProvider>;
}
