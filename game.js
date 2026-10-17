"use strict";

// WindowsのブラウザからUbuntu上のFastAPIへ接続
const API_BASE = "http://192.168.1.1:8000";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let authMode = "login";
let busy = false;

// --------------------------
// API communication
// --------------------------

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail = data?.detail || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data;
}

function showMessage(id, message, error = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", error);
}

// --------------------------
// Account: register / login
// --------------------------

function setAuthMode(mode) {
  authMode = mode;

  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");

  $("loginTab").classList.toggle("secondary", mode !== "login");
  $("registerTab").classList.toggle("secondary", mode !== "register");

  $("authSubmit").textContent =
    mode === "login" ? "ログイン" : "新規登録";

  $("password").autocomplete =
    mode === "login" ? "current-password" : "new-password";

  showMessage("authMessage", "");
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("registerTab").addEventListener("click", () => setAuthMode("register"));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = $("username").value.trim();
  const password = $("password").value;

  if (!username || !password) return;

  $("authSubmit").disabled = true;

  try {
    const path = authMode === "login" ? "/login" : "/register";

    const data = await apiRequest(path, {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    if (authMode === "register") {
      showMessage("authMessage", "登録成功！ログインしてください。");
      setAuthMode("login");
      $("username").value = username;
      $("password").value = "";
      return;
    }

    // Backend returns { message, user_id }
    currentUser = {
      id: data.user_id,
      username
    };

    $("loggedInName").textContent = username;
    $("playerName").textContent = username;
    $("accountStatus").textContent = "ログイン中";
    $("authPanel").hidden = true;
    $("loggedInPanel").hidden = false;

    showMessage("authMessage", "ログイン成功！");
    $("password").value = "";
    $("gameMessage").textContent = "ゲーム開始を押してね。";

  } catch (error) {
    showMessage("authMessage", error.message, true);
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("logoutBtn").addEventListener("click", () => {
  currentUser = null;

  stopGame();
  resetGame();

  $("authPanel").hidden = false;
  $("loggedInPanel").hidden = true;
  $("accountStatus").textContent = "ログインしていません";
  $("playerName").textContent = "未ログイン";

  showMessage("authMessage", "ログアウトしました。");
  $("gameMessage").textContent = "ログインしてゲームを開始しよう。";
});

// --------------------------
// Ranking
// --------------------------

async function loadRanking() {
  $("refreshRanking").disabled = true;

  try {
    const rows = await apiRequest("/ranking");

    const tbody = $("rankingBody");
    tbody.replaceChildren();

    if (!Array.isArray(rows) || rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "まだスコアがありません";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const row of rows) {
      const tr = document.createElement("tr");

      const rank = document.createElement("td");
      rank.textContent = row.rank;
      rank.className = "rank";

      const name = document.createElement("td");
      name.textContent = row.name;

      const score = document.createElement("td");
      score.textContent = Number(row.score).toLocaleString();

      tr.append(rank, name, score);
      tbody.appendChild(tr);
    }

    showMessage("rankingMessage", "");

  } catch (error) {
    showMessage("rankingMessage",
      `ランキング取得失敗：${error.message}`, true);
  } finally {
    $("refreshRanking").disabled = false;
  }
}

$("refreshRanking").addEventListener("click", loadRanking);

// --------------------------
// Pac-Man game
// --------------------------

// # = wall, . = dot, o = power dot, space = empty
const ORIGINAL_MAP = [
  "###############",
  "#.............#",
  "#.###.###.###.#",
  "#o#...#...#...#",
  "#.#.#.#.#.#.#.#",
  "#...#...#...#.#",
  "###.###.###.#.#",
  "#.....#.......#",
  "#.###.#.###.#.#",
  "#...#...#...#.#",
  "#.#.#.###.#.#.#",
  "#...#.....#...#",
  "#.###.###.###.#",
  "#.............#",
  "###############"
];

const canvas = $("game");
const ctx = canvas.getContext("2d");

const TILE = 28;
const ROWS = ORIGINAL_MAP.length;
const COLS = ORIGINAL_MAP[0].length;

canvas.width = COLS * TILE;
canvas.height = ROWS * TILE;

let map;
let pacman;
let ghosts;
let score = 0;
let gameRunning = false;
let gameOver = false;
let gameTimer = null;
let poweredUntil = 0;
let lastDirection = { x: 1, y: 0 };

function resetGame() {
  stopGame();

  map = ORIGINAL_MAP.map(row => row.split(""));
  score = 0;
  poweredUntil = 0;
  gameOver = false;

  pacman = { x: 1, y: 1, dx: 0, dy: 0 };

  ghosts = [
    { x: 7, y: 7, color: "#ff5c7a" },
    { x: 7, y: 8, color: "#53dcff" },
    { x: 8, y: 7, color: "#ff9f43" }
  ];

  $("score").textContent = score;
  drawGame();
}

function stopGame() {
  gameRunning = false;

  if (gameTimer !== null) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
}

function isWall(x, y) {
  if (y < 0 || y >= ROWS || x < 0 || x >= COLS) {
    return true;
  }

  return map[y][x] === "#";
}

function startGame() {
  if (!currentUser) {
    $("gameMessage").textContent = "先にログインしてください。";
    return;
  }

  if (gameRunning) return;

  if (gameOver) resetGame();

  gameRunning = true;
  $("gameMessage").textContent = "ゲーム中！ゴーストに注意。";

  gameTimer = setInterval(gameStep, 145);
}

function gameStep() {
  if (!gameRunning) return;

  const nx = pacman.x + pacman.dx;
  const ny = pacman.y + pacman.dy;

  if (!isWall(nx, ny)) {
    pacman.x = nx;
    pacman.y = ny;
  }

  collectDot();
  moveGhosts();
  checkCollision();
  drawGame();
}

function collectDot() {
  const tile = map[pacman.y][pacman.x];

  if (tile === ".") {
    score += 10;
    map[pacman.y][pacman.x] = " ";
  } else if (tile === "o") {
    score += 50;
    poweredUntil = Date.now() + 6000;
    map[pacman.y][pacman.x] = " ";
  }

  $("score").textContent = score;

  const remaining = map.some(row => row.some(
    cell => cell === "." || cell === "o"
  ));

  if (!remaining) {
    finishGame("全ドット獲得！クリア！");
  }
}

function moveGhosts() {
  for (const ghost of ghosts) {
    const options = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ].filter(direction =>
      !isWall(ghost.x + direction.x, ghost.y + direction.y)
    );

    if (!options.length) continue;

    // Prefer directions that move closer to Pac-Man.
    options.sort((a, b) => {
      const da = Math.abs(ghost.x + a.x - pacman.x) +
                 Math.abs(ghost.y + a.y - pacman.y);
      const db = Math.abs(ghost.x + b.x - pacman.x) +
                 Math.abs(ghost.y + b.y - pacman.y);
      return da - db;
    });

    let direction;

    if (Math.random() < 0.65) {
      direction = options[0];
    } else {
      direction = options[Math.floor(Math.random() * options.length)];
    }

    ghost.x += direction.x;
    ghost.y += direction.y;
  }
}

function checkCollision() {
  for (const ghost of ghosts) {
    if (ghost.x === pacman.x && ghost.y === pacman.y) {
      if (Date.now() < poweredUntil) {
        score += 200;
        $("score").textContent = score;
        ghost.x = 7;
        ghost.y = 7;
      } else {
        finishGame("ゴーストに捕まった！");
        return;
      }
    }
  }
}

async function finishGame(message) {
  if (gameOver) return;

  stopGame();
  gameOver = true;

  $("gameMessage").textContent = `${message} スコア：${score}点`;

  if (!currentUser) return;

  try {
    const result = await apiRequest("/score", {
      method: "POST",
      body: JSON.stringify({
        user_id: currentUser.id,
        score
      })
    });

    $("gameMessage").textContent += " スコアを保存しました！";
    await loadRanking();

  } catch (error) {
    $("gameMessage").textContent +=
      ` スコア保存失敗：${error.message}`;
  }
}

function drawGame() {
  ctx.fillStyle = "#050916";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * TILE;
      const py = y * TILE;
      const tile = map[y][x];

      if (tile === "#") {
        ctx.fillStyle = "#152f8c";
        ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        ctx.strokeStyle = "#397dff";
        ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
      } else if (tile === ".") {
        ctx.fillStyle = "#fff0b3";
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (tile === "o") {
        ctx.fillStyle = "#fff3a1";
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Pac-Man
  const cx = pacman.x * TILE + TILE / 2;
  const cy = pacman.y * TILE + TILE / 2;
  const angle = Math.atan2(pacman.dy, pacman.dx);
  const mouth = gameRunning ? 0.28 : 0.12;

  ctx.fillStyle = "#ffdf38";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, TILE * 0.39,
    angle + mouth, angle + Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();

  // Ghosts
  for (const ghost of ghosts) {
    const gx = ghost.x * TILE + TILE / 2;
    const gy = ghost.y * TILE + TILE / 2;

    ctx.fillStyle =
      Date.now() < poweredUntil ? "#4364ed" : ghost.color;

    ctx.beginPath();
    ctx.arc(gx, gy, TILE * 0.36, Math.PI, 0);
    ctx.lineTo(gx + TILE * 0.36, gy + TILE * 0.34);
    ctx.lineTo(gx + TILE * 0.12, gy + TILE * 0.22);
    ctx.lineTo(gx, gy + TILE * 0.34);
    ctx.lineTo(gx - TILE * 0.12, gy + TILE * 0.22);
    ctx.lineTo(gx - TILE * 0.36, gy + TILE * 0.34);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(gx - 5, gy - 2, 4, 0, Math.PI * 2);
    ctx.arc(gx + 5, gy - 2, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10182c";
    ctx.beginPath();
    ctx.arc(gx - 4, gy - 2, 2, 0, Math.PI * 2);
    ctx.arc(gx + 6, gy - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

document.addEventListener("keydown", event => {
  const directions = {
    ArrowUp:    { x: 0, y: -1 },
    ArrowDown:  { x: 0, y: 1 },
    ArrowLeft:  { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }
  };

  const direction = directions[event.key];
  if (!direction) return;

  event.preventDefault();

  if (!currentUser) {
    $("gameMessage").textContent = "先にログインしてください。";
    return;
  }

  if (!gameRunning && !gameOver) startGame();

  if (!isWall(pacman.x + direction.x, pacman.y + direction.y)) {
    pacman.dx = direction.x;
    pacman.dy = direction.y;
  }
});

$("startBtn").addEventListener("click", startGame);

$("restartBtn").addEventListener("click", () => {
  resetGame();

  if (currentUser) {
    $("gameMessage").textContent = "ゲーム開始を押してください。";
  } else {
    $("gameMessage").textContent = "ログインしてゲームを開始しよう。";
  }
});

resetGame();
loadRanking();