"""Read-only Drive / Notion imports. Provider content is reviewed before saving."""
import asyncio
import hashlib
import io
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID
import httpx
from fastapi import APIRouter, Depends, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from config import FRONTEND_ORIGIN
from calendar_integration import encrypt_tokens, decrypt_tokens, token_cipher, public_connection, CalendarSyncError
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail

router=APIRouter(prefix='/source-integrations',tags=['source-integrations'])
Provider=Literal['google-drive','notion']
DRIVE_SCOPE='https://www.googleapis.com/auth/drive.readonly'
NOTION_VERSION='2026-03-11'
MIMES=['application/vnd.google-apps.document','text/plain','text/markdown','application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.wordprocessingml.document']

def repository(): return Repository()
def key(provider): return provider.replace('-','_')
def settings(provider):
    prefix='GOOGLE_DRIVE' if provider=='google-drive' else 'NOTION'
    client_id,secret=os.getenv(prefix+'_CLIENT_ID',''),os.getenv(prefix+'_CLIENT_SECRET','')
    redirect=FRONTEND_ORIGIN.rstrip('/')+f'/integrations/{provider}/callback'
    if not client_id or not secret:
        fail('INTEGRATION_SETUP','자료 연동을 위한 서버 OAuth 설정이 필요해요.',503)
    token_cipher()
    return client_id,secret,redirect

def configured(provider):
    try: settings(provider);return True
    except Exception: return False

class Callback(BaseModel):
    model_config=ConfigDict(extra='forbid')
    state:str=Field(min_length=20,max_length=200)
    code:str=Field(min_length=1,max_length=4000)

class Disconnect(BaseModel):
    revision:int=Field(ge=0)

class Import(BaseModel):
    model_config=ConfigDict(extra='forbid')
    external_id:str=Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')
    course_id:UUID

class DraftAction(BaseModel):
    action:Literal['apply','discard']

async def connection(repo,user,provider):
    value=await repo._rpc('source_connection',{'p_user':user,'p_provider':key(provider)})
    if not value or value['status']!='connected': fail('RECONNECT_REQUIRED','자료 서비스를 먼저 연결해주세요.',409)
    return value

@router.get('/{provider}')
async def listing(provider:Provider,auth=Depends(session_user),repo=Depends(repository)):
    value=await repo._rpc('source_connection',{'p_user':auth[0],'p_provider':key(provider)})
    return {'configured':configured(provider),'connection':public_connection(value),'drafts':await repo._rpc('source_drafts',{'p_user':auth[0],'p_provider':key(provider)})}

@router.post('/{provider}/connect')
async def connect(provider:Provider,auth=Depends(session_user),repo=Depends(repository)):
    client_id,_,redirect=settings(provider);state=secrets.token_urlsafe(40)
    await repo._rpc('source_begin',{'p_user':auth[0],'p_provider':key(provider),'p_state':hashlib.sha256(state.encode()).hexdigest()})
    base='https://accounts.google.com/o/oauth2/v2/auth' if provider=='google-drive' else 'https://api.notion.com/v1/oauth/authorize'
    params={'client_id':client_id,'redirect_uri':redirect,'response_type':'code','state':state}
    if provider=='google-drive': params.update(scope=DRIVE_SCOPE,access_type='offline',prompt='consent')
    else: params['owner']='user'
    return {'url':base+'?'+urlencode(params)}

async def exchange(provider,client,payload):
    client_id,secret,_=settings(provider)
    if provider=='google-drive':
        response=await client.post('https://oauth2.googleapis.com/token',data={**payload,'client_id':client_id,'client_secret':secret})
    else:
        response=await client.post('https://api.notion.com/v1/oauth/token',auth=httpx.BasicAuth(client_id,secret),json=payload,headers={'Notion-Version':NOTION_VERSION})
    if response.is_error: raise CalendarSyncError('RECONNECT_REQUIRED')
    tokens=response.json()
    if not tokens.get('access_token'):raise CalendarSyncError('RECONNECT_REQUIRED')
    if 'expires_in' in tokens:tokens['expires_at']=(datetime.now(timezone.utc)+timedelta(seconds=int(tokens['expires_in']))).isoformat()
    return tokens

