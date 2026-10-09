(function() {
  const $ = id => document.getElementById(id);
  const format = (n,digits=0) => Number(n).toLocaleString('pt-BR',{maximumFractionDigits:digits});
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const heatGradient={0.12:'#f7e7be',0.35:'#f5bd63',0.58:'#ee7840',0.8:'#cf3e28',1:'#7c1d1d'};
  let map, overlays, latest, currentPoints=[], lastScope='', mode='density', peak=1;
  function ensureMap() {
    if (map) return true;
    if (!window.L) { $('mapError').textContent='Não foi possível carregar o mapa. Os dados continuam disponíveis nas tabelas.';return false; }
    map=L.map('voteMap',{scrollWheelZoom:true,minZoom:8,maxZoom:18}).setView([-24.03,-46.45],10);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Coordenadas: TSE',
    }).addTo(map);
    let failed=0;
    tiles.on('tileerror',()=>{failed++;if(failed>=3)$('mapError').textContent='O mapa de ruas não carregou. A camada de votos permanece disponível; tente recarregar a página.';});
    tiles.on('tileload',()=>{$('mapError').textContent='';failed=0;});
    overlays=L.layerGroup().addTo(map);
    const mapElement=$('voteMap');
    mapElement.dataset.zoom=String(map.getZoom());
    map.on('zoomend',()=>{mapElement.dataset.zoom=String(map.getZoom());});
    $('voteMap').querySelector('.leaflet-control-zoom-in').title='Aproximar mapa';$('voteMap').querySelector('.leaflet-control-zoom-out').title='Afastar mapa';
    new ResizeObserver(()=>{
      const element=$('voteMap');
      if(!element.clientWidth||!element.clientHeight)return;
      map.invalidateSize({pan:false});fit();
    }).observe($('voteMap'));
    return true;
  }
  function coordinateGroups(points) {
    const groups=new Map();
    for(const point of points){const key=`${point.latitude}:${point.longitude}`;if(!groups.has(key))groups.set(key,{latitude:point.latitude,longitude:point.longitude,votes:0,places:[]});const group=groups.get(key);group.votes+=point.votes;group.places.push(point);}
    return [...groups.values()];
  }
  function voteBand(votes) {
    if (votes === 0) return { label:'0 votos', fill:'#b3bcb6', stroke:'#617067' };
    if (votes <= 10) return { label:'1–10 votos', fill:'#f3c75d', stroke:'#9b6a18' };
    if (votes <= 20) return { label:'11–20 votos', fill:'#ef9245', stroke:'#a5481f' };
    if (votes <= 30) return { label:'21–30 votos', fill:'#db5934', stroke:'#8a2d20' };
    if (votes < 40) return { label:'31–39 votos', fill:'#ad342b', stroke:'#651b1a' };
    return { label:'40+ votos', fill:'#6d1b1b', stroke:'#3c1111' };
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
    const scope=[filters.candidate,filters.municipality,filters.zone,filters.place].join('|');
    if(mode==='density') {
      if(!L.heatLayer){$('mapError').textContent='Não foi possível carregar a camada de calor. Troque para “Votos por local” ou recarregue a página.';return;}
      const intensity=Math.max(1,...currentPoints.map(point=>point.votes));
      L.heatLayer(currentPoints.filter(point=>point.votes>0).map(point=>[point.latitude,point.longitude,point.votes/intensity]),{radius:32,blur:26,max:1,minOpacity:.2,gradient:heatGradient}).addTo(overlays);
      $('mapLegend').innerHTML='<strong>Concentração de votos</strong><span><i class="legend-heat legend-low"></i>Menor</span><span><i class="legend-heat legend-mid"></i>Média</span><span><i class="legend-heat legend-high"></i>Maior</span><small>Raio visual aproximado de 2 km. A intensidade relativa é recalculada para o recorte atual.</small>';
    } else {
      peak=Math.max(1,...coordinateGroups(reference.mapped).map(p=>p.votes));
      for(const point of coordinateGroups(currentPoints)) {
        const band=voteBand(point.votes);
        const layer=L.circleMarker([point.latitude,point.longitude],{radius:point.votes?4+18*Math.sqrt(point.votes/peak):3,weight:1.5,color:band.stroke,fillColor:band.fill,fillOpacity:point.votes?.78:.55});
        addPopup(layer,`<div class="map-popup"><span class="section-label">Votos registrados no local</span><h4>${format(point.votes)} votos</h4><p><span class="map-band" style="background:${band.fill}"></span>${band.label} · ${escape(name)}${point.places.length>1?` · ${point.places.length} locais nesta coordenada`:''}</p>${placeList(point.places)}</div>`,`${format(point.votes)} votos em ${point.places[0].place_name}. Abrir detalhes.`);
      }
      $('mapLegend').innerHTML='<strong>Votos por local</strong><span><i class="legend-point"></i>Tamanho: mais votos</span><span><i style="background:#b3bcb6"></i>0</span><span><i style="background:#f3c75d"></i>1–10</span><span><i style="background:#ef9245"></i>11–20</span><span><i style="background:#db5934"></i>21–30</span><span><i style="background:#ad342b"></i>31–39</span><span><i style="background:#6d1b1b"></i>40+</span><small>Locais na mesma coordenada são somados no símbolo e detalhados ao clicar.</small>';
    }
    const hiddenZeros=recorte.mapped.length-currentPoints.length;
    $('mapCoverage').textContent=`${format(recorte.mappedVotes)} de ${format(selected.total)} votos do recorte com coordenadas válidas · ${format(currentPoints.length)} locais exibidos${hiddenZeros?` · ${format(hiddenZeros)} locais sem votos ocultos`:''}.${recorte.missing.length?` ${format(recorte.missing.length)} locais sem coordenadas válidas, com ${format(recorte.missingVotes)} votos: constam nas tabelas, mas não no mapa.`:''}`;
    if(!currentPoints.length)$('mapCoverage').textContent+=' Nenhum local para exibir com estes filtros.';
    $('voteMap').dataset.mode=mode;$('voteMap').dataset.placeCount=String(currentPoints.length);$('voteMap').dataset.voteCount=String(recorte.mappedVotes);
    requestAnimationFrame(()=>{map.invalidateSize({pan:false});if(scope!==lastScope){fit();lastScope=scope;}});
  }
  document.addEventListener('detailmapchange',event=>{latest=event.detail;if(!latest.available){overlays?.clearLayers();map?.closePopup();lastScope='';return;}draw();});
  document.querySelectorAll('[data-map-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mapMode;document.querySelectorAll('[data-map-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));draw();}));
  $('mapZeros').addEventListener('change',draw);$('mapFit').addEventListener('click',fit);
  $('voteMap').addEventListener('click',event=>{const button=event.target.closest('[data-map-place]');if(button)document.dispatchEvent(new CustomEvent('exploreplace',{detail:{key:button.dataset.mapPlace}}));});
})();
