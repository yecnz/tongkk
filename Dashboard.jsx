import { useState } from "react";

const PINK = "#F070AE";
const CYAN = "#00C0E8";

const SidebarIcon = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
    <rect x="0.5" y="0.5" width="21" height="17" rx="3" stroke="#999" strokeWidth="1"/>
    <line x1="8" y1="1" x2="8" y2="17" stroke="#999" strokeWidth="1"/>
  </svg>
);

const Sidebar = ({ active, onNav, onClose }) => (
  <div style={{
    position: "fixed", top: 0, left: 0, width: 240, height: "100vh",
    background: "#fff", borderRight: "1px solid #eee", zIndex: 100,
    display: "flex", flexDirection: "column", padding: "24px 0",
    boxShadow: "2px 0 12px rgba(0,0,0,0.06)"
  }}>
    <div style={{ padding: "0 20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#999" }}>✕</button>
    </div>
    {["대시보드", "자료 요약", "퀴즈 생성", "커뮤니티", "마이페이지"].map(item => (
      <button key={item} onClick={() => { onNav(item); onClose(); }} style={{
        padding: "14px 24px", border: "none", background: active === item ? "#FFF0F6" : "transparent",
        textAlign: "left", fontSize: 15, fontWeight: active === item ? 600 : 400,
        color: active === item ? PINK : "#555", cursor: "pointer", transition: "all 0.2s"
      }}>{item}</button>
    ))}
  </div>
);

const Card = ({ children, style }) => (
  <div style={{
    background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)", ...style
  }}>{children}</div>
);

const AddCourseModal = ({ onClose, onAdd }) => {
  const [name, setName] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 추가</h3>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="과목명 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (name.trim()) { onAdd(name.trim()); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

const JoinCommunityModal = ({ onClose, onJoin }) => {
  const [univ, setUniv] = useState("");
  const [dept, setDept] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>커뮤니티 가입하기</h3>
        <input value={univ} onChange={e => setUniv(e.target.value)} placeholder="대학교 입력 (예: 제주대)" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }}/>
        <input value={dept} onChange={e => setDept(e.target.value)} placeholder="학과 입력 (예: 컴퓨터공학과)" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (univ.trim() && dept.trim()) { onJoin(univ.trim(), dept.trim()); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: CYAN, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>가입</button>
        </div>
      </Card>
    </div>
  );
};

