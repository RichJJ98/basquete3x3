import { useState, useEffect, useCallback, useRef } from "react";

/* ─────────────────────────────────────────────────────────────
   STORAGE
───────────────────────────────────────────────────────────── */
const K = { players:"b3x3v2:players", teams:"b3x3v2:teams", games:"b3x3v2:games",
            deadline:"b3x3v2:deadline", drawn:"b3x3v2:drawn", settings:"b3x3v2:settings" };

async function sget(k){ try{ const r=await window.storage.get(k,true); return r?JSON.parse(r.value):null; }catch{return null;} }
async function sset(k,v){ try{ await window.storage.set(k,JSON.stringify(v),true); }catch{} }

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const POSITIONS = ["Armador","Ala","Pivô"];
const JERSEY_COLORS = ["#E83A3A","#2196F3","#4CAF50","#FF9800","#9C27B0"];
const JERSEY_NAMES  = ["Vermelho","Azul","Verde","Laranja","Roxo"];
const NUM_TEAMS = 5;
const FIBA = { winScore:21, winTime:600, foulsLimit:6, timeoutsPerTeam:1 };

function uid(){ return Math.random().toString(36).slice(2,9); }
function shuffle(a){ const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }

function buildRoundRobin(teams){
  const games=[];
  for(let i=0;i<teams.length;i++){
    for(let j=i+1;j<teams.length;j++){
      games.push({
        id:uid(), round:1,
        teamA:{ id:teams[i].id, name:teams[i].name, color:teams[i].color },
        teamB:{ id:teams[j].id, name:teams[j].name, color:teams[j].color },
        scoreA:null, scoreB:null, foulsA:0, foulsB:0,
        timeoutsA:FIBA.timeoutsPerTeam, timeoutsB:FIBA.timeoutsPerTeam,
        date:null, status:"pending", notes:"", elapsedSec:0,
      });
    }
  }
  return games;
}

const V = { HOME:"home", REG:"reg", LOOKUP:"lookup", ADMIN:"admin", GAME:"game" };

function fmtDate(iso){
  return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}

/* ═══════════════════════════════════════════════════════════
   APP ROOT
═══════════════════════════════════════════════════════════ */
export default function App(){
  const [view,setView]         = useState(V.HOME);
  const [players,setPlayers]   = useState([]);
  const [teams,setTeams]       = useState([]);
  const [games,setGames]       = useState([]);
  const [deadline,setDeadline] = useState(null);
  const [drawn,setDrawn]       = useState(false);
  const [settings,setSettings] = useState({ eventName:"3x3 Open", venue:"", adminPass:"admin123" });
  const [adminOk,setAdminOk]   = useState(false);
  const [activeGame,setActiveGame] = useState(null);
  const [toast,setToast]       = useState(null);
  const [loading,setLoading]   = useState(true);
  const [myName,setMyName]     = useState(()=>localStorage.getItem("b3x3:name")||"");

  const notify=(msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3200); };

  useEffect(()=>{
    (async()=>{
      const [p,t,g,d,dr,s] = await Promise.all([
        sget(K.players),sget(K.teams),sget(K.games),
        sget(K.deadline),sget(K.drawn),sget(K.settings)
      ]);
      if(p) setPlayers(p);
      if(t) setTeams(t);
      if(g) setGames(g);
      if(d) setDeadline(d);
      if(dr) setDrawn(dr);
      if(s) setSettings(s);
      setLoading(false);
    })();
  },[]);

  useEffect(()=>{
    if(!deadline||drawn) return;
    const id=setInterval(()=>{ if(Date.now()>=new Date(deadline).getTime()) execDraw(); },5000);
    return ()=>clearInterval(id);
  },[deadline,drawn,players]);

  const execDraw = useCallback(async()=>{
    if(drawn) return;
    const list=shuffle(players);
    if(list.length<NUM_TEAMS){ notify("Mínimo "+NUM_TEAMS+" inscritos","err"); return; }
    const newTeams = Array.from({length:NUM_TEAMS},(_,i)=>({
      id:uid(), name:`Time ${JERSEY_NAMES[i]}`,
      color:JERSEY_COLORS[i], players:[],
      wins:0, losses:0, draws:0, pf:0, pa:0,
    }));
    list.forEach((p,i)=>{ newTeams[i%NUM_TEAMS].players.push(p.id); });
    const newGames = buildRoundRobin(newTeams);
    setTeams(newTeams); setGames(newGames); setDrawn(true);
    await sset(K.teams,newTeams); await sset(K.games,newGames); await sset(K.drawn,true);
    notify("🏀 Sorteio realizado! "+newTeams.length+" times formados.");
  },[players,drawn]);

  const saveGame = useCallback(async(patch)=>{
    const next=games.map(g=>g.id===patch.id?patch:g);
    if(patch.status==="done"){
      const t2=teams.map(t=>{
        let {wins,losses,draws,pf,pa}=t;
        if(t.id===patch.teamA.id){
          pf+=patch.scoreA||0; pa+=patch.scoreB||0;
          if(patch.scoreA>patch.scoreB) wins++; else if(patch.scoreA<patch.scoreB) losses++; else draws++;
        } else if(t.id===patch.teamB.id){
          pf+=patch.scoreB||0; pa+=patch.scoreA||0;
          if(patch.scoreB>patch.scoreA) wins++; else if(patch.scoreB<patch.scoreA) losses++; else draws++;
        }
        return {...t,wins,losses,draws,pf,pa};
      });
      setTeams(t2); await sset(K.teams,t2);
    }
    setGames(next); await sset(K.games,next);
  },[games,teams]);

  const saveSettings = async(s)=>{ setSettings(s); await sset(K.settings,s); notify("Configurações salvas!"); };
  const saveDeadline = async(d)=>{ setDeadline(d); await sset(K.deadline,d); notify("Prazo salvo!"); };

  const addPlayer = async(name,pos)=>{
    if(drawn){ notify("Sorteio já realizado","err"); return; }
    if(deadline&&Date.now()>=new Date(deadline).getTime()){ notify("Inscrições encerradas","err"); return; }
    if(players.find(p=>p.name.trim().toLowerCase()===name.trim().toLowerCase())){ notify("Nome já inscrito","err"); return; }
    const p={ id:uid(), name:name.trim(), position:pos, createdAt:new Date().toISOString() };
    const next=[...players,p];
    setPlayers(next); await sset(K.players,next);
    setMyName(p.name); localStorage.setItem("b3x3:name",p.name);
    notify("✅ Inscrito com sucesso!"); setView(V.LOOKUP);
  };

  if(loading) return <Splash/>;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <Nav view={view} setView={setView} adminOk={adminOk} eventName={settings.eventName}/>
        <main className="main">
          {toast && <Toast toast={toast}/>}
          {view===V.HOME   && <HomeView teams={teams} games={games} deadline={deadline} drawn={drawn} setView={setView} eventName={settings.eventName} venue={settings.venue}/>}
          {view===V.REG    && <RegisterView addPlayer={addPlayer} deadline={deadline} drawn={drawn}/>}
          {view===V.LOOKUP && <LookupView players={players} teams={teams} games={games} myName={myName} setMyName={setMyName}/>}
          {view===V.ADMIN  && (adminOk
            ? <AdminView players={players} teams={teams} games={games} deadline={deadline}
                drawn={drawn} settings={settings} execDraw={execDraw}
                saveGame={saveGame} saveSettings={saveSettings} saveDeadline={saveDeadline}
                setView={setView} setActiveGame={setActiveGame} notify={notify}/>
            : <AdminLogin correctPass={settings.adminPass} onSuccess={()=>setAdminOk(true)}/>
          )}
          {view===V.GAME && activeGame && (
            <GamePanel game={games.find(g=>g.id===activeGame)} saveGame={saveGame}
              back={()=>setView(V.ADMIN)} notify={notify}/>
          )}
        </main>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   NAV
