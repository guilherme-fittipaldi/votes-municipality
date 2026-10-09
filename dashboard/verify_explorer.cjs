const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, explore } = require('./dist/explorer-core.js');
const data = prepare(JSON.parse(fs.readFileSync(path.join(__dirname,'dist/data/detailed-results.json'),'utf8')));
const mapCore = require('./dist/map-core.js');
assert.equal(Object.values(data.places).filter(mapCore.validCoordinates).length,478);
for (const id of Object.keys(data.candidates)) {
  for (const level of ['zone','place','section']) {
    const result = explore(data, { candidate: id, level });
    assert.equal(result.total, data.candidateTotals.get(id));
    assert.equal(result.rows.reduce((total,row)=>total+row.votes,0), result.total);
    assert.equal(result.sectionCount, 4361);
    assert.equal(result.placeCount, 480);
    if (level==='place') {
      const points=mapCore.preparePlaces(data,result.rows);
      assert.equal(points.mappedVotes+points.missingVotes,result.total);
      assert.equal(points.missing.length,2);
      for(const size of [1,2,5]) {
        const cells=mapCore.grid(points.mapped,size);
        assert.equal(cells.reduce((sum,c)=>sum+c.votes,0),points.mappedVotes);
        assert(cells.every(c=>Math.abs(c.areaKm2-size*size)<0.00001));
        assert(cells.every(c=>Math.abs(c.density*c.areaKm2-c.votes)<0.000001));
      }
    }
  }
  for (const m of Object.keys(data.municipalities)) {
    const expected = data.zones.filter(([cid,mid])=>cid===id&&mid===m).reduce((sum,r)=>sum+r[3],0);
    assert.equal(explore(data,{candidate:id,level:'place',municipality:m}).total,expected);
  }
}
assert.equal(explore(data,{candidate:'not-in-detailed-file',level:'section'}).available,false);
const example = explore(data,{candidate:'250002536889',level:'place'}).rows[0];
const narrow = explore(data,{candidate:'250002536889',level:'section',municipality:example.municipality_id,zone:example.zone,place:example.place_key});
assert.equal(narrow.total,example.votes);
assert.equal(narrow.placeCount,1);
console.log('Aggregations verified: all candidates, municipalities, three levels, zero coverage and local drill-down.');
console.log('Map verified: coordinates, unmapped votes, fixed-grid aggregation checks and vote conservation.');