@router.post('/{provider}/callback')
async def callback(provider:Provider,request:Callback,auth=Depends(session_user),repo=Depends(repository)):
    _,_,redirect=settings(provider);state_hash=hashlib.sha256(request.state.encode()).hexdigest()
    try:
        state=await repo._rpc('source_consume',{'p_user':auth[0],'p_provider':key(provider),'p_state':state_hash,'p_code':hashlib.sha256(request.code.encode()).hexdigest()})
        if state['status']=='done':return {'connection':public_connection(await connection(repo,auth[0],provider))}
        async with httpx.AsyncClient(timeout=20) as client:
            tokens=await exchange(provider,client,{'grant_type':'authorization_code','code':request.code,'redirect_uri':redirect})
        if provider=='google-drive' and (DRIVE_SCOPE not in tokens.get('scope','').split() or not tokens.get('refresh_token')):
            fail('SCOPE_REQUIRED','Drive 읽기 권한을 허용하고 다시 연결해주세요.',409)
        value=await repo._rpc('integration_connect',{'p_user':auth[0],'p_state':state_hash,'p_cipher':encrypt_tokens(tokens,auth[0],state['connection_id'])})
        return {'connection':public_connection(value)}
    except WriteConflict:fail('CONFLICT','이미 처리했거나 연결 상태가 바뀌었어요. 다시 연결해주세요.',409)
    except (httpx.HTTPError,CalendarSyncError,ValueError,KeyError):fail('OAUTH_FAILED','서비스 연결을 완료하지 못했어요. 다시 시작해주세요.',502)

async def refresh(repo,provider,value,client):
    current=await repo._rpc('source_refresh_claim',{'p_user':value['user_id'],'p_provider':key(provider),'p_revision':value['revision']})
    old=decrypt_tokens(current['tokens_ciphertext'],current['user_id'],current['id'])
    try:
        tokens=await exchange(provider,client,{'grant_type':'refresh_token','refresh_token':old['refresh_token']})
        tokens={**old,**tokens}
        saved=await repo._rpc('source_refresh_save',{'p_user':current['user_id'],'p_id':current['id'],'p_revision':current['revision'],'p_lease':current['refresh_lease'],'p_cipher':encrypt_tokens(tokens,current['user_id'],current['id'])})
        if not saved:raise CalendarSyncError('CONNECTION_CHANGED')
        return tokens
    except (httpx.HTTPError,CalendarSyncError,KeyError,ValueError):
        await repo._rpc('source_refresh_save',{'p_user':current['user_id'],'p_id':current['id'],'p_revision':current['revision'],'p_lease':current['refresh_lease'],'p_cipher':None})
        raise CalendarSyncError('RECONNECT_REQUIRED') from None

class SourceClient:
    def __init__(self,repo,provider,value,client):
        self.repo,self.provider,self.value,self.client=repo,provider,value,client
        self.tokens=decrypt_tokens(value['tokens_ciphertext'],value['user_id'],value['id'])
    async def request(self,method,path,**kwargs):
        if self.tokens.get('expires_at') and datetime.fromisoformat(self.tokens['expires_at'])<=datetime.now(timezone.utc)+timedelta(seconds=60):
            self.tokens=await refresh(self.repo,self.provider,self.value,self.client)
        base='https://www.googleapis.com/drive/v3/' if self.provider=='google-drive' else 'https://api.notion.com/v1/'
        for attempt in range(2):
            headers={'Authorization':'Bearer '+self.tokens['access_token'],'Notion-Version':NOTION_VERSION}
            response=await self.client.request(method,base+path,headers=headers,**kwargs)
            if response.status_code==401 and attempt==0 and self.tokens.get('refresh_token'):
                self.tokens=await refresh(self.repo,self.provider,self.value,self.client);continue
            if response.status_code in (401,403):raise CalendarSyncError('RECONNECT_REQUIRED')
            if response.status_code==429:fail('PROVIDER_BUSY','외부 서비스의 요청 한도에 도달했어요. 잠시 후 다시 시도해주세요.',429)
            response.raise_for_status();return response

async def source_error(action):
    try:return await action
    except WriteConflict:fail('CONFLICT','연결이나 자료 상태가 바뀌었어요. 다시 확인해주세요.',409)
    except (httpx.HTTPError,CalendarSyncError,ValueError,KeyError):fail('SOURCE_UNAVAILABLE','자료를 읽지 못했어요. 서비스 권한과 연결 상태를 확인해주세요.',502)

