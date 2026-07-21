require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const migrate = require("./migrate");

const app = express();
app.use(express.json());

const LIMITE_JOGADORES = 50;
const TAMANHO_TIME = 6;
const MINIMO_ATIVOS = TAMANHO_TIME * 2; // 12

// ---------- CORS ----------
// FRONTEND_URL pode conter múltiplas origens separadas por vírgula, ex:
// FRONTEND_URL=https://futebol-hawai.vercel.app,http://localhost:5500
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5500,http://localhost:3000,http://127.0.0.1:5500")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // requisições sem origin (curl, health checks, apps mobile) são permitidas
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origem não permitida por CORS: ${origin}`));
    },
  })
);

// ---------- Helpers ----------
async function getAtivos() {
  const { rows } = await pool.query(
    `SELECT id, nome, ativo, jogos, vitorias FROM jogadores WHERE ativo = true ORDER BY id ASC`
  );
  return rows;
}

async function getIdsUltimaPartida() {
  const { rows: partidaRows } = await pool.query(
    `SELECT id FROM partidas ORDER BY id DESC LIMIT 1`
  );
  if (partidaRows.length === 0) return null;
  const partidaId = partidaRows[0].id;
  const { rows } = await pool.query(
    `SELECT jogador_id FROM partida_jogadores WHERE partida_id = $1`,
    [partidaId]
  );
  return rows.map((r) => r.jogador_id);
}

function ordenarPorFilaDeChegada(arr) {
  // Critério de prioridade: menos jogos disputados primeiro; empate → ordem de chegada (id)
  return [...arr].sort((a, b) => a.jogos - b.jogos || a.id - b.id);
}

// ---------- Rotas ----------

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error" });
  }
});

// Adicionar jogador
app.post("/jogadores", async (req, res) => {
  const nome = (req.body?.nome || "").trim();
  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (nome.length > 100) return res.status(400).json({ error: "Nome muito longo" });

  try {
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM jogadores`);
    if (countRows[0].total >= LIMITE_JOGADORES) {
      return res.status(400).json({ error: `Limite de ${LIMITE_JOGADORES} jogadores atingido` });
    }

    const { rows } = await pool.query(
      `INSERT INTO jogadores (nome) VALUES ($1) RETURNING id, nome, ativo, jogos, vitorias`,
      [nome]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao adicionar jogador" });
  }
});

// Listar jogadores (ordem de chegada = ordem de cadastro)
app.get("/jogadores", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, ativo, jogos, vitorias FROM jogadores ORDER BY id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar jogadores" });
  }
});

