const KEY = "LEXA_DATA_V4_CUTE";

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const round2 = (n) => Math.round(n*100)/100;
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pad2 = (n)=> String(n).padStart(2,"0");
const formatHMS = (sec)=>{
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};
const isoDate = (d=new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const toSemesterKeyNow = ()=>{
  const d = new Date();
  const y = d.getFullYear();
  const s = (d.getMonth() <= 5) ? 1 : 2;
  return `${y}-${s}`;
};

function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now();
}

function loadData(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}
function saveData(data){
  localStorage.setItem(KEY, JSON.stringify(data));
}
function wipeAll(){ localStorage.removeItem(KEY); }

function defaultData(){
  const sem = toSemesterKeyNow();
  return {
    activeSemester: sem,
    semestres: {
      [sem]: { ramos:{}, evaluaciones:[] } // evaluaciones: {id,date,ramo,tipo}
    },
    studySessions: [], // {id,date,ramo,minutes}
    weeklyTargets: {}  // { "Penal": 4, ... } hours per week
  };
}

let data = loadData() || defaultData();
if(!data.semestres) data = defaultData();
if(!data.studySessions) data.studySessions = [];
if(!data.weeklyTargets) data.weeklyTargets = {};

// DOM
const views = {
  dashboard: $("#view-dashboard"),
  calculator: $("#view-calculator"),
  planner: $("#view-planner"),
  history: $("#view-history"),
};

const semesterSelect = $("#semesterSelect");
const newSemesterBtn = $("#newSemesterBtn");
const resetBtn = $("#resetBtn");
const exportBtn = $("#exportBtn");
const importInput = $("#importInput");
const navBtns = $$(".nav-btn");

function ensureSemester(key){
  if(!data.semestres[key]){
    data.semestres[key] = { ramos:{}, evaluaciones:[] };
  }
}
function listSemesters(){
  return Object.keys(data.semestres).sort((a,b)=> b.localeCompare(a));
}
function hoursFromMinutes(mins){
  return `${round2(mins/60)} h`;
}
function daysUntil(iso){
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = new Date(iso + "T00:00:00");
  return Math.round((d - today) / (1000*60*60*24));
}

function calcRamoStatus(r){
  const notas = r.notas || [];
  const porcentajeHecho = notas.reduce((a,n)=> a + n.porcentaje, 0);
  const acumulado = notas.reduce((a,n)=> a + (n.nota * (n.porcentaje/100)), 0);
  const restante = 100 - porcentajeHecho;

  let notaFinal = (porcentajeHecho===100) ? acumulado : null;
  let notaNecesaria = null;
  let mensaje = "";
  let riesgo = false;

  if(porcentajeHecho===100){
    if(acumulado>=4.0) mensaje = `Aprobado ✅ (${round2(acumulado)})`;
    else { mensaje = `Reprobado ⚠️ (${round2(acumulado)})`; riesgo = true; }
  } else if (porcentajeHecho > 0) {
    const denom = (restante/100);
    notaNecesaria = (4.0 - acumulado) / denom;

    if(acumulado>=4.0) mensaje = "Vas sobre 4.0 en lo acumulado 💜";
    if(notaNecesaria>7.0){ riesgo=true; mensaje="Riesgo: necesitarías más de 7.0 ⚠️"; }
    else if(notaNecesaria<=1.0){ mensaje="Muy asegurado: incluso con 1.0 llegas a 4.0 ✅"; }
  } else {
    mensaje = "Agrega tu primera nota para calcular la necesaria ✨";
  }

  return {
    porcentajeHecho,
    acumulado: round2(acumulado),
    restante,
    notaFinal: notaFinal==null ? null : round2(notaFinal),
    notaNecesaria: notaNecesaria==null ? null : round2(notaNecesaria),
    mensaje,
    riesgo
  };
}

function calcSemesterAvg(semKey){
  const sem = data.semestres[semKey];
  const entries = Object.entries(sem?.ramos || {});
  let sum=0, count=0;
  for(const [,r] of entries){
    const st = calcRamoStatus(r);
    if(st.porcentajeHecho>0){
      sum += st.acumulado;
      count++;
    }
  }
  return count ? round2(sum/count) : null;
}

