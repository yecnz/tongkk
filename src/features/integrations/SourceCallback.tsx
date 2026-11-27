import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { workflowRequest } from '../../services/workflow';
import { reportOAuthResult } from '../../services/oauthPopup';
import LearningLayout from '../learningSession/LearningLayout';
const requests=new Map<string,Promise<unknown>>();
export default function SourceCallback(){
  const {user}=useAuth();const {provider}=useParams();const [params]=useState(()=>new URLSearchParams(window.location.search));const [status,setStatus]=useState('서비스 연결을 확인하는 중…');
  useEffect(()=>{window.history.replaceState(window.history.state,'',`/integrations/${provider}/callback`);if(!user)return;const state=params.get('state'),code=params.get('code');if(!['google-drive','notion'].includes(provider||'')||!state||!code||params.has('error')){const message='연결을 취소했거나 권한을 받지 못했어요. 마이페이지에서 다시 연결해 주세요.';setStatus(message);if(provider)reportOAuthResult(provider,message);return;}
    const key=`${user.id}:${provider}:${state}`;let request=requests.get(key);if(!request){request=workflowRequest(`/source-integrations/${provider}/callback`,'POST',{state,code});requests.set(key,request);if(requests.size>20)requests.delete(requests.keys().next().value!);}let active=true;request.then(()=>{if(active){setStatus('자료 서비스가 연결되었습니다. 마이페이지에서 자료를 선택해 주세요.');reportOAuthResult(provider!);}}).catch(e=>{if(active){setStatus(e.message);reportOAuthResult(provider!,e.message);}});return()=>{active=false;};},[user,provider,params]);
  return <LearningLayout active="마이페이지"><h1>자료 서비스 연결</h1><p role="status">{user?status:'로그인 후 다시 연결해 주세요.'}</p><Link to={user?'/mypage':'/auth'}>{user?'마이페이지로':'로그인'}</Link></LearningLayout>;
}