@router.get('/{provider}/documents')
async def documents(provider:Provider,q:str=Query('',max_length=100),cursor:str=Query('',max_length=2000),auth=Depends(session_user),repo=Depends(repository)):
    value=await connection(repo,auth[0],provider)
    async def load():
        async with httpx.AsyncClient(timeout=20) as client:
            api=SourceClient(repo,provider,value,client)
            if provider=='google-drive':
                escaped=q.replace('\\','\\\\').replace("'","\\'")
                query="trashed=false and ("+' or '.join("mimeType='"+m+"'" for m in MIMES)+')'+(" and name contains '"+escaped+"'" if q else '')
                body=(await api.request('GET','files',params={'q':query,'pageSize':30,'fields':'files(id,name,mimeType,modifiedTime),nextPageToken',**({'pageToken':cursor} if cursor else {})})).json()
                return {'documents':[{'id':x['id'],'title':x['name'],'modified':x.get('modifiedTime',''),'kind':x['mimeType']} for x in body.get('files',[])],'cursor':body.get('nextPageToken')}
            body=(await api.request('POST','search',json={'query':q,'filter':{'property':'object','value':'page'},'page_size':30,**({'start_cursor':cursor} if cursor else {})})).json()
            return {'documents':[{'id':x['id'],'title':page_title(x),'modified':x.get('last_edited_time',''),'kind':'Notion 페이지'} for x in body.get('results',[]) if not x.get('archived') and not x.get('in_trash')],'cursor':body.get('next_cursor') if body.get('has_more') else None}
    return await source_error(load())

def rich_text(parts):return ''.join(x.get('plain_text') or x.get('text',{}).get('content','') for x in parts)
def page_title(page):
    return next((rich_text(v.get('title',[])) for v in page.get('properties',{}).values() if v.get('type')=='title'),'제목 없는 페이지') or '제목 없는 페이지'

async def notion_document(api,external_id):
    page=(await api.request('GET','pages/'+external_id)).json()
    if page.get('archived') or page.get('in_trash'):raise ValueError('Deleted page')
    parts=[];notices=set();seen=set();count=0
    async def children(block_id,depth):
        nonlocal count
        if depth>8 or block_id in seen:raise ValueError('Nested page limit')
        seen.add(block_id);cursor=None
        while True:
            body=(await api.request('GET',f'blocks/{block_id}/children',params={'page_size':100,**({'start_cursor':cursor} if cursor else {})})).json()
            for block in body.get('results',[]):
                count+=1
                if count>500:raise ValueError('Page block limit')
                kind=block['type'];data=block.get(kind,{})
                if kind=='child_page':notices.add('하위 페이지는 별도로 선택해 가져와주세요.');continue
                if kind in ('image','video','audio','file','pdf','embed','bookmark','link_preview'):
                    notices.add('첨부 파일·이미지·외부 임베드는 본문에 포함하지 않았어요.');continue
                text=rich_text(data.get('rich_text',[]))
                if kind=='table_row':text=' | '.join(rich_text(cell) for cell in data.get('cells',[]))
                if kind.startswith('heading_'):text='#'*int(kind[-1])+' '+text
                elif kind in ('bulleted_list_item','numbered_list_item','to_do'):text='- '+text
                elif kind=='code':text='```'+data.get('language','')+'\n'+text+'\n```'
                elif kind=='equation':text='$$'+data.get('expression','')+'$$'
                if text:parts.append(text)
                elif kind not in ('table','column_list','column','divider','synced_block','toggle'):notices.add('일부 지원하지 않는 블록은 본문에 포함하지 않았어요.')
                if block.get('has_children'):await children(block['id'],depth+1)
            if not body.get('has_more'):break
            cursor=body.get('next_cursor')
            if not cursor:raise ValueError('Incomplete page')
    await children(external_id,0)
    latest=(await api.request('GET','pages/'+external_id)).json()
    if latest.get('last_edited_time') != page.get('last_edited_time') or latest.get('archived') or latest.get('in_trash'):raise ValueError('Page changed during import')
    return page_title(page),page.get('last_edited_time',''),'\n\n'.join(parts),sorted(notices)