// Ativar/desativar jogador
app.post("/jogadores/:id/ativo", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ativo = !!req.body?.ativo;
  if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  try {
    const { rows } = await pool.query(
      `UPDATE jogadores SET ativo = $1 WHERE id = $2 RETURNING id, nome, ativo, jogos, vitorias`,
      [ativo, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Jogador não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar jogador" });
  }
});

// Iniciar nova partida
// Lógica preservada do protótipo original:
// 1) Quem ficou de fora da última partida entra primeiro na fila.
// 2) Dentro de cada grupo (fora / dentro), ordena por menos jogos disputados e depois por ordem de chegada.
// 3) Os 6 primeiros formam o Time A, os 6 seguintes o Time B.
app.post("/partida", async (req, res) => {
  try {
    // impede iniciar uma nova partida se a última ainda não tem resultado
    const { rows: pendentes } = await pool.query(
      `SELECT id FROM partidas WHERE vencedor IS NULL ORDER BY id DESC LIMIT 1`
    );
    if (pendentes.length > 0) {
      const { rows: emAndamento } = await pool.query(
        `SELECT pj.time, j.id, j.nome
         FROM partida_jogadores pj
         JOIN jogadores j ON j.id = pj.jogador_id
         WHERE pj.partida_id = $1
         ORDER BY pj.id ASC`,
        [pendentes[0].id]
      );
      const timeA = emAndamento.filter((r) => r.time === "A").map((r) => ({ id: r.id, nome: r.nome }));
      const timeB = emAndamento.filter((r) => r.time === "B").map((r) => ({ id: r.id, nome: r.nome }));
      return res.json({ id: pendentes[0].id, timeA, timeB, vencedor: null });
    }

    const ativos = await getAtivos();
    if (ativos.length < MINIMO_ATIVOS) {
      return res.json({ message: `É necessário pelo menos ${MINIMO_ATIVOS} jogadores ativos` });
    }

    const idsUltima = await getIdsUltimaPartida();

    let fora, dentro;
    if (idsUltima) {
      fora = ativos.filter((j) => !idsUltima.includes(j.id));
      dentro = ativos.filter((j) => idsUltima.includes(j.id));
    } else {
      fora = ativos;
      dentro = [];
    }

    fora = ordenarPorFilaDeChegada(fora);
    dentro = ordenarPorFilaDeChegada(dentro);

    const candidatos = [...fora, ...dentro];
    const timeA = candidatos.slice(0, TAMANHO_TIME);
    const timeB = candidatos.slice(TAMANHO_TIME, TAMANHO_TIME * 2);

    if (timeA.length < TAMANHO_TIME || timeB.length < TAMANHO_TIME) {
      return res.json({ message: "Jogadores insuficientes para formar times" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: partidaRows } = await client.query(
        `INSERT INTO partidas DEFAULT VALUES RETURNING id`
      );
      const partidaId = partidaRows[0].id;

      for (const j of timeA) {
        await client.query(
          `INSERT INTO partida_jogadores (partida_id, jogador_id, time) VALUES ($1, $2, 'A')`,
          [partidaId, j.id]
        );
      }
      for (const j of timeB) {
        await client.query(
          `INSERT INTO partida_jogadores (partida_id, jogador_id, time) VALUES ($1, $2, 'B')`,
          [partidaId, j.id]
        );
      }

      await client.query("COMMIT");

      res.json({
        id: partidaId,
        timeA: timeA.map((j) => ({ id: j.id, nome: j.nome })),
        timeB: timeB.map((j) => ({ id: j.id, nome: j.nome })),
        vencedor: null,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao iniciar partida" });
  }
});

// Registrar resultado
app.post("/resultado", async (req, res) => {
  const { id, vencedor } = req.body || {};
  const partidaId = parseInt(id, 10);
  if (Number.isNaN(partidaId) || !["A", "B", "E"].includes(vencedor)) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: partidaRows } = await client.query(
      `SELECT id, vencedor FROM partidas WHERE id = $1 FOR UPDATE`,
      [partidaId]
    );
    if (partidaRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Partida não encontrada" });
    }
    if (partidaRows[0].vencedor !== null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Resultado já registrado para esta partida" });
    }

    await client.query(
      `UPDATE partidas SET vencedor = $1, finalizada_em = NOW() WHERE id = $2`,
      [vencedor, partidaId]
    );

    const { rows: jogadoresPartida } = await client.query(
      `SELECT jogador_id, time FROM partida_jogadores WHERE partida_id = $1`,
      [partidaId]
    );

    for (const jp of jogadoresPartida) {
      const venceu = jp.time === vencedor;
      await client.query(
        `UPDATE jogadores SET jogos = jogos + 1, vitorias = vitorias + $1 WHERE id = $2`,
        [venceu ? 1 : 0, jp.jogador_id]
      );
    }

    await client.query("COMMIT");
    res.json({ id: partidaId, vencedor });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao registrar resultado" });
  } finally {
    client.release();
  }
});

// Histórico de partidas
app.get("/partidas", async (req, res) => {
  try {
    const { rows: partidas } = await pool.query(
      `SELECT id, vencedor, criada_em, finalizada_em FROM partidas ORDER BY id ASC`
    );
    const { rows: pj } = await pool.query(
      `SELECT pj.partida_id, pj.time, j.id AS jogador_id, j.nome
       FROM partida_jogadores pj
       JOIN jogadores j ON j.id = pj.jogador_id
       ORDER BY pj.id ASC`
    );

    const result = partidas.map((p) => {
      const doTime = (time) =>
        pj
          .filter((x) => x.partida_id === p.id && x.time === time)
          .map((x) => ({ id: x.jogador_id, nome: x.nome }));
      return {
        id: p.id,
        timeA: doTime("A"),
        timeB: doTime("B"),
        vencedor: p.vencedor,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar partidas" });
  }
});

// Resetar campeonato (mantém jogadores cadastrados, zera estatísticas e histórico)
app.post("/reset", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM partida_jogadores`);
    await client.query(`DELETE FROM partidas`);
    await client.query(`UPDATE jogadores SET jogos = 0, vitorias = 0`);
    await client.query("COMMIT");
    res.json({ message: "Campeonato resetado" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao resetar campeonato" });
  } finally {
    client.release();
  }
});

// ---------- Inicialização ----------
const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await migrate();
    app.listen(PORT, () => {
      console.log(`Servidor Futebol Hawai rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error("Falha ao iniciar o servidor:", err);
    process.exit(1);
  }
}

start();