function totalMinutesSemester(semKey){
  const sem = data.semestres[semKey];
  const entries = Object.values(sem?.ramos || {});
  return entries.reduce((a,r)=> a+(r.horasEstudiadas||0),0);
}

function showView(name){
  Object.keys(views).forEach(k=>{
    views[k].classList.toggle("hidden", k!==name);
  });
  navBtns.forEach(b=> b.classList.toggle("active", b.dataset.view===name));
}

/******** TIMER ********/
let timer = { running:false, ramo:null, startedAt:null, elapsedSec:0, tickId:null };

function startTimer(ramo){
  if(timer.running) return;
  timer.ramo = ramo;
  timer.running = true;
  timer.startedAt = Date.now() - (timer.elapsedSec*1000);
  timer.tickId = setInterval(()=>{
    timer.elapsedSec = Math.floor((Date.now()-timer.startedAt)/1000);
    updateClockUI();
  }, 250);
}

function stopAndCommit(semKey){
  timer.running = false;
  clearInterval(timer.tickId);
  timer.tickId = null;

  const minutes = Math.max(0, Math.round(timer.elapsedSec/60));
  if(minutes>0 && timer.ramo){
    const sem = data.semestres[semKey];
    const r = sem?.ramos?.[timer.ramo];
    if(r){
      r.horasEstudiadas = (r.horasEstudiadas||0) + minutes;
      data.studySessions.push({ id: uuid(), date: isoDate(), ramo: timer.ramo, minutes });
    }
  }
  timer.elapsedSec = 0;
  updateClockUI();
}

function resetTimer(){
  if(timer.running){
    timer.running = false;
    clearInterval(timer.tickId);
    timer.tickId = null;
  }
  timer.elapsedSec = 0;
  updateClockUI();
}

function updateClockUI(){
  const display = $("#digitalTime", views.planner);
  if(display) display.textContent = formatHMS(timer.elapsedSec);

  const secHand = $("#secHand", views.planner);
  const minHand = $("#minHand", views.planner);
  const hourHand = $("#hourHand", views.planner);

  const s = timer.elapsedSec;
  const sec = s % 60;
  const min = Math.floor(s/60) % 60;
  const hr = Math.floor(s/3600);

  const secAngle = (sec / 60) * 360;
  const minAngle = ((min + sec/60) / 60) * 360;
  const hourAngle = (((hr % 12) + min/60) / 12) * 360;

  if(secHand) secHand.style.transform = `translate(-50%,-100%) rotate(${secAngle}deg)`;
  if(minHand) minHand.style.transform = `translate(-50%,-100%) rotate(${minAngle}deg)`;
  if(hourHand) hourHand.style.transform = `translate(-50%,-100%) rotate(${hourAngle}deg)`;

  const hint = $("#clockHint", views.planner);
  if(hint) hint.textContent = timer.running ? "Tap en el reloj para pausar" : "Tap en el reloj para iniciar";
}

/******** RENDER ********/
function rerender(){
  ensureSemester(data.activeSemester);
  saveData(data);

  const semKeys = listSemesters();
  semesterSelect.innerHTML = semKeys.map(k=> `<option value="${k}">${k}</option>`).join("");
  semesterSelect.value = data.activeSemester;

  renderDashboard();
  renderCalculator();
  renderPlanner();
  renderHistory();
}

