import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, dbGet, dbSet, dbAll } from './supabase.js'

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const POSITIONS     = ['Armador', 'Ala', 'Pivô']
const JERSEY_COLORS = ['#E83A3A','#2196F3','#4CAF50','#FF9800','#9C27B0','#00BCD4','#FF5722','#8BC34A','#E91E63','#607D8B']
const JERSEY_NAMES  = ['Vermelho','Azul','Verde','Laranja','Roxo','Ciano','Coral','Lima','Rosa','Cinza']
const PLAYERS_PER_TEAM = 3   // sempre 3x3
const MIN_PLAYERS      = 6   // mínimo 2 times
const FIBA = { winTime: 600, foulsLimit: 6, timeoutsPerTeam: 1 }

/* ─────────────────────────────────────────────────────────────
   SORTEIO INTELIGENTE POR POSIÇÃO
   Tenta montar cada time com 1 Armador + 1 Ala + 1 Pivô.
   Se as posições não fecharem perfeitamente, distribui o
   restante de forma equilibrada.
───────────────────────────────────────────────────────────── */
function smartDraw(players) {
  const numTeams = Math.floor(players.length / PLAYERS_PER_TEAM)

  // Cria times vazios
  const teams = Array.from({ length: numTeams }, (_, i) => ({
    id: uid(),
    name: `Time ${JERSEY_NAMES[i % JERSEY_NAMES.length]}`,
    color: JERSEY_COLORS[i % JERSEY_COLORS.length],
    players: [],
    wins: 0, losses: 0, draws: 0, pf: 0, pa: 0,
  }))

  // Separa por posição e embaralha cada grupo
  const byPos = {
    'Armador': shuffle(players.filter(p => p.position === 'Armador')),
    'Ala':     shuffle(players.filter(p => p.position === 'Ala')),
    'Pivô':    shuffle(players.filter(p => p.position === 'Pivô')),
  }

  // Distribui 1 de cada posição por time (round-robin)
  const order = ['Armador', 'Ala', 'Pivô']
  let teamIdx = 0
  for (const pos of order) {
    for (let i = 0; i < numTeams && byPos[pos].length > 0; i++) {
      const p = byPos[pos].shift()
      teams[i].players.push(p.id)
    }
  }

  // Jogadores restantes (sobras de posição) — distribui pelo time com menos jogadores
  const remaining = shuffle([...byPos['Armador'], ...byPos['Ala'], ...byPos['Pivô']])
  for (const p of remaining) {
    // Encontra o time com menos jogadores que ainda tem vaga (< PLAYERS_PER_TEAM)
    const target = teams
      .filter(t => t.players.length < PLAYERS_PER_TEAM)
      .sort((a, b) => a.players.length - b.players.length)[0]
    if (target) target.players.push(p.id)
  }

  return teams.filter(t => t.players.length === PLAYERS_PER_TEAM)
}

function uid() { return Math.random().toString(36).slice(2, 9) }
function shuffle(a) {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

function buildRoundRobin(teams) {
  const games = []
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      games.push({
        id: uid(), round: 1,
        team_a: { id: teams[i].id, name: teams[i].name, color: teams[i].color },
        team_b: { id: teams[j].id, name: teams[j].name, color: teams[j].color },
        score_a: null, score_b: null,
        fouls_a: 0, fouls_b: 0,
        timeouts_a: FIBA.timeoutsPerTeam, timeouts_b: FIBA.timeoutsPerTeam,
        game_date: null, status: 'pending', notes: '', elapsed_sec: 0,
        player_fouls_a: [0,0,0], player_fouls_b: [0,0,0], wo: null,
      })
    }
  }
  return games
}

const V = { HOME: 'home', REG: 'reg', LOOKUP: 'lookup', ADMIN: 'admin', GAME: 'game' }

