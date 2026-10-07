const state = { data: [], metric: 'percent_valid_votes' };
const labels = { percent_valid_votes: '% válidos', candidate_votes: 'votos', municipality_share_of_baixada_candidate_votes: '% da Baixada' };
const brNumber = new Intl.NumberFormat('pt-BR');
const brPercent = value => `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/); const headers = lines.shift().split(',');
  return lines.map(line => { const cells = []; let quoted=false, cell=''; for (let i=0;i<line.length;i++) { const c=line[i]; if(c==='"') quoted=!quoted; else if(c===','&&!quoted){cells.push(cell);cell=''}else cell+=c } cells.push(cell); return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??''])); });
}
function option(select, value, text) { const node=document.createElement('option'); node.value=value; node.textContent=text; select.append(node); }
function chosen() { return state.data.filter(d => d.office === office.value && d.candidate_id === candidate.value); }
function render() {
  state.metric = metric.value; const rows = chosen().sort((a,b)=>Number(b[state.metric])-Number(a[state.metric])); if (!rows.length) return;
  const total = rows.reduce((s,d)=>s+Number(d.candidate_votes),0); const top=rows[0];
  kpiVotes.textContent=brNumber.format(total); kpiPercent.textContent=brPercent(top.percent_valid_votes); kpiStronghold.textContent=top.municipality; kpiShare.textContent=brPercent(top.municipality_share_of_baixada_candidate_votes);
  chartTitle.textContent=`${top.ballot_name_registered} · ${top.office}`; metricLabel.textContent=labels[state.metric];
  const max=Math.max(...rows.map(d=>Number(d[state.metric]))); chart.innerHTML=rows.map(d=>`<div class="bar-row"><span class="bar-label">${d.municipality}</span><div class="track"><div class="bar" style="width:${(Number(d[state.metric])/max)*100}%"></div></div><span class="bar-value">${state.metric==='candidate_votes'?brNumber.format(d[state.metric]):brPercent(d[state.metric])}</span></div>`).join('');
  document.querySelector('#rows').innerHTML=rows.map(d=>`<tr><td>${d.municipality}</td><td>${brNumber.format(d.candidate_votes)}</td><td>${brPercent(d.percent_valid_votes)}</td><td>${brPercent(d.municipality_share_of_baixada_candidate_votes)}</td><td>${d.municipality_rank_proportional}º</td></tr>`).join('');
}
function downloadFiltered() { const rows=chosen(); const head=['municipality','office','ballot_name_registered','candidate_votes','valid_votes','percent_valid_votes','municipality_share_of_baixada_candidate_votes']; const csv=[head.join(','),...rows.map(d=>head.map(h=>`"${d[h]}"`).join(','))].join('\n'); const link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),download:'up-baixada-resultados-filtrados.csv'}); link.click(); URL.revokeObjectURL(link.href); }
const office=document.querySelector('#office'),candidate=document.querySelector('#candidate'),metric=document.querySelector('#metric'),chart=document.querySelector('#chart'),kpiVotes=document.querySelector('#kpiVotes'),kpiPercent=document.querySelector('#kpiPercent'),kpiStronghold=document.querySelector('#kpiStronghold'),kpiShare=document.querySelector('#kpiShare'),chartTitle=document.querySelector('#chartTitle'),metricLabel=document.querySelector('#metricLabel');
fetch('data/municipal-results.csv').then(r=>r.text()).then(text=>{state.data=parseCSV(text); const offices=[...new Set(state.data.map(d=>d.office))].sort(); offices.forEach(x=>option(office,x,x)); function populateCandidates(){candidate.innerHTML=''; state.data.filter(d=>d.office===office.value).filter((d,i,a)=>a.findIndex(x=>x.candidate_id===d.candidate_id)===i).sort((a,b)=>a.ballot_name_registered.localeCompare(b.ballot_name_registered)).forEach(d=>option(candidate,d.candidate_id,d.ballot_name_registered)); render()} office.addEventListener('change',populateCandidates); candidate.addEventListener('change',render); metric.addEventListener('change',render); document.querySelector('#download').addEventListener('click',downloadFiltered); populateCandidates();});