function renderDashboard(){
  const semKey = data.activeSemester;
  const sem = data.semestres[semKey];
  const avg = calcSemesterAvg(semKey);
  const totalMin = totalMinutesSemester(semKey);

  const ramosEntries = Object.entries(sem?.ramos || {});
  const risk = ramosEntries
    .map(([name,r])=> ({name, st: calcRamoStatus(r)}))
    .filter(x=> x.st.riesgo);

  const upcoming = (sem.evaluaciones||[])
    .slice()
    .sort((a,b)=> a.date.localeCompare(b.date))
    .filter(e=> daysUntil(e.date) >= 0)
    .slice(0,5);

  views.dashboard.innerHTML = `
    <div class="grid cols-3">
      <div class="card">
        <h2>🏠 Dashboard</h2>
        <div class="muted small">Semestre <b>${semKey}</b></div>
        <div class="hr"></div>
        <div class="pill">Promedio actual: <b>${avg ?? "—"}</b></div>
      </div>

      <div class="card">
        <h3>⏳ Horas estudiadas</h3>
        <div class="muted small">Acumulado del semestre</div>
        <div class="hr"></div>
        <div class="pill">${hoursFromMinutes(totalMin)}</div>
      </div>

      <div class="card">
        <h3>⚠️ Alertas</h3>
        <div class="muted small">Ramos en riesgo</div>
        <div class="hr"></div>
        ${
          risk.length
          ? `<div class="row">${risk.map(r=> `<span class="badge risk">${escapeHtml(r.name)}</span>`).join("")}</div>`
          : `<span class="badge ok">Todo estable por ahora 💜</span>`
        }
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>📌 Próximas evaluaciones</h3>
        <div class="muted small">Se muestran las 5 más cercanas</div>
        <div class="hr"></div>

        ${
          upcoming.length
          ? `<table class="table">
              <thead><tr><th>Fecha</th><th>Ramo</th><th>Tipo</th><th>Alerta</th></tr></thead>
              <tbody>
                ${upcoming.map(e=>{
                  const d = daysUntil(e.date);
                  const tag =
                    d === 0 ? `<span class="badge warn">HOY</span>` :
                    d <= 3 ? `<span class="badge warn">En ${d} días</span>` :
                    d <= 7 ? `<span class="badge ok">En ${d} días</span>` :
                    `<span class="badge">En ${d} días</span>`;
                  return `
                    <tr>
                      <td><b>${e.date}</b></td>
                      <td>${escapeHtml(e.ramo)}</td>
                      <td>${escapeHtml(e.tipo)}</td>
                      <td>${tag}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>`
          : `<div class="muted small">No hay evaluaciones próximas. Agrégalas en “Planificador”.</div>`
        }
      </div>

      <div class="card">
        <h3>🧾 Resumen rápido</h3>
        <div class="muted small">Nota necesaria solo aparece cuando hay notas</div>
        <div class="hr"></div>
        ${
          ramosEntries.length
          ? `<table class="table">
              <thead><tr><th>Ramo</th><th>%</th><th>Necesaria (4.0)</th></tr></thead>
              <tbody>
                ${ramosEntries.map(([name,r])=>{
                  const st = calcRamoStatus(r);
                  return `
                    <tr>
                      <td><b>${escapeHtml(name)}</b></td>
                      <td>${st.porcentajeHecho}%</td>
                      <td>${st.porcentajeHecho ? (st.notaNecesaria ?? "—") : "—"}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>`
          : `<div class="muted small">Aún no tienes ramos. Agrega uno en “Calculadora”.</div>`
        }
      </div>
    </div>
  `;
}

function renderCalculator(){
  const semKey = data.activeSemester;
  const sem = data.semestres[semKey];
  const ramos = sem?.ramos || {};

  views.calculator.innerHTML = `
    <div class="card">
      <h2>📊 Calculadora</h2>
      <div class="muted small">Minimalista: agrega ramo y registra notas dentro de cada ramo.</div>
      <div class="hr"></div>

      <div class="row">
        <div style="flex:2;">
          <div class="muted small">Nombre del ramo</div>
          <input id="ramoName" placeholder="Ej: Procesal / Penal / Civil..." />
        </div>
        <button id="addRamoBtn" class="btn no-flex">➕ Agregar</button>
        <div id="ramoMsg" class="muted small" style="flex:3;"></div>
      </div>
    </div>

    <div class="card">
      <h3>📚 Ramos</h3>
      <div class="muted small">Nota necesaria aparece abajo de las notas.</div>
      <div class="hr"></div>

      <div class="grid" id="ramosContainer">
        ${Object.keys(ramos).length
          ? Object.entries(ramos).map(([name,r])=> ramoCardHTML(name,r)).join("")
          : `<div class="muted small">No hay ramos aún.</div>`
        }
      </div>
    </div>
  `;

  $("#addRamoBtn", views.calculator).addEventListener("click", ()=>{
    const name = $("#ramoName", views.calculator).value.trim();
    const msg = $("#ramoMsg", views.calculator);

    if(!name){ msg.textContent="Escribe el nombre del ramo."; return; }
    if(sem.ramos[name]){ msg.textContent="Ese ramo ya existe (no se duplica)."; return; }

    sem.ramos[name] = { notas: [], horasEstudiadas: 0 };
    if(data.weeklyTargets[name] == null) data.weeklyTargets[name] = 4; // default
    msg.textContent="Ramo agregado ✅";
    $("#ramoName", views.calculator).value="";
    rerender();
  });

  $$("[data-action='del-ramo']", views.calculator).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ramo = btn.dataset.ramo;
      if(!confirm(`¿Borrar "${ramo}" y sus datos?`)) return;
      delete sem.ramos[ramo];
      sem.evaluaciones = (sem.evaluaciones||[]).filter(e=> e.ramo!==ramo);
      data.studySessions = (data.studySessions||[]).filter(s=> s.ramo!==ramo);
      delete data.weeklyTargets[ramo];
      rerender();
    });
  });

  $$("[data-action='add-nota']", views.calculator).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ramo = btn.dataset.ramo;
      const notaEl = $("#nota-"+cssSafe(ramo), views.calculator);
      const porEl  = $("#por-"+cssSafe(ramo), views.calculator);
      const msgEl  = $("#msg-"+cssSafe(ramo), views.calculator);

      const nota = safeNum(notaEl.value);
      const por  = safeNum(porEl.value);

      if(!nota || nota<1 || nota>7){ msgEl.textContent="Nota inválida (1.0 a 7.0)."; return; }
      if(!por || por<=0 || por>100){ msgEl.textContent="Porcentaje inválido."; return; }

      const r = sem.ramos[ramo];
      const total = (r.notas||[]).reduce((a,n)=> a+n.porcentaje,0);
      if(total + por > 100){ msgEl.textContent="No puedes superar 100%."; return; }

      r.notas.push({ nota: round2(nota), porcentaje: round2(por) });
      msgEl.textContent="Agregado ✅";
      notaEl.value=""; porEl.value="";
      rerender();
    });
  });

  $$("[data-action='del-nota']", views.calculator).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ramo = btn.dataset.ramo;
      const idx = Number(btn.dataset.idx);
      sem.ramos[ramo].notas.splice(idx,1);
      rerender();
    });
  });
}

