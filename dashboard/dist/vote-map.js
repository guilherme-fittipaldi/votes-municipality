(function() {
  const $ = id => document.getElementById(id);
  const format = (n,digits=0) => Number(n).toLocaleString('pt-BR',{maximumFractionDigits:digits});
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['#fee4ba','#f9bb76','#f48c45','#da522a','#9d261d'], fractions=[.1,.25,.5,.75,1];
  let map, overlays, latest, currentPoints=[], lastScope='', mode='density', peak=1;
  function ensureMap() {
    if (map) return true;
    if (!window.L) { $('mapError').textContent='Não foi possível carregar o mapa. Os dados continuam disponíveis nas tabelas.';return false; }
    map=L.map('voteMap',{scrollWheelZoom:false,minZoom:8,maxZoom:18}).setView([-24.03,-46.45],10);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Coordenadas: TSE',
    }).addTo(map);
    let failed=0;
    tiles.on('tileerror',()=>{failed++;if(failed>=3)$('mapError').textContent='O mapa de ruas não carregou. A camada de votos permanece disponível; tente recarregar a página.';});
    tiles.on('tileload',()=>{$('mapError').textContent='';failed=0;});
    overlays=L.layerGroup().addTo(map);
    $('voteMap').querySelector('.leaflet-control-zoom-in').title='Aproximar mapa';$('voteMap').querySelector('.leaflet-control-zoom-out').title='Afastar mapa';
    new ResizeObserver(()=>{map.invalidateSize({pan:false});fit();}).observe($('voteMap'));
    return true;
  }
  function color(value) {if(value===0)return '#b3bcb6';return colors[fractions.findIndex(f=>value<=peak*f)]||colors[colors.length-1];}
  function coordinateGroups(points) {
    const groups=new Map();
    for(const point of points){const key=`${point.latitude}:${point.longitude}`;if(!groups.has(key))groups.set(key,{latitude:point.latitude,longitude:point.longitude,votes:0,places:[]});const group=groups.get(key);group.votes+=point.votes;group.places.push(point);}
    return [...groups.values()];
  }
  function placeList(points) {
    return `<ul class="map-place-list">${points.slice().sort((a,b)=>b.votes-a.votes).map(p=>`<li><strong>${escape(p.place_name)}</strong><br>${escape(p.municipality)} · Zona ${escape(p.zone)} · ${format(p.votes)} votos<br><span>${escape(p.address)}${p.neighborhood?` · ${escape(p.neighborhood)}`:''}</span><br><button type="button" class="map-explore-place" data-map-place="${escape(p.place_key)}">Ver seções deste local →</button></li>`).join('')}</ul>`;
  }
  function addPopup(layer,html,title) {
    layer.bindPopup(html,{maxWidth:310});
    layer.on('add',()=>{const element=layer.getElement?.();if(element){element.setAttribute('aria-label',title);element.setAttribute('role','button');element.setAttribute('tabindex','0');element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();layer.openPopup();}});}});
    layer.addTo(overlays);
  }
  function fit() {
    if(!map||!latest?.available||!currentPoints.length||!$('voteMap').clientWidth)return;
    map.invalidateSize({pan:false});map.fitBounds(currentPoints.map(p=>[p.latitude,p.longitude]),{padding:[28,28],maxZoom:14,animate:false});
  }
  function draw() {
    if(!latest?.available||!ensureMap())return;
    const {data,filters,name}=latest;
    const selected=ElectoralExplorer.explore(data,{...filters,level:'place'});
    const all=ElectoralExplorer.explore(data,{candidate:filters.candidate,level:'place'});
    const recorte=ElectoralMap.preparePlaces(data,selected.rows);
    const reference=ElectoralMap.preparePlaces(data,all.rows);
    const showZeros=$('mapZeros').checked;
    currentPoints=recorte.mapped.filter(p=>showZeros||p.votes>0);
    overlays.clearLayers();map.closePopup();
    const size=Number($('mapGridSize').value);
    const scope=[filters.candidate,filters.municipality,filters.zone,filters.place].join('|');
    if(mode==='density') {
      peak=Math.max(1,...ElectoralMap.grid(reference.mapped,size).map(c=>c.density));
      for(const cell of ElectoralMap.grid(currentPoints,size)) {
        const layer=L.rectangle(cell.bounds,{color:'#fffef8',weight:1,fillColor:color(cell.density),fillOpacity:cell.votes?0.76:0.3});
        const content=`<div class="map-popup"><span class="section-label">Densidade na célula</span><h4>${format(cell.density,2)} votos/km²</h4><p>${format(cell.votes)} votos de ${escape(name)} · área ${format(cell.areaKm2,2)} km² · ${format(cell.places.length)} locais</p>${placeList(cell.places)}</div>`;
        addPopup(layer,content,`${format(cell.density,2)} votos por km²; ${format(cell.votes)} votos, ${cell.places.length} locais. Abrir detalhes.`);
      }
      $('mapLegend').innerHTML=`<strong>Votos/km²</strong><span class="legend-zero"><i style="background:#b3bcb6"></i>0</span>${colors.map((c,i)=>`<span><i style="background:${c}"></i>${i===0?'> 0':format(peak*fractions[i-1],2)} – ${format(peak*fractions[i],2)}</span>`).join('')}<small>Escala fixa para esta candidatura e tamanho de célula na Baixada.</small>`;
    } else {
      peak=Math.max(1,...coordinateGroups(reference.mapped).map(p=>p.votes));
      for(const point of coordinateGroups(currentPoints)) {
        const layer=L.circleMarker([point.latitude,point.longitude],{radius:point.votes?4+18*Math.sqrt(point.votes/peak):3,weight:1.5,color:point.votes?'#7a2b1c':'#617067',fillColor:point.votes?'#ec5c35':'#b3bcb6',fillOpacity:point.votes?.7:.5});
        addPopup(layer,`<div class="map-popup"><span class="section-label">Votos registrados no local</span><h4>${format(point.votes)} votos</h4><p>${escape(name)}${point.places.length>1?` · ${point.places.length} locais nesta coordenada`:''}</p>${placeList(point.places)}</div>`,`${format(point.votes)} votos em ${point.places[0].place_name}. Abrir detalhes.`);
      }
      $('mapLegend').innerHTML='<strong>Votos por local</strong><span><i class="legend-point"></i>Quanto maior o círculo, mais votos</span><span><i style="background:#b3bcb6"></i>Zero votos</span><small>Locais na mesma coordenada são somados no símbolo e detalhados ao clicar.</small>';
    }
    $('mapGridControl').hidden=mode!=='density';
    const hiddenZeros=recorte.mapped.length-currentPoints.length;
    $('mapCoverage').textContent=`${format(recorte.mappedVotes)} de ${format(selected.total)} votos do recorte com coordenadas válidas · ${format(currentPoints.length)} locais exibidos${hiddenZeros?` · ${format(hiddenZeros)} locais sem votos ocultos`:''}.${recorte.missing.length?` ${format(recorte.missing.length)} locais sem coordenadas válidas, com ${format(recorte.missingVotes)} votos: constam nas tabelas, mas não no mapa.`:''}`;
    if(!currentPoints.length)$('mapCoverage').textContent+=' Nenhum local para exibir com estes filtros.';
    $('voteMap').dataset.mode=mode;$('voteMap').dataset.placeCount=String(currentPoints.length);$('voteMap').dataset.voteCount=String(recorte.mappedVotes);
    requestAnimationFrame(()=>{map.invalidateSize({pan:false});if(scope!==lastScope){fit();lastScope=scope;}});
  }
  document.addEventListener('detailmapchange',event=>{latest=event.detail;if(!latest.available){overlays?.clearLayers();map?.closePopup();lastScope='';return;}draw();});
  document.querySelectorAll('[data-map-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mapMode;document.querySelectorAll('[data-map-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));draw();}));
  $('mapGridSize').addEventListener('change',draw);$('mapZeros').addEventListener('change',draw);$('mapFit').addEventListener('click',fit);
  $('voteMap').addEventListener('click',event=>{const button=event.target.closest('[data-map-place]');if(button)document.dispatchEvent(new CustomEvent('exploreplace',{detail:{key:button.dataset.mapPlace}}));});
})();
