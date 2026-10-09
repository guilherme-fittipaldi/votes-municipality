(function() {
  const $ = id => document.getElementById(id);
  const number = value => Number(value).toLocaleString('pt-BR');
  const percent = value => `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const sortText = (a,b) => a.localeCompare(b, 'pt-BR', { numeric: true });
  const state = { data: null, candidate: '', name: '', level: 'zone', page: 0, result: null, visible: [], failed: false };
  const municipality = $('detailMunicipality'), zone = $('detailZone'), place = $('detailPlace');
  const pageSize = 25;

  function options(select, values, first, keep = '') {
    select.replaceChildren();
    for (const [value, label] of [['', first], ...values]) {
      const node = document.createElement('option'); node.value = value; node.textContent = label; select.append(node);
    }
    select.value = [...select.options].some(o => o.value === keep) ? keep : '';
  }
  function populateZones() {
    const current = zone.value;
    const values = [...new Set(state.data.sections.filter(([m]) => !municipality.value || m === municipality.value).map(([,z]) => z))].sort(sortText);
    options(zone, values.map(z => [z, `Zona ${z}`]), 'Todas as zonas', current);
  }
  function populatePlaces() {
    const current = place.value;
    const values = Object.entries(state.data.places).filter(([,p]) => (!municipality.value || p.municipality_id === municipality.value) && (!zone.value || p.zone === zone.value));
    values.sort((a,b) => sortText(a[1].name,b[1].name) || sortText(a[0],b[0]));
    options(place, values.map(([key,p]) => [key, `${p.name} · ${state.data.municipalities[p.municipality_id]} · Z${p.zone} · local ${p.id}`]), 'Todos os locais', current);
  }
  function breadcrumb() {
    const parts = [municipality.value ? state.data.municipalities[municipality.value] : 'Toda a Baixada Santista'];
    if (zone.value) parts.push(`Zona ${zone.value}`);
    if (place.value) parts.push(state.data.places[place.value].name);
    $('detailBreadcrumb').textContent = parts.join(' › ');
  }
  function setLevel(level) {
    state.level = level; state.page = 0;
    document.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
    $('detailSearch').value = '';
    render();
  }
  function drill(key) {
    const row = state.result.rows.find(r => r.key === key); if (!row || state.level === 'section') return;
    municipality.value = row.municipality_id; populateZones(); zone.value = row.zone; populatePlaces();
    if (state.level === 'place') place.value = row.place_key;
    else place.value = '';
    setLevel(state.level === 'zone' ? 'place' : 'section');
    $('explorerTitle').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function render() {
    if (!state.data || !state.candidate) return;
    state.page = 0; breadcrumb();
    $('explorerCandidate').textContent = `Candidatura: ${state.name}`;
    state.result = ElectoralExplorer.explore(state.data, {
      candidate: state.candidate, level: state.level, municipality: municipality.value, zone: zone.value, place: place.value,
    });
    $('detailContent').hidden = !state.result.available;
    $('detailStatus').textContent = state.result.available ? '' : `A candidatura ${state.name} não foi encontrada nas fontes detalhadas importadas de SP. Seus resultados municipais continuam disponíveis no painel acima.`;
    if (!state.result.available) return;
    const r = state.result;
    $('detailVotes').textContent = number(r.total);
    $('detailShare').textContent = percent(r.regionTotal ? 100 * r.total / r.regionTotal : 0);
    $('detailSections').innerHTML = `${number(r.sectionsWithVotes)} <small>de ${number(r.sectionCount)} no cadastro</small>`;
    $('detailPlaces').textContent = number(r.placeCount);
    const levelName = {zone:'zona',place:'local de votação',section:'seção'}[state.level];
    $('detailChartTitle').textContent = `Ranking por ${levelName}`;
    $('detailGuide').textContent = state.level === 'zone' ? 'Clique em uma zona para ver seus locais de votação.' : state.level === 'place' ? 'Clique em um local para ver os votos em cada seção, com endereço e bairro.' : 'Cada seção é identificada pelo município, zona e número. Use os filtros para encontrar o local desejado.';
    filterRows();
  }
  function filterRows() {
    if (!state.result?.available) return;
    const query = fold($('detailSearch').value.trim());
    state.visible = state.result.rows.filter(r => ($('detailZeros').checked || r.votes > 0) && (!query || fold([r.label,r.municipality,r.zone,r.section,r.place_name,r.address,r.neighborhood].join(' ')).includes(query)));
    state.page = 0;
    const top = state.visible.filter(r => r.votes > 0).slice(0, 10);
    const max = top[0]?.votes || 1;
    $('detailChart').innerHTML = top.length ? top.map(r => `<${state.level === 'section' ? 'div' : 'button type="button"'} class="detail-bar" ${state.level === 'section' ? '' : `data-drill="${escape(r.key)}" aria-label="Explorar ${escape(r.label)} em ${escape(r.municipality)}"`}><span class="bar-label">${escape(r.label)}<small>${escape(r.municipality)}${state.level === 'zone' ? '' : ` · Zona ${escape(r.zone)}`}</small></span><span class="track"><span class="bar" style="display:block;width:${100*r.votes/max}%"></span></span><span class="bar-value">${number(r.votes)}</span></${state.level === 'section' ? 'div' : 'button'}>`).join('') : '<p class="detail-count">Nenhuma unidade com votos neste filtro.</p>';
    $('detailCount').textContent = `${number(state.visible.length)} de ${number(state.result.rows.length)} ${state.level === 'zone' ? 'zonas' : state.level === 'place' ? 'locais' : 'seções'} do recorte${query ? ' · busca aplicada' : ''}. Ordenação por votos absolutos. A busca e a opção de zeros afetam o ranking, a tabela e o CSV; os indicadores representam o recorte completo.`;
    renderPage();
  }
  function renderPage() {
    const pages = Math.max(1, Math.ceil(state.visible.length / pageSize));
    state.page = Math.max(0, Math.min(state.page, pages-1));
    const shareHelp = 'Parcela dos votos da candidatura neste recorte que veio desta unidade. A base é o total do recorte, antes da busca. Não é percentual de votos válidos.';
    $('detailHead').innerHTML = `<tr><th>${state.level === 'zone' ? 'Zona' : state.level === 'place' ? 'Local de votação' : 'Seção / local'}</th><th>Município</th>${state.level === 'zone' ? '' : '<th>Zona</th>'}<th>Votos UP</th><th>% no recorte <button class="info table-info" type="button" data-help="${shareHelp}" aria-label="Explicação: percentual no recorte" aria-expanded="false">ℹ️</button></th>${state.level === 'section' ? '' : '<th>Seções no cadastro</th>'}</tr>`;
    const rows = state.visible.slice(state.page*pageSize, (state.page+1)*pageSize);
    $('detailRows').innerHTML = rows.length ? rows.map(r => {
      const name = state.level === 'section' ? `<strong>${escape(r.label)}</strong>` : `<button class="drill-button" type="button" data-drill="${escape(r.key)}">${escape(r.label)} ↗</button>`;
      const sub = state.level === 'zone' ? `${number(r.places)} locais no cadastro` : `${state.level === 'section' ? `${escape(r.place_name)}<br>` : ''}${escape(r.address)}${r.neighborhood ? `<br>Bairro: ${escape(r.neighborhood)}` : '<br>Bairro não informado'}`;
      return `<tr><td class="unit-name">${name}<small>${sub}</small></td><td>${escape(r.municipality)}</td>${state.level === 'zone' ? '' : `<td>${escape(r.zone)}</td>`}<td>${number(r.votes)}</td><td>${percent(r.share)}</td>${state.level === 'section' ? '' : `<td>${number(r.sections)}</td>`}</tr>`;
    }).join('') : `<tr><td colspan="6">Nenhum resultado. Ajuste a busca ou marque “Mostrar unidades sem votos”.</td></tr>`;
    $('detailPage').textContent = `Página ${state.page+1} de ${pages}`;
    $('detailPrev').disabled = state.page === 0; $('detailNext').disabled = state.page >= pages-1;
  }
  function download() {
    const columns = ['candidate','level','municipality_id','municipality','zone','section','place_id','place_name','address','neighborhood','votes','share_of_filtered_candidate_votes','sections_in_register'];
    const cell = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = state.visible.map(r => [state.name,state.level,r.municipality_id,r.municipality,r.zone,r.section,r.place_key ? state.data.places[r.place_key].id : '',r.place_name,r.address,r.neighborhood,r.votes,r.share,r.sections].map(cell).join(','));
    const url = URL.createObjectURL(new Blob(['\uFEFF'+[columns.join(','),...lines].join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href=url; a.download=`up-baixada-${state.candidate}-${state.level}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.addEventListener('candidatechange', event => {
    if (state.candidate === event.detail.id) return;
    state.candidate = event.detail.id; state.name = event.detail.name; render();
  });
  municipality.addEventListener('change', () => { zone.value='';place.value='';populateZones();populatePlaces();render(); });
  zone.addEventListener('change', () => { place.value='';populatePlaces();render(); });
  place.addEventListener('change', () => {
    if (place.value) { const selected = state.data.places[place.value]; const key=place.value;municipality.value=selected.municipality_id;populateZones();zone.value=selected.zone;populatePlaces();place.value=key; }
    render();
  });
  document.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => setLevel(button.dataset.level)));
  $('detailSearch').addEventListener('input', filterRows); $('detailZeros').addEventListener('change', filterRows);
  $('detailPrev').addEventListener('click',()=>{state.page--;renderPage()}); $('detailNext').addEventListener('click',()=>{state.page++;renderPage()});
  $('resetDetails').addEventListener('click',()=>{municipality.value='';zone.value='';place.value='';$('detailSearch').value='';$('detailZeros').checked=false;populateZones();populatePlaces();setLevel('zone')});
  $('explorerTitle').closest('section').addEventListener('click', event => { const target=event.target.closest('[data-drill]');if(target)drill(target.dataset.drill); });
  $('downloadDetails').addEventListener('click',download);
  for (const select of [municipality,zone,place]) select.disabled=true;
  fetch('data/detailed-results.json').then(response => { if(!response.ok)throw new Error('HTTP '+response.status);return response.json(); }).then(data => {
    state.data=ElectoralExplorer.prepare(data);
    options(municipality,Object.entries(data.municipalities).sort((a,b)=>sortText(a[1],b[1])),'Todos os municípios');populateZones();populatePlaces();
    for (const select of [municipality,zone,place]) select.disabled=false;
    render();
  }).catch(() => {state.failed=true;$('detailStatus').textContent='Não foi possível carregar os dados detalhados. Recarregue a página para tentar novamente.';});
})();