function ramoCardHTML(name, r){
  const st = calcRamoStatus(r);
  const estado = st.riesgo ? `<span class="badge risk">Riesgo</span>` : `<span class="badge ok">OK</span>`;
  const totalPor = st.porcentajeHecho;

  return `
    <div class="ramo-card">
      <div class="ramo-head">
        <div>
          <div class="ramo-title">${escapeHtml(name)}</div>
          <div class="muted small">Estudio: <b>${hoursFromMinutes(r.horasEstudiadas||0)}</b></div>
        </div>
        <div class="row" style="justify-content:flex-end; align-items:center;">
          ${estado}
          <button class="icon-btn" data-action="del-ramo" data-ramo="${escapeHtml(name)}" title="Borrar ramo">🗑️</button>
        </div>
      </div>

      <div class="row">
        <div>
          <div class="muted small">Nota</div>
          <input id="nota-${cssSafe(name)}" type="number" min="1" max="7" step="0.1" placeholder="5.5" />
        </div>
        <div>
          <div class="muted small">%</div>
          <input id="por-${cssSafe(name)}" type="number" min="1" max="100" step="1" placeholder="30" />
        </div>
        <button class="btn no-flex" data-action="add-nota" data-ramo="${escapeHtml(name)}">➕</button>
        <div id="msg-${cssSafe(name)}" class="muted small" style="flex:2;"></div>
      </div>

      ${r.notas?.length ? `
        <table class="table">
          <thead><tr><th>#</th><th>Nota</th><th>%</th><th></th></tr></thead>
          <tbody>
            ${r.notas.map((n,idx)=>`
              <tr>
                <td>${idx+1}</td>
                <td><b>${n.nota}</b></td>
                <td>${n.porcentaje}%</td>
                <td><button class="icon-btn" data-action="del-nota" data-ramo="${escapeHtml(name)}" data-idx="${idx}" title="Borrar nota">🗑️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="muted small">Aún no hay notas.</div>`}

      <div class="hr"></div>

      <div class="row">
        <span class="pill">% evaluado: <b>${totalPor}%</b></span>
        <span class="pill">Acumulado: <b>${totalPor ? st.acumulado : "—"}</b></span>
        <span class="pill">Nota necesaria 4.0: <b>${totalPor ? (st.notaNecesaria ?? "—") : "—"}</b></span>
      </div>
      <div class="muted small">${st.mensaje || ""}</div>
    </div>
  `;
}

function renderPlanner(){
  const semKey = data.activeSemester;
  const sem = data.semestres[semKey];
  const ramos = Object.keys(sem?.ramos || {});
  const evals = (sem.evaluaciones||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));

  for(const r of ramos){
    if(data.weeklyTargets[r] == null) data.weeklyTargets[r] = 4;
  }

  views.planner.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>📅 Planificador</h2>
        <div class="muted small">Guarda pruebas/solemnes/exámenes por fecha</div>
        <div class="hr"></div>

        <div class="row">
          <div>
            <div class="muted small">Fecha</div>
            <input id="evDate" type="date" />
          </div>
          <div>
            <div class="muted small">Ramo</div>
            <select id="evRamo">
              ${ramos.length ? ramos.map(r=> `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("") : `<option value="">(sin ramos)</option>`}
            </select>
          </div>
          <div>
            <div class="muted small">Tipo</div>
            <select id="evTipo">
              <option>prueba</option>
              <option>solemne</option>
              <option>examen</option>
            </select>
          </div>
          <button id="addEvalBtn" class="btn no-flex">Agregar</button>
        </div>

        <div id="evMsg" class="muted small" style="margin-top:8px;"></div>

        <div class="hr"></div>

        <h3 style="margin-bottom:6px;">📌 Lista</h3>
        ${
          evals.length
          ? `<table class="table">
              <thead><tr><th>Fecha</th><th>Ramo</th><th>Tipo</th><th></th></tr></thead>
              <tbody>
                ${evals.map(e=>`
                  <tr>
                    <td><b>${e.date}</b></td>
                    <td>${escapeHtml(e.ramo)}</td>
                    <td>${escapeHtml(e.tipo)}</td>
                    <td><button class="icon-btn" data-action="del-eval" data-id="${e.id}">🗑️</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>`
          : `<div class="muted small">Aún no registras evaluaciones.</div>`
        }
      </div>

      <div class="card flocus-card">
        ${catSvg()}

        <h2>⏱ Tiempo de Flocus 🤓</h2>
        <div class="muted small">Tap en el reloj para iniciar/pausar • al pausar suma minutos al ramo.</div>
        <div class="hr"></div>

        <div class="row" style="position:relative; z-index:2;">
          <div>
            <div class="muted small">Ramo en foco</div>
            <select id="timerRamo">
              <option value="">— Selecciona —</option>
              ${ramos.map(r=> `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
            </select>
          </div>
          <button id="resetTimerBtn" class="btn btn-ghost no-flex">↩️ Reiniciar</button>
        </div>

        <div class="clock-wrap">
          <div id="clock" class="clock" title="Tap para iniciar/pausar">
            <div class="ticks"></div>
            <div id="hourHand" class="hand hour"></div>
            <div id="minHand" class="hand min"></div>
            <div id="secHand" class="hand sec"></div>
            <div class="center"></div>
          </div>

          <div class="timer-read">
            <div>
              <div class="hint" id="clockHint">Tap en el reloj para iniciar</div>
              <div class="time-digital" id="digitalTime">${formatHMS(timer.elapsedSec)}</div>
            </div>
            <span class="badge ${timer.running ? "ok" : ""}" id="runningBadge">${timer.running ? "En foco" : "Pausado"}</span>
          </div>
        </div>

        <div class="hr"></div>

        <div class="mini-title">
          <span>📌 Horas sugeridas por ramo (editable)</span>
          <span class="muted small">default: 4h</span>
        </div>

        ${
          ramos.length
          ? `<table class="table" style="position:relative; z-index:2;">
              <thead>
                <tr><th>Ramo</th><th>Horas/semana</th></tr>
              </thead>
              <tbody>
                ${ramos.map(r=>`
                  <tr>
                    <td><b>${escapeHtml(r)}</b></td>
                    <td style="max-width:140px;">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        data-action="set-target"
                        data-ramo="${escapeHtml(r)}"
                        value="${data.weeklyTargets[r] ?? 4}"
                        placeholder="4"
                      />
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>`
          : `<div class="muted small" style="position:relative; z-index:2;">Agrega ramos para definir horas sugeridas.</div>`
        }
      </div>
    </div>
  `;

  $("#addEvalBtn", views.planner).addEventListener("click", ()=>{
    const msg = $("#evMsg", views.planner);
    if(!ramos.length){ msg.textContent="Primero agrega ramos en Calculadora."; return; }

    const date = $("#evDate", views.planner).value;
    const ramo = $("#evRamo", views.planner).value;
    const tipo = $("#evTipo", views.planner).value;

    if(!date){ msg.textContent="Elige una fecha."; return; }
    if(!ramo){ msg.textContent="Elige un ramo."; return; }

    sem.evaluaciones.push({ id: uuid(), date, ramo, tipo });
    msg.textContent="Evaluación agregada ✅";
    rerender();
  });

  $$("[data-action='del-eval']", views.planner).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      sem.evaluaciones = (sem.evaluaciones||[]).filter(e=> e.id!==id);
      rerender();
    });
  });

  $$("[data-action='set-target']", views.planner).forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const ramo = inp.dataset.ramo;
      const v = safeNum(inp.value);
      data.weeklyTargets[ramo] = (v==null ? 4 : Math.max(0, v));
      saveData(data);
    });
  });

  const clock = $("#clock", views.planner);
  const ramoSel = $("#timerRamo", views.planner);
  const badge = $("#runningBadge", views.planner);

  function refreshBadge(){
    if(!badge) return;
    badge.className = "badge " + (timer.running ? "ok" : "");
    badge.textContent = timer.running ? "En foco" : "Pausado";
  }

  clock.addEventListener("click", ()=>{
    const chosen = ramoSel.value;
    if(!chosen){
      alert("Selecciona un ramo antes de iniciar.");
      return;
    }
    if(timer.running){
      stopAndCommit(semKey);
      refreshBadge();
      saveData(data);
      rerender();
    } else {
      startTimer(chosen);
      refreshBadge();
      updateClockUI();
    }
  });

  $("#resetTimerBtn", views.planner).addEventListener("click", ()=>{
    resetTimer();
    refreshBadge();
  });

  updateClockUI();
  refreshBadge();
}

