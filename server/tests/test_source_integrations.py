import asyncio
from datetime import datetime,timedelta,timezone
from uuid import uuid4
import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
import source_integrations as sources
from calendar_integration import encrypt_tokens

@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('INTEGRATION_ENCRYPTION_KEY',Fernet.generate_key().decode())
    for prefix in ('GOOGLE_DRIVE','NOTION'):
        monkeypatch.setenv(prefix+'_CLIENT_ID','client');monkeypatch.setenv(prefix+'_CLIENT_SECRET','secret')

def test_provider_oauth_scopes_and_states_are_separate(configured):
    calls=[]
    class Repo:
        async def _rpc(self,name,p):calls.append((name,p))
    app=FastAPI();app.include_router(sources.router)
    app.dependency_overrides[sources.session_user]=lambda:('owner','jwt')
    app.dependency_overrides[sources.repository]=lambda:Repo()
    client=TestClient(app)
    drive=client.post('/source-integrations/google-drive/connect').json()['url']
    notion=client.post('/source-integrations/notion/connect').json()['url']
    assert 'drive.readonly' in drive and 'calendar' not in drive
    assert 'api.notion.com/v1/oauth/authorize' in notion
    assert calls[0][1]['p_provider']=='google_drive' and calls[1][1]['p_provider']=='notion'
    assert calls[0][1]['p_state'] not in drive
    assert client.post('/source-integrations/unknown/connect').status_code==422

def test_notion_nested_blocks_and_pagination_are_not_silently_truncated():
    calls=[]
    class API:
        async def request(self,method,path,**kwargs):
            calls.append(path)
            if path.startswith('pages/'):
                return httpx.Response(200,json={'properties':{'Name':{'type':'title','title':[{'plain_text':'강의'}]}},'last_edited_time':'2026-11-23'})
            if path=='blocks/page/children':
                return httpx.Response(200,json={'results':[{'id':'parent','type':'toggle','toggle':{'rich_text':[{'plain_text':'핵심'}]},'has_children':True},{'id':'attachment','type':'image'}],'has_more':True,'next_cursor':'next'}) if not kwargs['params'].get('start_cursor') else httpx.Response(200,json={'results':[{'id':'last','type':'paragraph','paragraph':{'rich_text':[{'plain_text':'마지막 문단'}]}}]})
            return httpx.Response(200,json={'results':[{'id':'nested','type':'paragraph','paragraph':{'rich_text':[{'plain_text':'안쪽 문단'}]}}]})
    title,_,markdown,notices=asyncio.run(sources.notion_document(API(),'page'))
    assert title=='강의' and '안쪽 문단' in markdown and '마지막 문단' in markdown
    assert notices and calls.count('blocks/page/children')==2

def test_notion_refresh_rotates_token_and_saves_with_its_lease(configured):
    connection={'id':'c','user_id':'u','revision':2,'refresh_lease':'lease','tokens_ciphertext':encrypt_tokens({'access_token':'old','refresh_token':'old-refresh'},'u','c')}
    saved=[]
    class Repo:
        async def _rpc(self,name,p):
            if name=='source_refresh_claim':return connection
            saved.append(p);return True
    def respond(request):
        assert request.headers['authorization'].startswith('Basic ')
        return httpx.Response(200,json={'access_token':'new','refresh_token':'new-refresh'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await sources.refresh(Repo(),'notion',connection,client)
    tokens=asyncio.run(run())
    assert tokens['refresh_token']=='new-refresh' and saved[0]['p_lease']=='lease'
    assert 'new-refresh' not in saved[0]['p_cipher']

def test_drive_plain_document_uses_fixed_provider_endpoint(configured):
    connection={'id':'c','user_id':'u','revision':1,'tokens_ciphertext':encrypt_tokens({'access_token':'token','expires_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()},'u','c')}
    def respond(request):
        assert request.url.host=='www.googleapis.com'
        if request.url.params.get('fields'):return httpx.Response(200,json={'name':'강의','mimeType':'application/vnd.google-apps.document','modifiedTime':'2026-11-23'})
        assert request.url.params['mimeType']=='text/plain'
        return httpx.Response(200,text='프로세스는 실행 중인 프로그램이다.')
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await sources.drive_document(sources.SourceClient(None,'google-drive',connection,client),'safe-id','u')
    title,_,markdown,notices=asyncio.run(run())
    assert title=='강의' and '프로세스' in markdown and notices

def test_import_input_cannot_address_an_arbitrary_url():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):sources.Import(external_id='https://internal/private',course_id=uuid4())

@pytest.mark.parametrize('provider',['google-drive','google-calendar'])
def test_shared_google_client_disconnect_preserves_the_other_service(configured,monkeypatch,provider):
    import calendar_integration as calendar
    monkeypatch.setenv('GOOGLE_CALENDAR_CLIENT_ID','client');monkeypatch.setenv('GOOGLE_CALENDAR_CLIENT_SECRET','secret')
    calls=[]
    value={'id':'c','user_id':'u','revision':1,'status':'connected','tokens_ciphertext':encrypt_tokens({'refresh_token':'private'},'u','c')}
    class Repo:
        async def _rpc(self,name,params):
            calls.append(name)
            return value if name in ('integration_connection','source_connection') else True
    def forbidden(*args,**kwargs):raise AssertionError('Shared OAuth grant must not be revoked')
    monkeypatch.setattr(httpx,'AsyncClient',forbidden)
    result=asyncio.run(sources.disconnect('google-drive',sources.Disconnect(revision=1),auth=('u','jwt'),repo=Repo())) if provider=='google-drive' else asyncio.run(calendar.disconnect(calendar.Disconnect(revision=1),auth=('u','jwt'),repo=Repo()))
    assert result['disconnected'] and not result['provider_revoked']
    assert ('source_disconnect' if provider=='google-drive' else 'integration_disconnect') in calls
