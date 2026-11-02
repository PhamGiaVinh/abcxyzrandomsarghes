import {Navigate,useParams} from 'react-router-dom';

// Previously issued push links remain usable; this grants no chat access.
// The destination still performs its normal membership/auth checks.
export function LegacyGroupNotificationRedirect(){
  const {groupId}=useParams<{groupId:string}>();
  const target=groupId&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(groupId)
    ? `/group/${groupId}` : '/inbox';
  return <Navigate to={target} replace/>;
}
