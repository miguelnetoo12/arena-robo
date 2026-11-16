(function(){
"use strict";

const $ = id => document.getElementById(id);
const stage = $("stage"), cv = $("cv"), ctx = cv.getContext("2d");
// ===== Celular: detecção, desempenho automático e vibração =====
const IS_TOUCH = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : ("ontouchstart" in window);
if(IS_TOUCH) document.body.classList.add("touch");
let LOW = false, perfAcc = 0, perfN = 0, DPR = 1;
function perfTick(dt){
  if(LOW) return;
  perfAcc += dt; perfN++;
  if(perfN >= 90){ if(perfAcc / perfN > 0.024){ LOW = true; resize(); } perfAcc = 0; perfN = 0; }   // abaixo de ~40 quadros/s: modo leve
}
function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
const FX = () => LOW ? 0.4 : IS_TOUCH ? 0.7 : 1;                                                  // quantidade de partículas


let W = 0, H = 0, U = 30;
function resize(){
  const r = stage.getBoundingClientRect();
  const dpr = DPR = Math.min(LOW ? 1 : IS_TOUCH ? 1.5 : 2, window.devicePixelRatio || 1);
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  U = Math.max(22, Math.min(40, Math.min(W, H) / 13));
  if(P){ P.x = Math.min(P.x, W - U); P.y = Math.min(P.y, H - U); }
  if(state !== "play") draw();
}

// ===== Estado =====
let state = "start";
let P = null, enemies, bullets, eShots, drops, parts, texts;
let score, wave, kills, toSpawn, spawnT, fireT, waveDone, time, shake, flashRed;
let best = 0, muted = false;
try{ best = +(localStorage.getItem("arena-robo-best") || 0) || 0; muted = localStorage.getItem("arena-robo-mute") === "1"; }catch(e){}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

const KIND = {
  bug:   {hp:2, r:0.4,  sp:2.3, pts:10},
  virus: {hp:4, r:0.58, sp:1.3, pts:15},
  mini:  {hp:1, r:0.3,  sp:2.8, pts:5},
  worm:  {hp:1, r:0.32, sp:3.6, pts:15},
  hacker:{hp:3, r:0.45, sp:1.6, pts:25},
};

function reset(){
  P = {x:W / 2, y:H / 2, r:0.45, hp:5, maxHp:5, inv:0, aim:-Math.PI / 2, speed:4.6, rate:0.26, shots:1, dmg:1, pierce:0, mag:0};
  enemies = []; bullets = []; eShots = []; drops = []; parts = []; texts = [];
  score = 0; wave = 0; kills = 0; time = 0; shake = 0; flashRed = 0; fireT = 0;
  nextWave();
}
function nextWave(){
  wave++; toSpawn = 8 + wave * 4; spawnT = 1.2; waveDone = false;
  texts.push({x:W / 2, y:H * 0.4, text:"ONDA " + wave, color:"#FFFFFF", life:1.6, big:true});
}

function spawnEnemy(){
  const side = Math.floor(Math.random() * 4);
  const x = side === 0 ? -U : side === 1 ? W + U : rnd(0, W);
  const y = side === 2 ? -U : side === 3 ? H + U : rnd(0, H);
  const r = Math.random();
  let kind = "bug";
  if(wave >= 2 && r < 0.28) kind = "virus";
  if(wave >= 3 && r > 0.72) kind = "worm";
  if(wave >= 4 && r > 0.88) kind = "hacker";
  addEnemy(kind, x, y);
}
function addEnemy(kind, x, y){
  const K = KIND[kind], boost = 1 + wave * 0.05;
  enemies.push({kind, x, y, hp:K.hp + (kind === "bug" && wave > 5 ? 1 : 0), r:K.r, sp:K.sp * boost, t:rnd(0, 6), fire:rnd(1.5, 3), hit:0});
}

// ===== Controles =====
const keys = {};
document.addEventListener("keydown", e => {
  if((state === "start" || state === "over") && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); start(); return; }
  if(e.key === "p" || e.key === "P" || e.key === "Escape"){ togglePause(); return; }
  keys[e.key.toLowerCase()] = true;
  if(e.key.startsWith("Arrow")) e.preventDefault();
});
document.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

let mouse = null, mouseT = 0;
const sticks = {};   // pointerId -> {side, ox, oy, x, y}
function pt(e){ const r = cv.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; }
cv.addEventListener("pointerdown", e => {
  if(state !== "play") return;
  if(e.pointerType === "mouse") return;
  const p = pt(e);
  sticks[e.pointerId] = {side:p.x < W / 2 ? "move" : "aim", ox:p.x, oy:p.y, x:p.x, y:p.y};
  cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
});
cv.addEventListener("pointermove", e => {
  const p = pt(e);
  if(e.pointerType === "mouse"){ mouse = p; mouseT = 2; return; }
  const s = sticks[e.pointerId]; if(s){ s.x = p.x; s.y = p.y; }
});
function endStick(e){ delete sticks[e.pointerId]; }
cv.addEventListener("pointerup", endStick);
cv.addEventListener("pointercancel", endStick);
function stickVec(side){
  for(const id in sticks){
    const s = sticks[id]; if(s.side !== side) continue;
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), max = U * 2;
    if(d < 6) return side === "move" ? {x:0, y:0, on:true} : null;
    const m = Math.min(1, d / max);
    return {x:dx / d * m, y:dy / d * m, on:true, a:Math.atan2(dy, dx)};
  }
  return null;
}

