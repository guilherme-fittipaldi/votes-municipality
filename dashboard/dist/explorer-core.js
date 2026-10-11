/* Agregações por chaves oficiais: município + zona + seção/local. */
(function(root) {
  function sectionKey(m, z, s) { return `${m}:${z}:${s}`; }
  function prepare(data) {
    const votes = new Map();
    for (const [cid, m, z, s, value] of data.votes) {
      if (!votes.has(cid)) votes.set(cid, new Map());
      const key = sectionKey(m, z, s);
      votes.get(cid).set(key, (votes.get(cid).get(key) || 0) + value);
    }
    const totals = new Map();
    for (const [cid, , , value] of data.zones) totals.set(cid, (totals.get(cid) || 0) + value);
    const selections = new Map();
    for (const [id, candidate] of Object.entries(data.candidates)) {
      const key = `__all__:${candidate.office.toUpperCase()}`;
      selections.set(key, [...(selections.get(key) || []), id]);
    }
    return { ...data, voteIndex: votes, candidateTotals: totals, selections };
  }
  function selectionIds(data, candidate) {
    return data.selections?.get(candidate) || (data.candidates[candidate] ? [candidate] : []);
  }
  function votesFor(data, candidate) {
    const merged = new Map();
    for (const id of selectionIds(data, candidate)) for (const [key, value] of data.voteIndex.get(id) || []) merged.set(key, (merged.get(key) || 0) + value);
    return merged;
  }
  function totalFor(data, candidate) {
    return selectionIds(data, candidate).reduce((sum, id) => sum + (data.candidateTotals.get(id) || 0), 0);
  }
  function explore(data, filters) {
    if (!selectionIds(data, filters.candidate).length) return { available: false, rows: [], total: 0 };
    const candidateVotes = votesFor(data, filters.candidate);
    const groups = new Map();
    let total = 0, sectionsWithVotes = 0, sectionCount = 0;
    const placeKeys = new Set();
    for (const [m, z, s, p] of data.sections) {
      if (filters.municipality && filters.municipality !== m || filters.zone && filters.zone !== z || filters.place && filters.place !== p) continue;
      const place = data.places[p];
      const key = filters.level === 'zone' ? `${m}:${z}` : filters.level === 'place' ? p : sectionKey(m, z, s);
      if (!groups.has(key)) groups.set(key, {
        key, municipality_id: m, municipality: data.municipalities[m], zone: z,
        section: filters.level === 'section' ? s : '', place_key: filters.level === 'zone' ? '' : p,
        label: filters.level === 'zone' ? `Zona ${z}` : filters.level === 'place' ? place.name : `Seção ${s}`,
        place_name: filters.level === 'zone' ? '' : place.name,
        address: filters.level === 'zone' ? '' : place.address,
        neighborhood: filters.level === 'zone' ? '' : place.neighborhood,
        votes: 0, sections: 0, places: new Set(),
      });
      const value = candidateVotes.get(sectionKey(m, z, s)) || 0;
      const group = groups.get(key); group.votes += value; group.sections++; group.places.add(p);
      total += value; sectionCount++; if (value > 0) sectionsWithVotes++; placeKeys.add(p);
    }
    const rows = [...groups.values()].map(r => ({ ...r, places: r.places.size, share: total ? 100 * r.votes / total : 0 }));
    rows.sort((a, b) => b.votes - a.votes || a.municipality.localeCompare(b.municipality, 'pt-BR') || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
    return { available: true, rows, total, sectionCount, sectionsWithVotes, placeCount: placeKeys.size, regionTotal: totalFor(data, filters.candidate) };
  }
  const api = { prepare, explore, votesFor, totalFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ElectoralExplorer = api;
})(typeof window !== 'undefined' ? window : globalThis);
