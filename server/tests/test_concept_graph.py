from concept_graph import graph_view

def node(key,course='운영체제',state='needs_review'):
    return {'id':key,'title':'프로세스','course_name':course,'evidence_count':1,'source_changed':False,'state':state}

def test_confirmed_aliases_combine_history_without_merging_source_records():
    value=graph_view({'nodes':[node('a'),node('b','시스템')],'links':[]})
    assert len(value['groups'])==2 and value['suggestions']
    value=graph_view({'nodes':[node('a'),node('b','시스템')],'links':[{'relation':'equivalent','source_id':'a','target_id':'b'}]})
    assert len(value['groups'])==1 and len(value['groups'][0]['members'])==2
    assert value['groups'][0]['evidence_count']==2

def test_prerequisite_recommendations_skip_changed_source():
    a,b=node('a'),node('b');a['title']='자원';b['title']='교착'
    edge={'relation':'prerequisite','source_id':'a','target_id':'b'}
    assert graph_view({'nodes':[a,b],'links':[edge]})['recommendations'][0]['concept_id']=='a'
    a['source_changed']=True
    assert not graph_view({'nodes':[a,b],'links':[edge]})['recommendations']