const AddDdayModal = ({ onClose, onAdd }) => {
  const [subj, setSubj] = useState("");
  const [date, setDate] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>D-day 추가</h3>
        <input value={subj} onChange={e => setSubj(e.target.value)} placeholder="과목명" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }}/>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (subj && date) { onAdd(subj, date); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

const AddPlanModal = ({ onClose, onAdd }) => {
  const [txt, setTxt] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>학습 계획 추가</h3>
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="학습 계획 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (txt.trim()) { onAdd(txt.trim()); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: CYAN, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

export default function Dashboard() {
  const [sidebar, setSidebar] = useState(false);
  const [page, setPage] = useState("대시보드");
  const [courses, setCourses] = useState([]);
  const [community, setCommunity] = useState(null);
  const [ddays, setDdays] = useState([]);
  const [plans, setPlans] = useState([]);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showAddDday, setShowAddDday] = useState(false);
  const [showAllDdays, setShowAllDdays] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);

  const getDaysLeft = (dateStr) => {
    const t = new Date(dateStr); const n = new Date();
    t.setHours(0,0,0,0); n.setHours(0,0,0,0);
    return Math.ceil((t - n) / 86400000);
  };

  const displayDdays = showAllDdays ? ddays : ddays.slice(0, 3);

  const communityPosts = community ? [
    { title: "알고리즘 자료 공유" },
    { title: "빅데이터프로그래밍 퀴즈 공유" },
    { title: "데베 예상문제 50개" },
  ] : [];

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={setPage} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showAddCourse && <AddCourseModal onClose={() => setShowAddCourse(false)} onAdd={n => setCourses([...courses, n])} />}
      {showJoin && <JoinCommunityModal onClose={() => setShowJoin(false)} onJoin={(u, d) => setCommunity({ univ: u, dept: d })} />}
      {showAddDday && <AddDdayModal onClose={() => setShowAddDday(false)} onAdd={(s, d) => setDdays([...ddays, { subj: s, date: d }])} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={t => setPlans([...plans, { text: t, done: false }])} />}

      {/* Header */}
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
      </div>

      {/* Content */}
      <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
          {/* Left */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* 강의 목록 */}
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 14px", color: "#222" }}>강의 목록</h2>
              <Card style={{ padding: 20 }}>
                {courses.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "30px 0", color: "#aaa" }}>
                    <p style={{ margin: "0 0 16px", fontSize: 14 }}>등록된 강의가 없습니다</p>
                    <button onClick={() => setShowAddCourse(true)} style={{
                      padding: "10px 22px", borderRadius: 12, border: "none", background: PINK, color: "#fff",
                      fontSize: 14, fontWeight: 600, cursor: "pointer"
                    }}>+ 강의 추가하기</button>
                  </div>
                ) : (
                  <div>
                    {courses.map((c, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "14px 0", borderBottom: i < courses.length - 1 ? "1px solid #f5f5f5" : "none"
                      }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: "#333" }}>{c}</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          {["요약", "퀴즈", "커뮤니티"].map(btn => (
                            <button key={btn} style={{
                              padding: "6px 14px", borderRadius: 8,
                              border: btn === "커뮤니티" ? "1px solid #e0e0e0" : "none",
                              background: btn === "요약" ? "#FFF0F6" : btn === "퀴즈" ? "#E8FAFE" : "#fff",
                              color: btn === "요약" ? PINK : btn === "퀴즈" ? CYAN : "#666",
                              fontSize: 13, fontWeight: 500, cursor: "pointer"
                            }}>{btn}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setShowAddCourse(true)} style={{
                      marginTop: 14, padding: "10px 0", width: "100%", borderRadius: 10,
                      border: "1px dashed #ddd", background: "#fafafa", color: "#999",
                      fontSize: 14, cursor: "pointer"
                    }}>+ 강의 추가하기</button>
                  </div>
                )}
              </Card>
            </div>

            {/* 커뮤니티 글 */}
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 14px", color: "#222" }}>커뮤니티 글</h2>
              <Card style={{ padding: 20 }}>
                {!community ? (
                  <div style={{ textAlign: "center", padding: "30px 0", color: "#aaa" }}>
                    <p style={{ margin: "0 0 16px", fontSize: 14 }}>가입된 커뮤니티가 없습니다</p>
                    <button onClick={() => setShowJoin(true)} style={{
                      padding: "10px 22px", borderRadius: 12, border: "none", background: CYAN, color: "#fff",
                      fontSize: 14, fontWeight: 600, cursor: "pointer"
                    }}>커뮤니티 가입하기</button>
                  </div>
                ) : (
                  <div>
                    <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#222" }}>
                      {community.univ} 컴공 게시판
                    </h3>
                    {communityPosts.map((p, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center",
                        padding: "12px 0", borderBottom: i < communityPosts.length - 1 ? "1px solid #f5f5f5" : "none"
                      }}>
                        <span style={{ fontSize: 14, color: "#444" }}>• {p.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Right */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* D-day */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: PINK }}>D-day</h3>
                <button onClick={() => setShowAddDday(true)} style={{
                  background: "none", border: "none", fontSize: 20, color: PINK, cursor: "pointer", lineHeight: 1
                }}>+</button>
              </div>
              {ddays.length === 0 ? (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "10px 0" }}>설정된 D-day가 없습니다</p>
              ) : (
                <>
                  {displayDdays.map((d, i) => {
                    const left = getDaysLeft(d.date);
                    return (
                      <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 0", borderBottom: i < displayDdays.length - 1 ? "1px solid #f5f5f5" : "none"
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#333" }}>{d.subj}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: left <= 7 ? PINK : CYAN }}>
                          {left > 0 ? `D-${left}` : left === 0 ? "D-Day!" : `D+${Math.abs(left)}`}
                        </span>
                      </div>
                    );
                  })}
                  {ddays.length > 3 && (
                    <button onClick={() => setShowAllDdays(!showAllDdays)} style={{
                      marginTop: 10, padding: "6px 0", width: "100%", background: "none",
                      border: "none", color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 500
                    }}>{showAllDdays ? "접기" : `더보기 (${ddays.length - 3}개)`}</button>
                  )}
                </>
              )}
            </Card>

            {/* 오늘의 학습계획 */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>오늘의 학습계획</h3>
                <button onClick={() => setShowAddPlan(true)} style={{
                  background: "none", border: "none", fontSize: 20, color: CYAN, cursor: "pointer", lineHeight: 1
                }}>+</button>
              </div>
              {plans.length === 0 ? (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "10px 0" }}>학습 계획을 추가해보세요</p>
              ) : (
                plans.map((p, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                    borderBottom: i < plans.length - 1 ? "1px solid #f5f5f5" : "none"
                  }}>
                    <button onClick={() => {
                      const np = [...plans]; np[i] = { ...np[i], done: !np[i].done }; setPlans(np);
                    }} style={{
                      width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "#ddd"}`,
                      background: p.done ? CYAN : "#fff", cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
                    }}>
                      {p.done && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                    </button>
                    <span style={{
                      fontSize: 14, color: p.done ? "#bbb" : "#444",
                      textDecoration: p.done ? "line-through" : "none"
                    }}>{p.text}</span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}