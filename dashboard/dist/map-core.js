/* Grade esférica de áreas comparáveis. R: raio médio terrestre IUGG (km). */
(function(root) {
  const R = 6371.0088, radians = Math.PI / 180, originLat = -25, originLon = -48;
  function validCoordinates(place) {
    return Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && place.latitude >= -25 && place.latitude <= -23 && place.longitude >= -48 && place.longitude <= -45;
  }
  function grid(points, sizeKm) {
    if (![1,2,5].includes(sizeKm)) throw new Error('Tamanho de célula inválido');
    const cells = new Map(), latStep = sizeKm / R / radians;
    for (const point of points) {
      const row = Math.floor((point.latitude-originLat) / latStep);
      const south = originLat + row * latStep, north = south + latStep;
      const lonStep = sizeKm / (R * Math.cos((south+north)/2*radians)) / radians;
      const col = Math.floor((point.longitude-originLon) / lonStep);
      const west = originLon + col * lonStep, east = west + lonStep;
      const key = `${row}:${col}`;
      if (!cells.has(key)) cells.set(key, {
        key, bounds:[[south,west],[north,east]], votes:0, places:[],
        areaKm2:R*R*(east-west)*radians*(Math.sin(north*radians)-Math.sin(south*radians)),
      });
      const cell = cells.get(key);cell.votes+=point.votes;cell.places.push(point);
    }
    return [...cells.values()].map(cell=>({...cell,density:cell.votes/cell.areaKm2}));
  }
  function preparePlaces(data, rows) {
    const mapped=[], missing=[];
    for (const row of rows) {
      const place = data.places[row.place_key];
      const point = {...row,latitude:place.latitude,longitude:place.longitude};
      (validCoordinates(point) ? mapped : missing).push(point);
    }
    return { mapped, missing, mappedVotes:mapped.reduce((n,p)=>n+p.votes,0), missingVotes:missing.reduce((n,p)=>n+p.votes,0) };
  }
  const api = {grid,validCoordinates,preparePlaces};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.ElectoralMap=api;
})(typeof window !== 'undefined' ? window : globalThis);