function fmtDate(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/* ═══════════════════════════════════════════════════════════
   APP ROOT
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView]         = useState(V.HOME)
  const [players, setPlayers]   = useState([])
  const [teams, setTeams]       = useState([])
  const [games, setGames]       = useState([])
  const [deadline, setDeadline] = useState(null)
  const [drawn, setDrawn]       = useState(false)
  const [settings, setSettings] = useState({ event_name: '3x3 Open', venue: '', admin_pass: 'admin123', entry_fee: 0, pix_key: '', pix_name: '', registration_open: true })
  const [adminOk, setAdminOk]   = useState(false)
  const [activeGame, setActiveGame] = useState(null)
  const [toast, setToast]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [myName, setMyName]     = useState(() => localStorage.getItem('b3x3:name') || '')

  const notify = (msg, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  // ── Carrega tudo do Supabase ──────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [p, t, s, tour] = await Promise.all([
          dbAll('players'),
          dbAll('teams'),
          dbGet('settings'),
          dbGet('tournament'),
        ])
        // Load games ordered by seq then id
        const { data: g } = await supabase.from('games').select('*').order('seq', { ascending: true }).order('id', { ascending: true })
        if (p) setPlayers(p)
        if (t) setTeams(t)
        if (g) setGames(g)
        if (s) setSettings(s)
        if (tour) {
          setDeadline(tour.deadline)
          setDrawn(tour.drawn)
        }
      } catch (e) {
        notify('Erro ao conectar com banco de dados', 'err')
      }
      setLoading(false)
    })()
  }, [])

  // ── Realtime: atualiza placar ao vivo para todos ──────────
  useEffect(() => {
    const channel = supabase
      .channel('public-games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, payload => {
        if (payload.eventType === 'UPDATE') {
          setGames(prev => prev.map(g => g.id === payload.new.id ? payload.new : g))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, payload => {
        if (payload.eventType === 'UPDATE') {
          setTeams(prev => prev.map(t => t.id === payload.new.id ? payload.new : t))
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // ── Auto-sorteio quando prazo vence ──────────────────────
  useEffect(() => {
    if (!deadline || drawn) return
    const id = setInterval(() => {
      if (Date.now() >= new Date(deadline).getTime()) execDraw()
    }, 10000)
    return () => clearInterval(id)
  }, [deadline, drawn, players])

  // ── SORTEIO ───────────────────────────────────────────────
  const execDraw = useCallback(async () => {
    if (drawn) return
    if (players.length < MIN_PLAYERS) {
      notify(`Mínimo ${MIN_PLAYERS} inscritos para sortear (2 times)`, 'err'); return
    }

    const numTeams = Math.floor(players.length / PLAYERS_PER_TEAM)
    const usable   = players.slice(0, numTeams * PLAYERS_PER_TEAM) // descarta sobras
    const leftover = players.slice(numTeams * PLAYERS_PER_TEAM)

    const newTeams = smartDraw(usable)
    const newGames = buildRoundRobin(newTeams)

    // Salva no Supabase
    await supabase.from('teams').insert(newTeams)
    await supabase.from('games').insert(newGames)
    await supabase.from('tournament').update({ drawn: true }).eq('id', 'main')

    setTeams(newTeams)
    setGames(newGames)
    setDrawn(true)

    const msg = leftover.length > 0
      ? `🏀 ${newTeams.length} times formados! ${leftover.length} jogador(es) ficaram de fora (não completavam um time).`
      : `🏀 Sorteio realizado! ${newTeams.length} times de ${PLAYERS_PER_TEAM} jogadores.`
    notify(msg)
  }, [players, drawn])

  // ── SALVAR JOGO ───────────────────────────────────────────
  const saveGame = useCallback(async (patch) => {
    // Mapeia camelCase → snake_case para o banco
    const row = {
      id: patch.id,
      round: patch.round,
      team_a: patch.team_a,
      team_b: patch.team_b,
      score_a: patch.score_a,
      score_b: patch.score_b,
      fouls_a: patch.fouls_a,
      fouls_b: patch.fouls_b,
      timeouts_a: patch.timeouts_a,
      timeouts_b: patch.timeouts_b,
      status: patch.status,
      notes: patch.notes,
      elapsed_sec: patch.elapsed_sec,
      game_date: patch.game_date,
      player_fouls_a: patch.player_fouls_a || [0,0,0],
      player_fouls_b: patch.player_fouls_b || [0,0,0],
      wo: patch.wo || null,
    }
    await supabase.from('games').update(row).eq('id', patch.id)
    setGames(prev => prev.map(g => g.id === patch.id ? patch : g))

    // Recalcula stats do time se finalizado
    if (patch.status === 'done') {
      const updates = teams.map(t => {
        let { wins, losses, draws, pf, pa } = t
        if (t.id === patch.team_a.id) {
          pf += patch.score_a || 0; pa += patch.score_b || 0
          if (patch.score_a > patch.score_b) wins++
          else if (patch.score_a < patch.score_b) losses++
          else draws++
        } else if (t.id === patch.team_b.id) {
          pf += patch.score_b || 0; pa += patch.score_a || 0
          if (patch.score_b > patch.score_a) wins++
          else if (patch.score_b < patch.score_a) losses++
          else draws++
        } else return null
        return { id: t.id, wins, losses, draws, pf, pa }
      }).filter(Boolean)

      for (const u of updates) {
        await supabase.from('teams').update(u).eq('id', u.id)
      }
      setTeams(prev => prev.map(t => {
        const u = updates.find(x => x.id === t.id)
        return u ? { ...t, ...u } : t
      }))
    }
  }, [games, teams])

  // ── SALVAR SETTINGS ───────────────────────────────────────
  const saveSettings = async (s) => {
    await supabase.from('settings').update(s).eq('id', 'main')
    setSettings(s)
    notify('Configurações salvas!')
  }

  // ── SALVAR DEADLINE ───────────────────────────────────────
  const saveDeadline = async (d) => {
    await supabase.from('tournament').update({ deadline: d }).eq('id', 'main')
    setDeadline(d)
    notify('Prazo salvo!')
  }

  // ── ADICIONAR JOGADOR ─────────────────────────────────────
  const addPlayer = async (name, pos) => {
    if (drawn) { notify('Sorteio já realizado', 'err'); return }
    if (deadline && Date.now() >= new Date(deadline).getTime()) { notify('Inscrições encerradas', 'err'); return }
    if (settings.registration_open === false) { notify('Inscrições encerradas pelo organizador', 'err'); return }
    if (players.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())) { notify('Nome já inscrito', 'err'); return }

    const p = { id: uid(), name: name.trim(), position: pos, paid: false, created_at: new Date().toISOString() }
    const { error } = await supabase.from('players').insert(p)
    if (error) { notify('Erro ao salvar inscrição', 'err'); return }

    setPlayers(prev => [...prev, p])
    setMyName(p.name)
    localStorage.setItem('b3x3:name', p.name)
    notify('✅ Inscrito com sucesso!')
    setView(V.LOOKUP)
  }

  // ── TOGGLE PAGAMENTO ─────────────────────────────────
  const togglePaid = async (id) => {
    const player = players.find(p => p.id === id)
    if (!player) return
    const paid = !player.paid
    await supabase.from('players').update({ paid }).eq('id', id)
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, paid } : p))
    notify(paid ? '✅ Pagamento confirmado!' : '↩️ Pagamento removido')
  }

  // ── RESET CAMPEONATO ─────────────────────────────────
  const resetTournament = async () => {
    // Arquiva resultado atual em settings antes de limpar
    const summary = {
      archived_at: new Date().toISOString(),
      event: settings.event_name,
      teams: teams.map(t => ({ name: t.name, wins: t.wins, losses: t.losses, pf: t.pf, pa: t.pa }))
    }
    await supabase.from('settings').update({ last_edition: JSON.stringify(summary) }).eq('id', 'main')
    // Limpa jogos, times e reseta torneio
    await supabase.from('games').delete().neq('id', 'x')
    await supabase.from('teams').delete().neq('id', 'x')
    await supabase.from('players').delete().neq('id', 'x')
    await supabase.from('tournament').update({ drawn: false, deadline: null }).eq('id', 'main')
    setGames([]); setTeams([]); setPlayers([])
    setDrawn(false); setDeadline(null)
    notify('🆕 Novo campeonato iniciado!')
  }

  // ── REMOVER JOGADOR ───────────────────────────────────────
  const removePlayer = async (id) => {
    const { error } = await supabase.from('players').delete().eq('id', id)
    if (error) { notify('Erro ao remover jogador', 'err'); return }
    setPlayers(prev => prev.filter(p => p.id !== id))
    notify('🗑️ Jogador removido!')
  }

  // ── RENOMEAR TIME ─────────────────────────────────────────
  const renameTeam = async (teamId, newName) => {
    const trimmed = newName.trim()
    if (!trimmed) { notify('Nome não pode ser vazio', 'err'); return }
    if (teams.find(t => t.id !== teamId && t.name.toLowerCase() === trimmed.toLowerCase())) {
      notify('Esse nome já está sendo usado por outro time', 'err'); return
    }
    await supabase.from('teams').update({ name: trimmed, named: true }).eq('id', teamId)
    const teamGames = games.filter(g => g.team_a.id === teamId || g.team_b.id === teamId)
    for (const g of teamGames) {
      const patch = {}
      if (g.team_a.id === teamId) patch.team_a = { ...g.team_a, name: trimmed }
      if (g.team_b.id === teamId) patch.team_b = { ...g.team_b, name: trimmed }
      await supabase.from('games').update(patch).eq('id', g.id)
    }
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, name: trimmed, named: true } : t))
    setGames(prev => prev.map(g => {
      const upd = { ...g }
      if (g.team_a.id === teamId) upd.team_a = { ...g.team_a, name: trimmed }
      if (g.team_b.id === teamId) upd.team_b = { ...g.team_b, name: trimmed }
      return upd
    }))
    notify('✅ Nome do time atualizado!')
  }

  // ── REORDENAR JOGOS ──────────────────────────────────
  const reorderGames = async (newOrder) => {
    // newOrder = array de game ids na nova sequência
    // Salva um campo `seq` em cada jogo para manter a ordem
    const updates = newOrder.map((id, idx) => ({ id, seq: idx }))
    for (const u of updates) {
      await supabase.from('games').update({ seq: u.seq }).eq('id', u.id)
    }
    const reordered = newOrder.map(id => games.find(g => g.id === id)).filter(Boolean)
    setGames(reordered)
    notify('✅ Ordem salva!')
  }

  // Sugere ordem equilibrada: nenhum time joga 2x seguido
  const suggestOrder = (gameList) => {
    const pending = gameList.filter(g => g.status === 'pending')
    const rest    = gameList.filter(g => g.status !== 'pending')
    const result  = []
    const pool    = [...pending]
    let lastTeams = []

    while (pool.length > 0) {
      // Encontra jogo que não repete times do anterior
      const idx = pool.findIndex(g =>
        !lastTeams.includes(g.team_a.id) && !lastTeams.includes(g.team_b.id)
      )
      const pick = idx >= 0 ? pool.splice(idx, 1)[0] : pool.splice(0, 1)[0]
      result.push(pick)
      lastTeams = [pick.team_a.id, pick.team_b.id]
    }
    return [...result, ...rest]
  }

  if (loading) return <Splash />

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <Nav view={view} setView={setView} adminOk={adminOk} eventName={settings.event_name} />
        <main className="main">
          {toast && <Toast toast={toast} />}

          {view === V.HOME   && <HomeView teams={teams} games={games} deadline={deadline} drawn={drawn} setView={setView} eventName={settings.event_name} venue={settings.venue} />}
          {view === V.REG    && <RegisterView addPlayer={addPlayer} deadline={deadline} drawn={drawn} settings={settings} />}
          {view === V.LOOKUP && <LookupView players={players} teams={teams} games={games} myName={myName} setMyName={setMyName} renameTeam={renameTeam} />}
          {view === V.ADMIN  && (
            adminOk
              ? <AdminView players={players} teams={teams} games={games} deadline={deadline}
                  drawn={drawn} settings={settings} execDraw={execDraw}
                  saveGame={saveGame} saveSettings={saveSettings} saveDeadline={saveDeadline}
                  removePlayer={removePlayer} reorderGames={reorderGames} suggestOrder={suggestOrder}
                  togglePaid={togglePaid} resetTournament={resetTournament}
                  setView={setView} setActiveGame={setActiveGame} notify={notify} />
              : <AdminLogin correctPass={settings.admin_pass} onSuccess={() => setAdminOk(true)} />
          )}
          {view === V.GAME && activeGame && (
            <GamePanel
              game={games.find(g => g.id === activeGame)}
              saveGame={saveGame}
              back={() => setView(V.ADMIN)}
              notify={notify}
              allPlayers={players}
              allTeams={teams} />
          )}
        </main>
      </div>
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   NAV
───────────────────────────────────────────────────────────── */
function Nav({ view, setView, adminOk, eventName }) {
  const links = [
    { v: V.HOME, label: 'Início' },
    { v: V.REG, label: 'Inscrição' },
    { v: V.LOOKUP, label: 'Meu Time' },
    { v: V.ADMIN, label: adminOk ? '⚡ Admin' : 'Admin' },
  ]
  return (
    <nav className="nav">
      <div className="nav-brand" onClick={() => setView(V.HOME)}>
        <span>🏀</span>
        <span className="nav-title">{eventName || '3x3'}</span>
      </div>
      <div className="nav-links">
        {links.map(({ v, label }) => (
          <button key={v} className={`nav-btn${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}

/* ─────────────────────────────────────────────────────────────
   HOME
───────────────────────────────────────────────────────────── */
function HomeView({ teams, games, deadline, drawn, setView, eventName, venue }) {
  const isPast = deadline && Date.now() >= new Date(deadline).getTime()
  const sorted = [...teams].sort((a, b) =>
    (b.wins * 2 + b.draws) - (a.wins * 2 + a.draws) || (b.pf - b.pa) - (a.pf - a.pa)
  )
  const upcoming = [...games].sort((a,b) => (a.seq??99) - (b.seq??99)).filter(g => g.status === 'pending' || g.status === 'live').slice(0, 6)
  const recent   = [...games].sort((a,b) => (a.seq??99) - (b.seq??99)).filter(g => g.status === 'done').slice(-6).reverse()

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-bg" />
        <div className="hero-content">
          <div className="hero-tag">FIBA 3×3 Basketball</div>
          <h1 className="hero-name">{eventName}</h1>
          {venue && <p className="hero-venue">📍 {venue}</p>}
          <div className="hero-stats">
            <HeroStat n={teams.length} label="Times" />
            <HeroStat n={games.filter(g => g.status === 'done').length} label="Jogos" />
            <HeroStat n={games.length} label="Total" />
          </div>
          {deadline && (
            <div className={`deadline-badge${isPast ? ' past' : ''}`}>
              {isPast ? '⏰ Inscrições encerradas' : `⏳ Inscrições até ${fmtDate(deadline)}`}
            </div>
          )}
          {!drawn && <button className="cta-btn" onClick={() => setView(V.REG)}>Inscreva-se →</button>}
        </div>
      </div>

      {sorted.length > 0 && (
        <Section title="🏆 Classificação">
          <div className="table-wrap">
            <table className="standings-table">
              <thead>
                <tr><th>#</th><th>Time</th><th>J</th><th>V</th><th>D</th><th>SP</th><th>SA</th><th>SD</th><th>Pts</th></tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => {
                  const j = t.wins + t.losses + t.draws
                  const sd = t.pf - t.pa
                  return (
                    <tr key={t.id} className={i === 0 && j > 0 ? 'row-leader' : ''}>
                      <td><span className="pos-num">{i + 1}</span></td>
                      <td><span className="team-dot" style={{ background: t.color }} />{t.name}</td>
                      <td>{j}</td><td>{t.wins}</td><td>{t.losses}</td>
                      <td>{t.pf}</td><td>{t.pa}</td>
                      <td className={sd > 0 ? 'pos-sd' : sd < 0 ? 'neg-sd' : ''}>{sd > 0 ? '+' : ''}{sd}</td>
                      <td><strong className="pts">{t.wins * 2 + t.draws}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="rule-note">V=2pts · E=1pt · D=0 · SP=Pontos Feitos · SA=Pontos Sofridos · SD=Saldo</p>
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="📅 Próximos Jogos">
          <div className="game-grid">{upcoming.map(g => <GameCard key={g.id} game={g} />)}</div>
        </Section>
      )}

      {recent.length > 0 && (
        <Section title="✅ Resultados Recentes">
          <div className="game-grid">{recent.map(g => <GameCard key={g.id} game={g} />)}</div>
        </Section>
      )}
    </div>
  )
}

function HeroStat({ n, label }) {
  return (
    <div className="hero-stat">
      <span className="hero-stat-n">{n}</span>
      <span className="hero-stat-l">{label}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   REGISTER
───────────────────────────────────────────────────────────── */
function RegisterView({ addPlayer, deadline, drawn, settings }) {
  const [name, setName]     = useState('')
  const [pos, setPos]       = useState('Armador')
  const [loading, setLoading] = useState(false)
  const isPast = deadline && Date.now() >= new Date(deadline).getTime()
  const hasFee = settings?.entry_fee > 0
  const pixKey  = settings?.pix_key
  const pixName = settings?.pix_name
  const regOpen = settings?.registration_open !== false

  if (drawn || isPast || !regOpen) return (
    <div className="page"><div className="card center-card">
      <div className="card-icon">{drawn ? '🎲' : '⏰'}</div>
      <h2>{drawn ? 'Sorteio Realizado' : 'Inscrições Encerradas'}</h2>
      <p className="muted">{drawn ? 'Os times já foram formados. Consulte na aba Meu Time.' : 'O período de inscrições foi encerrado.'}</p>
    </div></div>
  )

  const handle = async () => {
    if (!name.trim()) return
    setLoading(true)
    await addPlayer(name, pos)
    setLoading(false)
  }

  return (
    <div className="page">
      <div className="card center-card">
        <div className="card-icon">📝</div>
        <h2>Inscrição</h2>
        <p className="muted" style={{ marginBottom: 20 }}>Preencha seus dados para participar do torneio.</p>

        <div className="field">
          <label className="field-label">Nome completo</label>
          <input className="field-input" placeholder="Seu nome" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handle()} />
        </div>

        <div className="field">
          <label className="field-label">Posição</label>
          <div className="pos-picker">
            {POSITIONS.map(p => (
              <button key={p} className={`pos-opt${pos === p ? ' active' : ''}`} onClick={() => setPos(p)}>{p}</button>
            ))}
          </div>
        </div>

        {/* Pix payment info */}
        {hasFee && (
          <div className="pix-box">
            <div className="pix-header">
              <span className="pix-icon">💸</span>
              <div>
                <div className="pix-title">Taxa de inscrição</div>
                <div className="pix-value">R$ {Number(settings.entry_fee).toFixed(2).replace('.',',')}</div>
              </div>
            </div>
            {pixKey && (
              <div className="pix-key-box">
                <div className="pix-key-label">Chave Pix {pixName ? `— ${pixName}` : ''}</div>
                <div className="pix-key-value" onClick={() => {
                  navigator.clipboard?.writeText(pixKey)
                }}>{pixKey} <span className="pix-copy">📋 copiar</span></div>
              </div>
            )}
            <p className="pix-note">⚠️ Envie o comprovante pelo WhatsApp ao organizador após se inscrever. Sua inscrição será confirmada após verificação do pagamento.</p>
          </div>
        )}

        <button className="submit-btn" onClick={handle} disabled={loading || !name.trim()}>
          {loading ? 'Salvando...' : hasFee ? `Inscrever-se · R$ ${Number(settings.entry_fee).toFixed(2).replace('.',',')}` : 'Confirmar Inscrição'}
        </button>
        {deadline && <p className="deadline-note">Prazo: {fmtDate(deadline)}</p>}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   LOOKUP
───────────────────────────────────────────────────────────── */
function LookupView({ players, teams, games, myName, setMyName, renameTeam }) {
  const [q, setQ]           = useState(myName || '')
  const [newTeamName, setNewTeamName] = useState('')
  const [renaming, setRenaming]       = useState(false)
  const [saving, setSaving]           = useState(false)

  const found   = q.trim().length > 1
    ? players.find(p => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : null
  const team    = found ? teams.find(t => Array.isArray(t.players) && t.players.includes(found.id)) : null
  const teammates = team
    ? players.filter(p => team.players.includes(p.id) && p.id !== found?.id)
    : []
  const myGames = team ? [...games].sort((a,b) => (a.seq??99)-(b.seq??99)).filter(g => g.team_a.id === team.id || g.team_b.id === team.id) : []
  const done    = myGames.filter(g => g.status === 'done')
  const next    = myGames.filter(g => g.status === 'pending' || g.status === 'live')

  // Só pode renomear se: sorteio feito, time ainda não foi nomeado, jogador é do time
  const canRename = team && !team.named && found

  const handleRename = async () => {
    if (!newTeamName.trim()) return
    setSaving(true)
    await renameTeam(team.id, newTeamName)
    setSaving(false)
    setRenaming(false)
    setNewTeamName('')
  }

  return (
    <div className="page">
      <Section title="🔍 Consultar Time">
        <div className="field">
          <label className="field-label">Seu nome</label>
          <input className="field-input" placeholder="Digite seu nome..." value={q}
            onChange={e => { setQ(e.target.value); setMyName(e.target.value); localStorage.setItem('b3x3:name', e.target.value) }} />
        </div>
      </Section>

      {found && !team && (
        <div className="card info-card">
          <p className="muted">✅ Inscrito como <strong>{found.name}</strong> · {found.position}</p>
          <p className="muted" style={{ marginTop: 6 }}>⏳ Aguardando sorteio dos times...</p>
        </div>
      )}

      {team && (
        <>
          {/* ── Card principal do time ── */}
          <div className="card team-hero-card" style={{ '--tc': team.color }}>
            <div className="team-jersey">
              <div className="jersey-shape" style={{ background: team.color }} />
              <span className="jersey-initial">{team.name[team.name.lastIndexOf(' ') + 1] || 'T'}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 className="team-name-big">{team.name}</h2>
                {canRename && !renaming && (
                  <button className="rename-trigger" onClick={() => { setRenaming(true); setNewTeamName('') }}>
                    ✏️ Dar nome
                  </button>
                )}
                {team.named && <span className="named-badge">✅ Nomeado</span>}
              </div>
              <p className="muted">{found.position} · <strong style={{color:'#e8edf5'}}>{found.name}</strong> <span style={{color:'var(--accent)'}}>← você</span></p>
              <div className="team-mini-stats">
                <span>V <strong>{team.wins}</strong></span>
                <span>D <strong>{team.losses}</strong></span>
                <span>SP <strong>{team.pf}</strong></span>
                <span>SA <strong>{team.pa}</strong></span>
                <span>SD <strong className={team.pf - team.pa >= 0 ? 'pos-sd' : 'neg-sd'}>{team.pf - team.pa > 0 ? '+' : ''}{team.pf - team.pa}</strong></span>
              </div>
            </div>
          </div>

          {/* ── Formulário de renomear ── */}
          {renaming && (
            <div className="card rename-card">
              <h3 className="card-title">✏️ Escolher nome do time</h3>
              <p className="muted" style={{ marginBottom: 12 }}>
                Só pode ser definido uma vez. Escolha bem — todos os seus colegas verão esse nome!
              </p>
              <div className="row-fields">
                <input className="field-input" placeholder="Nome do time..." maxLength={30}
                  value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRename()} autoFocus />
                <button className="action-btn" onClick={handleRename} disabled={saving || !newTeamName.trim()}>
                  {saving ? '...' : 'Confirmar'}
                </button>
                <button className="action-btn" style={{ background: 'var(--bg3)' }} onClick={() => setRenaming(false)}>
                  Cancelar
                </button>
              </div>
              <p className="muted sm" style={{ marginTop: 6 }}>{newTeamName.length}/30 caracteres</p>
            </div>
          )}

          {/* ── Elenco do time ── */}
          <Section title="👥 Seu Elenco">
            <div className="roster-card" style={{ '--tc': team.color }}>
              {/* jogador atual em destaque */}
              <div className="roster-row me">
                <span className="roster-pos" style={{ background: team.color + '33', color: team.color }}>{found.position}</span>
                <span className="roster-name">{found.name}</span>
                <span className="roster-you">você</span>
              </div>
              {/* colegas */}
              {teammates.map(p => (
                <div key={p.id} className="roster-row">
                  <span className="roster-pos">{p.position}</span>
                  <span className="roster-name">{p.name}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Próximos jogos ── */}
          {next.length > 0 && (
            <Section title="📅 Próximos Jogos">
              <div className="game-grid">{next.map(g => <GameCard key={g.id} game={g} highlight={team.id} />)}</div>
            </Section>
          )}

          {/* ── Resultados ── */}
          {done.length > 0 && (
            <Section title="📊 Resultados do Time">
              <div className="result-list">
                {done.map(g => {
                  const mine = g.team_a.id === team.id
                  const ms = mine ? g.score_a : g.score_b
                  const os = mine ? g.score_b : g.score_a
                  const mf = mine ? g.fouls_a : g.fouls_b
                  const of_ = mine ? g.fouls_b : g.fouls_a
                  const opp = mine ? g.team_b : g.team_a
                  const won = ms > os
                  return (
                    <div key={g.id} className={`result-row ${won ? 'won' : 'lost'}`}>
                      <div className="result-status">{won ? 'V' : 'D'}</div>
                      <div className="result-info">
                        <div className="result-vs">vs <span className="opp-dot" style={{ background: opp.color }} />{opp.name}</div>
                        {g.game_date && <div className="result-date">{fmtDate(g.game_date)}</div>}
                      </div>
                      <div className="result-score">{ms}<span className="score-sep">:</span>{os}</div>
                      <div className="result-detail">
                        <span>🟥 {mf} faltas</span>
                        <span className="muted">Adv: {of_}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}

      {q.trim().length > 1 && !found && (
        <div className="card info-card"><p className="muted">Nenhum jogador encontrado com esse nome.</p></div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LOGIN
───────────────────────────────────────────────────────────── */
function AdminLogin({ correctPass, onSuccess }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const try_ = () => { if (pw === correctPass) onSuccess(); else setErr(true) }
  return (
    <div className="page"><div className="card center-card">
      <div className="card-icon">🔐</div>
      <h2>Acesso Admin</h2>
      <div className="field">
        <label className="field-label">Senha</label>
        <input className={`field-input${err ? ' input-err' : ''}`} type="password" value={pw}
          onChange={e => { setPw(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && try_()} />
        {err && <span className="input-err-msg">Senha incorreta</span>}
      </div>
      <button className="submit-btn" onClick={try_}>Entrar</button>
    </div></div>
  )
}

/* ─────────────────────────────────────────────────────────────
   ADMIN VIEW
───────────────────────────────────────────────────────────── */
function AdminView({ players, teams, games, deadline, drawn, settings, execDraw, saveGame, saveSettings, saveDeadline, removePlayer, reorderGames, suggestOrder, togglePaid, resetTournament, setView, setActiveGame, notify }) {
  const [tab, setTab] = useState('dash')
  const TABS = [
    { k: 'dash', l: 'Dashboard' },
    { k: 'players', l: `Inscritos (${players.length})` },
    { k: 'bracket', l: 'Jogos' },
    { k: 'teams', l: 'Times' },
    { k: 'config', l: '⚙️ Config' },
  ]
  return (
    <div className="page">
      <h2 className="page-title">⚡ Painel Admin</h2>
      <div className="tabs">
        {TABS.map(({ k, l }) => (
          <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'dash'    && <AdminDash players={players} teams={teams} games={games} drawn={drawn} deadline={deadline} execDraw={execDraw} saveDeadline={saveDeadline} />}
      {tab === 'players' && <AdminPlayers players={players} teams={teams} removePlayer={removePlayer} togglePaid={togglePaid} drawn={drawn} notify={notify} settings={settings} />}
      {tab === 'bracket' && <AdminBracket games={games} setView={setView} setActiveGame={setActiveGame} reorderGames={reorderGames} suggestOrder={suggestOrder} notify={notify} />}
      {tab === 'teams'   && <AdminTeams teams={teams} players={players} games={games} eventName={settings.event_name} />}
      {tab === 'config'  && <AdminConfig settings={settings} saveSettings={saveSettings} resetTournament={resetTournament} notify={notify} />}
    </div>
  )
}

function AdminDash({ players, teams, games, drawn, deadline, execDraw, saveDeadline }) {
  const [dl, setDl] = useState(deadline ? deadline.slice(0, 16) : '')
  const done = games.filter(g => g.status === 'done').length
  const live = games.filter(g => g.status === 'live').length
  return (
    <div>
      <div className="dash-stats">
        {[['Inscritos', players.length, '#f97316'], ['Times', teams.length, '#2196F3'],
          ['Ao Vivo', live, '#22c55e'], ['Finalizados', done, '#9C27B0'],
          ['Total Jogos', games.length, '#64748b']].map(([l, n, c]) => (
          <div key={l} className="dash-stat-card" style={{ '--sc': c }}>
            <span className="dash-stat-val">{n}</span>
            <span className="dash-stat-label">{l}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="card-title">⏳ Prazo de Inscrições</h3>
        <div className="row-fields">
          <input className="field-input" type="datetime-local" value={dl} onChange={e => setDl(e.target.value)} />
          <button className="action-btn" onClick={() => saveDeadline(new Date(dl).toISOString())}>Salvar</button>
        </div>
        {deadline && <p className="muted sm" style={{ marginTop: 6 }}>Atual: {fmtDate(deadline)}</p>}
      </div>
      <div className="card">
        <h3 className="card-title">🎲 Sorteio dos Times</h3>
        {(drawn || teams.length > 0)
          ? <>
              <div className="drawn-summary">
                <span className="drawn-check">✅</span>
                <div>
                  <p style={{fontWeight:700,color:'#e8edf5',marginBottom:2}}>
                    Sorteio realizado — {teams.length} times de {PLAYERS_PER_TEAM} jogadores
                  </p>
                  <p className="muted sm">A formação está travada. Para ver os times acesse a aba <strong>Times</strong>.</p>
                </div>
              </div>
              <div className="drawn-teams-preview">
                {teams.map(t => {
                  const tp = players.filter(p => Array.isArray(t.players) && t.players.includes(p.id))
                  return (
                    <div key={t.id} className="drawn-team-pill" style={{'--tc': t.color}}>
                      <span className="drawn-dot" style={{background: t.color}}/>
                      <span className="drawn-tname">{t.name}</span>
                      <span className="drawn-tplayers">{tp.map(p => p.name.split(' ')[0]).join(', ')}</span>
                    </div>
                  )
                })}
              </div>
            </>
          : <>
              <div className="draw-preview">
                <div className="draw-preview-item">
                  <span className="draw-n">{players.length}</span>
                  <span className="draw-l">Inscritos</span>
                </div>
                <span className="draw-arrow">→</span>
                <div className="draw-preview-item">
                  <span className="draw-n">{Math.floor(players.length / PLAYERS_PER_TEAM)}</span>
                  <span className="draw-l">Times de {PLAYERS_PER_TEAM}</span>
                </div>
                {players.length % PLAYERS_PER_TEAM > 0 && (
                  <>
                    <span className="draw-arrow">+</span>
                    <div className="draw-preview-item warn">
                      <span className="draw-n">{players.length % PLAYERS_PER_TEAM}</span>
                      <span className="draw-l">Fora</span>
                    </div>
                  </>
                )}
              </div>
              <div className="pos-preview">
                {POSITIONS.map(pos => (
                  <span key={pos} className="pos-count">
                    {pos}: <strong>{players.filter(p => p.position === pos).length}</strong>
                  </span>
                ))}
              </div>
              <p className="muted sm" style={{marginBottom:10}}>
                O sorteio tenta equilibrar posições: 1 Armador + 1 Ala + 1 Pivô por time.
              </p>
              <button className="draw-btn" onClick={execDraw} disabled={players.length < MIN_PLAYERS}>
                🎲 Realizar Sorteio
              </button>
              {players.length < MIN_PLAYERS && (
                <p className="muted sm" style={{textAlign:'center',marginTop:6}}>Mínimo {MIN_PLAYERS} inscritos</p>
              )}
            </>
        }
      </div>
    </div>
  )
}

function AdminPlayers({ players, teams, removePlayer, togglePaid, drawn, notify, settings }) {
  const [confirmId, setConfirmId] = useState(null)
  const hasFee = settings?.entry_fee > 0
  const paidCount = players.filter(p => p.paid).length
  const totalFee = paidCount * (settings?.entry_fee || 0)

  const handleRemove = (id) => {
    if (drawn) { notify('Não é possível remover após o sorteio', 'err'); return }
    setConfirmId(id)
  }

  return (
    <div>
      {confirmId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p className="confirm-msg">⚠️ Remover <strong>{players.find(p => p.id === confirmId)?.name}</strong>?</p>
            <p className="muted" style={{ marginBottom: 16 }}>Essa ação não pode ser desfeita.</p>
            <div className="confirm-btns">
              <button className="action-btn" onClick={() => setConfirmId(null)}>Cancelar</button>
              <button className="action-btn danger" onClick={() => { removePlayer(confirmId); setConfirmId(null) }}>
                Confirmar Remoção
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment summary */}
      {hasFee && (
        <div className="payment-summary">
          <div className="pay-stat">
            <span className="pay-stat-n">{paidCount}/{players.length}</span>
            <span className="pay-stat-l">Pagamentos confirmados</span>
          </div>
          <div className="pay-stat">
            <span className="pay-stat-n" style={{color:'#22c55e'}}>R$ {totalFee.toFixed(2).replace('.',',')}</span>
            <span className="pay-stat-l">Total arrecadado</span>
          </div>
          <div className="pay-stat">
            <span className="pay-stat-n" style={{color:'#ef4444'}}>{players.length - paidCount}</span>
            <span className="pay-stat-l">Pendentes</span>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <th>#</th><th>Nome</th><th>Posição</th><th>Time</th>
            {hasFee && <th>Pagamento</th>}
            <th>Inscrito em</th><th></th>
          </tr></thead>
          <tbody>
            {players.map((p, i) => {
              const t = teams.find(t => Array.isArray(t.players) && t.players.includes(p.id))
              return (
                <tr key={p.id} className={hasFee && !p.paid ? 'row-unpaid' : ''}>
                  <td className="muted">{i + 1}</td>
                  <td><strong>{p.name}</strong></td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td>{t ? <><span className="team-dot" style={{ background: t.color }} />{t.name}</> : '—'}</td>
                  {hasFee && (
                    <td>
                      <button
                        className={`paid-btn${p.paid ? ' paid' : ' unpaid'}`}
                        onClick={() => togglePaid(p.id)}
                        title={p.paid ? 'Clique para remover pagamento' : 'Clique para confirmar pagamento'}
                      >
                        {p.paid ? '✅ Pago' : '⏳ Pendente'}
                      </button>
                    </td>
                  )}
                  <td className="muted sm">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                  <td>
                    {!drawn && (
                      <button className="remove-btn" onClick={() => handleRemove(p.id)} title="Remover jogador">
                        🗑️
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {drawn && <p className="muted sm" style={{ marginTop: 8, textAlign: 'center' }}>⚠️ Remoção bloqueada após o sorteio.</p>}
      </div>
    </div>
  )
}

function AdminBracket({ games, setView, setActiveGame, reorderGames, suggestOrder, notify }) {
  const [order, setOrder]       = useState(null)  // null = usa games original
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [changed, setChanged]   = useState(false)

  // Lista de trabalho: usa ordem local se existir
  const list = order
    ? order.map(id => games.find(g => g.id === id)).filter(Boolean)
    : [...games].sort((a, b) => {
        const o = { live: 0, pending: 1, done: 2 }
        return (o[a.status] ?? 3) - (o[b.status] ?? 3)
      })

  // Detecta times repetidos consecutivamente
  const consecutiveWarnings = new Set()
  for (let i = 1; i < list.length; i++) {
    const prev = list[i-1]
    const curr = list[i]
    if ([prev.team_a.id, prev.team_b.id].some(id =>
      [curr.team_a.id, curr.team_b.id].includes(id)
    )) consecutiveWarnings.add(i)
  }

  const handleDragStart = (id) => setDragging(id)
  const handleDragOver  = (e, id) => { e.preventDefault(); setDragOver(id) }
  const handleDrop      = (targetId) => {
    if (!dragging || dragging === targetId) { setDragging(null); setDragOver(null); return }
    const ids   = list.map(g => g.id)
    const from  = ids.indexOf(dragging)
    const to    = ids.indexOf(targetId)
    const next  = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, dragging)
    setOrder(next)
    setChanged(true)
    setDragging(null)
    setDragOver(null)
  }

  const handleSuggest = () => {
    const suggested = suggestOrder(list)
    setOrder(suggested.map(g => g.id))
    setChanged(true)
    notify('🔀 Ordem equilibrada sugerida! Revise e salve.')
  }

  const handleSave = async () => {
    await reorderGames(order || list.map(g => g.id))
    setChanged(false)
    setOrder(null)
  }

  const handleReset = () => { setOrder(null); setChanged(false) }

  const pendingCount = list.filter(g => g.status === 'pending').length

  return (
    <div>
      {/* Toolbar */}
      <div className="bracket-toolbar">
        <div className="bracket-info">
          <span className="muted">{list.length} jogos · {list.filter(g=>g.status==='done').length} finalizados</span>
          {consecutiveWarnings.size > 0 && (
            <span className="consec-warn">⚠️ {consecutiveWarnings.size} time(s) consecutivo(s)</span>
          )}
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {pendingCount > 1 && (
            <button className="action-btn" onClick={handleSuggest}>
              🔀 Sugerir ordem equilibrada
            </button>
          )}
          {changed && (
            <>
              <button className="action-btn" style={{background:'rgba(34,197,94,.15)',borderColor:'#22c55e40',color:'#22c55e'}} onClick={handleSave}>
                💾 Salvar ordem
              </button>
              <button className="action-btn" onClick={handleReset}>Cancelar</button>
            </>
          )}
        </div>
      </div>

      {/* Lista reordenável */}
      <div className="game-admin-list">
        {list.map((g, i) => (
          <div
            key={g.id}
            className={[
              'admin-game-row',
              dragging === g.id   ? 'dragging'  : '',
              dragOver === g.id   ? 'drag-over' : '',
              consecutiveWarnings.has(i) ? 'consec-row' : '',
            ].join(' ')}
            draggable={g.status === 'pending'}
            onDragStart={() => handleDragStart(g.id)}
            onDragOver={e  => handleDragOver(e, g.id)}
            onDrop={() => handleDrop(g.id)}
            onDragEnd={() => { setDragging(null); setDragOver(null) }}
          >
            {/* Número da sequência */}
            <div className="agr-seq">{i + 1}</div>

            {/* Handle de drag (só pendentes) */}
            {g.status === 'pending'
              ? <div className="drag-handle" title="Arrastar para reordenar">⠿</div>
              : <div style={{width:20}}/>
            }

            <div className="agr-status">
              <span className={`status-dot ${g.status === 'live' ? 'sdot-live' : g.status === 'done' ? 'sdot-done' : 'sdot-pending'}`} />
              <span className="status-label">{g.status === 'done' ? 'FIM' : g.status === 'live' ? 'AO VIVO' : 'Aguard.'}</span>
            </div>

            <div className="agr-teams" onClick={() => { setActiveGame(g.id); setView(V.GAME) }} style={{cursor:'pointer',flex:1}}>
              <div className="agr-team"><span className="team-dot" style={{ background: g.team_a.color }} />{g.team_a.name}</div>
              <div className="agr-score">
                {g.score_a !== null ? <>{g.score_a}<span className="score-sep">:</span>{g.score_b}</> : <span className="muted">–</span>}
              </div>
              <div className="agr-team right"><span className="team-dot" style={{ background: g.team_b.color }} />{g.team_b.name}</div>
            </div>

            <div className="agr-date">{g.game_date ? fmtDate(g.game_date) : 'Data a definir'}</div>
            <div className="agr-edit" onClick={() => { setActiveGame(g.id); setView(V.GAME) }}>✏️</div>
          </div>
        ))}
        {list.length === 0 && <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>Nenhum jogo criado ainda.</p>}
      </div>
    </div>
  )
}

function AdminTeams({ teams, players, games, eventName }) {
  const sorted = [...teams].sort((a, b) => (b.wins * 2 + b.draws) - (a.wins * 2 + a.draws))

  const copyToClipboard = () => {
    const lines = ['🏀 ' + (eventName || '3x3 Open') + ' — Formação dos Times', '']
    sorted.forEach((t, i) => {
      const tp = players.filter(p => Array.isArray(t.players) && t.players.includes(p.id))
      lines.push(`${i+1}. ${t.name}`)
      tp.forEach(p => lines.push(`   • ${p.name} (${p.position})`))
      lines.push('')
    })
    lines.push('Consulte seu time em: ' + window.location.origin)
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => alert('✅ Lista copiada! Cole no WhatsApp ou onde quiser.'))
      .catch(() => alert('Não foi possível copiar automaticamente.'))
  }

  return (
    <div>
      {teams.length > 0 && (
        <div style={{display:'flex', justifyContent:'flex-end', marginBottom: 12}}>
          <button className="action-btn" onClick={copyToClipboard}>
            📋 Copiar lista para WhatsApp
          </button>
        </div>
      )}
      <div className="team-cards-grid">
      {sorted.map(t => {
        const tPlayers = players.filter(p => Array.isArray(t.players) && t.players.includes(p.id))
        const tGames   = games.filter(g => (g.team_a.id === t.id || g.team_b.id === t.id) && g.status === 'done')
        const sd = t.pf - t.pa
        return (
          <div key={t.id} className="team-admin-card" style={{ '--tc': t.color }}>
            <div className="tac-header">
              <span className="tac-dot" style={{ background: t.color }} />
              <span className="tac-name">{t.name}</span>
              <span className="tac-pts">{t.wins * 2 + t.draws} pts</span>
            </div>
            <div className="tac-stats">
              <span>V {t.wins}</span><span>D {t.losses}</span>
              <span>SP {t.pf}</span><span>SA {t.pa}</span>
              <span className={sd >= 0 ? 'pos-sd' : 'neg-sd'}>SD {sd > 0 ? '+' : ''}{sd}</span>
            </div>
            <div className="tac-players">
              {tPlayers.map(p => (
                <div key={p.id} className="tac-player">
                  <span className="pos-badge sm">{p.position.slice(0, 3)}</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
            {tGames.length > 0 && (
              <div className="tac-record">
                {tGames.map(g => {
                  const mine = g.team_a.id === t.id
                  const ms = mine ? g.score_a : g.score_b
                  const os = mine ? g.score_b : g.score_a
                  const opp = mine ? g.team_b : g.team_a
                  return (
                    <div key={g.id} className={`mini-result ${ms > os ? 'won' : 'lost'}`}>
                      <span className="mini-opp"><span className="team-dot sm" style={{ background: opp.color }} />{opp.name}</span>
                      <span>{ms}:{os}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {teams.length === 0 && <p className="muted" style={{ padding: '20px 0' }}>Sorteio ainda não realizado.</p>}
    </div>
    </div>
  )
}

function AdminConfig({ settings, saveSettings, resetTournament, notify }) {
  const [s, setS]           = useState({ ...settings })
  const [showReset, setShowReset] = useState(false)

  // Sync if settings change externally
  useState(() => { setS({ ...settings }) }, [settings])

  const handleReset = async () => {
    await resetTournament()
    setShowReset(false)
  }

  return (
    <div>
      {showReset && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p className="confirm-msg">⚠️ Iniciar novo campeonato?</p>
            <p className="muted" style={{ marginBottom: 16 }}>
              Todos os jogadores, times e jogos serão apagados. Os resultados do campeonato atual serão arquivados.
            </p>
            <div className="confirm-btns">
              <button className="action-btn" onClick={() => setShowReset(false)}>Cancelar</button>
              <button className="action-btn danger" onClick={handleReset}>Confirmar Reset</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">🎪 Configurações do Evento</h3>
        {[
          { k: 'event_name', l: 'Nome do Evento', ph: 'ex: 3x3 Open Verão 2026', type: 'text' },
          { k: 'venue', l: 'Local / Quadra', ph: 'ex: Ginásio Central', type: 'text' },
          { k: 'admin_pass', l: 'Senha do Admin', ph: '••••••', type: 'password' },
        ].map(({ k, l, ph, type }) => (
          <div key={k} className="field">
            <label className="field-label">{l}</label>
            <input className="field-input" placeholder={ph} value={s[k] || ''} type={type}
              onChange={e => setS(prev => ({ ...prev, [k]: e.target.value }))} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="card-title">💸 Inscrição Paga</h3>
        <div className="field">
          <label className="field-label">Valor da inscrição (R$) — 0 para gratuita</label>
          <input className="field-input" type="number" min="0" step="1" placeholder="0"
            value={s.entry_fee || 0}
            onChange={e => setS(prev => ({ ...prev, entry_fee: Number(e.target.value) }))} />
        </div>
        <div className="field">
          <label className="field-label">Chave Pix</label>
          <input className="field-input" placeholder="CPF, e-mail, telefone ou chave aleatória"
            value={s.pix_key || ''} onChange={e => setS(prev => ({ ...prev, pix_key: e.target.value }))} />
        </div>
        <div className="field">
          <label className="field-label">Nome do recebedor (aparece na tela de inscrição)</label>
          <input className="field-input" placeholder="ex: João Silva"
            value={s.pix_name || ''} onChange={e => setS(prev => ({ ...prev, pix_name: e.target.value }))} />
        </div>
        <div className="field">
          <label className="field-label">Inscrições abertas</label>
          <div className="toggle-row">
            <button
              className={`toggle-btn${s.registration_open !== false ? ' on' : ''}`}
              onClick={() => setS(prev => ({ ...prev, registration_open: !(prev.registration_open !== false) }))}>
              {s.registration_open !== false ? '✅ Abertas' : '🔒 Fechadas'}
            </button>
            <span className="muted sm">Controla se novos jogadores podem se inscrever</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">📋 Regras FIBA 3×3</h3>
        <div className="fiba-grid">
          {[
            ['Vitória', 'Primeiro a 21 pts OU maior placar em 10 min'],
            ['Pontuação', 'Dentro do arco = 1pt · Além do arco = 2pts · LB = 1pt'],
            ['Overtime', 'Empate no tempo → primeiro ponto vence'],
            ['Timeout', '1 por time por partida'],
            ['Faltas', '6 faltas de equipe → lances livres'],
            ['Posse', 'Início: sorteio · Após cesta: adversário atrás do arco'],
          ].map(([k, v]) => (
            <div key={k} className="fiba-rule">
              <span className="fiba-key">{k}</span>
              <span className="fiba-val">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="submit-btn" onClick={() => saveSettings(s)}>
        💾 Salvar Configurações
      </button>

      <div className="card" style={{ marginTop: 16, borderColor: 'rgba(239,68,68,.3)' }}>
        <h3 className="card-title" style={{ color: '#ef4444' }}>🆕 Novo Campeonato</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Arquiva o campeonato atual e começa do zero. Jogadores, times e jogos serão apagados.
        </p>
        <button className="action-btn danger" style={{ width: '100%' }} onClick={() => setShowReset(true)}>
          Iniciar Novo Campeonato
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   GAME PANEL
───────────────────────────────────────────────────────────── */
function GamePanel({ game, saveGame, back, notify, allPlayers, allTeams }) {
  const [g, setG] = useState(game ? {
    ...game,
    score_a: game.score_a ?? 0,
    score_b: game.score_b ?? 0,
    player_fouls_a: game.player_fouls_a || [0,0,0],
    player_fouls_b: game.player_fouls_b || [0,0,0],
    wo: game.wo || null,
  } : null)
  const [timer, setTimer]   = useState(game?.elapsed_sec || 0)
  const [running, setRunning] = useState(false)
  const [showWO, setShowWO]   = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => {
        setTimer(t => { const n=t+1; setG(p=>({...p,elapsed_sec:n})); return n })
      }, 1000)
    } else clearInterval(ref.current)
    return () => clearInterval(ref.current)
  }, [running])

  if (!g) return <div className="page"><button className="back-btn" onClick={back}>← Voltar</button></div>

  // Get players for each team
  const teamAPlayers = allTeams?.find(t => t.id === g.team_a.id)
  const teamBPlayers = allTeams?.find(t => t.id === g.team_b.id)
  const playersA = allPlayers?.filter(p => Array.isArray(teamAPlayers?.players) && teamAPlayers.players.includes(p.id)) || []
  const playersB = allPlayers?.filter(p => Array.isArray(teamBPlayers?.players) && teamBPlayers.players.includes(p.id)) || []

  const pv = (k, v) => setG(prev => ({ ...prev, [k]: v }))
  const inc = (k, by=1) => setG(prev => ({ ...prev, [k]: (prev[k]??0)+by }))
  const dec = (k) => setG(prev => ({ ...prev, [k]: Math.max(0,(prev[k]??0)-1) }))

  const incPlayerFoul = (side, idx) => setG(prev => {
    const arr = [...(prev[`player_fouls_${side}`] || [0,0,0])]
    arr[idx] = (arr[idx]||0)+1
    const teamFouls = arr.reduce((a,b)=>a+b,0)
    return { ...prev, [`player_fouls_${side}`]: arr, [`fouls_${side}`]: teamFouls }
  })
  const decPlayerFoul = (side, idx) => setG(prev => {
    const arr = [...(prev[`player_fouls_${side}`] || [0,0,0])]
    arr[idx] = Math.max(0,(arr[idx]||0)-1)
    const teamFouls = arr.reduce((a,b)=>a+b,0)
    return { ...prev, [`player_fouls_${side}`]: arr, [`fouls_${side}`]: teamFouls }
  })

  const handleSave   = async () => { await saveGame(g); notify('💾 Salvo!') }
  const handleFinish = async () => {
    setRunning(false)
    const f = { ...g, status: 'done' }
    setG(f); await saveGame(f); notify('✅ Jogo finalizado!'); back()
  }
  const handleLive = async () => {
    const l = { ...g, status: 'live' }
    setG(l); await saveGame(l); setRunning(true); notify('▶ Jogo iniciado!')
  }
  const handleWO = async (loserSide) => {
    setRunning(false)
    const wo = { ...g, status: 'done', wo: loserSide,
      score_a: loserSide === 'a' ? 0 : 10,
      score_b: loserSide === 'b' ? 0 : 10,
    }
    setG(wo); await saveGame(wo)
    notify(`🚫 W.O. — ${loserSide === 'a' ? g.team_a.name : g.team_b.name} não compareceu`)
    setShowWO(false); back()
  }

  const mm = String(Math.floor(timer/60)).padStart(2,'0')
  const ss = String(timer%60).padStart(2,'0')
  const overTime = timer >= FIBA.winTime

  return (
    <div className="page">
      <button className="back-btn" onClick={back}>← Voltar</button>

      {/* W.O. Modal */}
      {showWO && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <h3 style={{marginBottom:8,color:'#e2e8f0'}}>🚫 Declarar W.O.</h3>
            <p className="muted" style={{marginBottom:16}}>Qual time não compareceu?</p>
            <div className="confirm-btns" style={{flexDirection:'column',gap:8}}>
              <button className="action-btn danger" onClick={() => handleWO('a')}>{g.team_a.name} não compareceu</button>
              <button className="action-btn danger" onClick={() => handleWO('b')}>{g.team_b.name} não compareceu</button>
              <button className="action-btn" onClick={() => setShowWO(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div className="game-panel">
        {/* Header */}
        <div className="gp-header">
          <div className="gp-status-row">
            <span className={`gp-status ${g.status==='live'?'st-live':g.status==='done'?'st-done':'st-pending'}`}>
              {g.wo ? '🚫 W.O.' : g.status==='done' ? 'FINALIZADO' : g.status==='live' ? '🔴 AO VIVO' : 'AGUARDANDO'}
            </span>
            <div className="gp-timer" style={{color:overTime?'#f97316':'#e2e8f0'}}>
              {mm}:{ss}{overTime&&<span className="ot-badge">OT</span>}
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {g.status!=='done'&&(
                !running
                  ? <button className="ctrl-btn green" onClick={g.status==='live'?()=>setRunning(true):handleLive}>
                      {g.status==='live'?'▶':'▶ Iniciar'}
                    </button>
                  : <button className="ctrl-btn yellow" onClick={()=>setRunning(false)}>⏸</button>
              )}
              {g.status!=='done'&&(
                <button className="ctrl-btn" style={{background:'#7c3aed'}} onClick={()=>setShowWO(true)}>🚫 W.O.</button>
              )}
            </div>
          </div>
        </div>

        {/* Scoreboard */}
        <div className="gp-scoreboard">
          <ScoreBlock
            label={g.team_a.name} color={g.team_a.color}
            score={g.score_a} fouls={g.fouls_a} timeouts={g.timeouts_a}
            on1={()=>inc('score_a',1)} on2={()=>inc('score_a',2)} onFT={()=>inc('score_a',1)}
            onFoul={()=>inc('fouls_a')} onFoulDec={()=>dec('fouls_a')}
            onTimeout={()=>pv('timeouts_a',Math.max(0,g.timeouts_a-1))}
            onMinus={()=>dec('score_a')} />
          <div className="gp-center">
            <div className="gp-big-score">{g.score_a??0}</div>
            <div className="gp-colon">:</div>
            <div className="gp-big-score">{g.score_b??0}</div>
          </div>
          <ScoreBlock
            label={g.team_b.name} color={g.team_b.color}
            score={g.score_b} fouls={g.fouls_b} timeouts={g.timeouts_b}
            on1={()=>inc('score_b',1)} on2={()=>inc('score_b',2)} onFT={()=>inc('score_b',1)}
            onFoul={()=>inc('fouls_b')} onFoulDec={()=>dec('fouls_b')}
            onTimeout={()=>pv('timeouts_b',Math.max(0,g.timeouts_b-1))}
            onMinus={()=>dec('score_b')} />
        </div>

        {(g.fouls_a>=FIBA.foulsLimit||g.fouls_b>=FIBA.foulsLimit)&&(
          <div className="foul-warning">
            ⚠️ {g.fouls_a>=FIBA.foulsLimit?g.team_a.name:''}{g.fouls_a>=FIBA.foulsLimit&&g.fouls_b>=FIBA.foulsLimit?' e ':''}{g.fouls_b>=FIBA.foulsLimit?g.team_b.name:''} — limite de faltas (lances livres)
          </div>
        )}

        {/* Faltas por jogador */}
        {(playersA.length>0||playersB.length>0)&&(
          <div className="player-fouls-section">
            <div className="pf-label">🟥 Faltas por Jogador</div>
            <div className="pf-grid">
              <div className="pf-team">
                {playersA.map((p,i)=>(
                  <div key={p.id} className={`pf-row${(g.player_fouls_a[i]||0)>=2?' pf-warn':''}`}>
                    <span className="pf-name">{p.name.split(' ')[0]}</span>
                    <span className="pf-pos">{p.position.slice(0,3)}</span>
                    <div className="pf-counter">
                      <button className="counter-btn" onClick={()=>decPlayerFoul('a',i)}>-</button>
                      <span className="pf-count">{g.player_fouls_a[i]||0}</span>
                      <button className="counter-btn" onClick={()=>incPlayerFoul('a',i)}>+</button>
                    </div>
                    {(g.player_fouls_a[i]||0)>=2&&<span className="pf-badge">⚠️ 2F</span>}
                  </div>
                ))}
              </div>
              <div className="pf-divider"/>
              <div className="pf-team">
                {playersB.map((p,i)=>(
                  <div key={p.id} className={`pf-row${(g.player_fouls_b[i]||0)>=2?' pf-warn':''}`}>
                    <span className="pf-name">{p.name.split(' ')[0]}</span>
                    <span className="pf-pos">{p.position.slice(0,3)}</span>
                    <div className="pf-counter">
                      <button className="counter-btn" onClick={()=>decPlayerFoul('b',i)}>-</button>
                      <span className="pf-count">{g.player_fouls_b[i]||0}</span>
                      <button className="counter-btn" onClick={()=>incPlayerFoul('b',i)}>+</button>
                    </div>
                    {(g.player_fouls_b[i]||0)>=2&&<span className="pf-badge">⚠️ 2F</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="gp-meta">
          <div className="field">
            <label className="field-label">Data e Hora</label>
            <input className="field-input" type="datetime-local"
              value={g.game_date?.slice(0,16)||''}
              onChange={e=>pv('game_date',new Date(e.target.value).toISOString())}/>
          </div>
          <div className="field">
            <label className="field-label">Observações / Fatos do Jogo</label>
            <textarea className="field-input" rows={3} placeholder="Destaque, incidentes, MVPs..."
              value={g.notes||''} onChange={e=>pv('notes',e.target.value)}/>
          </div>
        </div>

        <div className="gp-actions">
          <button className="action-btn" onClick={handleSave}>💾 Salvar</button>
          {g.status!=='done'&&(
            <button className="action-btn danger" onClick={handleFinish}>✅ Finalizar Jogo</button>
          )}
        </div>
      </div>
    </div>
  )
}

function ScoreBlock({ label, color, fouls, timeouts, on1, on2, onFT, onFoul, onFoulDec, onTimeout, onMinus }) {
  return (
    <div className="score-block">
      <div className="sb-team-name"><span className="team-dot" style={{ background: color }} />{label}</div>
      <div className="sb-btns">
        <button className="sb-btn two"   onClick={on2}    title="Além do arco (+2)">+2</button>
        <button className="sb-btn one"   onClick={on1}    title="Dentro do arco (+1)">+1</button>
        <button className="sb-btn ft"    onClick={onFT}   title="Lance Livre (+1)">LB</button>
        <button className="sb-btn minus" onClick={onMinus} title="Corrigir (-1)">-1</button>
      </div>
      <div className="sb-meta">
        <div>
          <span className="meta-label">Faltas</span>
          <div className="meta-counter">
            <button className="counter-btn" onClick={onFoulDec}>-</button>
            <span className={fouls >= FIBA.foulsLimit ? 'foul-limit' : ''}>{fouls}</span>
            <button className="counter-btn" onClick={onFoul}>+</button>
          </div>
        </div>
        <div>
          <span className="meta-label">Timeout</span>
          <div className="meta-counter">
            <button className="counter-btn" onClick={onTimeout} disabled={timeouts <= 0}>usar</button>
            <span>{timeouts}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   SHARED
───────────────────────────────────────────────────────────── */
function GameCard({ game, highlight }) {
  const isLive = game.status === 'live'
  const isDone = game.status === 'done'
  return (
    <div className={`game-card${isLive ? ' live-card' : ''}`}>
      {isLive && <div className="live-indicator">🔴 AO VIVO</div>}
      <div className="gc-teams">
        <div className={`gc-team${highlight === game.team_a.id ? ' my-team' : ''}`}>
          <span className="team-dot" style={{ background: game.team_a.color }} />
          <span className="gc-name">{game.team_a.name}</span>
          {isDone && <span className="gc-score">{game.score_a}</span>}
        </div>
        <span className="gc-vs">×</span>
        <div className={`gc-team right${highlight === game.team_b.id ? ' my-team' : ''}`}>
          {isDone && <span className="gc-score">{game.score_b}</span>}
          <span className="gc-name">{game.team_b.name}</span>
          <span className="team-dot" style={{ background: game.team_b.color }} />
        </div>
      </div>
      <div className="gc-date">{game.game_date ? fmtDate(game.game_date) : 'Data a definir'}</div>
      {game.notes && <div className="gc-notes">💬 {game.notes}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return <div className="section"><h3 className="section-title">{title}</h3>{children}</div>
}
function Toast({ toast }) {
  return <div className={`toast ${toast.type === 'err' ? 'toast-err' : 'toast-ok'}`}>{toast.msg}</div>
}
function Splash() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#060d1a' }}>
      <span style={{ fontSize: 64, animation: 'spin 1s linear infinite' }}>🏀</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   CSS
───────────────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=DM+Sans:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#060d1a;--bg2:#0d1a2e;--bg3:#1a2744;
  --border:#1e3058;--text:#e8edf5;--muted:#5a7aa0;
  --accent:#f97316;--accent2:#fb923c;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;}
.app{min-height:100vh;}
.main{max-width:960px;margin:0 auto;padding:0 16px 60px;}
.page{padding-top:20px;display:flex;flex-direction:column;gap:0;}
.nav{position:sticky;top:0;z-index:100;background:rgba(6,13,26,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:52px;}
.nav-brand{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:20px;}
.nav-title{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:900;letter-spacing:.3px;color:#fff;}
.nav-links{display:flex;gap:2px;}
.nav-btn{background:none;border:none;color:var(--muted);padding:6px 13px;border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;transition:all .15s;}
.nav-btn:hover{color:var(--text);background:var(--bg3);}
.nav-btn.active{color:var(--accent);background:rgba(249,115,22,.1);}
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
.deadline-badge.past{border-color:#ef4444;color:#ef4444;}
.cta-btn{background:var(--accent);color:#fff;border:none;padding:12px 36px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;cursor:pointer;transition:all .2s;}
.cta-btn:hover{background:var(--accent2);transform:translateY(-1px);}
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
.game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:10px;}
.game-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 15px;transition:border-color .2s;}
.game-card:hover{border-color:rgba(249,115,22,.4);}
.live-card{border-color:#ef444460;animation:pulse-border 2s ease-in-out infinite;}
@keyframes pulse-border{0%,100%{border-color:#ef444460}50%{border-color:#ef4444}}
.live-indicator{color:#ef4444;font-size:11px;font-weight:700;margin-bottom:7px;}
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
.section{margin-top:28px;}
.section-title,.page-title{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:700;color:var(--text);margin-bottom:12px;}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:14px;}
.card-title{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;margin-bottom:14px;color:var(--text);}
.center-card{max-width:420px;margin:36px auto 0;text-align:center;}
.center-card .field{text-align:left;}
.card-icon{font-size:38px;margin-bottom:10px;}
.center-card h2{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;margin-bottom:6px;}
.info-card{text-align:center;}
.field{margin-bottom:13px;}
.field-label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:5px;}
.field-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border .15s;}
.field-input:focus{border-color:var(--accent);}
.field-input.input-err{border-color:#ef4444;}
.input-err-msg{font-size:11px;color:#ef4444;margin-top:3px;display:block;}
textarea.field-input{resize:vertical;}
.pos-picker{display:flex;gap:8px;}
.pos-opt{flex:1;background:var(--bg);border:1px solid var(--border);color:var(--muted);padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
.pos-opt.active{background:rgba(249,115,22,.14);border-color:var(--accent);color:var(--accent);}
.pos-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(249,115,22,.1);color:var(--accent);}
.pos-badge.sm{padding:1px 5px;font-size:10px;}
.submit-btn{width:100%;background:var(--accent);color:#fff;border:none;padding:13px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;cursor:pointer;transition:all .15s;margin-top:4px;}
.submit-btn:hover:not(:disabled){background:var(--accent2);}
.submit-btn:disabled{opacity:.5;cursor:not-allowed;}
.deadline-note{font-size:11px;color:var(--muted);margin-top:8px;}
.team-hero-card{display:flex;align-items:center;gap:18px;border-left:4px solid var(--tc,var(--accent));}
.team-jersey{position:relative;width:56px;height:56px;flex-shrink:0;}
.jersey-shape{width:56px;height:56px;border-radius:50%;}
.jersey-initial{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:#fff;text-shadow:0 1px 4px #0006;}
.team-name-big{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;color:#fff;}
.team-mini-stats{display:flex;gap:12px;margin-top:5px;font-size:12px;color:var(--muted);}
.team-mini-stats strong{color:var(--text);}
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
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:18px;}
.tab-btn{background:var(--bg2);border:1px solid var(--border);color:var(--muted);padding:7px 15px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
.tab-btn:hover{color:var(--text);}
.tab-btn.active{background:rgba(249,115,22,.14);border-color:var(--accent);color:var(--accent);}
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
.data-table{width:100%;border-collapse:collapse;font-size:13px;min-width:460px;}
.data-table thead tr{background:var(--bg3);}
.data-table th{padding:9px 11px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700;}
.data-table td{padding:9px 11px;border-bottom:1px solid var(--border);}
.data-table tr:hover td{background:var(--bg3);}
.game-admin-list{display:flex;flex-direction:column;gap:6px;}
.admin-game-row{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;cursor:pointer;transition:all .15s;display:grid;grid-template-columns:100px 1fr 120px 30px;align-items:center;gap:10px;}
.admin-game-row:hover{border-color:var(--accent);background:var(--bg3);}
.agr-status{display:flex;align-items:center;gap:6px;}
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.sdot-live{background:#22c55e;box-shadow:0 0 6px #22c55e;}.sdot-done{background:var(--accent);}.sdot-pending{background:var(--muted);}
.status-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);}
.agr-teams{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.agr-team{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:600;}
.agr-team.right{flex-direction:row-reverse;}
.agr-score{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:900;color:var(--accent);text-align:center;min-width:50px;}
.agr-date{font-size:11px;color:var(--muted);}
.agr-edit{color:var(--muted);text-align:right;}
.bracket-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;padding:12px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;}
.bracket-info{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.consec-warn{font-size:12px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);padding:3px 10px;border-radius:20px;}
.agr-seq{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;color:var(--muted);min-width:24px;text-align:center;}
.drag-handle{font-size:18px;color:var(--muted);cursor:grab;padding:0 4px;user-select:none;flex-shrink:0;}
.drag-handle:active{cursor:grabbing;}
.admin-game-row{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;transition:all .15s;display:grid;grid-template-columns:28px 20px 100px 1fr 120px 30px;align-items:center;gap:8px;}
.admin-game-row.dragging{opacity:.4;border-style:dashed;}
.admin-game-row.drag-over{border-color:var(--accent);background:rgba(249,115,22,.08);transform:scale(1.01);}
.admin-game-row.consec-row{border-left:3px solid #f59e0b;}
.admin-game-row:hover{border-color:rgba(249,115,22,.4);background:var(--bg3);}
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
.fiba-box{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:15px;margin-top:14px;}
.fiba-title{font-family:'Barlow Condensed',sans-serif;font-size:13px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px;color:var(--muted);}
.fiba-grid{display:flex;flex-direction:column;gap:6px;}
.fiba-rule{display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:12px;align-items:start;}
.fiba-key{font-weight:700;color:var(--accent);}
.fiba-val{color:var(--muted);line-height:1.4;}
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
.foul-limit{color:#ef4444;}
.foul-warning{background:rgba(239,68,68,.09);border:1px solid rgba(239,68,68,.28);color:#f87171;border-radius:8px;padding:9px 13px;font-size:13px;font-weight:600;text-align:center;margin:8px 0;}
.gp-meta{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:14px;}
.gp-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end;}
.back-btn{background:var(--bg2);border:1px solid var(--border);color:var(--muted);padding:8px 15px;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:14px;}
.player-fouls-section{background:var(--bg3);border-radius:12px;padding:14px;margin:10px 0;}
.pf-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:10px;}
.pf-grid{display:grid;grid-template-columns:1fr 1px 1fr;gap:12px;align-items:start;}
.pf-divider{background:var(--border);width:1px;align-self:stretch;}
.pf-team{display:flex;flex-direction:column;gap:6px;}
.pf-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;background:var(--bg2);transition:background .15s;}
.pf-row.pf-warn{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);}
.pf-name{font-size:13px;font-weight:600;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pf-pos{font-size:10px;color:var(--muted);background:var(--bg3);padding:1px 5px;border-radius:3px;flex-shrink:0;}
.pf-counter{display:flex;align-items:center;gap:4px;flex-shrink:0;}
.pf-count{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;color:var(--text);min-width:18px;text-align:center;}
.pf-row.pf-warn .pf-count{color:var(--red);}
.pf-badge{font-size:11px;font-weight:700;color:var(--red);flex-shrink:0;}
.wo-badge{background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.4);color:#a78bfa;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;}
.draw-preview{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;}
.draw-preview-item{background:var(--bg3);border-radius:8px;padding:10px 16px;text-align:center;min-width:80px;}
.draw-preview-item.warn{background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.3);}
.draw-n{display:block;font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:900;color:var(--accent);}
.draw-l{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;}
.draw-arrow{color:var(--muted);font-size:18px;font-weight:700;}
.pos-preview{display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;}
.pos-count{font-size:12px;color:var(--muted);background:var(--bg3);padding:4px 10px;border-radius:20px;}
.pos-count strong{color:var(--text);}
.remove-btn{background:none;border:none;cursor:pointer;font-size:15px;padding:4px 6px;border-radius:4px;transition:background .15s;opacity:.5;}
.remove-btn:hover{background:rgba(239,68,68,.15);opacity:1;}
.rename-trigger{background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.35);color:var(--accent);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;}
.rename-trigger:hover{background:var(--accent);color:#fff;}
.named-badge{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#22c55e;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
.rename-card{border-left:3px solid var(--accent);}
.roster-card{background:var(--bg3);border-radius:12px;overflow:hidden;}
.roster-row{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border);}
.roster-row:last-child{border-bottom:none;}
.roster-row.me{background:rgba(249,115,22,.07);}
.roster-pos{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(255,255,255,.07);color:var(--muted);flex-shrink:0;}
.roster-name{font-size:14px;font-weight:600;color:var(--text);flex:1;}
.roster-you{font-size:11px;font-weight:700;color:var(--accent);background:rgba(249,115,22,.12);padding:2px 8px;border-radius:20px;flex-shrink:0;}
.pix-box{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.25);border-radius:12px;padding:14px;margin:14px 0;}
.pix-header{display:flex;align-items:center;gap:12px;margin-bottom:10px;}
.pix-icon{font-size:28px;}
.pix-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);}
.pix-value{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;color:#22c55e;}
.pix-key-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;}
.pix-key-label{font-size:11px;color:var(--muted);margin-bottom:3px;}
.pix-key-value{font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px;word-break:break-all;}
.pix-copy{font-size:11px;color:var(--accent);flex-shrink:0;}
.pix-note{font-size:11px;color:var(--muted);line-height:1.5;}
.payment-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}
.pay-stat{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;}
.pay-stat-n{display:block;font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:900;color:var(--accent);}
.pay-stat-l{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-top:2px;}
.paid-btn{border:none;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;}
.paid-btn.paid{background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);}
.paid-btn.unpaid{background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25);}
.paid-btn:hover{opacity:.8;}
.row-unpaid td{opacity:.7;}
.toggle-row{display:flex;align-items:center;gap:12px;}
.toggle-btn{background:var(--bg3);border:1px solid var(--border);color:var(--muted);padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;transition:all .15s;}
.toggle-btn.on{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.4);color:#22c55e;}
.drawn-summary{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;}
.drawn-check{font-size:22px;flex-shrink:0;margin-top:2px;}
.drawn-teams-preview{display:flex;flex-direction:column;gap:6px;}
.drawn-team-pill{background:var(--bg3);border-left:3px solid var(--tc,#f97316);border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.drawn-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.drawn-tname{font-weight:700;font-size:13px;color:var(--text);min-width:110px;}
.drawn-tplayers{font-size:12px;color:var(--muted);}
.confirm-overlay{position:fixed;inset:0;background:#0009;z-index:200;display:flex;align-items:center;justify-content:center;}
.confirm-box{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:380px;width:90%;box-shadow:0 20px 60px #000a;}
.confirm-msg{font-size:16px;margin-bottom:6px;color:var(--text);}
.confirm-btns{display:flex;gap:10px;justify-content:flex-end;}
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
`