async def drive_document(api,external_id,user):
    meta=(await api.request('GET','files/'+external_id,params={'fields':'id,name,mimeType,modifiedTime,size,trashed,capabilities(canDownload)'})).json()
    mime=meta['mimeType']
    if meta.get('trashed') or mime not in MIMES or not meta.get('capabilities',{}).get('canDownload',True):raise ValueError('Unsupported document')
    if int(meta.get('size',0))>10*1024*1024:raise ValueError('Document too large')
    path=f'files/{external_id}/export' if mime.startswith('application/vnd.google-apps.') else f'files/{external_id}'
    params={'mimeType':'text/plain'} if mime.startswith('application/vnd.google-apps.') else {'alt':'media'}
    # Stream provider content so an oversized export cannot exhaust API memory.
    headers={'Authorization':'Bearer '+api.tokens['access_token']}
    async with api.client.stream('GET','https://www.googleapis.com/drive/v3/'+path,params=params,headers=headers) as response:
        response.raise_for_status();data=bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data)>10*1024*1024:raise ValueError('Document too large')
    notices=[]
    if mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.wordprocessingml.document'):
        from main import convert_document_to_markdown
        extension={MIMES[3]:'.pdf',MIMES[4]:'.pptx',MIMES[5]:'.docx'}[mime]
        upload=UploadFile(file=io.BytesIO(data),filename='import'+extension)
        try:markdown=(await convert_document_to_markdown(upload,_user={'id':user}))['markdown']
        finally:await upload.close()
    else:
        markdown=bytes(data).decode('utf-8-sig')
        if mime.startswith('application/vnd.google-apps.'):notices.append('문서의 텍스트를 가져왔어요. 이미지와 원래 서식은 포함하지 않아요.')
    latest=(await api.request('GET','files/'+external_id,params={'fields':'modifiedTime,trashed'})).json()
    if latest.get('modifiedTime') != meta.get('modifiedTime') or latest.get('trashed'):raise ValueError('Document changed during import')
    return meta['name'],meta.get('modifiedTime',''),markdown,notices

@router.post('/{provider}/imports')
async def import_document(provider:Provider,request:Import,auth=Depends(session_user),repo=Depends(repository)):
    value=await connection(repo,auth[0],provider)
    from usage import request_usage
    usage_context=request_usage.get()
    if usage_context:
        usage_context['feature']='source_import'
    async def load():
        async with httpx.AsyncClient(timeout=20) as client:
            api=SourceClient(repo,provider,value,client)
            title,modified,markdown,notices=await asyncio.wait_for(drive_document(api,request.external_id,auth[0]) if provider=='google-drive' else notion_document(api,request.external_id),timeout=120)
        if not markdown.strip() or len(markdown)>300000:fail('CONTENT_LIMIT','가져올 본문이 없거나 너무 길어요. 자료를 나눠서 가져와주세요.',422)
        return await repo._rpc('source_draft_create',{'p_user':auth[0],'p_connection':value['id'],'p_revision':value['revision'],'p_course':str(request.course_id),'p_external':request.external_id,'p_title':title[:1000],'p_modified':modified,'p_markdown':markdown,'p_notices':notices})
    try:return await source_error(load())
    except TimeoutError:fail('IMPORT_TIMEOUT','자료를 가져오는 시간이 초과됐어요. 더 작은 자료를 선택해주세요.',504)

@router.post('/drafts/{draft_id}/actions')
async def draft_action(draft_id:UUID,request:DraftAction,auth=Depends(session_user),repo=Depends(repository)):
    try:return await repo._rpc('source_draft_action',{'p_user':auth[0],'p_id':str(draft_id),'p_action':request.action})
    except WriteConflict:fail('CONFLICT','저장할 자료의 상태가 바뀌었어요. 다시 확인해주세요.',409)

@router.post('/{provider}/disconnect')
async def disconnect(provider:Provider,request:Disconnect,auth=Depends(session_user),repo=Depends(repository)):
    value=await repo._rpc('source_connection',{'p_user':auth[0],'p_provider':key(provider)})
    try:await repo._rpc('source_disconnect',{'p_user':auth[0],'p_provider':key(provider),'p_revision':request.revision})
    except WriteConflict:fail('CONFLICT','연결 상태가 바뀌었어요. 다시 확인해주세요.',409)
    revoked=False
    shared_active=False
    if provider=='google-drive' and os.getenv('GOOGLE_DRIVE_CLIENT_ID') and os.getenv('GOOGLE_DRIVE_CLIENT_ID')==os.getenv('GOOGLE_CALENDAR_CLIENT_ID'):
        calendar=await repo._rpc('integration_connection',{'p_user':auth[0]})
        shared_active=bool(calendar and calendar['status']=='connected')
    if value and value.get('tokens_ciphertext') and configured(provider) and not shared_active:
        try:
            tokens=decrypt_tokens(value['tokens_ciphertext'],auth[0],value['id'])
            async with httpx.AsyncClient(timeout=10) as client:
                if provider=='google-drive':response=await client.post('https://oauth2.googleapis.com/revoke',data={'token':tokens.get('refresh_token') or tokens['access_token']})
                else:
                    client_id,secret,_=settings(provider)
                    response=await client.post('https://api.notion.com/v1/oauth/revoke',json={'token':tokens['access_token']},auth=httpx.BasicAuth(client_id,secret),headers={'Notion-Version':NOTION_VERSION})
                revoked=response.is_success
        except (httpx.HTTPError,CalendarSyncError,KeyError):pass
    return {'disconnected':True,'provider_revoked':revoked}
