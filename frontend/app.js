const API = window.API_URL || "http://localhost:4000";
let jogadoresCache = [];
let partidasCache = [];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

async function apiFetch(path, options) {
  const res = await fetch(`${API}${path}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // resposta sem corpo JSON
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Erro na requisição (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function carregarJogadores() {
  jogadoresCache = await apiFetch("/jogadores");
  document.getElementById("listaJogadores").innerHTML = jogadoresCache
    .map(
      (j) => `
        <li class="${j.ativo ? "" : "inactive"}">
          <label class="flex items-center gap-2">
            <input type="checkbox" class="chk-ativo" data-id="${j.id}" ${j.ativo ? "checked" : ""} />
            ${escapeHtml(j.nome)} (jogos: ${j.jogos}, vitórias: ${j.vitorias})
          </label>
        </li>
      `
    )
    .join("");
  atualizarTabela();
}

async function adicionarJogador() {
  const input = document.getElementById("nomeJogador");
  const nome = input.value.trim();
  if (!nome) return alert("Digite um nome!");
  try {
    await apiFetch("/jogadores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    input.value = "";
    await carregarJogadores();
  } catch (err) {
    alert(err.message);
  }
}

async function iniciarPartida() {
  try {
    const partida = await apiFetch("/partida", { method: "POST" });
    if (partida.message) {
      document.getElementById("partidaAtual").innerHTML = `<p class="text-red-600">${escapeHtml(partida.message)}</p>`;
      return;
    }
    mostrarPartidaAtual(partida);
    await carregarHistorico();
  } catch (err) {
    document.getElementById("partidaAtual").innerHTML = `<p class="text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

async function registrarResultado(partidaId, vencedor) {
  try {
    await apiFetch("/resultado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: partidaId, vencedor }),
    });
    await carregarJogadores();
    await carregarHistorico();
    setTimeout(iniciarPartida, 300);
  } catch (err) {
    alert(err.message);
  }
}

async function carregarHistorico() {
  partidasCache = await apiFetch("/partidas");
  document.getElementById("historicoPartidas").innerHTML = partidasCache
    .map(
      (p) => `
        <div class="p-2 border rounded bg-gray-50">
          <p><strong>Partida ${escapeHtml(String(p.id))}</strong></p>
          <p><span class="font-semibold text-blue-600">Time A:</span> ${escapeHtml(p.timeA.map((j) => j.nome).join(", "))}</p>
          <p><span class="font-semibold text-red-600">Time B:</span> ${escapeHtml(p.timeB.map((j) => j.nome).join(", "))}</p>
          <p><strong>Vencedor:</strong> ${p.vencedor === "E" ? "Empate" : p.vencedor ? "Time " + escapeHtml(p.vencedor) : "Ainda jogando"}</p>
        </div>
      `
    )
    .join("");
  atualizarTabela();
}

function mostrarPartidaAtual(partida) {
  const cont = document.getElementById("partidaAtual");
  cont.innerHTML = `
    <p><span class="font-semibold text-blue-600">Time A:</span> ${escapeHtml(partida.timeA.map((j) => j.nome).join(", "))}</p>
    <p><span class="font-semibold text-red-600">Time B:</span> ${escapeHtml(partida.timeB.map((j) => j.nome).join(", "))}</p>
    <div class="mt-2">
      <button data-partida-id="${escapeHtml(String(partida.id))}" data-vencedor="A" class="btn-result bg-blue-500 text-white px-2 py-1 rounded">Vitória Time A</button>
      <button data-partida-id="${escapeHtml(String(partida.id))}" data-vencedor="B" class="btn-result bg-red-500 text-white px-2 py-1 rounded ml-2">Vitória Time B</button>
      <button data-partida-id="${escapeHtml(String(partida.id))}" data-vencedor="E" class="btn-result bg-gray-600 text-white px-2 py-1 rounded ml-2">Empate</button>
    </div>
  `;
}

function atualizarTabela() {
  if (!jogadoresCache || !partidasCache) return;
  const thead = document.querySelector("#tabela thead tr");
  const tbody = document.querySelector("#tabela tbody");

  thead.innerHTML = `<th class="border border-gray-400 px-2">Jogador</th>`;
  partidasCache.forEach((p) => {
    thead.innerHTML += `<th class="border border-gray-400 px-2">P${p.id}</th>`;
  });

  tbody.innerHTML = jogadoresCache
    .map((j) => {
      let row = `<tr><td class="border border-gray-400 px-2 ${j.ativo ? "" : "inactive"}">${escapeHtml(j.nome)}</td>`;
      partidasCache.forEach((p, idx) => {
        let mark = "";
        if (p.timeA.some((x) => x.id === j.id)) mark = "X";
        if (p.timeB.some((x) => x.id === j.id)) mark = "O";

        let highlight = "";
        if (idx > 0) {
          const prev = partidasCache[idx - 1];
          const emA1 = prev.timeA.some((x) => x.id === j.id);
          const emB1 = prev.timeB.some((x) => x.id === j.id);
          const emA2 = p.timeA.some((x) => x.id === j.id);
          const emB2 = p.timeB.some((x) => x.id === j.id);
          if ((emA1 && emA2) || (emB1 && emB2)) highlight = "highlight";
        }

        row += `<td class="border border-gray-400 px-2 ${highlight}">${mark}</td>`;
      });
      row += "</tr>";
      return row;
    })
    .join("");
}

document.addEventListener("click", async (ev) => {
  const t = ev.target;
  if (t.classList.contains("btn-result")) {
    const pid = t.getAttribute("data-partida-id");
    const v = t.getAttribute("data-vencedor");
    if (pid && v) registrarResultado(pid, v);
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.classList.contains("chk-ativo")) {
    const id = t.getAttribute("data-id");
    const ativo = t.checked;
    try {
      await apiFetch(`/jogadores/${id}/ativo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo }),
      });
      await carregarJogadores();
    } catch (err) {
      alert(err.message);
    }
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("btn-adicionar").addEventListener("click", adicionarJogador);
  document.getElementById("btn-partida").addEventListener("click", iniciarPartida);
  document.getElementById("btn-reset").addEventListener("click", async () => {
    if (!confirm("Resetar campeonato?")) return;
    try {
      await apiFetch("/reset", { method: "POST" });
      document.getElementById("partidaAtual").innerHTML = "";
      await carregarJogadores();
      await carregarHistorico();
    } catch (err) {
      alert(err.message);
    }
  });

  try {
    await carregarJogadores();
    await carregarHistorico();
  } catch (err) {
    document.getElementById("partidaAtual").innerHTML = `<p class="text-red-600">Não foi possível conectar ao backend (${escapeHtml(API)}). ${escapeHtml(err.message)}</p>`;
  }
});