async function browserChecks() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.EXPLORER_URL || 'http://127.0.0.1:8765/',{waitUntil:'networkidle'});
    await page.waitForSelector('#detailContent:not([hidden])');
    assert.equal(await page.locator('#metric').inputValue(),'candidate_votes');
    assert.equal(await page.locator('[data-level="place"]').getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#candidate option:checked').textContent(),/MAÍRA DE SOUZA/);
    assert.equal(await page.locator('#detailVotes').textContent(),'4.243');
    await page.waitForSelector('#neighborhoodRows tr');
    assert.match(await page.locator('#neighborhoodLeader').textContent(),/\S/);
    assert(Number(await page.locator('#neighborhoodVotes').textContent())>0);
    assert(await page.locator('#neighborhoodRows tr').count()>0);
    assert(await page.locator('#neighborhoodLowRows tr').count()>0);
    assert.match(await page.locator('#neighborhoodLowNote').textContent(),/não registraram votos/);
    await page.waitForSelector('#voteMap path.leaflet-interactive');
    assert.equal(await page.locator('#voteMap').getAttribute('data-mode'),'points');
    await page.locator('#voteMap').scrollIntoViewIfNeeded();
    const mapBox=await page.locator('#voteMap').boundingBox();
    const zoomBefore=Number(await page.locator('#voteMap').getAttribute('data-zoom'));
    await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);await page.mouse.wheel(0,-360);
    await page.waitForFunction(previous=>Number(document.querySelector('#voteMap').dataset.zoom)>previous,zoomBefore);
    assert.equal(await page.locator('#voteMap').getAttribute('data-place-count'),'478');
    assert.match(await page.locator('#mapCoverage').textContent(),/2 locais sem coordenadas/);
    assert.match(await page.locator('#mapLegend').textContent(),/0[\s\S]*1–10[\s\S]*11–20[\s\S]*21–30[\s\S]*31–39[\s\S]*40\+/);
    await page.locator('#mapZeros').uncheck();
    assert(Number(await page.locator('#voteMap').getAttribute('data-place-count'))<478);
    // Open a symbol through its accessible keyboard target, then drill into sections.
    await page.locator('#voteMap path.leaflet-interactive').first().focus();await page.keyboard.press('Enter');
    await page.waitForSelector('.map-explore-place');
    await page.locator('.map-explore-place').first().click();
    assert.equal(await page.locator('[data-level="section"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#voteMap').getAttribute('data-place-count'),'1');
    await page.locator('#resetDetails').click();
    await page.locator('[data-map-mode="density"]').click();
    await page.locator('#mapZeros').check();
    await page.locator('#detailMunicipality').selectOption('70718');
    assert(Number(await page.locator('#voteMap').getAttribute('data-place-count'))<478);
    const zoneSelectValues = await page.locator('#detailZone option').evaluateAll(nodes=>nodes.map(n=>n.value));
    assert(zoneSelectValues.length>1);
    await page.locator('[data-level="zone"]').click();
    await page.locator('#detailChart [data-drill]').first().click();
    assert.equal(await page.locator('[data-level="place"]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#detailZone').inputValue());
    await page.locator('#detailRows [data-drill]').first().click();
    assert.equal(await page.locator('[data-level="section"]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#detailPlace').inputValue());
    assert.match(await page.locator('#detailRows').textContent(),/Bairro:/);
    await page.locator('#detailZeros').check();
    const countBefore = await page.locator('#detailCount').textContent();
    await page.locator('#detailSearch').fill('a-search-with-no-matches');
    assert.match(await page.locator('#detailRows').textContent(),/Nenhum resultado/);
    await page.locator('#detailSearch').fill('');
    assert.equal(await page.locator('#detailCount').textContent(), countBefore);
    await page.locator('#metric').selectOption('percent_valid_votes');
    assert.equal(await page.locator('#detailCount').textContent(), countBefore);
    const promise=page.waitForEvent('download');await page.locator('#downloadDetails').click();const download=await promise;
    const csv=fs.readFileSync(await download.path(),'utf8');
    assert(csv.includes('share_of_filtered_candidate_votes'));
    assert(csv.includes('MAÍRA DE SOUZA'));
    await page.locator('#resetDetails').click();
    assert.equal(await page.locator('#detailVotes').textContent(),'4.243');
    await page.locator('#showNeighborhoodPlaces').click();
    assert.equal(await page.locator('[data-level="place"]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#detailSearch').inputValue());
    await page.locator('#resetDetails').click();
    await page.locator('#showLowNeighborhoodPlaces').click();
    assert.equal(await page.locator('[data-level="place"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#detailZeros').isChecked(),true);
    await page.locator('#resetDetails').click();
    await page.locator('[data-level="section"]').click();
    assert.equal(await page.locator('#detailRows tr').count(),25);
    await page.locator('#detailNext').click();assert.match(await page.locator('#detailPage').textContent(),/Página 2/);
    await page.locator('#detailHead .table-info').click();assert.match(await page.locator('.table-help').textContent(),/Parcela dos votos/);
    await page.keyboard.press('Escape');
    await page.locator('#office').selectOption('PRESIDENTE');
    await page.waitForSelector('#detailContent:not([hidden])');
    assert.match(await page.locator('#candidate option:checked').textContent(),/SAMARA/);
    assert.equal(await page.locator('#detailVotes').textContent(),'2.002');
    await page.locator('#office').selectOption('DEPUTADO ESTADUAL');
    await page.locator('#metric').selectOption('candidate_votes');
    await page.locator('#resetDetails').click();
    await page.locator('#explorerTitle').scrollIntoViewIfNeeded();
    await page.locator('.explorer').screenshot({path:'outputs/explorer-desktop.png'});
    await page.locator('.map-panel').screenshot({path:'outputs/map-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-level="place"]').click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    assert.equal(overflow,false,'Mobile page must not overflow horizontally');
    await page.locator('#explorerTitle').scrollIntoViewIfNeeded();
    await page.screenshot({path:'outputs/explorer-mobile.png'});
    await page.locator('.map-panel').screenshot({path:'outputs/map-mobile.png'});
    assert.deepEqual(errors,[]);
    console.log('Browser verified: heatmap, scroll zoom, neighborhood ranking and drill-down, point mode, zero locations, map-to-section navigation, cascading filters, search, pagination, CSV and mobile layout.');
  } finally { await browser.close(); }
}
if (process.argv.includes('--browser')) browserChecks().catch(e=>{console.error(e);process.exitCode=1;});
