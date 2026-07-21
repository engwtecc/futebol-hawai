-- Schema do Futebol Hawai
-- Este arquivo é apenas para referência/inspeção manual.
-- A criação real das tabelas acontece automaticamente em migrate.js ao iniciar o servidor.

CREATE TABLE IF NOT EXISTS jogadores (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  jogos INTEGER NOT NULL DEFAULT 0,
  vitorias INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partidas (
  id SERIAL PRIMARY KEY,
  vencedor CHAR(1), -- 'A', 'B', 'E' (empate) ou NULL (em andamento)
  criada_em TIMESTAMP NOT NULL DEFAULT NOW(),
  finalizada_em TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partida_jogadores (
  id SERIAL PRIMARY KEY,
  partida_id INTEGER NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  jogador_id INTEGER NOT NULL REFERENCES jogadores(id),
  time CHAR(1) NOT NULL CHECK (time IN ('A', 'B'))
);

CREATE INDEX IF NOT EXISTS idx_pj_partida ON partida_jogadores(partida_id);
CREATE INDEX IF NOT EXISTS idx_pj_jogador ON partida_jogadores(jogador_id);
