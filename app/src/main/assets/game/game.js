/* ==========================================================
   BlixBloxCatz — a cozy cat-fruit match-3
   ========================================================== */

// ---------- Asset manifest ----------
const IMAGE_NAMES = [
  "background_cat","block_red_cat","block_blue_cat","block_green_cat",
  "block_yellow_cat","block_purple_cat","block_orange_cat",
  "mascot_happy","mascot_excited","mascot_shocked","mascot_cool","mascot_victory",
  "text_combo_x2","text_combo_x3","text_purrfect","text_meowza_blast",
  "explosion_cat","sparkle_particles","btn_remove_ads_cat","btn_buy_lives_cat",
  "btn_play_cat","heart_cat","star_cat","paw_icon","icon_512_cat","loading_cat"
];
const SOUND_IDS = [
  "sndBgm","sndPop","sndClear","sndSwipe","sndClick",
  "sndError","sndExplosion","sndMeowHappy","sndMeowAmazed","sndYowlEpic"
];

const BLOCK_TYPES = [
  "block_red_cat","block_blue_cat","block_green_cat",
  "block_yellow_cat","block_purple_cat","block_orange_cat"
];

const images = {};
let assetsTotal = IMAGE_NAMES.length + SOUND_IDS.length;
let assetsLoaded = 0;
let muted = false;

function bumpLoad(){
  assetsLoaded++;
  const pct = Math.round((assetsLoaded/assetsTotal)*100);
  const fillEl = document.getElementById('loadBarFill');
  const labelEl = document.getElementById('loadLabel');
  if(fillEl) fillEl.style.width = pct + "%";
  if(labelEl) labelEl.textContent = "Loading… " + pct + "%";
  if(assetsLoaded >= assetsTotal){
    setTimeout(onAssetsReady, 250);
  }
}

function preload(){
  IMAGE_NAMES.forEach(name=>{
    const img = new Image();
    let done = false;
    const fin = (ok)=>{
      if(done) return;
      done = true;
      if(!ok) console.warn("[assets] image failed/timed out:", "images/"+name+".png");
      bumpLoad();
    };
    img.onload = ()=>fin(true);
    img.onerror = ()=>fin(false);
    img.src = "images/" + name + ".png";
    images[name] = img;
    // Fallback in case neither load nor error fires (seen on some strict
    // local file:// security modes) — never let one asset hang the whole game.
    setTimeout(()=>fin(false), 5000);
  });
  SOUND_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(!el){ bumpLoad(); return; }
    let done = false;
    const fin = (ok)=>{
      if(done) return;
      done = true;
      if(!ok) console.warn("[assets] sound failed/timed out:", id, el.currentSrc || el.src);
      bumpLoad();
    };
    el.addEventListener('canplaythrough', ()=>fin(true), {once:true});
    el.addEventListener('error', ()=>fin(false), {once:true});
    el.load();
    // Fallback in case canplaythrough never fires (some mobile browsers)
    setTimeout(()=>fin(false), 5000);
  });
  // little loading-cat sprite reuses the mascot happy image, cropped via CSS wrap
  const lc = document.getElementById('loadCatWrap');
  if(lc){
    const im = document.createElement('img');
    im.src = "images/mascot_excited.png";
    lc.appendChild(im);
  }
}

let assetsReadyFired = false;
function onAssetsReady(){
  if(assetsReadyFired) return;
  assetsReadyFired = true;
  showScreen('menuScreen');
}
// Absolute last-resort safety net: never leave the player stuck on the
// loading screen even if some asset never fires load/error/timeout.
setTimeout(()=>{
  if(!assetsReadyFired){
    console.warn("[assets] forcing menu after global 12s failsafe — some asset never resolved");
    onAssetsReady();
  }
}, 12000);

// ---------- Screen management ----------
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ---------- Sound helpers ----------
function playSound(id, opts){
  if(muted) return;
  const el = document.getElementById(id);
  if(!el) return;
  try{
    const node = el.cloneNode(true);
    node.volume = (opts && opts.volume) || 1;
    node.play().catch(()=>{});
  }catch(e){}
}
function toggleMute(){
  muted = !muted;
  document.getElementById('muteToggle').textContent = muted ? "🔇" : "🔊";
  const bgm = document.getElementById('sndBgm');
  if(muted){ bgm.pause(); } else { bgm.play().catch(()=>{}); }
}
function startBgm(){
  const bgm = document.getElementById('sndBgm');
  bgm.volume = 0.55;
  if(!muted) bgm.play().catch(()=>{});
}

