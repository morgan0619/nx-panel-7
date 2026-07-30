(() => {
  "use strict";

  // ---------- Constants ----------
  const COLS = 8;
  const ROWS = 7;
  const START_FILLED_ROWS = 5; // 2 empty rows on top for rising-line headroom
  const MOVES_PER_LINE = 5;
  const START_HAMMERS = 3;
  const START_ADD_ROWS = 3;
  const LINES_PER_HAMMER = 3; // clear this many full rows → +1 hammer
  const BEST_KEY = "morgans-game-best";
  const SAVE_KEY = "morgans-game-save-v6";

  const DIRS = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  const TILE_COLORS = {
    1: "#e8eefc",
    2: "#ff8fab",
    3: "#ffe566",
    4: "#6ec6ff",
    5: "#7dff9a",
    6: "#b48cff",
    7: "#ff9e6e",
    8: "#5ce1e6",
    9: "#ff6b9d",
  };

  // ---------- DOM ----------
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const equationEl = document.getElementById("equation");
  const movesFillEl = document.getElementById("moves-fill");
  const movesLeftEl = document.getElementById("moves-left");
  const hammerCountEl = document.getElementById("hammer-count");
  const addRowCountEl = document.getElementById("add-row-count");
  const btnHammer = document.getElementById("btn-hammer");
  const btnAddRow = document.getElementById("btn-add-row");
  const btnRestart = document.getElementById("btn-restart");
  const btnSettings = document.getElementById("btn-settings");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const finalScoreEl = document.getElementById("final-score");

  const btnCancel = document.getElementById("btn-cancel");

  // ---------- State ----------
  /** @type {(number|null)[][]} grid[row][col] — null = cleared/empty */
  let grid;
  let cursor = { r: 3, c: 3 };
  /** @type {{r:number,c:number}|null} */
  let lineStart = null;
  /** @type {{r:number,c:number}|null} */
  let lineDir = null;
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let movesLeft = MOVES_PER_LINE;
  let hammers = START_HAMMERS;
  let addRows = START_ADD_ROWS;
  let linesTowardHammer = 0; // 0..LINES_PER_HAMMER-1 progress toward next hammer
  let hammerMode = false;
  let gameOver = false;
  let animPhase = 0;

  // Layout metrics (updated on resize)
  let layout = {
    pad: 16,
    gap: 8,
    tile: 64,
    originX: 16,
    originY: 16,
  };

  // ---------- Helpers ----------
  function randDigit() {
    return 1 + Math.floor(Math.random() * 9);
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function makeRow() {
    return Array.from({ length: COLS }, () => randDigit());
  }

  function cloneGrid(g) {
    return g.map((row) => row.slice());
  }

  // ---------- Game setup ----------
  function newGame(fromSave) {
    if (fromSave) {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.grid && !data.gameOver) {
            grid = data.grid;
            score = data.score || 0;
            movesLeft = data.movesLeft ?? MOVES_PER_LINE;
            hammers = data.hammers ?? START_HAMMERS;
            addRows = data.addRows ?? START_ADD_ROWS;
            linesTowardHammer = data.linesTowardHammer ?? 0;
            cursor = data.cursor || { r: 3, c: 3 };
            gameOver = false;
            lineStart = null;
            lineDir = null;
            hammerMode = false;
            hideOverlay();
            updateHud();
            updateCancelButton();
            return;
          }
        }
      } catch (_) {
        /* ignore corrupt save */
      }
    }

    grid = emptyGrid();
    // Fill bottom START_FILLED_ROWS with numbers
    for (let r = ROWS - START_FILLED_ROWS; r < ROWS; r++) {
      grid[r] = makeRow();
    }
    score = 0;
    movesLeft = MOVES_PER_LINE;
    hammers = START_HAMMERS;
    addRows = START_ADD_ROWS;
    linesTowardHammer = 0;
    cursor = { r: ROWS - 3, c: Math.floor(COLS / 2) };
    lineStart = null;
    lineDir = null;
    hammerMode = false;
    gameOver = false;
    hideOverlay();
    updateHud();
    updateCancelButton();
    saveGame();
  }

  function saveGame() {
    if (gameOver) {
      localStorage.removeItem(SAVE_KEY);
      return;
    }
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        grid,
        score,
        movesLeft,
        hammers,
        addRows,
        linesTowardHammer,
        cursor,
        gameOver,
      })
    );
  }

  function updateBest() {
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  // ---------- Line / match logic ----------
  /** Active cells from start along dir, stopping at endpoint (inclusive) when provided. */
  function cellsOnRay(start, dir, end) {
    /** @type {{r:number,c:number,value:number}[]} */
    const cells = [];
    if (!start || !dir) return cells;

    if (grid[start.r][start.c] == null) return cells;
    cells.push({ r: start.r, c: start.c, value: grid[start.r][start.c] });

    const maxSteps = end
      ? Math.max(Math.abs(end.r - start.r), Math.abs(end.c - start.c))
      : COLS + ROWS;

    for (let step = 1; step <= maxSteps; step++) {
      const r = start.r + dir.dr * step;
      const c = start.c + dir.dc * step;
      if (!inBounds(r, c)) break;
      if (grid[r][c] != null) {
        cells.push({ r, c, value: grid[r][c] });
      }
    }
    return cells;
  }

  function evaluateMatch(cells) {
    if (!cells || cells.length < 2) {
      return { valid: false, kind: null, sum: cells?.[0]?.value ?? 0, text: "" };
    }
    const values = cells.map((c) => c.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const allSame = values.every((v) => v === values[0]);
    const isTen = sum === 10;
    const valid = allSame || isTen;
    const kind = allSame ? "twins" : isTen ? "tens" : null;
    const text = values.join(" + ") + " = " + sum;
    return { valid, kind, sum, text };
  }

  function getSelection() {
    if (!lineStart) return [];
    if (!lineDir) {
      const v = grid[lineStart.r][lineStart.c];
      return v != null ? [{ r: lineStart.r, c: lineStart.c, value: v }] : [];
    }
    // Extend through cursor: include active tiles from start up to cursor along the ray
    return cellsOnRay(lineStart, lineDir, cursor);
  }

  // ---------- Row collapse ----------
  // Cleared tiles stay as dark holes (lines can skip through them).
  // Only a fully empty row is removed; rows above then fall as a block.

  function collapseFullyEmptyRows() {
    const kept = grid.filter((row) => row.some((v) => v != null));
    while (kept.length < ROWS) {
      kept.unshift(Array(COLS).fill(null));
    }
    grid = kept;
    cursor.r = Math.min(Math.max(0, cursor.r), ROWS - 1);
    if (lineStart) {
      lineStart.r = Math.min(Math.max(0, lineStart.r), ROWS - 1);
    }
  }

  function pushNewRow() {
    // If top row has any tile, board is full → game over
    if (grid[0].some((v) => v != null)) {
      endGame("The board filled up.");
      return false;
    }
    // Shift everything up one
    for (let r = 0; r < ROWS - 1; r++) {
      grid[r] = grid[r + 1].slice();
    }
    grid[ROWS - 1] = makeRow();
    // Keep cursor on board
    cursor.r = Math.max(0, cursor.r - 1);
    if (lineStart) lineStart.r = Math.max(0, lineStart.r - 1);
    return true;
  }

  function afterSuccessfulAction() {
    movesLeft -= 1;
    if (movesLeft <= 0) {
      movesLeft = MOVES_PER_LINE;
      pushNewRow();
    }
    updateHud();
    saveGame();
  }

  function clearCells(cells) {
    const touchedRows = new Set(cells.map((c) => c.r));
    for (const cell of cells) {
      grid[cell.r][cell.c] = null;
    }
    let lines = 0;
    for (const r of touchedRows) {
      if (grid[r].every((v) => v == null)) lines++;
    }
    // Leave holes in place; only collapse when a whole row is empty
    collapseFullyEmptyRows();
    if (lines > 0) awardHammersForClearedLines(lines);
  }

  function awardHammersForClearedLines(lines) {
    if (lines <= 0) return;
    linesTowardHammer += lines;
    let gained = 0;
    while (linesTowardHammer >= LINES_PER_HAMMER) {
      linesTowardHammer -= LINES_PER_HAMMER;
      hammers += 1;
      gained += 1;
    }
    updateHud();
    if (gained > 0) {
      equationEl.classList.remove("invalid");
      equationEl.classList.add("valid");
      equationEl.textContent =
        gained === 1 ? "+1 hammer" : `+${gained} hammers`;
    }
  }

  function scoreMatch(cells, kind) {
    const base = cells.length * 10;
    const bonus = kind === "twins" ? cells.length * 5 : cells.length * 8;
    return base + bonus;
  }

  // ---------- Shared game commands ----------
  // Input adapters (pointer / keyboard / gamepad) only call these.
  // Directions: up, down, left, right, up-left, up-right, down-left, down-right
  // Aliases like "diagonal-up-right" are accepted.

  const DIR_VECTORS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
    "up-left": { dr: -1, dc: -1 },
    "up-right": { dr: -1, dc: 1 },
    "down-left": { dr: 1, dc: -1 },
    "down-right": { dr: 1, dc: 1 },
    "diagonal-up-left": { dr: -1, dc: -1 },
    "diagonal-up-right": { dr: -1, dc: 1 },
    "diagonal-down-left": { dr: 1, dc: -1 },
    "diagonal-down-right": { dr: 1, dc: 1 },
  };

  function resolveDir(dir) {
    if (!dir) return null;
    if (typeof dir === "string") return DIR_VECTORS[dir] || null;
    if (typeof dir.dr === "number" && typeof dir.dc === "number") {
      return { dr: Math.sign(dir.dr), dc: Math.sign(dir.dc) };
    }
    return null;
  }

  function dirNameFromDelta(dr, dc) {
    const sr = Math.sign(dr);
    const sc = Math.sign(dc);
    for (const [name, v] of Object.entries(DIR_VECTORS)) {
      if (name.startsWith("diagonal-")) continue;
      if (v.dr === sr && v.dc === sc) return name;
    }
    return null;
  }

  /** Free cursor move (no active line). Keyboard/controller use this before selecting. */
  function moveCursor(dir) {
    if (gameOver) return;
    const v = resolveDir(dir);
    if (!v || (v.dr === 0 && v.dc === 0)) return;
    if (lineStart) {
      // While a line is active, directional input extends instead of free-moving
      extendSelection(dir);
      return;
    }
    const nr = cursor.r + v.dr;
    const nc = cursor.c + v.dc;
    if (inBounds(nr, nc)) cursor = { r: nr, c: nc };
  }

  /** Jump cursor to a cell (touch tap targeting). */
  function focusTile(r, c) {
    if (gameOver || !inBounds(r, c)) return;
    cursor = { r, c };
  }

  /** Begin a line from the focused tile (or optional explicit cell). */
  function startSelection(cell) {
    if (gameOver) return;
    if (hammerMode) {
      if (cell) focusTile(cell.r, cell.c);
      useHammerOnCursor();
      return;
    }
    if (cell) focusTile(cell.r, cell.c);
    if (grid[cursor.r][cursor.c] == null) return;
    if (lineStart) return; // already selecting — use confirmSelection
    lineStart = { ...cursor };
    lineDir = null;
    updateEquation();
    updateCancelButton();
  }

  /**
   * Extend the active line in a named direction (keyboard / controller).
   * First call locks the 8-way direction; further calls grow or shrink along it.
   */
  function extendSelection(dir) {
    if (gameOver || !lineStart) return;
    const v = resolveDir(dir);
    if (!v || (v.dr === 0 && v.dc === 0)) return;

    if (!lineDir) {
      lineDir = { ...v };
      const next = findNextActive(lineStart, lineDir);
      cursor = next ? { r: next.r, c: next.c } : { ...lineStart };
      updateEquation();
      return;
    }

    if (v.dr === lineDir.dr && v.dc === lineDir.dc) {
      const next = findNextActive(cursor, lineDir);
      if (next) cursor = { r: next.r, c: next.c };
      else {
        const nr = cursor.r + v.dr;
        const nc = cursor.c + v.dc;
        if (inBounds(nr, nc)) cursor = { r: nr, c: nc };
      }
    } else if (v.dr === -lineDir.dr && v.dc === -lineDir.dc) {
      const back = findPrevActive(cursor, lineDir, lineStart);
      if (back) cursor = { r: back.r, c: back.c };
      else cursor = { ...lineStart };
    } else {
      // D-pad often can't hold two directions: Up then Left should become up-left
      const merged = mergeToDiagonal(lineDir, v);
      lineDir = merged ? { ...merged } : { ...v };
      const next = findNextActive(lineStart, lineDir);
      cursor = next ? { r: next.r, c: next.c } : { ...lineStart };
    }
    updateEquation();
  }

  /** Combine a cardinal line with a perpendicular press into a diagonal. */
  function mergeToDiagonal(current, incoming) {
    if (!current || !incoming) return null;
    const curCardinal =
      (current.dr !== 0 && current.dc === 0) || (current.dr === 0 && current.dc !== 0);
    const inCardinal =
      (incoming.dr !== 0 && incoming.dc === 0) || (incoming.dr === 0 && incoming.dc !== 0);
    if (!curCardinal || !inCardinal) return null;
    // Same axis (up then down, etc.) — not a diagonal
    if (current.dr !== 0 && incoming.dr !== 0) return null;
    if (current.dc !== 0 && incoming.dc !== 0) return null;
    return {
      dr: current.dr !== 0 ? current.dr : incoming.dr,
      dc: current.dc !== 0 ? current.dc : incoming.dc,
    };
  }

  /**
   * Touch/mouse: set line direction and endpoint from a board cell
   * (highlight + connector follow the finger).
   * Dragging back to the start tile clears the direction so you can restart the line.
   */
  function extendSelectionTo(r, c) {
    if (gameOver || !lineStart || !inBounds(r, c)) return;

    // Back on the starting tile → reset to a single-tile selection
    if (r === lineStart.r && c === lineStart.c) {
      lineDir = null;
      cursor = { ...lineStart };
      updateEquation();
      return;
    }

    const name = dirNameFromDelta(r - lineStart.r, c - lineStart.c);
    if (!name) return; // not a straight 8-way line from start
    const v = DIR_VECTORS[name];
    lineDir = { ...v };
    cursor = { r, c };
    updateEquation();
  }

  /** Confirm the current line if it is a valid twins/tens match. */
  function confirmSelection() {
    if (gameOver) return;
    if (hammerMode) {
      useHammerOnCursor();
      return;
    }
    if (!lineStart) return;

    const cells = getSelection();
    const evalResult = evaluateMatch(cells);
    if (!evalResult.valid) {
      equationEl.classList.add("invalid");
      return;
    }

    score += scoreMatch(cells, evalResult.kind);
    updateBest();
    clearCells(cells);
    lineStart = null;
    lineDir = null;
    if (grid[cursor.r][cursor.c] == null) snapCursorToNearest();
    afterSuccessfulAction();
    updateEquation();
    updateCancelButton();
  }

  /** Enter/A/Space: start if idle, otherwise confirm. */
  function primaryAction() {
    if (gameOver) return;
    if (hammerMode) {
      useHammerOnCursor();
      return;
    }
    if (!lineStart) startSelection();
    else confirmSelection();
  }

  function cancelSelection() {
    if (gameOver) return;
    if (hammerMode) {
      hammerMode = false;
      btnHammer.classList.remove("active");
      updateCancelButton();
      return;
    }
    lineStart = null;
    lineDir = null;
    updateEquation();
    updateCancelButton();
  }

  function findNextActive(from, dir) {
    let r = from.r + dir.dr;
    let c = from.c + dir.dc;
    while (inBounds(r, c)) {
      if (grid[r][c] != null) return { r, c };
      r += dir.dr;
      c += dir.dc;
    }
    return null;
  }

  function findPrevActive(from, dir, start) {
    let r = from.r - dir.dr;
    let c = from.c - dir.dc;
    while (inBounds(r, c)) {
      if (r === start.r && c === start.c) return { r, c };
      if (grid[r][c] != null) return { r, c };
      r -= dir.dr;
      c -= dir.dc;
    }
    return null;
  }

  function snapCursorToNearest() {
    let bestDist = Infinity;
    let bestPos = null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] == null) continue;
        const d = Math.abs(r - cursor.r) + Math.abs(c - cursor.c);
        if (d < bestDist) {
          bestDist = d;
          bestPos = { r, c };
        }
      }
    }
    if (bestPos) cursor = bestPos;
  }

  function useHammerOnCursor() {
    if (hammers <= 0 || gameOver) return;
    if (grid[cursor.r][cursor.c] == null) return;
    hammers -= 1;
    hammerMode = false;
    btnHammer.classList.remove("active");
    const row = cursor.r;
    grid[cursor.r][cursor.c] = null;
    const clearedRow = grid[row].every((v) => v == null) ? 1 : 0;
    collapseFullyEmptyRows();
    if (clearedRow) awardHammersForClearedLines(clearedRow);
    snapCursorToNearest();
    afterSuccessfulAction();
    updateEquation();
    updateCancelButton();
  }

  function activateHammer() {
    if (gameOver || hammers <= 0) return;
    hammerMode = !hammerMode;
    btnHammer.classList.toggle("active", hammerMode);
    if (hammerMode) {
      lineStart = null;
      lineDir = null;
      updateEquation();
    }
    updateCancelButton();
  }

  function manualAddRow() {
    if (gameOver) return;
    lineStart = null;
    lineDir = null;
    hammerMode = false;
    btnHammer.classList.remove("active");
    // Unlimited until the board has no room — pushNewRow ends the game if full
    if (!pushNewRow()) {
      updateHud();
      updateCancelButton();
      return;
    }
    updateHud();
    saveGame();
    updateEquation();
    updateCancelButton();
  }

  function updateCancelButton() {
    const canCancel = !gameOver && (!!lineStart || hammerMode);
    btnCancel.disabled = !canCancel;
    btnCancel.classList.toggle("ready", canCancel);
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function endGame(msg) {
    gameOver = true;
    updateBest();
    localStorage.removeItem(SAVE_KEY);
    overlayTitle.textContent = "Game Over";
    overlayMsg.textContent = msg || "The board filled up.";
    finalScoreEl.textContent = String(score);
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    updateHud();
    updateCancelButton();
  }

  // ---------- HUD ----------
  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    hammerCountEl.textContent = String(hammers);
    addRowCountEl.textContent = "∞";
    movesLeftEl.textContent = String(movesLeft);
    movesFillEl.style.width = `${(movesLeft / MOVES_PER_LINE) * 100}%`;
    btnHammer.disabled = hammers <= 0 || gameOver;
    btnAddRow.disabled = gameOver;
    const bar = movesFillEl.parentElement;
    if (bar) {
      bar.setAttribute("aria-valuenow", String(movesLeft));
      bar.setAttribute("aria-valuemax", String(MOVES_PER_LINE));
    }
  }

  function updateEquation() {
    const cells = getSelection();
    const evalResult = evaluateMatch(cells);
    equationEl.classList.remove("valid", "invalid");
    if (cells.length === 0) {
      equationEl.textContent = hammerMode ? "Hammer: select a tile to smash" : "";
      return;
    }
    if (cells.length === 1) {
      equationEl.textContent = String(cells[0].value);
      return;
    }
    equationEl.textContent = evalResult.text + (evalResult.valid ? " ✓" : "");
    equationEl.classList.add(evalResult.valid ? "valid" : "invalid");
  }

  // ---------- Rendering ----------
  function computeLayout() {
    const pad = 16;
    const gap = 8;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const tile = Math.floor(
      Math.min((availW - gap * (COLS - 1)) / COLS, (availH - gap * (ROWS - 1)) / ROWS)
    );
    const boardW = COLS * tile + (COLS - 1) * gap;
    const boardH = ROWS * tile + (ROWS - 1) * gap;
    layout = {
      pad,
      gap,
      tile,
      originX: Math.floor((canvas.width - boardW) / 2),
      originY: Math.floor((canvas.height - boardH) / 2),
    };
  }

  function cellCenter(r, c) {
    const x = layout.originX + c * (layout.tile + layout.gap) + layout.tile / 2;
    const y = layout.originY + r * (layout.tile + layout.gap) + layout.tile / 2;
    return { x, y };
  }

  function cellRect(r, c) {
    const x = layout.originX + c * (layout.tile + layout.gap);
    const y = layout.originY + r * (layout.tile + layout.gap);
    return { x, y, s: layout.tile };
  }

  function roundRect(x, y, w, h, rad) {
    const r = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    animPhase += 0.03;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Soft board backdrop
    ctx.fillStyle = "#071428";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const selection = getSelection();
    const selectedSet = new Set(selection.map((c) => `${c.r},${c.c}`));
    const evalResult = evaluateMatch(selection);

    // Draw empty slots faintly
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y, s } = cellRect(r, c);
        if (grid[r][c] == null) {
          // Darkened cleared / empty slot
          ctx.fillStyle = "rgba(8, 16, 36, 0.9)";
          roundRect(x, y, s, s, 12);
          ctx.fill();
          ctx.strokeStyle = "rgba(40, 70, 120, 0.55)";
          ctx.lineWidth = 2;
          roundRect(x + 1, y + 1, s - 2, s - 2, 11);
          ctx.stroke();
        }
      }
    }

    // Draw tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = grid[r][c];
        if (val == null) continue;
        const { x, y, s } = cellRect(r, c);
        const key = `${r},${c}`;
        const isSel = selectedSet.has(key);
        const isCursor = cursor.r === r && cursor.c === c;

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        roundRect(x + 2, y + 3, s, s, 12);
        ctx.fill();

        ctx.fillStyle = TILE_COLORS[val] || "#ccc";
        roundRect(x, y, s, s, 12);
        ctx.fill();

        if (isSel) {
          ctx.strokeStyle = evalResult.valid || selection.length < 2 ? "#ffffff" : "#f87171";
          ctx.lineWidth = 3;
          roundRect(x + 1.5, y + 1.5, s - 3, s - 3, 10);
          ctx.stroke();
        }

        if (isCursor) {
          const pulse = 0.5 + 0.5 * Math.sin(animPhase * 4);
          ctx.strokeStyle = hammerMode
            ? `rgba(255, 122, 61, ${0.7 + pulse * 0.3})`
            : `rgba(61, 214, 198, ${0.6 + pulse * 0.4})`;
          ctx.lineWidth = 3;
          roundRect(x - 3, y - 3, s + 6, s + 6, 14);
          ctx.stroke();
        }

        ctx.fillStyle = val === 1 ? "#1a2a4a" : "#102038";
        ctx.font = `800 ${Math.floor(s * 0.55)}px Trebuchet MS, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(val), x + s / 2, y + s / 2 + 1);
      }
    }

    // Connecting line through selection (including across cleared gaps)
    if (selection.length >= 2 && lineStart && lineDir) {
      // Build path through all cells from start along dir including empties for visual continuity
      const pathCenters = [];
      let r = lineStart.r;
      let c = lineStart.c;
      const last = selection[selection.length - 1];
      pathCenters.push(cellCenter(r, c));
      r += lineDir.dr;
      c += lineDir.dc;
      while (inBounds(r, c)) {
        pathCenters.push(cellCenter(r, c));
        if (r === last.r && c === last.c) break;
        // Stop after we've passed the last selected cell
        const passedLast =
          (lineDir.dr !== 0 && (lineDir.dr > 0 ? r > last.r : r < last.r)) ||
          (lineDir.dc !== 0 && (lineDir.dc > 0 ? c > last.c : c < last.c));
        if (passedLast && grid[r]?.[c] == null) {
          // keep going until last active — already handled by break on last
        }
        if (r === last.r && c === last.c) break;
        r += lineDir.dr;
        c += lineDir.dc;
        // Safety
        if (pathCenters.length > COLS + ROWS) break;
      }

      ctx.lineWidth = 4;
      ctx.strokeStyle = evalResult.valid ? "rgba(255,255,255,0.85)" : "rgba(248,113,113,0.75)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      // Only draw between selection active cells for cleaner look
      for (let i = 0; i < selection.length; i++) {
        const p = cellCenter(selection[i].r, selection[i].c);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Dots on each selected center
      for (const cell of selection) {
        const p = cellCenter(cell.r, cell.c);
        ctx.fillStyle = evalResult.valid ? "#fff" : "#fca5a5";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (lineStart) {
      const p = cellCenter(lineStart.r, lineStart.c);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cursor on empty cell
    if (grid[cursor.r][cursor.c] == null) {
      const { x, y, s } = cellRect(cursor.r, cursor.c);
      ctx.strokeStyle = hammerMode ? "#ff7a3d" : "#3dd6c6";
      ctx.lineWidth = 2;
      roundRect(x - 2, y - 2, s + 4, s + 4, 14);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  // ---------- Hit testing ----------
  function canvasToCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const { originX, originY, tile, gap } = layout;
    const c = Math.floor((x - originX) / (tile + gap));
    const r = Math.floor((y - originY) / (tile + gap));
    if (!inBounds(r, c)) return null;
    const localX = x - originX - c * (tile + gap);
    const localY = y - originY - r * (tile + gap);
    if (localX > tile || localY > tile || localX < 0 || localY < 0) return null;
    return { r, c };
  }

  // ---------- Input adapters ----------
  // Each device only translates hardware events into shared commands.

  // --- Keyboard (KeyboardEvent) ---
  const KEY_TO_DIR = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  window.addEventListener("keydown", (e) => {
    // Let browser shortcuts through (Cmd/Ctrl+Shift+R refresh, etc.)
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        newGame(false);
      }
      return;
    }

    const dir = KEY_TO_DIR[e.key];
    if (dir) {
      e.preventDefault();
      // Idle → move cursor; selecting → extend line (handled inside moveCursor)
      moveCursor(dir);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      primaryAction();
      return;
    }
    if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      cancelSelection();
      return;
    }
    if (e.key === "h" || e.key === "H") {
      activateHammer();
      return;
    }
    if (e.key === "r" || e.key === "R") {
      manualAddRow();
      return;
    }
  });

  // --- HUD buttons ---
  btnHammer.addEventListener("click", () => activateHammer());
  btnAddRow.addEventListener("click", () => manualAddRow());
  btnCancel.addEventListener("click", () => cancelSelection());
  btnRestart.addEventListener("click", () => newGame(false));
  btnSettings.addEventListener("click", () => {
    if (confirm("Start a new game?")) newGame(false);
  });

  // --- Pointer Events (touch, stylus, mouse) ---
  // Press → start; drag → extend/shrink; release → confirm if valid, otherwise cancel
  let pointerDown = null;
  let pointerSelecting = false;

  function onPointerDown(clientX, clientY) {
    if (gameOver) return;
    const cell = canvasToCell(clientX, clientY);

    // Tap empty board / miss while selecting → cancel and start over
    if (!cell) {
      if (lineStart || hammerMode) cancelSelection();
      pointerDown = null;
      pointerSelecting = false;
      return;
    }

    pointerDown = { ...cell, x: clientX, y: clientY };

    if (hammerMode) {
      startSelection(cell);
      pointerDown = null;
      return;
    }

    // Already mid-selection from a previous gesture: tap start or empty-ish restart
    if (lineStart && !pointerSelecting) {
      // Tap the start tile again → cancel
      if (cell.r === lineStart.r && cell.c === lineStart.c) {
        cancelSelection();
        pointerDown = null;
        return;
      }
      // Tap any other filled tile → abandon old line and start a new one there
      if (grid[cell.r][cell.c] != null) {
        cancelSelection();
        startSelection(cell);
        pointerSelecting = true;
        return;
      }
      // Tap a hole → cancel
      cancelSelection();
      focusTile(cell.r, cell.c);
      pointerDown = null;
      return;
    }

    if (!lineStart) {
      if (grid[cell.r][cell.c] != null) {
        startSelection(cell);
        pointerSelecting = true;
      } else {
        focusTile(cell.r, cell.c);
      }
      return;
    }

    // Continuing an active drag selection
    extendSelectionTo(cell.r, cell.c);
    pointerSelecting = true;
  }

  function onPointerMove(clientX, clientY) {
    if (!pointerDown || !pointerSelecting || !lineStart) return;
    const cell = canvasToCell(clientX, clientY);
    if (!cell) return;
    extendSelectionTo(cell.r, cell.c);
  }

  function onPointerUp(clientX, clientY) {
    if (!pointerDown) return;
    pointerDown = null;

    if (!pointerSelecting || !lineStart) {
      pointerSelecting = false;
      return;
    }

    const cell = canvasToCell(clientX, clientY);
    if (cell) extendSelectionTo(cell.r, cell.c);

    const evalResult = evaluateMatch(getSelection());
    if (evalResult.valid) {
      confirmSelection();
    } else {
      // Don't leave a half-drawn invalid line stuck on screen — clear it
      cancelSelection();
    }

    pointerSelecting = false;
  }

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      onPointerDown(e.clientX, e.clientY);
    },
    { passive: false }
  );

  canvas.addEventListener(
    "pointermove",
    (e) => {
      e.preventDefault();
      onPointerMove(e.clientX, e.clientY);
    },
    { passive: false }
  );

  canvas.addEventListener(
    "pointerup",
    (e) => {
      e.preventDefault();
      onPointerUp(e.clientX, e.clientY);
    },
    { passive: false }
  );

  canvas.addEventListener("pointercancel", () => {
    pointerDown = null;
    if (pointerSelecting && lineStart) cancelSelection();
    pointerSelecting = false;
  });

  // --- Gamepad API (D-pad + A/B, with menu-style repeat delay) ---
  const PAD_INITIAL_DELAY = 280;
  const PAD_REPEAT_DELAY = 120;
  const PAD_DIAGONAL_GRACE_MS = 320; // hat D-pads can't hold two dirs; remember briefly
  const padPrev = { a: false, b: false, x: false, y: false };
  let padRepeatAt = 0;
  let padHeldDir = null;
  const padCardinalAt = { up: 0, down: 0, left: 0, right: 0 };

  function stickEightWay(gp) {
    const x = gp.axes[0] || 0;
    const y = gp.axes[1] || 0;
    if (Math.hypot(x, y) < 0.55) return null;
    // 8 sectors from atan2 (y down, x right)
    const sector = (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8;
    return [
      "right",
      "down-right",
      "down",
      "down-left",
      "left",
      "up-left",
      "up",
      "up-right",
    ][sector];
  }

  function gamepadDirection(gp, ts) {
    const upBtn = !!(gp.buttons[12] && gp.buttons[12].pressed);
    const downBtn = !!(gp.buttons[13] && gp.buttons[13].pressed);
    const leftBtn = !!(gp.buttons[14] && gp.buttons[14].pressed);
    const rightBtn = !!(gp.buttons[15] && gp.buttons[15].pressed);

    if (upBtn) padCardinalAt.up = ts;
    if (downBtn) padCardinalAt.down = ts;
    if (leftBtn) padCardinalAt.left = ts;
    if (rightBtn) padCardinalAt.right = ts;

    const recent = (name) => ts - padCardinalAt[name] < PAD_DIAGONAL_GRACE_MS;
    let up = upBtn || recent("up");
    let down = downBtn || recent("down");
    let left = leftBtn || recent("left");
    let right = rightBtn || recent("right");

    // Prefer live opposites over stale grace
    if (upBtn && down) down = false;
    if (downBtn && up) up = false;
    if (leftBtn && right) right = false;
    if (rightBtn && left) left = false;
    if (up && down) {
      up = upBtn;
      down = downBtn;
    }
    if (left && right) {
      left = leftBtn;
      right = rightBtn;
    }

    if (up && left) return "up-left";
    if (up && right) return "up-right";
    if (down && left) return "down-left";
    if (down && right) return "down-right";
    if (upBtn && !downBtn) return "up";
    if (downBtn && !upBtn) return "down";
    if (leftBtn && !rightBtn) return "left";
    if (rightBtn && !leftBtn) return "right";

    // Left stick: true 8-way (better diagonals than axis thresholds)
    return stickEightWay(gp);
  }

  function readGamepad(ts) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0] || pads[1];
    if (!gp) {
      requestAnimationFrame(readGamepad);
      return;
    }

    const dirNow = gamepadDirection(gp, ts);
    if (dirNow) {
      if (padHeldDir !== dirNow) {
        padHeldDir = dirNow;
        padRepeatAt = ts + PAD_INITIAL_DELAY;
        moveCursor(dirNow);
      } else if (ts >= padRepeatAt) {
        padRepeatAt = ts + PAD_REPEAT_DELAY;
        moveCursor(dirNow);
      }
    } else {
      padHeldDir = null;
    }

    const a = !!(gp.buttons[0] && gp.buttons[0].pressed);
    const b = !!(gp.buttons[1] && gp.buttons[1].pressed);
    const x = !!(gp.buttons[2] && gp.buttons[2].pressed);
    const y = !!(gp.buttons[3] && gp.buttons[3].pressed);

    if (a && !padPrev.a) primaryAction();
    if (b && !padPrev.b) cancelSelection();
    if (x && !padPrev.x) manualAddRow();
    if (y && !padPrev.y) activateHammer();
    padPrev.a = a;
    padPrev.b = b;
    padPrev.x = x;
    padPrev.y = y;

    requestAnimationFrame(readGamepad);
  }

  window.addEventListener("gamepadconnected", () => {
    /* polling loop already running */
  });

  // ---------- Resize ----------
  function fitCanvas() {
    // Keep internal resolution crisp
    const maxW = 640;
    const maxH = 560;
    canvas.width = maxW;
    canvas.height = maxH;
    computeLayout();
  }

  window.addEventListener("resize", fitCanvas);

  // ---------- Boot ----------
  fitCanvas();
  bestEl.textContent = String(best);
  newGame(true);
  updateEquation();
  updateCancelButton();
  requestAnimationFrame(draw);
  requestAnimationFrame(readGamepad);

  // Public API for debugging / automated checks
  window.MorgansGame = {
    newGame: () => newGame(false),
    getState: () => ({
      grid: cloneGrid(grid),
      score,
      movesLeft,
      hammers,
      addRows,
      cursor: { ...cursor },
      lineStart: lineStart ? { ...lineStart } : null,
      lineDir: lineDir ? { ...lineDir } : null,
      gameOver,
    }),
    setGrid: (g) => {
      grid = cloneGrid(g);
      lineStart = null;
      lineDir = null;
      gameOver = false;
      hideOverlay();
      updateHud();
      updateCancelButton();
      saveGame();
    },
    moveCursor,
    startSelection,
    extendSelection,
    extendSelectionTo,
    confirmSelection,
    cancelSelection,
    primaryAction,
    activateHammer,
    manualAddRow,
    evaluateSelection: () => evaluateMatch(getSelection()),
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js?v=14")
        .then((reg) => reg.update())
        .catch(() => {
          /* file:// or unsupported — ignore */
        });
    });
  }
})();