// ===== Som =====
let ac = null;
function sfx(kind){
  if(muted) return;
  try{
    if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    const S = {shot:["square",1000,600,0.04,0.018], hit:["square",320,240,0.04,0.03], boom:["sawtooth",240,70,0.2,0.06],
               hurt:["sawtooth",200,60,0.35,0.1], pick:["sine",800,1500,0.12,0.06], wave:["triangle",440,990,0.4,0.08]}[kind];
    if(!S) return;
    o.type = S[0]; o.frequency.setValueAtTime(S[1], t); o.frequency.exponentialRampToValueAtTime(S[2], t + S[3]);
    g.gain.setValueAtTime(S[4], t); g.gain.exponentialRampToValueAtTime(0.0001, t + S[3]);
    o.start(t); o.stop(t + S[3] + 0.02);
  }catch(e){}
}
function setMuteUI(){ $("btnSound").textContent = muted ? "🔇" : "🔊"; $("btnSound").setAttribute("aria-label", muted ? "Som desligado" : "Som ligado"); }
$("btnSound").addEventListener("click", () => { muted = !muted; setMuteUI(); try{ localStorage.setItem("arena-robo-mute", muted ? "1" : "0"); }catch(e){} });

// ===== Melhorias =====
const UPGRADES = [
  {id:"shots", ic:"🔱", t:"Tiro extra", d:"Mais um tiro a cada disparo", ok:() => P.shots < 5, go:() => P.shots++},
  {id:"rate", ic:"⚡", t:"Tiro mais rápido", d:"Atira 20% mais rápido", ok:() => P.rate > 0.09, go:() => P.rate *= 0.8},
  {id:"speed", ic:"👟", t:"Mais velocidade", d:"Anda 15% mais rápido", ok:() => P.speed < 8, go:() => P.speed *= 1.15},
  {id:"heal", ic:"❤️", t:"Consertar robô", d:"Recupera toda a vida", ok:() => P.hp < P.maxHp, go:() => P.hp = P.maxHp},
  {id:"maxhp", ic:"🛡️", t:"Blindagem", d:"+1 de vida máxima (e cura 1)", ok:() => P.maxHp < 8, go:() => { P.maxHp++; P.hp = Math.min(P.maxHp, P.hp + 1); }},
  {id:"pierce", ic:"🎯", t:"Tiro perfurante", d:"O tiro atravessa mais um inimigo", ok:() => P.pierce < 3, go:() => P.pierce++},
  {id:"dmg", ic:"💥", t:"Dano dobrado", d:"Cada tiro tira mais vida", ok:() => P.dmg < 3, go:() => P.dmg++},
  {id:"mag", ic:"🧲", t:"Ímã de chips", d:"Puxa os chips de longe", ok:() => P.mag < 2, go:() => P.mag++},
];
function showUpgrades(){
  state = "up";
  const opts = UPGRADES.filter(u => u.ok()).sort(() => Math.random() - 0.5).slice(0, 3);
  $("upTag").textContent = "Onda " + wave + " concluída · +" + (wave * 50) + " pontos";
  const box = $("ups"); box.innerHTML = "";
  for(const u of opts){
    const b = document.createElement("button"); b.type = "button"; b.className = "up";
    b.innerHTML = '<span class="ic" aria-hidden="true">' + u.ic + '</span><span><b>' + u.t + '</b><span>' + u.d + '</span></span>';
    b.addEventListener("click", () => { u.go(); $("upScreen").hidden = true; for(const k in sticks) delete sticks[k]; state = "play"; last = performance.now(); nextWave(); sfx("wave"); });
    box.appendChild(b);
  }
  $("upScreen").hidden = false;
  const first = box.querySelector("button"); if(first) first.focus({preventScroll:true});
}