// ==========================================================
//  GAME STATE
// ==========================================================
const ROWS = 8, COLS = 7;
let CELL = 44; // recalculated on layout
let grid = [];         // grid[r][c] = type index or -1
let removing = new Set(); // "r,c" keys currently mid-removal animation
let overrideSprites = []; // temporary sprites drawn instead of grid during anim {x,y,type,scale,alpha}
let boardState = 'idle'; // idle | busy
let selected = null;     // {r,c}
let dragStart = null;

let level = 1;

// Browser/itch.io build: no lives or in-app purchases.
window.BlixBlox = {
  showInterstitial(){ /* intentionally disabled: banner-only monetization */ },
  setAdsRemoved(){ /* no-op */ }
};

let score = 0;
let target = 300;
let movesLeft = 20;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

function levelConfig(n){
  return {
    target: 300 + (n-1)*150,
    moves: 20 + Math.min(6, Math.floor((n-1)/2))
  };
}

function setupLevel(n){
  const cfg = levelConfig(n);
  level = n;
  target = cfg.target;
  movesLeft = cfg.moves;
  score = 0;
  updateHud();
  buildBoard();
}

function updateHud(){
  document.getElementById('scoreVal').textContent = score;
  document.getElementById('levelVal').textContent = level;
  document.getElementById('movesVal').textContent = Math.max(0, movesLeft);
  const pct = Math.max(0, Math.min(100, Math.round((score/target)*100)));
  document.getElementById('targetBarFill').style.width = pct + "%";
  document.getElementById('targetLabelText').textContent = score + " / " + target;
}

// ---------- Board construction ----------
function randType(){ return Math.floor(Math.random()*BLOCK_TYPES.length); }

function buildBoard(){
  layoutCanvas();
  do{
    grid = [];
    for(let r=0;r<ROWS;r++){
      const row = [];
      for(let c=0;c<COLS;c++){
        let t;
        let tries=0;
        do{
          t = randType();
          tries++;
        } while(tries<20 && wouldMatchAt(row, r, c, t));
        row.push(t);
      }
      grid.push(row);
    }
  } while(findMatches(grid).cells.size>0 || !hasPossibleMove());
  render();
}
// helper used only during initial fill (row being built left-to-right; grid rows above already final)
function wouldMatchAt(rowSoFar, r, c, t){
  if(c>=2 && rowSoFar[c-1]===t && rowSoFar[c-2]===t) return true;
  if(r>=2 && grid[r-1] && grid[r-2] && grid[r-1][c]===t && grid[r-2][c]===t) return true;
  return false;
}

function layoutCanvas(){
  const wrap = document.getElementById('boardWrap');
  const maxW = Math.min(wrap.clientWidth - 20, 480);
  const maxH = wrap.clientHeight - 20;
  CELL = Math.floor(Math.min(maxW/COLS, maxH/ROWS));
  CELL = Math.max(30, Math.min(60, CELL));
  canvas.width = CELL*COLS;
  canvas.height = CELL*ROWS;
  canvas.style.width = canvas.width + "px";
  canvas.style.height = canvas.height + "px";
}

// ---------- Match detection ----------
function findMatches(g){
  const cells = new Set();
  const runs = [];
  // horizontal
  for(let r=0;r<ROWS;r++){
    let c=0;
    while(c<COLS){
      const t = g[r][c];
      if(t<0){ c++; continue; }
      let c2=c;
      while(c2+1<COLS && g[r][c2+1]===t) c2++;
      const len = c2-c+1;
      if(len>=3){
        const run=[];
        for(let cc=c; cc<=c2; cc++){ cells.add(r+","+cc); run.push([r,cc]); }
        runs.push(run);
      }
      c = c2+1;
    }
  }
  // vertical
  for(let c=0;c<COLS;c++){
    let r=0;
    while(r<ROWS){
      const t = g[r][c];
      if(t<0){ r++; continue; }
      let r2=r;
      while(r2+1<ROWS && g[r2+1][c]===t) r2++;
      const len = r2-r+1;
      if(len>=3){
        const run=[];
        for(let rr=r; rr<=r2; rr++){ cells.add(rr+","+c); run.push([rr,c]); }
        runs.push(run);
      }
      r = r2+1;
    }
  }
  return {cells, runs};
}