───────────────────────────────────────────────────────────── */
function Nav({view,setView,adminOk,eventName}){
  const links=[{v:V.HOME,label:"Início"},{v:V.REG,label:"Inscrição"},{v:V.LOOKUP,label:"Meu Time"},{v:V.ADMIN,label:adminOk?"⚡ Admin":"Admin"}];
  return(
    <nav className="nav">
      <div className="nav-brand" onClick={()=>setView(V.HOME)}>
        <span>🏀</span>
        <span className="nav-title">{eventName||"3x3"}</span>
      </div>
      <div className="nav-links">
        {links.map(({v,label})=>(
          <button key={v} className={`nav-btn${view===v?" active":""}`} onClick={()=>setView(v)}>{label}</button>
        ))}
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────
   HOME
───────────────────────────────────────────────────────────── */
function HomeView({teams,games,deadline,drawn,setView,eventName,venue}){
  const isPast=deadline&&Date.now()>=new Date(deadline).getTime();
  const sorted=[...teams].sort((a,b)=>(b.wins*2+b.draws)-(a.wins*2+a.draws)||(b.pf-b.pa)-(a.pf-a.pa));
  const upcoming=games.filter(g=>g.status==="pending"||g.status==="live").slice(0,6);
  const recent=games.filter(g=>g.status==="done").slice(-6).reverse();

  return(
    <div className="page">
      <div className="hero">
        <div className="hero-bg"/>
        <div className="hero-content">
          <div className="hero-tag">FIBA 3×3 Basketball</div>
          <h1 className="hero-name">{eventName}</h1>
          {venue&&<p className="hero-venue">📍 {venue}</p>}
          <div className="hero-stats">
            <HeroStat n={teams.length} label="Times"/>
            <HeroStat n={games.filter(g=>g.status==="done").length} label="Jogos"/>
            <HeroStat n={games.length} label="Total"/>
          </div>
          {deadline&&(
            <div className={`deadline-badge${isPast?" past":""}`}>
              {isPast?"⏰ Inscrições encerradas":`⏳ Inscrições até ${fmtDate(deadline)}`}
            </div>
          )}
          {!drawn&&<button className="cta-btn" onClick={()=>setView(V.REG)}>Inscreva-se →</button>}
        </div>
      </div>

      {sorted.length>0&&(
        <Section title="🏆 Classificação">
          <div className="table-wrap">
            <table className="standings-table">
              <thead><tr><th>#</th><th>Time</th><th>J</th><th>V</th><th>D</th><th>SP</th><th>SA</th><th>SD</th><th>Pts</th></tr></thead>
              <tbody>
                {sorted.map((t,i)=>{
                  const j=t.wins+t.losses+t.draws; const sd=t.pf-t.pa;
                  return(
                    <tr key={t.id} className={i===0&&j>0?"row-leader":""}>
                      <td><span className="pos-num">{i+1}</span></td>
                      <td><span className="team-dot" style={{background:t.color}}/>{t.name}</td>
                      <td>{j}</td><td>{t.wins}</td><td>{t.losses}</td>
                      <td>{t.pf}</td><td>{t.pa}</td>
                      <td className={sd>0?"pos-sd":sd<0?"neg-sd":""}>{sd>0?"+":""}{sd}</td>
                      <td><strong className="pts">{t.wins*2+t.draws}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="rule-note">V=2pts · E=1pt · D=0 · SP=Saldo de Pontos · SD=Saldo</p>
        </Section>
      )}

      {upcoming.length>0&&(
        <Section title="📅 Próximos Jogos">
          <div className="game-grid">{upcoming.map(g=><GameCard key={g.id} game={g}/>)}</div>
        </Section>
      )}

      {recent.length>0&&(
        <Section title="✅ Resultados Recentes">
          <div className="game-grid">{recent.map(g=><GameCard key={g.id} game={g}/>)}</div>
        </Section>
      )}
    </div>
  );
}

function HeroStat({n,label}){
  return <div className="hero-stat"><span className="hero-stat-n">{n}</span><span className="hero-stat-l">{label}</span></div>;
}

/* ─────────────────────────────────────────────────────────────
   REGISTER
───────────────────────────────────────────────────────────── */
function RegisterView({addPlayer,deadline,drawn}){
  const [name,setName]=useState("");
  const [pos,setPos]=useState("Armador");
  const isPast=deadline&&Date.now()>=new Date(deadline).getTime();

  if(drawn||isPast) return(
    <div className="page"><div className="card center-card">
      <div className="card-icon">{drawn?"🎲":"⏰"}</div>
      <h2>{drawn?"Sorteio Realizado":"Prazo Encerrado"}</h2>
      <p className="muted">{drawn?"Os times já foram formados. Consulte na aba Meu Time.":"O período de inscrições foi encerrado."}</p>
    </div></div>
  );

  return(
    <div className="page"><div className="card center-card">
      <div className="card-icon">📝</div>
      <h2>Inscrição</h2>
      <p className="muted" style={{marginBottom:20}}>Preencha seus dados para participar do torneio.</p>
      <div className="field">
        <label className="field-label">Nome completo</label>
        <input className="field-input" placeholder="Seu nome" value={name}
          onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&name.trim()&&addPlayer(name,pos)}/>
      </div>
      <div className="field">
        <label className="field-label">Posição</label>
        <div className="pos-picker">
          {POSITIONS.map(p=>(
            <button key={p} className={`pos-opt${pos===p?" active":""}`} onClick={()=>setPos(p)}>{p}</button>
          ))}
        </div>
      </div>
      <button className="submit-btn" onClick={()=>name.trim()&&addPlayer(name,pos)}>Confirmar Inscrição</button>
      {deadline&&<p className="deadline-note">Prazo: {fmtDate(deadline)}</p>}
    </div></div>
  );
}

/* ─────────────────────────────────────────────────────────────
   LOOKUP
───────────────────────────────────────────────────────────── */
function LookupView({players,teams,games,myName,setMyName}){
  const [q,setQ]=useState(myName||"");
  const found=q.trim().length>1?players.find(p=>p.name.toLowerCase().includes(q.trim().toLowerCase())):null;
  const team=found?teams.find(t=>t.players?.includes(found.id)):null;
  const myGames=team?games.filter(g=>g.teamA.id===team.id||g.teamB.id===team.id):[];
  const done=myGames.filter(g=>g.status==="done");
  const next=myGames.filter(g=>g.status==="pending"||g.status==="live");

  return(
    <div className="page">
      <Section title="🔍 Consultar Time">
        <div className="field">
          <label className="field-label">Seu nome</label>
          <input className="field-input" placeholder="Digite seu nome..." value={q}
            onChange={e=>{ setQ(e.target.value); setMyName(e.target.value); localStorage.setItem("b3x3:name",e.target.value); }}/>
        </div>
      </Section>

      {found&&!team&&(
        <div className="card info-card">
          <p className="muted">✅ Inscrito como <strong>{found.name}</strong> · {found.position}</p>
          <p className="muted" style={{marginTop:6}}>⏳ Aguardando sorteio dos times...</p>
        </div>
      )}

      {team&&(
        <>
          <div className="card team-hero-card" style={{"--tc":team.color}}>
            <div className="team-jersey">
              <div className="jersey-shape" style={{background:team.color}}/>
              <span className="jersey-initial">{team.name.split(" ")[1]?.[0]||"T"}</span>
            </div>
            <div>
              <h2 className="team-name-big">{team.name}</h2>
              <p className="muted">{found.position} · {found.name}</p>
              <div className="team-mini-stats">
                <span>V <strong>{team.wins}</strong></span>
                <span>D <strong>{team.losses}</strong></span>
                <span>SP <strong>{team.pf}</strong></span>
                <span>SA <strong>{team.pa}</strong></span>
                <span>SD <strong className={team.pf-team.pa>=0?"pos-sd":"neg-sd"}>{team.pf-team.pa>0?"+":""}{team.pf-team.pa}</strong></span>
              </div>
            </div>
          </div>

          {next.length>0&&(
            <Section title="📅 Próximos Jogos">
              <div className="game-grid">{next.map(g=><GameCard key={g.id} game={g} highlight={team.id}/>)}</div>
            </Section>
          )}

          {done.length>0&&(
            <Section title="📊 Resultados do Time">
              <div className="result-list">
                {done.map(g=>{
                  const mine=g.teamA.id===team.id;
                  const ms=mine?g.scoreA:g.scoreB, os=mine?g.scoreB:g.scoreA;
                  const mf=mine?g.foulsA:g.foulsB, of=mine?g.foulsB:g.foulsA;
                  const opp=mine?g.teamB:g.teamA;
                  const won=ms>os;
                  return(
                    <div key={g.id} className={`result-row ${won?"won":"lost"}`}>
                      <div className="result-status">{won?"V":"D"}</div>
                      <div className="result-info">
                        <div className="result-vs">vs <span className="opp-dot" style={{background:opp.color}}/>{opp.name}</div>
                        {g.date&&<div className="result-date">{fmtDate(g.date)}</div>}
                      </div>
                      <div className="result-score">{ms}<span className="score-sep">:</span>{os}</div>
                      <div className="result-detail">
                        <span>🟥 {mf} faltas</span>
                        <span className="muted">Adv: {of}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}

      {q.trim().length>1&&!found&&(
        <div className="card info-card"><p className="muted">Nenhum jogador encontrado com esse nome.</p></div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LOGIN
───────────────────────────────────────────────────────────── */
function AdminLogin({correctPass,onSuccess}){
  const [pw,setPw]=useState(""); const [err,setErr]=useState(false);
  const try_=()=>{ if(pw===correctPass) onSuccess(); else setErr(true); };
  return(
    <div className="page"><div className="card center-card">
      <div className="card-icon">🔐</div>
      <h2>Acesso Admin</h2>
      <div className="field">
        <label className="field-label">Senha</label>
        <input className={`field-input${err?" input-err":""}`} type="password" value={pw}
          onChange={e=>{ setPw(e.target.value); setErr(false); }}
          onKeyDown={e=>e.key==="Enter"&&try_()}/>
        {err&&<span className="input-err-msg">Senha incorreta</span>}
      </div>
      <button className="submit-btn" onClick={try_}>Entrar</button>
    </div></div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ADMIN VIEW
───────────────────────────────────────────────────────────── */
function AdminView({players,teams,games,deadline,drawn,settings,execDraw,saveGame,saveSettings,saveDeadline,setView,setActiveGame,notify}){
  const [tab,setTab]=useState("dash");
  const TABS=[{k:"dash",l:"Dashboard"},{k:"players",l:`Inscritos (${players.length})`},{k:"bracket",l:"Jogos"},{k:"teams",l:"Times"},{k:"config",l:"⚙️ Config"}];
  return(
    <div className="page">
      <h2 className="page-title">⚡ Painel Admin</h2>
      <div className="tabs">
        {TABS.map(({k,l})=>(
          <button key={k} className={`tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>
      {tab==="dash"    && <AdminDash players={players} teams={teams} games={games} drawn={drawn} deadline={deadline} execDraw={execDraw} saveDeadline={saveDeadline}/>}
      {tab==="players" && <AdminPlayers players={players} teams={teams}/>}
      {tab==="bracket" && <AdminBracket games={games} setView={setView} setActiveGame={setActiveGame}/>}
      {tab==="teams"   && <AdminTeams teams={teams} players={players} games={games}/>}
      {tab==="config"  && <AdminConfig settings={settings} saveSettings={saveSettings}/>}
    </div>
  );
}

function AdminDash({players,teams,games,drawn,deadline,execDraw,saveDeadline}){
  const [dl,setDl]=useState(deadline?deadline.slice(0,16):"");
  const done=games.filter(g=>g.status==="done").length;
  const live=games.filter(g=>g.status==="live").length;
  return(
    <div>
      <div className="dash-stats">
        {[["Inscritos",players.length,"#f97316"],["Times",teams.length,"#2196F3"],["Ao Vivo",live,"#22c55e"],["Finalizados",done,"#9C27B0"],["Total Jogos",games.length,"#64748b"]].map(([l,n,c])=>(
          <div key={l} className="dash-stat-card" style={{"--sc":c}}>
            <span className="dash-stat-val">{n}</span>
            <span className="dash-stat-label">{l}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="card-title">⏳ Prazo de Inscrições</h3>
        <div className="row-fields">
          <input className="field-input" type="datetime-local" value={dl} onChange={e=>setDl(e.target.value)}/>
          <button className="action-btn" onClick={()=>saveDeadline(new Date(dl).toISOString())}>Salvar</button>
        </div>
        {deadline&&<p className="muted sm" style={{marginTop:6}}>Atual: {fmtDate(deadline)}</p>}
      </div>
      <div className="card">
        <h3 className="card-title">🎲 Sorteio dos Times</h3>
        {drawn
          ? <p className="muted">✅ Sorteio realizado. {teams.length} times · {players.length} jogadores.</p>
          : <>
              <p className="muted">Serão formados {NUM_TEAMS} times aleatoriamente com os {players.length} inscritos. (mín. {NUM_TEAMS})</p>
              <button className="draw-btn" onClick={execDraw} disabled={players.length<NUM_TEAMS}>🎲 Realizar Sorteio</button>
            </>
        }
      </div>
    </div>
  );
}

function AdminPlayers({players,teams}){
  return(
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>#</th><th>Nome</th><th>Posição</th><th>Time</th><th>Inscrito em</th></tr></thead>
        <tbody>
          {players.map((p,i)=>{
            const t=teams.find(t=>t.players?.includes(p.id));
            return(
              <tr key={p.id}>
                <td className="muted">{i+1}</td>
                <td><strong>{p.name}</strong></td>
                <td><span className="pos-badge">{p.position}</span></td>
                <td>{t?<><span className="team-dot" style={{background:t.color}}/>{t.name}</>:"—"}</td>
                <td className="muted sm">{new Date(p.createdAt).toLocaleDateString("pt-BR")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdminBracket({games,setView,setActiveGame}){
  const sorted=[...games].sort((a,b)=>{
    const o={live:0,pending:1,done:2}; return (o[a.status]??3)-(o[b.status]??3);
  });
  return(
    <div className="game-admin-list">
      {sorted.map(g=>(
        <div key={g.id} className="admin-game-row" onClick={()=>{ setActiveGame(g.id); setView(V.GAME); }}>
          <div className="agr-status">
            <span className={`status-dot ${g.status==="live"?"sdot-live":g.status==="done"?"sdot-done":"sdot-pending"}`}/>
            <span className="status-label">{g.status==="done"?"FIM":g.status==="live"?"AO VIVO":"Aguard."}</span>
          </div>
          <div className="agr-teams">
            <div className="agr-team"><span className="team-dot" style={{background:g.teamA.color}}/>{g.teamA.name}</div>
            <div className="agr-score">
              {g.scoreA!==null?<>{g.scoreA}<span className="score-sep">:</span>{g.scoreB}</>:<span className="muted">–</span>}
            </div>
            <div className="agr-team right"><span className="team-dot" style={{background:g.teamB.color}}/>{g.teamB.name}</div>
          </div>
          <div className="agr-date">{g.date?fmtDate(g.date):"Data a definir"}</div>
          <div className="agr-edit">✏️</div>
        </div>
      ))}
      {sorted.length===0&&<p className="muted" style={{padding:"20px 0",textAlign:"center"}}>Nenhum jogo criado ainda.</p>}
    </div>
  );
}

function AdminTeams({teams,players,games}){
  const sorted=[...teams].sort((a,b)=>(b.wins*2+b.draws)-(a.wins*2+a.draws));
  return(
    <div className="team-cards-grid">
      {sorted.map(t=>{
        const tPlayers=players.filter(p=>t.players?.includes(p.id));
        const tGames=games.filter(g=>(g.teamA.id===t.id||g.teamB.id===t.id)&&g.status==="done");
        const sd=t.pf-t.pa;
        return(
          <div key={t.id} className="team-admin-card" style={{"--tc":t.color}}>
            <div className="tac-header">
              <span className="tac-dot" style={{background:t.color}}/>
              <span className="tac-name">{t.name}</span>
              <span className="tac-pts">{t.wins*2+t.draws} pts</span>
            </div>
            <div className="tac-stats">
              <span>V {t.wins}</span><span>D {t.losses}</span>
              <span>SP {t.pf}</span><span>SA {t.pa}</span>
              <span className={sd>=0?"pos-sd":"neg-sd"}>SD {sd>0?"+":""}{sd}</span>
            </div>
            <div className="tac-players">
              {tPlayers.map(p=>(
                <div key={p.id} className="tac-player">
                  <span className="pos-badge sm">{p.position.slice(0,3)}</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
            {tGames.length>0&&(
              <div className="tac-record">
                {tGames.map(g=>{
                  const mine=g.teamA.id===t.id;
                  const ms=mine?g.scoreA:g.scoreB, os=mine?g.scoreB:g.scoreA;
                  const opp=mine?g.teamB:g.teamA;
                  return(
                    <div key={g.id} className={`mini-result ${ms>os?"won":"lost"}`}>
                      <span className="mini-opp"><span className="team-dot sm" style={{background:opp.color}}/>{opp.name}</span>
                      <span>{ms}:{os}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {teams.length===0&&<p className="muted" style={{padding:"20px 0"}}>Sorteio ainda não realizado.</p>}
    </div>
  );
}

function AdminConfig({settings,saveSettings}){
  const [s,setS]=useState({...settings});
  return(
    <div className="card">
      <h3 className="card-title">⚙️ Configurações do Evento</h3>
      {[{k:"eventName",l:"Nome do Evento",ph:"ex: 3x3 Open Verão"},{k:"venue",l:"Local / Quadra",ph:"ex: Ginásio Central"},{k:"adminPass",l:"Senha do Admin",ph:"••••••"}].map(({k,l,ph})=>(
        <div key={k} className="field">
          <label className="field-label">{l}</label>
          <input className="field-input" placeholder={ph} value={s[k]||""} type={k==="adminPass"?"password":"text"}
            onChange={e=>setS(prev=>({...prev,[k]:e.target.value}))}/>
        </div>
      ))}
      <div className="fiba-box">
        <h4 className="fiba-title">📋 Regras FIBA 3×3 (referência)</h4>
        <div className="fiba-grid">
          {[
            ["Vitória","Primeiro a 21 pts OU maior placar em 10 min regulamentares"],
            ["Pontuação","Arremesso dentro do arco = 1pt · Além do arco = 2pts · Lance livre = 1pt"],
            ["Overtime","Se empate no tempo: jogo até o primeiro ponto marcado"],
            ["Timeout","1 por time por partida (não acumulável)"],
            ["Faltas","6 faltas de equipe: a partir daí lances livres para infrações não técnicas"],
            ["Posse","Início: cara ou coroa · Após cesta: adversário recebe bola atrás do arco"],
          ].map(([k,v])=>(
            <div key={k} className="fiba-rule"><span className="fiba-key">{k}</span><span className="fiba-val">{v}</span></div>
          ))}
        </div>
      </div>
      <button className="submit-btn" style={{marginTop:16}} onClick={()=>saveSettings(s)}>Salvar Configurações</button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   GAME PANEL
───────────────────────────────────────────────────────────── */
function GamePanel({game,saveGame,back,notify}){
  const [g,setG]=useState(game?{...game,scoreA:game.scoreA??0,scoreB:game.scoreB??0}:null);
  const [timer,setTimer]=useState(game?.elapsedSec||0);
  const [running,setRunning]=useState(false);
  const ref=useRef(null);

  useEffect(()=>{
    if(running){ ref.current=setInterval(()=>setTimer(t=>{ const n=t+1; setG(p=>({...p,elapsedSec:n})); return n; }),1000); }
    else clearInterval(ref.current);
    return()=>clearInterval(ref.current);
  },[running]);

  if(!g) return <div className="page"><button className="back-btn" onClick={back}>← Voltar</button></div>;

  const p=(k,v)=>setG(prev=>({...prev,[k]:v}));
  const inc=(k,by=1)=>setG(prev=>({...prev,[k]:(prev[k]??0)+by}));
  const dec=(k)=>setG(prev=>({...prev,[k]:Math.max(0,(prev[k]??0)-1)}));

  const handleSave=async()=>{ await saveGame(g); notify("💾 Salvo!"); };
  const handleFinish=async()=>{ setRunning(false); const f={...g,status:"done"}; setG(f); await saveGame(f); notify("✅ Jogo finalizado!"); back(); };
  const handleLive=async()=>{ const l={...g,status:"live"}; setG(l); await saveGame(l); setRunning(true); notify("▶ Jogo iniciado!"); };

  const mm=String(Math.floor(timer/60)).padStart(2,"0");
  const ss=String(timer%60).padStart(2,"0");
  const overTime=timer>=FIBA.winTime;
  const foulWarnA=g.foulsA>=FIBA.foulsLimit;
  const foulWarnB=g.foulsB>=FIBA.foulsLimit;

  return(
    <div className="page">
      <button className="back-btn" onClick={back}>← Voltar</button>
      <div className="game-panel">

        {/* Header */}
        <div className="gp-header">
          <div className="gp-status-row">
            <span className={`gp-status ${g.status==="live"?"st-live":g.status==="done"?"st-done":"st-pending"}`}>
              {g.status==="done"?"FINALIZADO":g.status==="live"?"🔴 AO VIVO":"AGUARDANDO"}
            </span>
            <div className="gp-timer" style={{color:overTime?"#f97316":"#e2e8f0"}}>
              {mm}:{ss}{overTime&&<span className="ot-badge">OT</span>}
            </div>
            <div style={{display:"flex",gap:6}}>
              {g.status!=="done"&&(
                !running
                  ? <button className="ctrl-btn green" onClick={g.status==="live"?()=>setRunning(true):handleLive}>{g.status==="live"?"▶":"▶ Iniciar"}</button>
                  : <button className="ctrl-btn yellow" onClick={()=>setRunning(false)}>⏸</button>
              )}
            </div>
          </div>
        </div>

        {/* Scoreboard */}
        <div className="gp-scoreboard">
          <ScoreBlock label={g.teamA.name} color={g.teamA.color} score={g.scoreA} fouls={g.foulsA} timeouts={g.timeoutsA}
            on1={()=>inc("scoreA",1)} on2={()=>inc("scoreA",2)} onFT={()=>inc("scoreA",1)}
            onFoul={()=>inc("foulsA")} onFoulDec={()=>dec("foulsA")}
            onTimeout={()=>p("timeoutsA",Math.max(0,g.timeoutsA-1))} onMinus={()=>dec("scoreA")}/>
          <div className="gp-center">
            <div className="gp-big-score">{g.scoreA??0}</div>
            <div className="gp-colon">:</div>
            <div className="gp-big-score">{g.scoreB??0}</div>
          </div>
          <ScoreBlock label={g.teamB.name} color={g.teamB.color} score={g.scoreB} fouls={g.foulsB} timeouts={g.timeoutsB}
            on1={()=>inc("scoreB",1)} on2={()=>inc("scoreB",2)} onFT={()=>inc("scoreB",1)}
            onFoul={()=>inc("foulsB")} onFoulDec={()=>dec("foulsB")}
            onTimeout={()=>p("timeoutsB",Math.max(0,g.timeoutsB-1))} onMinus={()=>dec("scoreB")}/>
        </div>

        {(foulWarnA||foulWarnB)&&(
          <div className="foul-warning">⚠️ {foulWarnA?g.teamA.name:""}{foulWarnA&&foulWarnB?" e ":""}{foulWarnB?g.teamB.name:""} — limite de faltas atingido (lances livres)</div>
        )}

        <div className="gp-meta">
          <div className="field">
            <label className="field-label">Data e Hora</label>
            <input className="field-input" type="datetime-local" value={g.date?.slice(0,16)||""}
              onChange={e=>p("date",new Date(e.target.value).toISOString())}/>
          </div>
          <div className="field">
            <label className="field-label">Observações / Fatos do Jogo</label>
            <textarea className="field-input" rows={3} placeholder="Destaque, incidentes, MVPs..."
              value={g.notes||""} onChange={e=>p("notes",e.target.value)}/>
          </div>
        </div>

        <div className="gp-actions">
          <button className="action-btn" onClick={handleSave}>💾 Salvar</button>
          {g.status!=="done"&&<button className="action-btn danger" onClick={handleFinish}>✅ Finalizar Jogo</button>}
        </div>
      </div>
    </div>
  );
}

function ScoreBlock({label,color,fouls,timeouts,on1,on2,onFT,onFoul,onFoulDec,onTimeout,onMinus}){
  return(
    <div className="score-block">
      <div className="sb-team-name"><span className="team-dot" style={{background:color}}/>{label}</div>
      <div className="sb-btns">
        <button className="sb-btn two" onClick={on2} title="Arremesso além do arco (+2)">+2</button>
        <button className="sb-btn one" onClick={on1} title="Arremesso dentro do arco (+1)">+1</button>
        <button className="sb-btn ft"  onClick={onFT} title="Lance Livre (+1)">LB</button>
        <button className="sb-btn minus" onClick={onMinus} title="Corrigir (-1)">-1</button>
      </div>
      <div className="sb-meta">
        <div>
          <span className="meta-label">Faltas</span>
          <div className="meta-counter">
            <button className="counter-btn" onClick={onFoulDec}>-</button>
            <span className={fouls>=FIBA.foulsLimit?"foul-limit":""}>{fouls}</span>
            <button className="counter-btn" onClick={onFoul}>+</button>
          </div>
        </div>
        <div>
          <span className="meta-label">Timeout</span>
          <div className="meta-counter">
            <button className="counter-btn" onClick={onTimeout} disabled={timeouts<=0}>usar</button>
            <span>{timeouts}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SHARED
───────────────────────────────────────────────────────────── */
function GameCard({game,highlight}){
  const isLive=game.status==="live"; const isDone=game.status==="done";
  return(
    <div className={`game-card${isLive?" live-card":""}`}>
      {isLive&&<div className="live-indicator">🔴 AO VIVO</div>}
      <div className="gc-teams">
        <div className={`gc-team${highlight===game.teamA.id?" my-team":""}`}>
          <span className="team-dot" style={{background:game.teamA.color}}/>
          <span className="gc-name">{game.teamA.name}</span>
          {isDone&&<span className="gc-score">{game.scoreA}</span>}
        </div>
        <span className="gc-vs">×</span>
        <div className={`gc-team right${highlight===game.teamB.id?" my-team":""}`}>
          {isDone&&<span className="gc-score">{game.scoreB}</span>}
          <span className="gc-name">{game.teamB.name}</span>
          <span className="team-dot" style={{background:game.teamB.color}}/>
        </div>
      </div>
      <div className="gc-date">{game.date?fmtDate(game.date):"Data a definir"}</div>
      {game.notes&&<div className="gc-notes">💬 {game.notes}</div>}
    </div>
  );
}

function Section({title,children}){
  return <div className="section"><h3 className="section-title">{title}</h3>{children}</div>;
}
function Toast({toast}){
  return <div className={`toast ${toast.type==="err"?"toast-err":"toast-ok"}`}>{toast.msg}</div>;
}
function Splash(){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#060d1a"}}>
      <span style={{fontSize:64,animation:"spin 1s linear infinite"}}>🏀</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   CSS
───────────────────────────────────────────────────────────── */
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=DM+Sans:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#060d1a;--bg2:#0d1a2e;--bg3:#1a2744;
  --border:#1e3058;--text:#e8edf5;--muted:#5a7aa0;
  --accent:#f97316;--accent2:#fb923c;
  --green:#22c55e;--red:#ef4444;--blue:#3b82f6;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;}
.app{min-height:100vh;}
.main{max-width:960px;margin:0 auto;padding:0 16px 60px;}
.page{padding-top:20px;display:flex;flex-direction:column;gap:0;}

/* NAV */
.nav{position:sticky;top:0;z-index:100;background:rgba(6,13,26,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:52px;}
.nav-brand{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:20px;}
.nav-title{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:900;letter-spacing:.3px;color:#fff;}
.nav-links{display:flex;gap:2px;}
.nav-btn{background:none;border:none;color:var(--muted);padding:6px 13px;border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;transition:all .15s;}
.nav-btn:hover{color:var(--text);background:var(--bg3);}
.nav-btn.active{color:var(--accent);background:rgba(249,115,22,.1);}

/* HERO */
.hero{position:relative;overflow:hidden;padding:56px 24px 44px;text-align:center;}
.hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 50%,rgba(249,115,22,.13) 0%,transparent 70%);pointer-events:none;}
.hero-bg::after{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,transparent,transparent 44px,rgba(255,255,255,.018) 44px,rgba(255,255,255,.018) 45px),repeating-linear-gradient(90deg,transparent,transparent 44px,rgba(255,255,255,.018) 44px,rgba(255,255,255,.018) 45px);}
.hero-content{position:relative;z-index:1;}
.hero-tag{display:inline-block;border:1px solid var(--accent);color:var(--accent);font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:3px;font-weight:700;text-transform:uppercase;padding:4px 14px;border-radius:20px;margin-bottom:14px;}
.hero-name{font-family:'Barlow Condensed',sans-serif;font-size:clamp(44px,10vw,86px);font-weight:900;color:#fff;line-height:.9;letter-spacing:-1px;text-shadow:0 0 60px rgba(249,115,22,.35);}
.hero-venue{color:var(--muted);margin-top:8px;font-size:15px;}
.hero-stats{display:flex;justify-content:center;gap:32px;margin:26px 0 18px;}
.hero-stat{text-align:center;}
.hero-stat-n{display:block;font-family:'Barlow Condensed',sans-serif;font-size:40px;font-weight:900;color:var(--accent);line-height:1;}
.hero-stat-l{display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-top:2px;}
.deadline-badge{display:inline-block;border:1px solid var(--border);background:var(--bg2);border-radius:20px;padding:5px 16px;font-size:13px;color:var(--muted);margin-bottom:14px;}
.deadline-badge.past{border-color:var(--red);color:var(--red);}
.cta-btn{background:var(--accent);color:#fff;border:none;padding:12px 36px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:.3px;cursor:pointer;transition:all .2s;}
.cta-btn:hover{background:var(--accent2);transform:translateY(-1px);}

/* STANDINGS */
.table-wrap{overflow-x:auto;}
.standings-table{width:100%;border-collapse:collapse;font-size:13px;}
.standings-table thead tr{background:var(--bg3);}
.standings-table th{padding:9px 11px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:700;}
.standings-table td{padding:9px 11px;border-bottom:1px solid var(--border);vertical-align:middle;}
.standings-table tr.row-leader td{background:rgba(249,115,22,.06);}
.standings-table tr:hover td{background:var(--bg3);}
.team-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle;flex-shrink:0;}
.team-dot.sm{width:7px;height:7px;}
.pos-num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:var(--bg3);font-size:12px;font-weight:700;}
.pts{color:var(--accent);font-size:15px;}
.pos-sd{color:#22c55e;}.neg-sd{color:#ef4444;}
.rule-note{font-size:11px;color:var(--muted);margin-top:8px;text-align:center;}

/* GAME CARDS */
.game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:10px;}
.game-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 15px;transition:border-color .2s;}
.game-card:hover{border-color:rgba(249,115,22,.4);}
.live-card{border-color:#ef444460;animation:pulse-border 2s ease-in-out infinite;}
@keyframes pulse-border{0%,100%{border-color:#ef444460}50%{border-color:#ef4444}}
.live-indicator{color:#ef4444;font-size:11px;font-weight:700;margin-bottom:7px;letter-spacing:.5px;}
.gc-teams{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px;}
.gc-team{display:flex;align-items:center;gap:5px;flex:1;}
.gc-team.right{flex-direction:row-reverse;}
.gc-name{font-size:13px;font-weight:600;color:var(--text);}
.gc-score{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;color:var(--accent);}
.gc-vs{color:var(--muted);font-size:11px;font-weight:700;flex-shrink:0;}
.gc-date{font-size:11px;color:var(--muted);}
.gc-notes{font-size:11px;color:var(--muted);margin-top:4px;font-style:italic;}
.my-team .gc-name{color:var(--accent);}
.score-sep{color:var(--muted);margin:0 1px;}

/* SECTION / CARD */
.section{margin-top:28px;}
.section-title,.page-title{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:700;letter-spacing:.2px;color:var(--text);margin-bottom:12px;}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:14px;}
.card-title{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;margin-bottom:14px;color:var(--text);}
.center-card{max-width:420px;margin:36px auto 0;text-align:center;}
.center-card .field{text-align:left;}
.card-icon{font-size:38px;margin-bottom:10px;}
.center-card h2{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;margin-bottom:6px;}
.info-card{text-align:center;}

/* FORM */
.field{margin-bottom:13px;}
.field-label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:5px;}
.field-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border .15s;}
.field-input:focus{border-color:var(--accent);}
.field-input.input-err{border-color:var(--red);}
.input-err-msg{font-size:11px;color:var(--red);margin-top:3px;display:block;}
textarea.field-input{resize:vertical;}
.pos-picker{display:flex;gap:8px;}
.pos-opt{flex:1;background:var(--bg);border:1px solid var(--border);color:var(--muted);padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
.pos-opt.active{background:rgba(249,115,22,.14);border-color:var(--accent);color:var(--accent);}
.pos-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(249,115,22,.1);color:var(--accent);}
.pos-badge.sm{padding:1px 5px;font-size:10px;}
.submit-btn{width:100%;background:var(--accent);color:#fff;border:none;padding:13px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;letter-spacing:.3px;cursor:pointer;transition:all .15s;margin-top:4px;}
.submit-btn:hover{background:var(--accent2);}
.deadline-note{font-size:11px;color:var(--muted);margin-top:8px;}

/* TEAM HERO (lookup) */
.team-hero-card{display:flex;align-items:center;gap:18px;border-left:4px solid var(--tc,var(--accent));}
.team-jersey{position:relative;width:56px;height:56px;flex-shrink:0;}
.jersey-shape{width:56px;height:56px;border-radius:50%;}
.jersey-initial{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:#fff;text-shadow:0 1px 4px #0006;}
.team-name-big{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;color:#fff;}
.team-mini-stats{display:flex;gap:12px;margin-top:5px;font-size:12px;color:var(--muted);}
.team-mini-stats strong{color:var(--text);}

/* RESULTS */
.result-list{display:flex;flex-direction:column;gap:7px;}
.result-row{display:grid;grid-template-columns:34px 1fr auto auto;align-items:center;gap:10px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;}
.result-status{width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:15px;}
.result-row.won .result-status{background:rgba(34,197,94,.14);color:#22c55e;}
.result-row.lost .result-status{background:rgba(239,68,68,.1);color:#ef4444;}
.result-vs{font-size:13px;font-weight:600;}
.opp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 3px;vertical-align:middle;}
.result-date{font-size:11px;color:var(--muted);}
.result-score{font-family:'Barlow Condensed',sans-serif;font-size:21px;font-weight:900;color:var(--accent);}
.result-detail{font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:2px;text-align:right;}

/* TABS */
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:18px;}
.tab-btn{background:var(--bg2);border:1px solid var(--border);color:var(--muted);padding:7px 15px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
.tab-btn:hover{color:var(--text);}
.tab-btn.active{background:rgba(249,115,22,.14);border-color:var(--accent);color:var(--accent);}

/* ADMIN DASH */
.dash-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:9px;margin-bottom:14px;}
.dash-stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 15px;border-top:3px solid var(--sc,var(--accent));}
.dash-stat-val{display:block;font-family:'Barlow Condensed',sans-serif;font-size:34px;font-weight:900;color:var(--sc,var(--accent));}
.dash-stat-label{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-top:2px;}
.row-fields{display:flex;gap:8px;}
.action-btn{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;white-space:nowrap;}
.action-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff;}
.action-btn.danger{background:rgba(239,68,68,.13);border-color:#ef444438;color:#ef4444;}
.action-btn.danger:hover{background:#ef4444;border-color:#ef4444;color:#fff;}
.draw-btn{width:100%;background:rgba(249,115,22,.12);border:1px dashed var(--accent);color:var(--accent);padding:14px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:8px;}
.draw-btn:hover:not(:disabled){background:var(--accent);color:#fff;}
.draw-btn:disabled{opacity:.35;cursor:not-allowed;}

/* DATA TABLE */
.data-table{width:100%;border-collapse:collapse;font-size:13px;min-width:460px;}
.data-table thead tr{background:var(--bg3);}
.data-table th{padding:9px 11px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700;}
.data-table td{padding:9px 11px;border-bottom:1px solid var(--border);}
.data-table tr:hover td{background:var(--bg3);}

/* ADMIN BRACKET */
.game-admin-list{display:flex;flex-direction:column;gap:6px;}
.admin-game-row{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;cursor:pointer;transition:all .15s;display:grid;grid-template-columns:100px 1fr 120px 30px;align-items:center;gap:10px;}
.admin-game-row:hover{border-color:var(--accent);background:var(--bg3);}
.agr-status{display:flex;align-items:center;gap:6px;}
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.sdot-live{background:#22c55e;box-shadow:0 0 6px #22c55e;}
.sdot-done{background:var(--accent);}
.sdot-pending{background:var(--muted);}
.status-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);}
.agr-teams{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.agr-team{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:600;}
.agr-team.right{flex-direction:row-reverse;}
.agr-score{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:900;color:var(--accent);text-align:center;min-width:50px;}
.agr-date{font-size:11px;color:var(--muted);}
.agr-edit{color:var(--muted);text-align:right;}

/* TEAM CARDS */
.team-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:11px;}
.team-admin-card{background:var(--bg2);border:1px solid var(--border);border-top:3px solid var(--tc);border-radius:12px;padding:15px;}
.tac-header{display:flex;align-items:center;gap:8px;margin-bottom:9px;}
.tac-dot{width:12px;height:12px;border-radius:50%;}
.tac-name{font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;flex:1;}
.tac-pts{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;color:var(--accent);}
.tac-stats{display:flex;gap:9px;font-size:12px;color:var(--muted);flex-wrap:wrap;margin-bottom:9px;}
.tac-players{display:flex;flex-direction:column;gap:3px;margin-bottom:8px;}
.tac-player{display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;border-top:1px solid var(--border);}
.tac-record{display:flex;flex-direction:column;gap:3px;}
.mini-result{display:flex;justify-content:space-between;font-size:12px;padding:3px 6px;border-radius:4px;}
.mini-result.won{background:rgba(34,197,94,.07);color:#22c55e;}
.mini-result.lost{background:rgba(239,68,68,.06);color:#ef4444;}
.mini-opp{display:flex;align-items:center;gap:4px;}

/* FIBA BOX */
.fiba-box{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:15px;margin-top:14px;}
.fiba-title{font-family:'Barlow Condensed',sans-serif;font-size:13px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px;color:var(--muted);}
.fiba-grid{display:flex;flex-direction:column;gap:6px;}
.fiba-rule{display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:12px;align-items:start;}
.fiba-key{font-weight:700;color:var(--accent);}
.fiba-val{color:var(--muted);line-height:1.4;}

/* GAME PANEL */
.game-panel{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:20px;}
.gp-header{margin-bottom:18px;}
.gp-status-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
.gp-status{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
.st-live{color:#22c55e;}.st-done{color:var(--accent);}.st-pending{color:var(--muted);}
.gp-timer{font-family:'Barlow Condensed',sans-serif;font-size:38px;font-weight:900;letter-spacing:2px;line-height:1;}
.ot-badge{font-size:13px;background:rgba(249,115,22,.18);color:var(--accent);border-radius:4px;padding:2px 7px;margin-left:8px;vertical-align:middle;}
.ctrl-btn{border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;color:#fff;}
.ctrl-btn.green{background:#16a34a;}.ctrl-btn.yellow{background:#ca8a04;}
.gp-scoreboard{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:start;margin:14px 0;}
.gp-center{display:flex;align-items:center;justify-content:center;gap:2px;padding-top:14px;}
.gp-big-score{font-family:'Barlow Condensed',sans-serif;font-size:76px;font-weight:900;color:var(--accent);line-height:1;}
.gp-colon{font-family:'Barlow Condensed',sans-serif;font-size:56px;color:var(--border);line-height:1;}
.score-block{background:var(--bg3);border-radius:12px;padding:13px;text-align:center;}
.sb-team-name{font-size:13px;font-weight:600;margin-bottom:11px;display:flex;align-items:center;justify-content:center;gap:5px;}
.sb-btns{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-bottom:11px;}
.sb-btn{border:none;border-radius:8px;padding:10px 13px;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:900;cursor:pointer;color:#fff;transition:opacity .15s;}
.sb-btn:hover{opacity:.82;}
.sb-btn.two{background:#1d4ed8;}.sb-btn.one{background:#2563eb;}.sb-btn.ft{background:#0891b2;}.sb-btn.minus{background:#334155;}
.sb-meta{display:flex;gap:16px;justify-content:center;}
.meta-label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;}
.meta-counter{display:flex;align-items:center;gap:5px;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;}
.counter-btn{background:var(--bg);border:1px solid var(--border);color:var(--muted);width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:12px;}
.counter-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.counter-btn:disabled{opacity:.3;cursor:not-allowed;}
.foul-limit{color:var(--red);}
.foul-warning{background:rgba(239,68,68,.09);border:1px solid rgba(239,68,68,.28);color:#f87171;border-radius:8px;padding:9px 13px;font-size:13px;font-weight:600;text-align:center;margin:8px 0;}
.gp-meta{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:14px;}
.gp-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end;}
.back-btn{background:var(--bg2);border:1px solid var(--border);color:var(--muted);padding:8px 15px;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:14px;}

/* MISC */
.muted{color:var(--muted);font-size:13px;line-height:1.6;}
.muted strong{color:var(--text);}
.sm{font-size:11px;}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:11px 22px;border-radius:10px;font-weight:600;font-size:14px;z-index:999;color:#fff;box-shadow:0 4px 20px #0009;white-space:nowrap;}
.toast-ok{background:#16a34a;}.toast-err{background:#dc2626;}

@media(max-width:560px){
  .gp-scoreboard{grid-template-columns:1fr;}.gp-center{flex-direction:row;justify-content:center;}
  .nav-links .nav-btn{padding:5px 8px;font-size:12px;}
  .admin-game-row{grid-template-columns:1fr;gap:6px;}
  .gp-meta{grid-template-columns:1fr;}
  .result-row{grid-template-columns:30px 1fr auto;}
}
`;