// ===== Fluxo =====
function start(){
  reset(); state = "play"; sfx("wave");
  ["startScreen", "overScreen", "pauseScreen", "upScreen"].forEach(id => $(id).hidden = true); $("hud").hidden = false;
  last = performance.now();
  if(ac && ac.state === "suspended") ac.resume();
}
function togglePause(){
  if(state === "play"){ state = "pause"; $("pauseScreen").hidden = false; }
  else if(state === "pause"){ state = "play"; $("pauseScreen").hidden = true; last = performance.now(); }
}
function gameOver(){
  state = "over"; sfx("hurt"); shake = 0.4;
  for(const k in sticks) delete sticks[k];
  const rec = score > best;
  if(rec){ best = score; try{ localStorage.setItem("arena-robo-best", String(best)); }catch(e){} }
  setTimeout(() => {
    $("overTitle").textContent = rec ? "Novo recorde!" : pick(["Robô desligado!", "Bateria zerada!", "Servidor caiu!"]);
    $("overTag").textContent = rec ? "Parabéns" : "Fim de jogo";
    $("overScore").textContent = score.toLocaleString("pt-BR");
    $("overWave").textContent = wave;
    $("overKills").textContent = kills;
    $("overBest").textContent = "Recorde: " + best.toLocaleString("pt-BR");
    $("overScreen").hidden = false;
    $("btnAgain").focus({preventScroll:true});
  }, 800);
}
$("btnPlay").addEventListener("click", start);
$("btnAgain").addEventListener("click", start);
$("btnPause").addEventListener("click", togglePause);
$("btnResume").addEventListener("click", togglePause);
document.addEventListener("visibilitychange", () => { if(document.hidden && state === "play") togglePause(); });

function burst(x, y, color, n, sp){ n = Math.round(n * FX()); if(parts.length > 260) return; for(let i = 0; i < n; i++){ const a = Math.random() * 6.28, v = rnd(30, sp || 220); parts.push({x, y, vx:Math.cos(a) * v, vy:Math.sin(a) * v, life:rnd(0.25, 0.6), color, s:rnd(2, 4)}); } }

