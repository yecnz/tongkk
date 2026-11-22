import pytest
from review_schedule import next_review


@pytest.mark.parametrize('states,assisted,successes,expected', [
    (['met'],False,0,(3,True)),(['met'],False,1,(7,True)),(['met'],True,3,(1,False)),
    (['missing'],False,2,(1,False)),(['contradicted'],False,0,(1,False)),(['uncertain'],False,4,(None,False)),
    ([],False,0,(None,False)),(['met'],False,100,(60,True))])
def test_scheduling_only_advances_after_an_independent_known_success(states,assisted,successes,expected):
    assert next_review({'criteria':[{'status':s} for s in states]},assisted,successes)==expected