function renderHistory(){
  const semKeys = listSemesters();
  const current = data.activeSemester;

  views.history.innerHTML = `
    <div class="card">
      <h2>📚 Historial</h2>
      <div class="muted small">Semestres + nota final (solo si hay 100%) + horas por ramo</div>
      <div class="hr"></div>

      ${semKeys.length ? semKeys.map(k=> historySemHTML(k, k===current)).join("") : `<div class="muted small">Sin semestres aún.</div>`}
    </div>
  `;
}

function historySemHTML(semKey, isCurrent){
  const sem = data.semestres[semKey];
  const entries = Object.entries(sem?.ramos || {});
  return `
    <div class="card" style="box-shadow:none; border-style:dashed;">
      <div class="row" style="align-items:center; justify-content:space-between;">
        <div class="pill">${semKey} ${isCurrent ? "• (actual)" : ""}</div>
        <div class="muted small">Ramos: <b>${entries.length}</b></div>
      </div>
      <div class="hr"></div>

      ${
        entries.length
        ? `<table class="table">
            <thead><tr><th>Ramo</th><th>Nota final</th><th>Horas</th></tr></thead>
            <tbody>
              ${entries.map(([name,r])=>{
                const st = calcRamoStatus(r);
                return `
                  <tr>
                    <td><b>${escapeHtml(name)}</b></td>
                    <td>${st.notaFinal ?? "—"}</td>
                    <td>${hoursFromMinutes(r.horasEstudiadas||0)}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>`
        : `<div class="muted small">Semestre sin ramos.</div>`
      }
    </div>
  `;
}

/******** EXPORT/IMPORT ********/
function downloadJSON(obj){
  const blob = new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `LEXA-backup-${isoDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/******** EVENTS ********/
navBtns.forEach(btn=>{
  btn.addEventListener("click", ()=> showView(btn.dataset.view));
});

semesterSelect.addEventListener("change", ()=>{
  data.activeSemester = semesterSelect.value;
  ensureSemester(data.activeSemester);
  rerender();
});

newSemesterBtn.addEventListener("click", ()=>{
  const sem = prompt('Crea un semestre (ej: "2026-1" o "2026-2")');
  if(!sem) return;
  const key = sem.trim();
  ensureSemester(key);
  data.activeSemester = key;
  rerender();
});

resetBtn.addEventListener("click", ()=>{
  if(!confirm("Esto borrará TODO. ¿Confirmas?")) return;
  if(timer.running){
    timer.running = false;
    clearInterval(timer.tickId);
    timer.tickId = null;
    timer.elapsedSec = 0;
  }
  wipeAll();
  data = defaultData();
  rerender();
  alert("Reset listo ✅");
});

exportBtn.addEventListener("click", ()=> downloadJSON(data));

importInput.addEventListener("change", async ()=>{
  const file = importInput.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const imported = JSON.parse(text);
    if(!imported || !imported.semestres) throw new Error("JSON inválido.");
    data = imported;
    if(!data.studySessions) data.studySessions = [];
    if(!data.weeklyTargets) data.weeklyTargets = {};
    if(!data.activeSemester) data.activeSemester = listSemesters()[0] || toSemesterKeyNow();
    ensureSemester(data.activeSemester);
    rerender();
    alert("Importado ✅");
  }catch(e){
    alert("No se pudo importar: " + e.message);
  }finally{
    importInput.value="";
  }
});

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}
function cssSafe(s){
  return String(s).replaceAll(" ","_").replaceAll(/[^\w-]/g,"_");
}

function catSvg(){
  return `
    <svg class="flocus-bg" viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="g1" x1="0" x2="1">
          <stop offset="0" stop-color="#6f4cff"/>
          <stop offset="1" stop-color="#b8aaff"/>
        </linearGradient>
      </defs>
      <path d="M140 360c0-92 60-166 134-166s134 74 134 166c0 54-33 92-78 92H218c-45 0-78-38-78-92z" fill="url(#g1)"/>
      <circle cx="210" cy="290" r="22" fill="#fff"/>
      <circle cx="300" cy="290" r="22" fill="#fff"/>
      <circle cx="210" cy="290" r="10" fill="#181427"/>
      <circle cx="300" cy="290" r="10" fill="#181427"/>
      <path d="M250 322c10-10 22-10 32 0" stroke="#181427" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M170 220l-28-40c-9-13 4-30 19-24l43 17" fill="url(#g1)"/>
      <path d="M340 220l28-40c9-13-4-30-19-24l-43 17" fill="url(#g1)"/>
      <path d="M120 410h272c16 0 28 12 28 28v10H92v-10c0-16 12-28 28-28z" fill="#181427"/>
      <path d="M150 380h210c10 0 18 8 18 18v18H132v-18c0-10 8-18 18-18z" fill="#fff"/>
      <path d="M168 396h86v10h-86zM268 396h86v10h-86z" fill="#d7f0ff"/>
      <path d="M170 430c18 10 34 10 52 0" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M290 430c18 10 34 10 52 0" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none"/>
    </svg>
  `;
}

// INIT
ensureSemester(data.activeSemester);
rerender();
showView("dashboard");