// ===== Atualização =====
function update(dt){
  time += dt;
  if(P.inv > 0) P.inv -= dt;
  if(flashRed > 0) flashRed -= dt;
  if(mouseT > 0) mouseT -= dt;

  // movimento
  let mx = 0, my = 0;
  if(keys["a"] || keys["arrowleft"]) mx -= 1;
  if(keys["d"] || keys["arrowright"]) mx += 1;
  if(keys["w"] || keys["arrowup"]) my -= 1;
  if(keys["s"] || keys["arrowdown"]) my += 1;
  if(mx || my){ const d = Math.hypot(mx, my); mx /= d; my /= d; }
  const mv = stickVec("move"); if(mv){ mx = mv.x; my = mv.y; }
  P.x = Math.max(U * P.r, Math.min(W - U * P.r, P.x + mx * P.speed * U * dt));
  P.y = Math.max(U * P.r, Math.min(H - U * P.r, P.y + my * P.speed * U * dt));

  // mira: dedo direito > mouse > inimigo mais perto
  const av = stickVec("aim");
  let target = null;
  if(av) P.aim = av.a;
  else if(mouse && mouseT > 0) P.aim = Math.atan2(mouse.y - P.y, mouse.x - P.x);
  else {
    let bd = Infinity;
    for(const e of enemies){ const d = Math.hypot(e.x - P.x, e.y - P.y); if(d < bd && e.x > 0 && e.x < W && e.y > 0 && e.y < H){ bd = d; target = e; } }
    if(target){ const want = Math.atan2(target.y - P.y, target.x - P.x); let diff = want - P.aim; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); P.aim += diff * Math.min(1, dt * 14); }
  }

  // tiro automático (só quando há inimigo na tela, ou mirando)
  fireT -= dt;
  const anyOn = enemies.some(e => e.x > -U && e.x < W + U && e.y > -U && e.y < H + U);
  if(fireT <= 0 && (anyOn || av)){
    fireT = P.rate;
    const spread = 0.14;
    for(let i = 0; i < P.shots; i++){
      const a = P.aim + (i - (P.shots - 1) / 2) * spread;
      bullets.push({x:P.x + Math.cos(a) * U * 0.55, y:P.y + Math.sin(a) * U * 0.55, vx:Math.cos(a) * U * 15, vy:Math.sin(a) * U * 15, life:1.2, pierce:P.pierce, hitSet:new Set()});
    }
    sfx("shot");
  }

  // ondas
  if(toSpawn > 0){
    spawnT -= dt;
    if(spawnT <= 0){ spawnEnemy(); toSpawn--; spawnT = Math.max(0.18, rnd(0.45, 0.9) - wave * 0.04); if(wave > 3 && Math.random() < 0.3 && toSpawn > 0){ spawnEnemy(); toSpawn--; } }
  }

  // inimigos
  for(const e of enemies){
    e.t += dt; if(e.hit > 0) e.hit -= dt;
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy) || 1;
    let vx = dx / d, vy = dy / d;
    if(e.kind === "worm"){ const z = Math.sin(e.t * 7) * 0.9; const nx = -vy, ny = vx; vx += nx * z; vy += ny * z; }
    if(e.kind === "hacker"){
      const want = U * 5.5;
      if(d < want){ vx = -vx; vy = -vy; }
      if(Math.abs(d - want) < U){ vx = -dy / d * 0.6; vy = dx / d * 0.6; }
      e.fire -= dt;
      if(e.fire <= 0){ e.fire = rnd(1.6, 2.6); const a = Math.atan2(dy, dx); eShots.push({x:e.x, y:e.y, vx:Math.cos(a) * U * 5, vy:Math.sin(a) * U * 5, life:4}); }
    }
    const l = Math.hypot(vx, vy) || 1;
    e.x += vx / l * e.sp * U * dt; e.y += vy / l * e.sp * U * dt;
    if(d < (e.r + P.r) * U) hurt();
  }
  // separação simples entre inimigos
  for(let i = 0; i < enemies.length; i++) for(let j = i + 1; j < enemies.length; j++){
    const a = enemies[i], b = enemies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = (a.r + b.r) * U * 0.9;
    if(d > 0 && d < min){ const push = (min - d) / 2 / d; a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push; }
  }

  // tiros
  for(const b of bullets){
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if(b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) b.life = 0;
    if(b.life <= 0) continue;
    for(const e of enemies){
      if(e.dead || b.hitSet.has(e)) continue;
      if(Math.hypot(e.x - b.x, e.y - b.y) < e.r * U + 3){
        b.hitSet.add(e); e.hp -= P.dmg; e.hit = 0.08; sfx("hit");
        burst(b.x, b.y, "#FFFFFF", 3, 100);
        if(e.hp <= 0) kill(e);
        if(b.pierce > 0) b.pierce--; else { b.life = 0; break; }
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);
  for(const s of eShots){
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    if(Math.hypot(s.x - P.x, s.y - P.y) < P.r * U + 4){ s.life = 0; hurt(); }
  }
  eShots = eShots.filter(s => s.life > 0);

  // chips
  for(const c of drops){
    const dx = P.x - c.x, dy = P.y - c.y, d = Math.hypot(dx, dy);
    const range = U * (1.2 + P.mag * 2.5);
    if(d < range){ c.x += dx / d * U * 9 * dt; c.y += dy / d * U * 9 * dt; }
    c.life -= dt;
    if(d < U * 0.6){ c.life = 0; sfx("pick"); if(c.kind === "heart"){ P.hp = Math.min(P.maxHp, P.hp + 1); texts.push({x:c.x, y:c.y, text:"+1 ❤", color:"#FF6B7D", life:0.8}); } else score += 5; }
  }
  drops = drops.filter(c => c.life > 0);
  enemies = enemies.filter(e => !e.dead);

  for(const p of parts){ p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for(const t of texts){ t.y -= (t.big ? 10 : 35) * dt; t.life -= dt; }
  texts = texts.filter(t => t.life > 0);

  if(!waveDone && toSpawn <= 0 && enemies.length === 0){
    waveDone = true; score += wave * 50; sfx("wave");
    setTimeout(() => { if(state === "play") showUpgrades(); }, 700);
  }
  hud();
}

function kill(e){
  e.dead = true; kills++; score += KIND[e.kind].pts; sfx("boom");
  const col = {bug:"#FF6B7D", virus:"#4BE37A", mini:"#4BE37A", worm:"#C084FC", hacker:"#4BE3A1"}[e.kind];
  burst(e.x, e.y, col, 14);
  if(e.kind === "virus"){ for(const s of [-1, 1]) addEnemy("mini", e.x + s * U * 0.4, e.y + s * U * 0.2); }
  if(Math.random() < 0.55) drops.push({x:e.x, y:e.y, kind:Math.random() < 0.04 ? "heart" : "chip", life:8});
}
function hurt(){
  if(P.inv > 0 || state !== "play") return;
  P.hp--; P.inv = 1.1; flashRed = 0.3; shake = 0.25; sfx("hurt"); buzz(70);
  burst(P.x, P.y, "#FF6B7D", 16, 260);
  if(P.hp <= 0) gameOver();
}
function hud(){
  $("hudScore").textContent = score.toLocaleString("pt-BR");
  $("hudWave").textContent = wave;
  $("hudLives").textContent = "❤".repeat(Math.max(0, P.hp)) + "♡".repeat(Math.max(0, P.maxHp - Math.max(0, P.hp)));
}

// ===== Desenho =====
function drawFloor(){
  ctx.fillStyle = "#0A1F57"; ctx.fillRect(0, 0, W, H);
  const s = U * 2;
  ctx.strokeStyle = "rgba(94,194,255,.09)"; ctx.lineWidth = 1; ctx.beginPath();
  for(let x = (W / 2) % s; x < W; x += s){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for(let y = (H / 2) % s; y < H; y += s){ ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // trilhas de circuito
  ctx.strokeStyle = "rgba(94,194,255,.16)"; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(0, H * 0.25); ctx.lineTo(W * 0.3, H * 0.25); ctx.lineTo(W * 0.38, H * 0.35);
  ctx.moveTo(W, H * 0.7); ctx.lineTo(W * 0.68, H * 0.7); ctx.lineTo(W * 0.6, H * 0.62);
  ctx.moveTo(W * 0.5, 0); ctx.lineTo(W * 0.5, H * 0.15);
  ctx.stroke();
  ctx.fillStyle = "rgba(94,194,255,.2)";
  for(const [x, y] of [[W * 0.38, H * 0.35], [W * 0.6, H * 0.62], [W * 0.5, H * 0.15]]){ ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }
  ctx.strokeStyle = "#5EC2FF"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
}

function drawEnemy(e){
  const r = e.r * U;
  ctx.save(); ctx.translate(e.x, e.y);
  const a = Math.atan2(P.y - e.y, P.x - e.x);
  if(e.hit > 0) ctx.globalAlpha = 0.6;
  if(e.kind === "bug"){
    ctx.rotate(a + Math.PI / 2);
    ctx.strokeStyle = "#B42335"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    const l = Math.sin(e.t * 18) * r * 0.25;
    for(const s of [-1, 1]) for(const dy of [-0.4, 0.1, 0.6]){ ctx.beginPath(); ctx.moveTo(s * r * 0.5, dy * r); ctx.lineTo(s * r * 1.1, dy * r + (dy === 0.1 ? l : -l)); ctx.stroke(); }
    ctx.fillStyle = "#FF6B7D"; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.65, r * 0.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#3A0710"; ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.55, r * 0.15, 0, 7); ctx.arc(r * 0.25, -r * 0.55, r * 0.15, 0, 7); ctx.fill();
  } else if(e.kind === "virus" || e.kind === "mini"){
    ctx.rotate(e.t);
    ctx.strokeStyle = "#1E8A45"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    for(let i = 0; i < 9; i++){ const b = i / 9 * 6.28; ctx.beginPath(); ctx.moveTo(Math.cos(b) * r * 0.75, Math.sin(b) * r * 0.75); ctx.lineTo(Math.cos(b) * r * 1.15, Math.sin(b) * r * 1.15); ctx.stroke(); }
    ctx.fillStyle = "#4BE37A"; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.fill();
    ctx.rotate(-e.t);
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.1, r * 0.2, 0, 7); ctx.arc(r * 0.28, -r * 0.1, r * 0.2, 0, 7); ctx.fill();
    ctx.fillStyle = "#0B3A1C"; ctx.beginPath(); ctx.arc(-r * 0.28 + Math.cos(a) * r * 0.08, -r * 0.1 + Math.sin(a) * r * 0.08, r * 0.1, 0, 7); ctx.arc(r * 0.28 + Math.cos(a) * r * 0.08, -r * 0.1 + Math.sin(a) * r * 0.08, r * 0.1, 0, 7); ctx.fill();
  } else if(e.kind === "worm"){
    ctx.rotate(a);
    for(let i = 3; i >= 0; i--){ ctx.fillStyle = i ? "#9F67E8" : "#C084FC"; ctx.beginPath(); ctx.arc(-i * r * 0.9, Math.sin(e.t * 10 - i) * r * 0.35, r * (1 - i * 0.12), 0, 7); ctx.fill(); }
    ctx.fillStyle = "#2E0E57"; ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.3, r * 0.15, 0, 7); ctx.arc(r * 0.35, r * 0.3, r * 0.15, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = "#22164A"; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#FF6B7D"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(75,227,161,.35)"; ctx.fillRect(-r * 0.52, -r * 0.22, r * 0.44, r * 0.32); ctx.fillRect(r * 0.08, -r * 0.22, r * 0.44, r * 0.32);
    ctx.fillStyle = "#4BE3A1"; ctx.fillRect(-r * 0.45, -r * 0.15, r * 0.3, r * 0.18); ctx.fillRect(r * 0.15, -r * 0.15, r * 0.3, r * 0.18);
  }
  ctx.restore();
}

function drawPlayer(){
  if(P.inv > 0 && Math.floor(P.inv * 14) % 2) return;
  const r = P.r * U;
  ctx.save(); ctx.translate(P.x, P.y);
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(3, 5, r * 1.05, r * 0.9, 0, 0, 7); ctx.fill();
  ctx.rotate(P.aim);
  // canhão
  ctx.fillStyle = "#CFE6FF"; ctx.fillRect(r * 0.3, -r * 0.22, r * 1.05, r * 0.44);
  ctx.fillStyle = "#5EC2FF"; ctx.fillRect(r * 1.15, -r * 0.26, r * 0.25, r * 0.52);
  // corpo
  ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.strokeStyle = "#5EC2FF"; ctx.lineWidth = r * 0.18; ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, 7); ctx.stroke();
  ctx.fillStyle = "#0A1F57"; ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.32, 0, 7); ctx.fill();
  ctx.fillStyle = "#5EC2FF"; ctx.beginPath(); ctx.arc(r * 0.33, 0, r * 0.12, 0, 7); ctx.fill();
  ctx.restore();
}

function drawSticks(){
  for(const id in sticks){
    const s = sticks[id], max = U * 2;
    let dx = s.x - s.ox, dy = s.y - s.oy; const d = Math.hypot(dx, dy); if(d > max){ dx = dx / d * max; dy = dy / d * max; }
    ctx.strokeStyle = s.side === "move" ? "rgba(94,194,255,.5)" : "rgba(255,107,125,.5)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, max, 0, 7); ctx.stroke();
    ctx.fillStyle = s.side === "move" ? "rgba(94,194,255,.45)" : "rgba(255,107,125,.45)";
    ctx.beginPath(); ctx.arc(s.ox + dx, s.oy + dy, U * 0.8, 0, 7); ctx.fill();
  }
}

function draw(){
  ctx.save();
  if(shake > 0) ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);
  drawFloor();
  if(P && enemies){
    for(const c of drops){
      if(c.kind === "heart"){ ctx.font = Math.round(U * 0.7) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("❤️", c.x, c.y); }
      else { ctx.fillStyle = "#FFC93C"; ctx.globalAlpha = c.life < 2 ? (Math.floor(c.life * 8) % 2 ? 0.4 : 1) : 1; ctx.fillRect(c.x - U * 0.15, c.y - U * 0.15, U * 0.3, U * 0.3); ctx.globalAlpha = 1; }
    }
    for(const e of enemies) drawEnemy(e);
    ctx.fillStyle = "#FFC93C";
    for(const b of bullets){ ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(3, U * 0.12), 0, 7); ctx.fill(); }
    for(const s of eShots){ ctx.fillStyle = "#FF6B7D"; ctx.beginPath(); ctx.arc(s.x, s.y, U * 0.18, 0, 7); ctx.fill(); ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(s.x, s.y, U * 0.07, 0, 7); ctx.fill(); }
    if(state !== "start") drawPlayer();
    for(const p of parts){ ctx.globalAlpha = Math.max(0, p.life * 1.8); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.s, p.s); }
    ctx.globalAlpha = 1;
    for(const t of texts){
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.font = "900 " + Math.round(t.big ? Math.min(W * 0.12, 64) : Math.max(15, U * 0.55)) + "px Archivo, Arial Black, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 6; ctx.strokeStyle = "#061541";
      ctx.strokeText(t.text, t.x, t.y); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    if(state === "play") drawSticks();
  }
  if(flashRed > 0){ ctx.fillStyle = "rgba(255,107,125," + flashRed.toFixed(2) + ")"; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.restore();
}

let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if(state === "play"){ update(dt); perfTick(dt); }
  else if(state === "over"){ for(const p of parts){ p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; } parts = parts.filter(p => p.life > 0); }
  if(shake > 0) shake = Math.max(0, shake - dt);
  if(state !== "pause" && state !== "up") draw();
}

setMuteUI();
$("bestStart").textContent = "Recorde: " + best.toLocaleString("pt-BR");
new ResizeObserver(resize).observe(stage);
resize();
reset();
requestAnimationFrame(loop);
})();
