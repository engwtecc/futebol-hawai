const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "AVISO: variável de ambiente DATABASE_URL não definida. Configure-a no .env (local) ou nas variáveis do Railway (produção)."
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || "");

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do PostgreSQL:", err);
});

module.exports = pool;