function hasPossibleMove(){
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      if(c+1<COLS){
        swapCells(grid,r,c,r,c+1);
        const m = findMatches(grid).cells.size>0;
        swapCells(grid,r,c,r,c+1);
        if(m) return true;
      }
      if(r+1<ROWS){
        swapCells(grid,r,c,r+1,c);
        const m = findMatches(grid).cells.size>0;
        swapCells(grid,r,c,r+1,c);
        if(m) return true;
      }
    }
  }
  return false;
}
function swapCells(g,r1,c1,r2,c2){
  const tmp = g[r1][c1]; g[r1][c1]=g[r2][c2]; g[r2][c2]=tmp;
}

// ---------- Rendering ----------
function cellPx(r,c){ return { x: c*CELL, y: r*CELL }; }

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // grid backdrop cells
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const p = cellPx(r,c);
      ctx.fillStyle = ((r+c)%2===0) ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
      roundRect(ctx, p.x+2, p.y+2, CELL-4, CELL-4, 8);
      ctx.fill();
    }
  }
  // tiles
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const key = r+","+c;
      if(removing.has(key)) continue;
      const t = grid[r][c];
      if(t==null || t<0) continue;
      drawTile(r,c,t,1,1);
      if(selected && selected.r===r && selected.c===c){
        const p = cellPx(r,c);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3;
        roundRect(ctx, p.x+3, p.y+3, CELL-6, CELL-6, 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  // override sprites (swap/fall/remove animations)
  overrideSprites.forEach(s=>{
    drawTileAtPixel(s.x, s.y, s.type, s.scale||1, s.alpha==null?1:s.alpha);
  });
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawTile(r,c,type,scale,alpha){
  const p = cellPx(r,c);
  drawTileAtPixel(p.x, p.y, type, scale, alpha);
}
function drawTileAtPixel(x,y,type,scale,alpha){
  const img = images[BLOCK_TYPES[type]];
  if(!img) return;
  const pad = CELL*0.08;
  const size = (CELL - pad*2) * (scale||1);
  const cx = x + CELL/2, cy = y + CELL/2;
  ctx.save();
  ctx.globalAlpha = alpha==null?1:alpha;
  ctx.drawImage(img, cx-size/2, cy-size/2, size, size);
  ctx.restore();
}

// ==========================================================
//  ANIMATION HELPERS
// ==========================================================
function tween(duration, onUpdate){
  return new Promise(resolve=>{
    const start = performance.now();
    function step(now){
      let t = Math.min(1, (now-start)/duration);
      onUpdate(t);
      render();
      if(t<1){ requestAnimationFrame(step); } else { resolve(); }
    }
    requestAnimationFrame(step);
  });
}
function easeOutQuad(t){ return 1-(1-t)*(1-t); }
function easeOutBack(t){ const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); }

// ---------- swap animation ----------
async function animateSwapVisual(r1,c1,r2,c2){
  const p1 = cellPx(r1,c1), p2 = cellPx(r2,c2);
  const t1 = grid[r1][c1], t2 = grid[r2][c2];
  overrideSprites = [
    {x:p1.x,y:p1.y,type:t1},
    {x:p2.x,y:p2.y,type:t2}
  ];
  grid[r1][c1] = -99; grid[r2][c2] = -99; // hide originals while animating
  await tween(160, t=>{
    const e = easeOutQuad(t);
    overrideSprites[0].x = p1.x + (p2.x-p1.x)*e;
    overrideSprites[0].y = p1.y + (p2.y-p1.y)*e;
    overrideSprites[1].x = p2.x + (p1.x-p2.x)*e;
    overrideSprites[1].y = p2.y + (p1.y-p2.y)*e;
  });
  grid[r1][c1] = t2; grid[r2][c2] = t1;
  overrideSprites = [];
  render();
}

// ---------- removal animation ----------
async function animateRemoval(cellsSet){
  const list = Array.from(cellsSet).map(k=>{
    const [r,c] = k.split(',').map(Number);
    return {r,c,type:grid[r][c]};
  });
  list.forEach(o=> removing.add(o.r+","+o.c));
  overrideSprites = list.map(o=>{
    const p = cellPx(o.r,o.c);
    return {x:p.x,y:p.y,type:o.type,scale:1,alpha:1};
  });
  await tween(220, t=>{
    overrideSprites.forEach(s=>{
      s.scale = 1 - easeOutQuad(t);
      s.alpha = 1 - t;
    });
  });
  list.forEach(o=>{ grid[o.r][o.c] = -1; removing.delete(o.r+","+o.c); });
  overrideSprites = [];
  render();
}

// ---------- gravity / refill animation ----------
async function animateGravityClean(){
  const moves = [];
  const newGrid = [];
  for(let r=0;r<ROWS;r++) newGrid.push(new Array(COLS).fill(-1));

  for(let c=0;c<COLS;c++){
    const colVals = [];
    for(let r=0;r<ROWS;r++){ if(grid[r][c]>=0) colVals.push({type:grid[r][c], fromRow:r}); }
    const missing = ROWS - colVals.length;
    for(let k=0;k<colVals.length;k++){
      const toRow = missing+k;
      newGrid[toRow][c] = colVals[k].type;
      moves.push({col:c, toRow, type:colVals[k].type, fromRow:colVals[k].fromRow});
    }
    for(let i=0;i<missing;i++){
      const toRow = i;
      const type = randType();
      newGrid[toRow][c] = type;
      moves.push({col:c, toRow, type, fromRow: -(missing-i)});
    }
  }

  overrideSprites = moves.map(m=>{
    const toP = cellPx(m.toRow, m.col);
    const fromP = cellPx(m.fromRow, m.col);
    return {x:toP.x, y:fromP.y, sx:toP.x, sy:fromP.y, tx:toP.x, ty:toP.y, type:m.type};
  });

  grid = grid.map(row=>row.map(()=> -1));
  render();

  const maxDist = Math.max(1, ...overrideSprites.map(s=>Math.abs(s.ty-s.sy)));
  const duration = Math.min(520, 200 + maxDist*0.85);

  await tween(duration, t=>{
    const e = easeOutQuad(t);
    overrideSprites.forEach(s=>{
      s.y = s.sy + (s.ty - s.sy)*e;
    });
  });

  grid = newGrid;
  overrideSprites = [];
  render();
}

// ==========================================================
//  FX: combo popups, floating score, sparkles, mascot
// ==========================================================
const mascotImgEl = document.getElementById('mascotCorner');
function setMascot(name, bounce){
  mascotImgEl.src = "images/" + name + ".png";
  if(bounce){
    mascotImgEl.style.transform = "scale(1.18) rotate(-4deg)";
    setTimeout(()=>{ mascotImgEl.style.transform = "scale(1) rotate(0deg)"; }, 260);
  }
}

function boardPixelToPage(x,y){
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

function spawnFloatScore(px, py, amount){
  const layer = document.getElementById('fxLayer');
  const wrapRect = document.getElementById('boardWrap').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floatScore';
  el.textContent = "+" + amount;
  el.style.left = (px - wrapRect.left) + "px";
  el.style.top = (py - wrapRect.top) + "px";
  layer.appendChild(el);
  setTimeout(()=> el.remove(), 900);
}

function spawnSparkles(px, py, count){
  const layer = document.getElementById('fxLayer');
  const wrapRect = document.getElementById('boardWrap').getBoundingClientRect();
  for(let i=0;i<count;i++){
    const el = document.createElement('img');
    el.src = "images/sparkle_particles.png";
    el.style.position = 'absolute';
    el.style.width = (18+Math.random()*14)+'px';
    el.style.left = (px - wrapRect.left) + "px";
    el.style.top = (py - wrapRect.top) + "px";
    el.style.opacity = '1';
    el.style.pointerEvents='none';
    el.style.transition = 'transform .6s ease-out, opacity .6s ease-out';
    layer.appendChild(el);
    const ang = Math.random()*Math.PI*2;
    const dist = 20+Math.random()*40;
    requestAnimationFrame(()=>{
      el.style.transform = `translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px) rotate(${Math.random()*180}deg) scale(0.3)`;
      el.style.opacity = '0';
    });
    setTimeout(()=> el.remove(), 650);
  }
}

function spawnExplosion(px, py){
  const layer = document.getElementById('fxLayer');
  const wrapRect = document.getElementById('boardWrap').getBoundingClientRect();
  const el = document.createElement('img');
  el.src = "images/explosion_cat.png";
  el.style.position='absolute';
  el.style.width='90px';
  el.style.left = (px - wrapRect.left - 45) + "px";
  el.style.top = (py - wrapRect.top - 45) + "px";
  el.style.opacity='0.95';
  el.style.transform='scale(0.3)';
  el.style.transition='transform .4s cubic-bezier(.2,1.6,.4,1), opacity .5s ease .15s';
  el.style.pointerEvents='none';
  layer.appendChild(el);
  requestAnimationFrame(()=>{ el.style.transform='scale(1.3)'; });
  setTimeout(()=>{ el.style.opacity='0'; }, 250);
  setTimeout(()=> el.remove(), 700);
}

function spawnComboPopup(imgName){
  const layer = document.getElementById('fxLayer');
  const el = document.createElement('img');
  el.src = "images/" + imgName + ".png";
  el.className = 'comboPop';
  layer.appendChild(el);
  setTimeout(()=> el.remove(), 950);
}

// ==========================================================
//  CORE RESOLUTION LOOP
// ==========================================================
async function resolveOnce(cascadeLevel){
  const {cells, runs} = findMatches(grid);
  if(cells.size===0) return false;

  let maxRun = 0;
  runs.forEach(run=>{ maxRun = Math.max(maxRun, run.length); });

  // scoring
  let gained = 0;
  cells.forEach(()=>{ gained += 10 * cascadeLevel; });
  if(maxRun===4) gained += 40;
  if(maxRun>=5) gained += 100;
  score += gained;

  // floating score + sparkles at centroid
  let sx=0, sy=0, n=0;
  cells.forEach(k=>{
    const [r,c] = k.split(',').map(Number);
    const p = cellPx(r,c);
    const page = boardPixelToPage(p.x+CELL/2, p.y+CELL/2);
    sx += page.x; sy += page.y; n++;
    if(Math.random()<0.5) spawnSparkles(page.x, page.y, 3);
  });
  sx/=n; sy/=n;
  spawnFloatScore(sx, sy, gained);
  updateHud();

  // sound + combo popup + mascot based on cascade/run size
  if(maxRun>=5){
    playSound('sndExplosion');
    spawnExplosion(sx,sy);
    spawnComboPopup('text_meowza_blast');
    playSound('sndYowlEpic');
    setMascot('mascot_victory', true);
  } else if(cascadeLevel>=4){
    spawnComboPopup('text_meowza_blast');
    playSound('sndYowlEpic');
    setMascot('mascot_victory', true);
  } else if(cascadeLevel===3){
    spawnComboPopup('text_combo_x3');
    playSound('sndMeowAmazed');
    setMascot('mascot_cool', true);
  } else if(cascadeLevel===2){
    spawnComboPopup('text_combo_x2');
    playSound('sndMeowHappy');
    setMascot('mascot_excited', true);
  } else {
    playSound(maxRun>=4 ? 'sndClear' : 'sndPop');
    setMascot('mascot_happy', false);
  }

  await animateRemoval(cells);
  await animateGravityClean();
  return true;
}

async function resolveAll(){
  let cascadeLevel = 1;
  while(await resolveOnce(cascadeLevel)){
    cascadeLevel++;
    await new Promise(r=>setTimeout(r,60));
  }
}

// ==========================================================
//  INPUT HANDLING
// ==========================================================
function cellFromEvent(evt){
  const rect = canvas.getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const c = Math.floor(x/CELL);
  const r = Math.floor(y/CELL);
  if(r<0||r>=ROWS||c<0||c>=COLS) return null;
  return {r,c};
}

function isAdjacent(a,b){
  const dr = Math.abs(a.r-b.r), dc = Math.abs(a.c-b.c);
  return (dr+dc)===1;
}

async function attemptMove(a,b){
  if(boardState!=='idle') return;
  if(!isAdjacent(a,b)) { selected=b; render(); return; }
  boardState='busy';
  selected=null;
  playSound('sndSwipe');
  await animateSwapVisual(a.r,a.c,b.r,b.c);
  const hasMatch = findMatches(grid).cells.size>0;
  if(!hasMatch){
    await new Promise(r=>setTimeout(r,60));
    await animateSwapVisual(a.r,a.c,b.r,b.c); // swap back
    boardState='idle';
    return;
  }
  movesLeft--;
  updateHud();
  await resolveAll();
  boardState='idle';
  checkLevelEnd();
}

canvas.addEventListener('pointerdown', e=>{
  if(boardState!=='idle') return;
  const cell = cellFromEvent(e);
  if(!cell) return;
  dragStart = cell;
  if(selected && isAdjacent(selected, cell)){
    const a = selected; selected=null;
    attemptMove(a, cell);
  } else {
    selected = cell;
    render();
  }
});
canvas.addEventListener('pointermove', e=>{
  if(!dragStart || boardState!=='idle') return;
  const cell = cellFromEvent(e);
  if(!cell) return;
  if((cell.r!==dragStart.r || cell.c!==dragStart.c) && isAdjacent(dragStart,cell)){
    const a = dragStart; dragStart=null; selected=null;
    attemptMove(a, cell);
  }
});
window.addEventListener('pointerup', ()=>{ dragStart=null; });

// ==========================================================
//  LEVEL FLOW / MODALS
// ==========================================================
function checkLevelEnd(){
  if(score>=target){
    winLevel();
  } else if(movesLeft<=0){
    loseLevel();
  }
}

function starsForScore(){
  const ratio = score/target;
  if(ratio>=1.6) return 3;
  if(ratio>=1.25) return 2;
  return 1;
}

function openModal(){ document.getElementById('modalOverlay').classList.add('show'); }
function closeModal(){ document.getElementById('modalOverlay').classList.remove('show'); }

function winLevel(){
  playSound('sndYowlEpic');
  const stars = starsForScore();
  document.getElementById('modalMascot').src = 'images/mascot_victory.png';
  document.getElementById('modalBanner').src = 'images/text_purrfect.png';
  document.getElementById('modalScoreText').textContent = `Level ${level} complete — Score: ${score}`;
  [1,2,3].forEach(i=>{
    document.getElementById('star'+i).classList.toggle('lit', i<=stars);
  });
  document.getElementById('modalBtn').src = 'images/btn_play_cat.png';
  document.getElementById('modalBtn').onclick = ()=>{
    playSound('sndClick');
    closeModal();
    setupLevel(level+1);
  };
  document.getElementById('modalSecondary').onclick = ()=>{
    playSound('sndClick');
    closeModal();
    showScreen('menuScreen');
  };
  openModal();
}

function loseLevel(){
  playSound('sndError');
  document.getElementById('modalMascot').src = 'images/mascot_shocked.png';
  document.getElementById('modalBanner').style.visibility = 'hidden';
  document.getElementById('modalStars').style.display = 'none';
  document.getElementById('modalScoreText').textContent = `So close! Score: ${score} / ${target}`;
  document.getElementById('modalBtn').src = 'images/btn_play_cat.png';
  document.getElementById('modalBtn').onclick = ()=>{
    playSound('sndClick');
    closeModal();
    setupLevel(level);
    document.getElementById('modalBanner').style.visibility='visible';
    document.getElementById('modalStars').style.display='flex';
  };
  document.getElementById('modalSecondary').onclick = ()=>{
    playSound('sndClick');
    closeModal();
    document.getElementById('modalBanner').style.visibility='visible';
    document.getElementById('modalStars').style.display='flex';
    showScreen('menuScreen');
  };
  openModal();
}

// ==========================================================
//  WIRE UP UI
// ==========================================================
document.getElementById('muteToggle').addEventListener('click', toggleMute);

document.getElementById('supportBtn').addEventListener('click', ()=>{
  playSound('sndClick');
  document.getElementById('donationOverlay').classList.add('show');
});
document.getElementById('donationClose').addEventListener('click', ()=>{
  playSound('sndClick');
  document.getElementById('donationOverlay').classList.remove('show');
});
document.getElementById('donationOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'donationOverlay'){
    document.getElementById('donationOverlay').classList.remove('show');
  }
});

document.getElementById('playBtn').addEventListener('click', ()=>{
  playSound('sndClick');
  startBgm();
  showScreen('gameScreen');
  setupLevel(1);
});
document.getElementById('backBtn').addEventListener('click', ()=>{
  playSound('sndClick');
  showScreen('menuScreen');
});

window.addEventListener('resize', ()=>{
  if(!document.getElementById('gameScreen').classList.contains('hidden')){
    layoutCanvas();
    render();
  }
});

preload();
