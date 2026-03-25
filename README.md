# 🏀 Basquete 3x3 — Guia de Deploy

## Stack
- **Frontend**: React + Vite
- **Banco de dados**: Supabase (PostgreSQL grátis)
- **Hospedagem**: Vercel (grátis)

---

## PASSO 1 — Criar banco no Supabase

1. Acesse https://supabase.com e crie uma conta gratuita
2. Clique em **"New Project"**
   - Nome: `basquete3x3`
   - Região: **South America (São Paulo)**
   - Crie uma senha forte e salve
3. Aguarde ~2 minutos o projeto inicializar
4. No menu lateral, vá em **SQL Editor**
5. Cole o conteúdo do arquivo `schema.sql` e clique em **RUN**
6. Vá em **Project Settings → API** e copie:
   - **Project URL** → ex: `https://xyzabc.supabase.co`
   - **anon public key** → chave longa começando com `eyJ...`

---

## PASSO 2 — Configurar as credenciais

Abra o arquivo `src/supabase.js` e substitua:

```js
const SUPABASE_URL  = 'https://SEU_PROJECT_ID.supabase.co'  // ← cole aqui
const SUPABASE_ANON = 'SUA_ANON_PUBLIC_KEY_AQUI'            // ← cole aqui
```

---

## PASSO 3 — Testar localmente

```bash
# Na pasta do projeto:
npm install
npm run dev
```

Acesse http://localhost:5173 — tudo deve funcionar!

---

## PASSO 4 — Subir no GitHub

```bash
git init
git add .
git commit -m "basquete 3x3 torneio"
git branch -M main

# Crie um repositório no github.com e copie a URL, então:
git remote add origin https://github.com/SEU_USUARIO/basquete3x3.git
git push -u origin main
```

---

## PASSO 5 — Deploy na Vercel

1. Acesse https://vercel.com e faça login com GitHub
2. Clique em **"Add New Project"**
3. Selecione o repositório `basquete3x3`
4. Framework Preset: **Vite**
5. Clique em **Deploy**
6. Em ~1 minuto você terá uma URL tipo: `basquete3x3.vercel.app`

> ✅ A cada `git push` a Vercel faz deploy automático.

---

## Estrutura do projeto

```
basquete3x3/
├── src/
│   ├── main.jsx        # entrada React
│   ├── App.jsx         # toda a aplicação
│   └── supabase.js     # ← COLOQUE SUAS CREDENCIAIS AQUI
├── schema.sql          # rode no Supabase SQL Editor
├── index.html
├── vite.config.js
└── package.json
```

---

## Senha padrão do admin

`admin123` — você pode alterar no painel Admin → Config.

---

## Funcionalidades

| Área | O que faz |
|---|---|
| Inscrição | Nome + posição, salvo no banco |
| Meu Time | Consulta por nome após sorteio |
| Início | Classificação, próximos jogos, resultados |
| Admin/Dashboard | Estatísticas, prazo, botão de sorteio |
| Admin/Inscritos | Lista completa de jogadores |
| Admin/Jogos | Todos os confrontos, clique para lançar placar |
| Admin/Times | Cards com jogadores e histórico |
| Admin/Config | Nome do evento, local, senha |
| Painel de jogo | Placar ao vivo, cronômetro, faltas, timeout, notas |
| Realtime | Placar atualiza automaticamente para todos via Supabase |
