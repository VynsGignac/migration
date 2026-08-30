// ============================================================
// ÉTAT DU JEU
// Ressources, bâtiments posés, ressources de terrain (arbres/pierre),
// chargements en transit sur le réseau, et ruines.
// Ne dessine rien : GameScene lit cet état pour l'afficher.
// ============================================================

const GameState = {
  cols: GameConfig.world.cols,
  rows: GameConfig.world.rows,
  // Stock central : seuls les Entrepôts y déposent (via une expédition qui arrive à destination).
  resources: Object.assign({ wood: 0, planks: 0, stone: 0, stoneBlocks: 0, wheat: 0, bread: 0, ore: 0, codex: 0 }, GameConfig.resources.starting),
  // Clé "col,row" -> { type, outputBuffer?, inputBuffer?, ruinLoot? }
  // Une case absente de la Map est considérée "vide".
  tiles: new Map(),
  // Clé "col,row" -> { type: 'tree'|'stone', amount: number }. Ressource naturelle du terrain,
  // exclusive avec tiles (on ne peut pas construire sur une case qui en porte une).
  resourceTiles: new Map(),
  // Chargements en cours de transport : { id, resource, amount, path:[{col,row},...], progress, fromKey, toKey, toType }
  shipments: [],
  nextShipmentId: 1,
  // Résultat du dernier calcul de allocateLabor (Map "col,row" -> { col, row, workers }),
  // recalculé à chaque tick de production. Lu par l'UI via getAssignedWorkers.
  laborAssignment: null,
  // Tirs de tour en cours d'affichage : { fromCol, fromRow, toX, toRow, ttl }, purement visuel
  // (les dégâts sont déjà appliqués au moment du tir) — voir GameScene.redrawShots.
  shots: [],
  // Nœuds débloqués dans GameConfig.techTree.nodes : "id" -> niveau atteint (>= 1). Absent de la Map
  // = niveau 0 = pas débloqué. Vide au départ : il n'y a plus de nœud racine commun (voir
  // GameConfig.techTree), chaque branche démarre directement débloquable (canResearchTech ci-dessous :
  // un nœud sans parent est toujours débloquable à son niveau 1).
  unlockedTech: new Map(),
  // Brouillard de guerre : ensemble ("col,row") des cases actuellement révélées par au moins un
  // bâtiment vivant (voir computeRevealedTiles). Recalculé entièrement à chaque changement de
  // bâtiments (voir buildingsDirty) plutôt que mémorisé au fil du temps : ce n'est pas "déjà vu",
  // c'est "actuellement couvert" — un bâtiment détruit cesse donc immédiatement de révéler sa zone.
  revealedTiles: new Set(),
  // Cases à portée d'au moins un Entrepôt (voir computeGuildZone/techTree.nodes.ind_guilde),
  // recalculé au même moment que revealedTiles (voir GameScene, sur buildingsDirty).
  guildZone: new Set(),
  // Cases à portée d'au moins une Université (voir computeUniversityZone/techTree.nodes.
  // rec_formateur), même principe que guildZone ci-dessus.
  universityZone: new Set(),
  // Mis à true par toute méthode qui change l'état visuel, lu puis remis à false par GameScene.
  dirty: true,
  // Mis à true seulement par les méthodes qui posent/détruisent un bâtiment (voir zoneRadiusFor/
  // computeRevealedTiles) : plus restreint que `dirty` (qui change aussi à chaque tick de
  // production), pour ne recalculer le brouillard de guerre que quand il peut vraiment changer.
  buildingsDirty: true,
  // Records de la partie (voir reset() pour le détail) : le MAXIMUM jamais atteint, affiché sur
  // l'écran de défaite (voir GameScene.computeGameOverStats, demande utilisateur explicite) --
  // PAS la valeur au moment de la défaite, qui peut avoir redescendu depuis.
  maxPopulation: 0,
  maxBuildings: 0,
  monstersKilled: 0,

  key(col, row) {
    return col + ',' + row;
  },

  getTile(col, row) {
    return this.tiles.get(this.key(col, row)) || { type: 'empty' };
  },

  getResourceTile(col, row) {
    return this.resourceTiles.get(this.key(col, row)) || null;
  },

  canAfford(cost) {
    for (const res in cost) {
      if ((this.resources[res] || 0) < cost[res]) return false;
    }
    return true;
  },

  spend(cost) {
    for (const res in cost) this.resources[res] -= cost[res];
  },

  // "Route" est le SEUL cas où l'appelant doit encore fournir un tile.type === 'road' déjà posé,
  // sinon buildingId identifie le chantier. Une Route reste instantanée (voir demande utilisateur
  // explicite) ; tout le reste passe par un chantier "underConstruction" tant que les ressources
  // n'ont pas été livrées depuis un Entrepôt (voir _spawnWarehouseConstructionDeliveries) -- un
  // chantier hors de portée de tout Entrepôt ne sera donc jamais terminé, c'est voulu.
  placeBuilding(col, row, buildingId) {
    const def = GameConfig.buildings[buildingId];
    if (!def) return { ok: false, reason: 'unknown' };
    const key = this.key(col, row);
    if (this.tiles.has(key)) return { ok: false, reason: 'occupied' };
    const resTile = this.resourceTiles.get(key);
    if (resTile) {
      // Seule une Route peut être posée sur du bois/blé, ce qui détruit la ressource (voir
      // demande utilisateur) -- la pierre reste bloquante, pas demandée.
      const roadClearsResource = buildingId === 'road' && (resTile.type === 'tree' || resTile.type === 'wheat');
      if (!roadClearsResource) return { ok: false, reason: 'resource' };
    }
    // Une route ne peut s'étendre qu'à partir d'une route déjà posée (voir _hasAdjacentRoad,
    // partagé avec la condition d'activation des Tours/Universités) : empêche de semer des
    // tronçons isolés sans connexion au réseau. L'Entrepôt de départ est entouré de routes dès le
    // début de la partie (voir GameScene.create) pour donner un premier point de départ.
    if (buildingId === 'road' && !this._hasAdjacentRoad(col, row)) return { ok: false, reason: 'noRoadAdjacent' };

    if (resTile) this.resourceTiles.delete(key);

    if (buildingId === 'road') {
      // Une route reste payée immédiatement (voir demande utilisateur explicite), donc encore
      // soumise à une vraie vérification de solde -- contrairement à un chantier ci-dessous, qui
      // n'est plus bloqué par le coût (demande utilisateur : "je n'ai plus besoin de vérifier si
      // les matériaux de construction sont disponibles maintenant... il restera en attente tant
      // que les ressources ne sont pas disponibles").
      if (!this.canAfford(def.cost)) return { ok: false, reason: 'cost' };
      this.spend(def.cost);
      this.tiles.set(key, { type: 'road' });
      this.dirty = true;
      this.buildingsDirty = true;
      return { ok: true };
    }

    this.tiles.set(key, {
      type: buildingId,
      underConstruction: true,
      constructionNeeded: { ...def.cost },
      constructionDelivered: Object.fromEntries(Object.keys(def.cost).map(r => [r, 0])),
    });
    this.dirty = true;
    this.buildingsDirty = true;
    return { ok: true };
  },

  // Termine un chantier (voir placeBuilding/_spawnWarehouseConstructionDeliveries) : bascule la
  // case en bâtiment opérationnel, avec exactement la même init que placeBuilding appliquait
  // auparavant tout de suite après avoir payé le coût.
  _completeConstruction(tile) {
    delete tile.underConstruction;
    delete tile.constructionNeeded;
    delete tile.constructionDelivered;
    const def = GameConfig.buildings[tile.type];
    if (def.kind === 'extractor' || def.kind === 'processor') tile.outputBuffer = 0;
    if (def.kind === 'processor' || def.kind === 'house') tile.inputBuffer = 0;
    if (def.plants) tile.plantTimer = 0;
    if (def.kind === 'house') {
      tile.population = def.startPopulation;
      tile.growthTimer = 0;
      tile.growTimer = 0;
      tile.hadDeficit = false;
    }
    if (def.kind === 'tower') tile.fireCooldown = 0;
    this.dirty = true;
    this.buildingsDirty = true;
  },

  // Transforme un Donjon déjà posé en Château (voir GameConfig.buildings.castle et techTree.
  // nodes.def_forgerie) : contrairement à placeBuilding, ne change QUE le type -- fireCooldown
  // et l'appartenance à une route restent ceux du Donjon, aucune raison de les réinitialiser.
  // "cost" sur buildings.castle est le coût de CETTE transformation, pas d'une construction neuve.
  upgradeToCastle(col, row) {
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (!tile || tile.type !== 'donjon' || tile.underConstruction) return { ok: false, reason: 'notDonjon' };
    if (!this.isTechUnlocked('def_forgerie')) return { ok: false, reason: 'locked' };
    const cost = GameConfig.buildings.castle.cost;
    if (!this.canAfford(cost)) return { ok: false, reason: 'cost' };

    this.spend(cost);
    tile.type = 'castle';
    this.dirty = true;
    this.buildingsDirty = true;
    return { ok: true };
  },

  // Rayon de la "zone d'action" d'un bâtiment selon son type (même logique que GameScene.
  // redrawActionZone, dont c'est en fait le calcul de rayon extrait pour être partagé) : null si le
  // bâtiment n'a pas de zone d'action (route, université). Sert aussi de base au rayon de brouillard
  // de guerre (+2, voir computeRevealedTiles).
  zoneRadiusFor(type) {
    const def = GameConfig.buildings[type];
    if (!def) return null;
    if (def.kind === 'extractor') return def.extractRadius;
    if (def.kind === 'processor') return def.linkRange;
    if (def.kind === 'house') return GameConfig.population.laborRadius;
    if (def.kind === 'tower') return this.towerRange(def);
    if (def.kind === 'watchtower') return def.range;
    if (def === GameConfig.buildings.warehouse) return this.warehouseZoneRadius();
    // Même rayon que l'Entrepôt (voir plus haut), faute d'un rayon dédié à l'Université dans sa
    // config -- ne servait jusqu'ici à rien (l'Université ouvre l'arbre techno, pas de zone/
    // brouillard de guerre) ; sert maintenant à Formateur (voir computeUniversityZone ci-dessous).
    if (def.kind === 'university') return GameConfig.logistics.linkRange;
    return null;
  },

  // Recalcule entièrement l'ensemble des cases révélées (voir revealedTiles) à partir des
  // bâtiments actuellement en place. Appelé par GameScene seulement quand buildingsDirty (pas à
  // chaque frame : coûteux si la ville est grande, et inutile puisque seuls les bâtiments posés/
  // détruits peuvent changer le résultat).
  computeRevealedTiles() {
    // DÉSACTIVÉ TEMPORAIREMENT (demande utilisateur explicite, pour inspecter la horde/les
    // nouveaux visuels sans le brouillard de guerre) : révèle toute la carte d'un coup plutôt que
    // de calculer la vraie portée des bâtiments -- tous les autres endroits qui lisent
    // revealedTiles (redrawFog/redrawTileArt/redrawMonsters/redrawBuildings) en profitent
    // automatiquement, un seul endroit à changer. Remettre la ligne juste en dessous (commentée)
    // pour réactiver le vrai calcul.
    const revealed = new Set();
    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) revealed.add(this.key(col, row));
    }
    this.revealedTiles = revealed;
    return;
    // Code original, inatteignable tant que le return ci-dessus reste -- gardé tel quel pour
    // pouvoir réactiver le vrai calcul juste en retirant ce return.
    for (const [key, tile] of this.tiles) {
      if (tile.underConstruction) continue; // pas encore opérationnel, pas de zone/brouillard révélé
      const radius = this.zoneRadiusFor(tile.type);
      if (radius == null) continue;
      const [col, row] = key.split(',').map(Number);
      for (const c of HexUtils.hexesInRange(col, row, radius + 2, this.cols, this.rows)) {
        revealed.add(this.key(c.col, c.row));
      }
    }
    this.revealedTiles = revealed;
  },

  // Cases à portée d'au moins un Entrepôt (voir techTree.nodes.ind_guilde) : recalculé au même
  // moment que revealedTiles ci-dessus (seuls les bâtiments posés/détruits peuvent le changer),
  // pas à chaque tick de production. GameConfig.logistics.linkRange, pas zoneRadiusFor(warehouse)
  // (qui inclut +2 de marge pour le brouillard de guerre — ici on veut le rayon d'action réel).
  computeGuildZone() {
    const zone = new Set();
    for (const [key, tile] of this.tiles) {
      if (tile.type !== 'warehouse' || tile.underConstruction) continue;
      const [col, row] = key.split(',').map(Number);
      for (const c of HexUtils.hexesInRange(col, row, this.warehouseZoneRadius(), this.cols, this.rows)) {
        zone.add(this.key(c.col, c.row));
      }
    }
    this.guildZone = zone;
  },

  // Cases à portée d'au moins une Université (voir techTree.nodes.rec_formateur) : même principe
  // que computeGuildZone ci-dessus.
  computeUniversityZone() {
    const zone = new Set();
    for (const [key, tile] of this.tiles) {
      if (tile.type !== 'university' || tile.underConstruction) continue;
      const [col, row] = key.split(',').map(Number);
      for (const c of HexUtils.hexesInRange(col, row, GameConfig.logistics.linkRange, this.cols, this.rows)) {
        zone.add(this.key(c.col, c.row));
      }
    }
    this.universityZone = zone;
  },

  // Peuple la carte de zones d'arbres et de pierre, à distance de l'Entrepôt de départ.
  generateResourceBlobs() {
    const cfg = GameConfig.resourceNodes;
    this._spawnBlobs('tree', cfg.blobCountTree, cfg);
    this._spawnBlobs('stone', cfg.blobCountStone, cfg);
    this._spawnSingleTiles('corpse', cfg.corpseCount, cfg);
    this._ensureStartingVisibility(cfg);
  },

  // Anti-softlock (demande utilisateur explicite) : garantit qu'au moins une case de bois ET une
  // case de pierre sont dans la ZONE D'ACTION de l'Entrepôt de départ dès le lancement (pas
  // seulement visibles dans le brouillard de guerre, un rayon plus large mais inutile si aucun
  // Camp posé à portée ne peut jamais expédier jusqu'à l'Entrepôt -- voir demande utilisateur
  // explicite). Même rayon que warehouseZoneRadius() (zoneRadiusFor('warehouse'), SANS la marge
  // +2 de computeRevealedTiles) : la portée réelle à laquelle un Camp de Bûcheron/Mineur posé là
  // peut relier l'Entrepôt. Les blobs ci-dessus sont placés au hasard sur toute la carte -- rien
  // ne garantissait qu'un joueur ait ne serait-ce qu'UNE case de chaque ressource exploitable
  // sans déjà avoir étendu son réseau de routes au petit bonheur. Appelé après _spawnBlobs, donc
  // ce filet de sécurité ne s'active que si le hasard n'a vraiment rien mis à portée.
  _ensureStartingVisibility(cfg) {
    const startCol = GameConfig.world.startCol;
    const startRow = Math.floor(this.rows / 2);
    const actionRadius = this.warehouseZoneRadius();
    const ring = HexUtils.hexesInRange(startCol, startRow, actionRadius, this.cols, this.rows);

    for (const type of ['tree', 'stone']) {
      const alreadyVisible = ring.some((c) => {
        const t = this.resourceTiles.get(this.key(c.col, c.row));
        return t && t.type === type;
      });
      if (alreadyVisible) continue;

      // Cherche une case libre dans cet anneau visible mais hors dégagement de départ (voir
      // _withinStartClearance) : quelques tentatives avec une graine aléatoire à chaque fois,
      // même principe que _spawnBlobs -- la zone est petite, ça suffit presque toujours à
      // trouver une place pour un blob de taille minimale.
      for (let attempt = 0; attempt < 100; attempt++) {
        const cand = ring[Math.floor(Math.random() * ring.length)];
        if (this._withinStartClearance(cand.col, cfg.startClearance)) continue;
        const blobTiles = this._growBlob(cand.col, cand.row, cfg.blobSizeMin, cfg.startClearance);
        if (blobTiles.length === 0) continue;
        for (const t of blobTiles) {
          const amount = cfg[type].amountMin + Math.floor(Math.random() * (cfg[type].amountMax - cfg[type].amountMin + 1));
          this.resourceTiles.set(this.key(t.col, t.row), { type, amount });
        }
        break;
      }
    }
  },

  // Cadavre de monstre (voir resourceNodes.corpseCount/buildings.recycler) : contrairement aux
  // amas de _spawnBlobs ci-dessous, une seule case isolée par occurrence -- rare et dispersée
  // plutôt que groupée.
  _spawnSingleTiles(type, count, cfg) {
    const clearance = cfg.startClearance;
    // Marge haut/bas (voir resourceNodes.corpse.edgeRowMargin, demande utilisateur explicite) :
    // ne s'applique qu'à CETTE génération de départ, pas aux cadavres laissés par un monstre tué
    // (voir _maybeDropCorpse, qui n'a aucune restriction de rangée -- un monstre meurt où il meurt).
    const edgeRowMargin = (cfg[type] && cfg[type].edgeRowMargin) || 0;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 30) {
      attempts++;
      const col = Math.floor(Math.random() * this.cols);
      const row = Math.floor(Math.random() * this.rows);
      if (row < edgeRowMargin || row >= this.rows - edgeRowMargin) continue;
      if (this._withinStartClearance(col, clearance)) continue;
      if (!this._tileIsFreeForResource(col, row)) continue;
      const amount = cfg[type].amountMin + Math.floor(Math.random() * (cfg[type].amountMax - cfg[type].amountMin + 1));
      this.resourceTiles.set(this.key(col, row), { type, amount });
      placed++;
    }
  },

  _spawnBlobs(type, count, cfg) {
    const clearance = cfg.startClearance;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 15) {
      attempts++;
      const seedCol = Math.floor(Math.random() * this.cols);
      const seedRow = Math.floor(Math.random() * this.rows);
      if (this._withinStartClearance(seedCol, clearance)) continue;

      const size = cfg.blobSizeMin + Math.floor(Math.random() * (cfg.blobSizeMax - cfg.blobSizeMin + 1));
      const blobTiles = this._growBlob(seedCol, seedRow, size, clearance);
      if (blobTiles.length === 0) continue;

      for (const t of blobTiles) {
        const amount = cfg[type].amountMin + Math.floor(Math.random() * (cfg[type].amountMax - cfg[type].amountMin + 1));
        this.resourceTiles.set(this.key(t.col, t.row), { type, amount });
      }
      placed++;
    }
  },

  _withinStartClearance(col, clearance) {
    const dc = Math.abs(HexUtils.wrapCol(col, this.cols) - GameConfig.world.startCol);
    return Math.min(dc, this.cols - dc) < clearance;
  },

  // Fait pousser un amas irrégulier de `size` cases autour d'une graine, en évitant les cases
  // déjà occupées (bâtiment ou autre ressource) et la zone de dégagement de départ.
  // Peut renvoyer moins de `size` cases si la place manque.
  _growBlob(seedCol, seedRow, size, clearance) {
    const wrappedSeedCol = HexUtils.wrapCol(seedCol, this.cols);
    if (!this._tileIsFreeForResource(wrappedSeedCol, seedRow)) return [];

    const result = [{ col: wrappedSeedCol, row: seedRow }];
    const visited = new Set([this.key(wrappedSeedCol, seedRow)]);
    let frontier = [{ col: seedCol, row: seedRow }];
    let guard = 0;

    while (result.length < size && frontier.length > 0 && guard < size * 20) {
      guard++;
      const idx = Math.floor(Math.random() * frontier.length);
      const cur = frontier[idx];
      const candidates = HexUtils.neighbors(cur.col, cur.row).filter(n => n.row >= 0 && n.row < this.rows);
      if (candidates.length === 0) { frontier.splice(idx, 1); continue; }

      const n = candidates[Math.floor(Math.random() * candidates.length)];
      const wrappedCol = HexUtils.wrapCol(n.col, this.cols);
      const k = this.key(wrappedCol, n.row);
      if (visited.has(k)) continue;
      visited.add(k);
      if (this._withinStartClearance(n.col, clearance)) continue;

      if (this._tileIsFreeForResource(wrappedCol, n.row)) {
        result.push({ col: wrappedCol, row: n.row });
        frontier.push({ col: n.col, row: n.row });
      }
    }
    return result;
  },

  _tileIsFreeForResource(col, row) {
    const k = this.key(col, row);
    return !this.resourceTiles.has(k) && !this.tiles.has(k);
  },

  // Cherche par BFS (le long des ROUTES uniquement — voir plus bas) TOUS les bâtiments dont le
  // type figure dans targetTypes, à au plus maxRange cases, et renvoie le chemin vers celui qui a
  // le plus BESOIN (meilleur scoreFn(tile), typiquement la place encore libre dans son
  // inputBuffer) plutôt que simplement le plus proche. À distance égale de score, le plus proche
  // gagne (la BFS visite les cases proches en premier, et un score strictement supérieur est requis
  // pour remplacer le meilleur trouvé jusque-là).
  // scoreFn(tile) doit renvoyer un nombre (plus haut = plus prioritaire) ; toute valeur <= 0 écarte
  // la cible (ex : déjà pleine — bug vécu : un Entrepôt/une Ferme proche de 2 Maisons/Boulangeries
  // n'en nourrissait qu'une seule, toujours la même, l'autre était totalement ignorée puisque la
  // recherche s'arrêtait sur la première trouvée sans jamais regarder si elle avait encore de la
  // place).
  // Version générale de findBestPathToBuildingType ci-dessous (qui n'est plus qu'un raccourci
  // dessus) : matchFn(tile) plutôt qu'une liste de types fixe, pour pouvoir chercher "n'importe
  // quel chantier qui a encore besoin de telle ressource" (voir
  // _spawnWarehouseConstructionDeliveries), pas juste un type de bâtiment précis.
  findBestPath(fromCol, fromRow, matchFn, maxRange, scoreFn) {
    const visited = new Set([this.key(fromCol, fromRow)]);
    let frontier = [{ col: fromCol, row: fromRow, path: [{ col: fromCol, row: fromRow }] }];
    let best = null;

    for (let step = 0; step < maxRange; step++) {
      const next = [];
      for (const cur of frontier) {
        for (const n of HexUtils.neighbors(cur.col, cur.row)) {
          if (n.row < 0 || n.row >= this.rows) continue;
          const wrappedCol = HexUtils.wrapCol(n.col, this.cols);
          const key = this.key(wrappedCol, n.row);
          if (visited.has(key)) continue;
          visited.add(key);

          const tile = this.tiles.get(key);
          if (!tile) continue;

          if (matchFn(tile, key)) {
            const score = scoreFn(tile, key);
            if (score > 0 && (!best || score > best.score)) {
              const newPath = [...cur.path, { col: wrappedCol, row: n.row }];
              best = { path: newPath, targetCol: wrappedCol, targetRow: n.row, score };
            }
            continue; // pas un relais (voir plus bas) : une cible qui matche n'est jamais traversée
          }
          // Seule une route sert de relais : un autre bâtiment (ou une ruine) bloque le passage —
          // un chargement ne doit pas "couper à travers" une maison/ferme/etc. pour raccourcir son
          // trajet (bug vécu : le bois traversait des maisons au lieu de suivre la route).
          if (tile.type !== 'road') continue;
          const newPath = [...cur.path, { col: wrappedCol, row: n.row }];
          next.push({ col: n.col, row: n.row, path: newPath });
        }
      }
      frontier = next;
    }
    return best;
  },

  // targetTypes ET jamais un chantier "underConstruction" : un bâtiment pas encore terminé ne
  // doit recevoir ni matières premières de production NI pain (voir _spawnShipments/
  // _spawnWarehouseBread, les deux seuls appelants) -- seulement ses matériaux de construction,
  // via _spawnWarehouseConstructionDeliveries.
  findBestPathToBuildingType(fromCol, fromRow, targetTypes, maxRange, scoreFn) {
    return this.findBestPath(fromCol, fromRow, (tile) => targetTypes.includes(tile.type) && !tile.underConstruction, maxRange, scoreFn);
  },

  // Vrai si au moins un Entrepôt opérationnel est à portée par la route (voir
  // warehouseZoneRadius) -- utilisé par l'UI (voir GameScene.buildingInfoText) pour prévenir
  // qu'un chantier hors de portée de tout Entrepôt ne recevra jamais rien (voir
  // _spawnWarehouseConstructionDeliveries, demande utilisateur explicite).
  hasWarehouseInRange(col, row) {
    return !!this.findBestPathToBuildingType(col, row, ['warehouse'], this.warehouseZoneRadius(), () => 1);
  },

  // Distance en pas par la route (BFS le long des ROUTES uniquement, voir findBestPathToBuildingType)
  // entre deux cases précises. Contrairement à findBestPathToBuildingType (qui cherche le
  // MEILLEUR score d'un TYPE), ici on mesure la distance vers une case précise, pour départager deux candidats à
  // égalité de travailleurs. Renvoie Infinity si aucun chemin n'est trouvé dans maxRange pas
  // (le candidat reste éligible, juste moins prioritaire).
  _roadDistance(fromCol, fromRow, toCol, toRow, maxRange) {
    if (fromCol === toCol && fromRow === toRow) return 0;
    const targetKey = this.key(toCol, toRow);
    const visited = new Set([this.key(fromCol, fromRow)]);
    let frontier = [{ col: fromCol, row: fromRow }];

    for (let step = 1; step <= maxRange; step++) {
      const next = [];
      for (const cur of frontier) {
        for (const n of HexUtils.neighbors(cur.col, cur.row)) {
          if (n.row < 0 || n.row >= this.rows) continue;
          const wrappedCol = HexUtils.wrapCol(n.col, this.cols);
          const key = this.key(wrappedCol, n.row);
          if (visited.has(key)) continue;
          visited.add(key);
          if (key === targetKey) return step;

          const tile = this.tiles.get(key);
          if (!tile || tile.type !== 'road') continue;
          next.push({ col: n.col, row: n.row });
        }
      }
      frontier = next;
    }
    return Infinity;
  },

  // BFS le long des ROUTES uniquement (même règle de traversée que findBestPath : seule une route
  // sert de relais, un bâtiment est une case atteignable mais n'en prolonge jamais le chemin),
  // mais collecte TOUT ce qui est atteignable en `maxRange` pas plutôt qu'un seul meilleur
  // candidat -- utilisé pour visualiser la vraie portée d'un Entrepôt (voir GameScene.
  // redrawActionZone, demande utilisateur explicite : "une indication qui indique sur les routes
  // uniquement les bâtiments à portée", plus fidèle qu'un simple cercle de cases à vol d'oiseau,
  // qui peut englober des bâtiments non reliés ou exclure des bâtiments reliés par une route
  // sinueuse plus longue que le rayon à vol d'oiseau).
  roadReachableFrom(fromCol, fromRow, maxRange) {
    const roadCells = new Set();
    const buildingCells = new Set();
    const visited = new Set([this.key(fromCol, fromRow)]);
    let frontier = [{ col: fromCol, row: fromRow }];

    for (let step = 0; step < maxRange; step++) {
      const next = [];
      for (const cur of frontier) {
        for (const n of HexUtils.neighbors(cur.col, cur.row)) {
          if (n.row < 0 || n.row >= this.rows) continue;
          const wrappedCol = HexUtils.wrapCol(n.col, this.cols);
          const key = this.key(wrappedCol, n.row);
          if (visited.has(key)) continue;
          visited.add(key);

          const tile = this.tiles.get(key);
          if (!tile) continue;
          if (tile.type === 'road') {
            roadCells.add(key);
            next.push({ col: n.col, row: n.row });
          } else {
            buildingCells.add(key);
          }
        }
      }
      frontier = next;
    }
    return { roadCells, buildingCells };
  },

  // Répartit les habitants de toutes les Maisons vers les bâtiments de production (extracteurs,
  // processeurs, tours) à portée : un habitant = un poste dans un seul bâtiment (jamais compté deux fois).
  // Pour chaque Maison, ses habitants sont affectés un par un aux bâtiments à laborRadius cases,
  // en choisissant à chaque fois le bâtiment avec le MOINS de travailleurs déjà affectés (pour
  // répartir la couverture), et en cas d'égalité le plus proche PAR LA ROUTE. Recalculé à chaque
  // tick de production (léger : quelques dizaines de bâtiments/maisons en pratique).
  // Renvoie une Map "col,row" -> nombre de travailleurs affectés à ce bâtiment.
  allocateLabor() {
    const houses = [];
    const producers = new Map();
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || tile.underConstruction) continue;
      if (def.kind === 'house') {
        const [col, row] = key.split(',').map(Number);
        houses.push({ col, row, population: tile.population });
      } else if ((def.kind === 'extractor' || def.kind === 'processor' || def.kind === 'tower') && tile.type !== 'recycler') {
        // Recycleur exclu (voir buildings.recycler/tickProduction) : toujours à pleine efficacité
        // sans main-d'œuvre, ça ne servirait qu'à détourner inutilement des habitants d'un
        // bâtiment qui, lui, en profiterait vraiment.
        const [col, row] = key.split(',').map(Number);
        // Apprentissage (voir techTree.nodes.ind_apprentissage) / Service militaire (voir
        // techTree.nodes.def_service, même principe pour les tours) : ces bâtiments démarrent
        // avec 1 travailleur déjà compté, avant même la répartition des habitants ci-dessous --
        // l'algorithme glouton (le moins staffé d'abord) leur envoie donc naturellement moins
        // d'habitants réels pour atteindre le même plein rendement.
        const freeWorker =
          (def.kind === 'processor' && this.isTechUnlocked('ind_apprentissage')) ||
          (def.kind === 'tower' && this.isTechUnlocked('def_service'))
            ? 1 : 0;
        producers.set(key, { col, row, workers: freeWorker });
      }
    }

    const radius = GameConfig.population.laborRadius;
    const roadRange = GameConfig.population.laborRoadSearchRange;
    for (const house of houses) {
      const candidates = HexUtils.hexesInRange(house.col, house.row, radius, this.cols, this.rows)
        .map(p => producers.get(this.key(p.col, p.row)))
        .filter(Boolean);
      if (candidates.length === 0) continue;

      const distanceCache = new Map();
      for (const cand of candidates) {
        const dist = this._roadDistance(house.col, house.row, cand.col, cand.row, roadRange);
        distanceCache.set(cand, dist);
      }

      for (let worker = 0; worker < house.population; worker++) {
        candidates.sort((a, b) => {
          if (a.workers !== b.workers) return a.workers - b.workers;
          return distanceCache.get(a) - distanceCache.get(b);
        });
        candidates[0].workers += 1;
      }
    }

    return producers;
  },

  // Nombre de travailleurs actuellement affectés à ce bâtiment, d'après le dernier calcul de
  // allocateLabor (mis à jour à chaque tick de production). Utilisé par l'UI pour l'afficher.
  getAssignedWorkers(col, row) {
    if (!this.laborAssignment) return 0;
    const entry = this.laborAssignment.get(this.key(col, row));
    return entry ? entry.workers : 0;
  },

  // Nombre de travailleurs supplémentaires qu'il faudrait pour amener CHAQUE bâtiment de
  // production à 100 % d'efficacité (somme des manques par bâtiment, pas un simple total de
  // postes) — voir efficiencyForWorkers. Affiché dans le bandeau (GameScene) pour indiquer si la
  // population actuelle suffit à faire tourner l'économie à plein régime.
  neededWorkers() {
    if (!this.laborAssignment) return 0;
    const baseFullStaff = GameConfig.population.efficiencyByWorkers.length - 1;
    // Les bâtiments de Production plafonnent à 3 travailleurs, pas 4 (voir population.
    // efficiencyByWorkersProduction/tickProduction) -- sinon ce compteur réclamerait toujours 1
    // travailleur de trop pour un Camp/une Ferme/une Scierie déjà à 100 %.
    const productionFullStaff = GameConfig.population.efficiencyByWorkersProduction.length - 1;
    let needed = 0;
    for (const [key, entry] of this.laborAssignment) {
      // laborAssignment est un instantané du dernier tick de production (voir tickProduction,
      // pas recalculé à chaque frame) : un bâtiment qu'il référence a pu être détruit depuis
      // (démolition, horde...) sans que cette Map soit rafraîchie avant le prochain tick --
      // jusque-là sa case pointe vers une ruine (voire plus aucune entrée) plutôt qu'un vrai
      // bâtiment. Bug vécu pour de vrai : ça faisait planter tout le jeu, cette fonction étant
      // appelée à chaque frame par le HUD (voir GameScene.update).
      const tile = this.tiles.get(key);
      const def = tile && GameConfig.buildings[tile.type];
      if (!def) continue;
      // Le Château (voir buildings.castle.capMultiplier) absorbe utilement 2x plus de
      // travailleurs qu'un Donjon normal -- sinon ce compteur dirait "complet" à 4 alors qu'il
      // pourrait encore en accueillir 4 de plus (voir efficiencyForWorkers).
      const isProduction = def.kind === 'extractor' || def.kind === 'processor';
      const fullStaff = (isProduction ? productionFullStaff : baseFullStaff) * (def.capMultiplier || 1);
      needed += Math.max(0, fullStaff - entry.workers);
    }
    return needed;
  },

  // Places de logement encore libres, toutes Maisons confondues (populationCap - population).
  availableHousing() {
    let available = 0;
    for (const [, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (def && def.kind === 'house' && !tile.underConstruction) available += this.housePopulationCap(def) - tile.population;
    }
    return available;
  },

  // Estimation "à l'instant t" du gain/perte NET par minute réelle, pour les 3 ressources finales
  // principales (planches/pierre taillée/pain) -- demande utilisateur explicite : une PROJECTION
  // du régime actuel, pas une moyenne glissante sur l'historique. Version STRUCTURELLE (pas gated
  // sur l'état instantané d'un chargement en cours) : une première version regardait "un
  // producteur/Entrepôt encore inactif enverrait-il un chargement MAINTENANT", mais comme un
  // producteur/Entrepôt reste "occupé" pendant tout le trajet d'un chargement, cette éligibilité
  // n'est vraie qu'un bref instant par cycle -- bug vécu, signalé par l'utilisateur : "la valeur
  // vaut 0 sauf quand un paquet est reçu, puis repasse à 0". Ici, on ignore l'état d'occupation
  // et on calcule un débit SOUTENABLE : le plus petit des deux goulots possibles (cadence de
  // production réelle -- comme tickProduction -- et capacité de livraison, shipBatchSize divisé
  // par le temps de trajet réel d'après le chemin trouvé), tant qu'un chemin STRUCTUREL existe.
  // Change seulement quand la topologie (routes/bâtiments) ou la main-d'œuvre change, pas à
  // chaque cycle de livraison individuel -- d'où la stabilité demandée.
  estimateResourceRates() {
    const labor = this.allocateLabor();
    const batch = GameConfig.logistics.shipBatchSize;

    const roueLevel = this.techLevel('log_roue');
    const roueBonus = roueLevel > 0 ? GameConfig.techTree.nodes.log_roue.speedBonusByLevel[roueLevel - 1] : 0;
    const shipSpeed = GameConfig.logistics.shipSpeed * (1 + roueBonus);

    const expertiseLevel = this.techLevel('ind_expertise');
    const expertiseBonus = expertiseLevel > 0 ? GameConfig.techTree.nodes.ind_expertise.speedBonusByLevel[expertiseLevel - 1] : 0;
    const guildLevel = this.techLevel('ind_guilde');
    const guildBonusValue = guildLevel > 0 ? GameConfig.techTree.nodes.ind_guilde.productionBonusByLevel[guildLevel - 1] : 0;
    const alphabetisationLevel = this.techLevel('rec_alphabetisation');
    const alphabetisationBonus = alphabetisationLevel > 0 ? GameConfig.techTree.nodes.rec_alphabetisation.efficiencyBonusByLevel[alphabetisationLevel - 1] : 0;
    const formateurBonus = this.isTechUnlocked('rec_formateur') ? GameConfig.techTree.nodes.rec_formateur.zoneBonus : 0;

    const perSecond = { planks: 0, stoneBlocks: 0, bread: 0 };

    // Entrées : débit soutenable producteur -> Entrepôt (voir _spawnShipments). Un chemin
    // structurel qui existe suffit (voir findBestPathToBuildingType, scoreFn constant -- on ne
    // cherche pas ici quelle cible précise a le plus de place, juste qu'UNE existe).
    const outputResourceOf = { sawmill: 'planks', stonecutter: 'stoneBlocks', bakery: 'bread' };
    for (const [key, tile] of this.tiles) {
      const res = outputResourceOf[tile.type];
      const def = GameConfig.buildings[tile.type];
      if (!res || !def || tile.underConstruction) continue;
      const [col, row] = key.split(',').map(Number);
      let found = null;
      for (const targetType of def.linkTargets) {
        found = this.findBestPathToBuildingType(col, row, [targetType], def.linkRange, () => 1);
        if (found) break;
      }
      if (!found) continue;

      const travelTime = (found.path.length - 1) / shipSpeed;
      const deliveryCapacity = batch / travelTime;
      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers);
      const speedMultiplier = 1 + expertiseBonus + alphabetisationBonus
        + (this.guildZone.has(key) ? guildBonusValue : 0)
        + (this.universityZone.has(key) ? formateurBonus : 0);
      const productionRate = def.rate * efficiency * speedMultiplier;
      perSecond[res] += Math.min(deliveryCapacity, productionRate);
    }

    // Sorties (pain) : demande réelle des Maisons (population * consommation, voir tickProduction)
    // -- toujours stable, ne dépend que de la population, jamais du hasard des trajets.
    const nutritionLevel = this.techLevel('pop_nutrition');
    const breadReduction = nutritionLevel > 0
      ? GameConfig.techTree.nodes.pop_nutrition.breadReductionByLevel[nutritionLevel - 1] : 0;
    for (const [, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'house' || tile.underConstruction) continue;
      perSecond.bread -= tile.population * def.consumptionPerPerson * (1 - breadReduction);
    }

    // Sorties (planches/pierre taillée) : capacité de livraison Entrepôt -> chantier le plus
    // proche qui en a encore besoin (voir _spawnWarehouseConstructionDeliveries), même logique
    // structurelle que les entrées ci-dessus.
    for (const [key, tile] of this.tiles) {
      if (tile.type !== 'warehouse' || tile.underConstruction) continue;
      const [col, row] = key.split(',').map(Number);
      for (const res of ['planks', 'stoneBlocks']) {
        const found = this.findBestPath(col, row, (t) => {
          return t.underConstruction && t.constructionNeeded[res] > t.constructionDelivered[res];
        }, this.warehouseZoneRadius(), (t) => t.constructionNeeded[res] - t.constructionDelivered[res]);
        if (!found) continue;
        const travelTime = (found.path.length - 1) / shipSpeed;
        perSecond[res] -= batch / travelTime;
      }
    }

    const toPerMinute = 60 * GameConfig.simulation.speed;
    return {
      planks: perSecond.planks * toPerMinute,
      stoneBlocks: perSecond.stoneBlocks * toPerMinute,
      bread: perSecond.bread * toPerMinute,
    };
  },

  // Efficacité (0-1) selon le nombre de travailleurs affectés à un bâtiment (voir
  // GameConfig.population.efficiencyByWorkers) : une courbe, pas un tout-ou-rien. Au-delà du
  // dernier palier configuré, l'efficacité reste à sa dernière valeur (100 % par défaut).
  // capMultiplier > 1 (voir buildings.castle) : au-delà du palier normal (les 4 premiers
  // travailleurs, table[0..4] = 50-100 %), chaque palier de travailleurs SUPPLÉMENTAIRE ajoute le
  // même gain marginal qu'à son équivalent dans le palier normal (le 5e travailleur apporte le
  // même gain que le 1er, etc.) -- PAS un simple ×capMultiplier, qui doublerait aussi le socle de
  // 50 % obtenu à 0 travailleur. Pour capMultiplier=1 (tout le reste), se comporte EXACTEMENT
  // comme avant (aucun palier supplémentaire).
  efficiencyForWorkers(workers, capMultiplier = 1, table = GameConfig.population.efficiencyByWorkers) {
    const maxIndex = table.length - 1;
    const baseline = table[0];
    let total = table[Math.min(workers, maxIndex)];
    let remaining = workers - maxIndex;
    for (let tier = 1; tier < capMultiplier && remaining > 0; tier++) {
      total += table[Math.min(remaining, maxIndex)] - baseline;
      remaining -= maxIndex;
    }
    return total;
  },

  tickProduction(dtSeconds) {
    // 0. Plantation (bâtiments avec plants: true, ex. la Ferme) : crée périodiquement de
    // nouvelles cases de sa ressource dans son rayon, tant qu'il reste de la place libre et
    // que le nombre de cases déjà plantées n'a pas atteint maxPatches. C'est ce qui permet à
    // la Ferme de cultiver son propre blé en boucle au lieu d'épuiser des cases naturelles.
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || !def.plants || tile.underConstruction) continue;

      tile.plantTimer += dtSeconds;
      // Labourage (voir techTree.nodes.ind_labourage) : vise explicitement "les champs de blé",
      // donc seulement la Ferme -- pas un bonus générique à tout bâtiment plants:true.
      const plantSpeedBonus = (tile.type === 'farm' && this.isTechUnlocked('ind_labourage'))
        ? GameConfig.techTree.nodes.ind_labourage.plantSpeedBonus : 0;
      const effectivePlantInterval = def.plantInterval / (1 + plantSpeedBonus);
      if (tile.plantTimer < effectivePlantInterval) continue;
      tile.plantTimer = 0;

      const [col, row] = key.split(',').map(Number);
      const inRange = HexUtils.hexesInRange(col, row, def.extractRadius, this.cols, this.rows);
      const currentPatches = inRange.reduce((count, p) => {
        const res = this.resourceTiles.get(this.key(p.col, p.row));
        return count + (res && res.type === def.resource ? 1 : 0);
      }, 0);
      if (currentPatches >= def.maxPatches) continue;

      const emptySpots = inRange.filter(p => this._tileIsFreeForResource(p.col, p.row));
      if (emptySpots.length === 0) continue;
      const spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
      this.resourceTiles.set(this.key(spot.col, spot.row), { type: def.resource, amount: def.patchAmount });
      this.dirty = true;
    }

    // 0.5 Main-d'œuvre : répartit les habitants disponibles vers les bâtiments de production
    // (un par poste, voir allocateLabor). Recalculé avant les boucles d'extraction/transformation
    // ci-dessous, qui lisent le résultat pour déterminer leur efficacité.
    const labor = this.allocateLabor();
    this.laborAssignment = labor;

    // Bonus de la branche Industrie de l'arbre techno (voir GameConfig.techTree.nodes), calculés
    // une fois avant les boucles d'extraction/transformation ci-dessous plutôt qu'à chaque bâtiment.
    const expertiseLevel = this.techLevel('ind_expertise');
    const expertiseBonus = expertiseLevel > 0
      ? GameConfig.techTree.nodes.ind_expertise.speedBonusByLevel[expertiseLevel - 1] : 0;
    const guildLevel = this.techLevel('ind_guilde');
    const guildBonusValue = guildLevel > 0
      ? GameConfig.techTree.nodes.ind_guilde.productionBonusByLevel[guildLevel - 1] : 0;
    const forestierUnlocked = this.isTechUnlocked('ind_forestier');
    const tunnelierChance = this.isTechUnlocked('ind_tunnelier') ? GameConfig.techTree.nodes.ind_tunnelier.oreChance : 0;
    const imprimerieChance = this.isTechUnlocked('rec_imprimerie') ? GameConfig.techTree.nodes.rec_imprimerie.codexChance : 0;
    const alphabetisationLevel = this.techLevel('rec_alphabetisation');
    const alphabetisationBonus = alphabetisationLevel > 0
      ? GameConfig.techTree.nodes.rec_alphabetisation.efficiencyBonusByLevel[alphabetisationLevel - 1] : 0;
    const formateurBonus = this.isTechUnlocked('rec_formateur') ? GameConfig.techTree.nodes.rec_formateur.zoneBonus : 0;

    // 1. Extraction : les extracteurs remplissent leur propre outputBuffer depuis les cases
    //    de ressource dans leur rayon (les plus proches d'abord), indépendamment du réseau.
    //    Le rythme dépend du nombre de travailleurs affectés (efficiencyForWorkers) ET, désormais,
    //    d'Expertise/Guilde (voir speedMultiplier) -- Guilde seulement si à portée d'un Entrepôt.
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'extractor' || tile.underConstruction) continue;

      const [col, row] = key.split(',').map(Number);
      // Recycleur : pas de main-d'œuvre (voir allocateLabor/buildings.recycler), toujours 100 %.
      // Les autres extracteurs (catégorie Production) utilisent leur propre courbe, 100 % atteint
      // à 3 travailleurs plutôt que 4 (voir population.efficiencyByWorkersProduction, demande
      // utilisateur explicite -- s'applique aussi aux processeurs de raffinage, voir la boucle de
      // transformation plus bas, mais pas aux tours qui gardent efficiencyByWorkers/4).
      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = tile.type === 'recycler'
        ? 1
        : this.efficiencyForWorkers(workers, 1, GameConfig.population.efficiencyByWorkersProduction);
      const speedMultiplier = 1 + expertiseBonus + alphabetisationBonus
        + (this.guildZone.has(key) ? guildBonusValue : 0)
        + (this.universityZone.has(key) ? formateurBonus : 0);
      let toExtract = Math.min(def.extractRate * efficiency * speedMultiplier * dtSeconds, def.outputCap + this.capBonus() - tile.outputBuffer);
      if (toExtract <= 0) continue;

      const inRange = HexUtils.hexesInRange(col, row, def.extractRadius, this.cols, this.rows);
      let extracted = 0;

      for (const pos of inRange) {
        if (toExtract <= 0) break;
        const resKey = this.key(pos.col, pos.row);
        const resTile = this.resourceTiles.get(resKey);
        if (!resTile || resTile.type !== def.resource) continue;

        const take = Math.min(toExtract, resTile.amount);
        resTile.amount -= take;
        toExtract -= take;
        // Recycleur exclu : pas d'outputBuffer à faire fructifier (voir plus bas, le Codex est
        // versé d'un coup à la case de cadavre épuisée, pas accumulé fraction par fraction) --
        // sinon il finirait par plafonner sur outputCap après quelques cadavres et se bloquer.
        if (tile.type !== 'recycler') tile.outputBuffer += take;
        extracted += take;
        this.dirty = true;
        if (resTile.amount <= 0.0001) {
          this.resourceTiles.delete(resKey);
          // Cadavre entièrement recyclé (voir buildings.recycler/demande utilisateur explicite) :
          // 10 Codex d'un coup, doublés (20) avec une chance liée à Imprimerie -- PAS un simple
          // +1 comme l'ancienne version (voir techTree.nodes.rec_imprimerie, description mise à
          // jour en conséquence). Un vrai jet UNIQUE par cadavre, pas une accumulation fractionnée
          // qui aurait lissé la variance au fil des ticks.
          if (tile.type === 'recycler') {
            const doubled = imprimerieChance > 0 && Math.random() < imprimerieChance;
            this.resources.codex += doubled ? 20 : 10;
            this.dirty = true;
          }
        }
      }

      // Forestier : le Camp de Bûcheron replante immédiatement ce qu'il vient d'abattre, sur une
      // autre case libre du même rayon (voir techTree.nodes.ind_forestier) -- au rythme réel de
      // sa récolte de ce tick, pas un calendrier fixe comme la plantation "0." plus haut.
      if (extracted > 0 && tile.type === 'lumberjackCamp' && forestierUnlocked) {
        const emptySpots = inRange.filter(p => this._tileIsFreeForResource(p.col, p.row));
        if (emptySpots.length > 0) {
          const spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
          this.resourceTiles.set(this.key(spot.col, spot.row), { type: 'tree', amount: extracted });
          this.dirty = true;
        }
      }

      // Tunnelier : chance de produire aussi du minerai (voir techTree.nodes.ind_tunnelier),
      // ajouté directement au stock central -- le Camp de Mineur n'a qu'un seul type de sortie
      // (outputBuffer/linkTargets, voir buildings.minerCamp), le minerai "saute" donc l'étape
      // entrepôt plutôt que d'exiger tout un second circuit de livraison pour un simple bonus.
      if (extracted > 0 && tile.type === 'minerCamp' && tunnelierChance > 0 && Math.random() < tunnelierChance) {
        this.resources.ore += extracted;
        this.dirty = true;
      }
    }

    // 2. Transformation : les processeurs consomment leur inputBuffer local pour remplir leur
    //    outputBuffer, limités par ce qui leur a été livré (plus de réseau global instantané).
    //    Même courbe d'efficacité que les extracteurs (voir plus haut/population.
    //    efficiencyByWorkersProduction, 100 % à 3 travailleurs -- tous les bâtiments de la
    //    catégorie Production, extraction ET raffinage, demande utilisateur explicite) selon la
    //    main-d'œuvre affectée (le travailleur gratuit d'Apprentissage y est déjà inclus, voir
    //    allocateLabor) et Expertise/Guilde.
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'processor' || tile.underConstruction) continue;

      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers, 1, GameConfig.population.efficiencyByWorkersProduction);
      const speedMultiplier = 1 + expertiseBonus + alphabetisationBonus
        + (this.guildZone.has(key) ? guildBonusValue : 0)
        + (this.universityZone.has(key) ? formateurBonus : 0);
      const roomInOutput = def.outputCap + this.capBonus() - tile.outputBuffer;
      const actual = Math.min(def.rate * efficiency * speedMultiplier * dtSeconds, tile.inputBuffer, roomInOutput);
      if (actual <= 0) continue;

      tile.inputBuffer -= actual;
      tile.outputBuffer += actual;
    }

    // 2.5 Population : chaque Maison consomme du pain proportionnellement à ses habitants.
    // Deux minuteries INDÉPENDANTES plutôt qu'une seule (voir l'ancienne version) : la techno
    // Immigration doit accélérer la croissance SANS toucher à la vitesse de déclin (demande
    // utilisateur explicite), ce qui n'est possible que si les deux ont chacune leur propre rythme.
    // Déclin (growthTimer, rythme toujours égal à growthInterval) : au moins un instant en manque
    // de pain sur la période => -1 habitant (voir pop_urbanisme pour le plancher).
    // Croissance (growTimer) : n'avance QUE tant que la Maison est nourrie à l'instant présent (une
    // seule pénurie la remet à zéro) ; son seuil est raccourci par pop_immigration et pop_mariage.
    const nutritionNode = GameConfig.techTree.nodes.pop_nutrition;
    const nutritionLevel = this.techLevel('pop_nutrition');
    const breadReduction = nutritionLevel > 0 ? nutritionNode.breadReductionByLevel[nutritionLevel - 1] : 0;

    const immigrationNode = GameConfig.techTree.nodes.pop_immigration;
    const immigrationLevel = this.techLevel('pop_immigration');
    const growthBonus = immigrationLevel > 0 ? immigrationNode.growthBonusByLevel[immigrationLevel - 1] : 0;

    const mariageUnlocked = this.isTechUnlocked('pop_mariage');
    const mariageDiscountPerCapita = GameConfig.techTree.nodes.pop_mariage.growthDiscountPerCapita;

    const urbanismeUnlocked = this.isTechUnlocked('pop_urbanisme');

    for (const [, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'house' || tile.underConstruction) continue;

      const needed = tile.population * def.consumptionPerPerson * (1 - breadReduction) * dtSeconds;
      let fed;
      if (tile.inputBuffer >= needed) {
        tile.inputBuffer -= needed;
        fed = true;
      } else {
        tile.inputBuffer = 0;
        tile.hadDeficit = true;
        fed = false;
      }

      tile.growthTimer += dtSeconds;
      if (tile.growthTimer >= def.growthInterval) {
        tile.growthTimer = 0;
        if (tile.hadDeficit) {
          const floor = urbanismeUnlocked ? 1 : 0;
          tile.population = Math.max(floor, tile.population - 1);
        }
        tile.hadDeficit = false;
        this.dirty = true;
      }

      const cap = this.housePopulationCap(def);
      if (fed && tile.population < cap) {
        tile.growTimer = (tile.growTimer || 0) + dtSeconds;
        let growthInterval = def.growthInterval / (1 + growthBonus);
        if (mariageUnlocked) {
          const discount = Math.min(0.9, tile.population * mariageDiscountPerCapita);
          growthInterval *= (1 - discount);
        }
        if (tile.growTimer >= growthInterval) {
          tile.growTimer = 0;
          tile.population += 1;
          this.dirty = true;
        }
      } else {
        tile.growTimer = 0;
      }
    }

    // 2.6 Tours (Donjon) : tirent sur le monstre le plus proche à portée, si reliées à une route.
    // Le délai entre deux tirs se vide à vitesse normale avec un travailleur affecté, deux fois
    // plus lentement sans (même principe que l'efficacité des extracteurs/processeurs ci-dessus,
    // mais appliqué à la fréquence de tir plutôt qu'à un débit de ressource).
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'tower' || tile.underConstruction) continue;

      const [col, row] = key.split(',').map(Number);
      if (!this._hasAdjacentRoad(col, row)) continue;

      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers, def.capMultiplier || 1);

      // Alphabétisation (voir techTree.nodes.rec_alphabetisation) : seule techno qui touche aussi
      // les tours, vu son intitulé "TOUS les bâtiments" -- contrairement à Expertise/Guilde/
      // Formateur, qui ne parlent que des bâtiments de PRODUCTION.
      tile.fireCooldown -= dtSeconds * efficiency * (1 + alphabetisationBonus);
      if (tile.fireCooldown > 0) continue;
      tile.fireCooldown = def.fireInterval;

      const target = this._findMonsterInRange(col, row, this.towerRange(def));
      if (target) {
        target.hp -= this.towerDamage(def);
        if (target.hp <= 0) {
          target.alive = false;
          this.monstersKilled++;
          this._maybeDropCorpse(target);
          // Régénération (voir GameConfig.monsters.chiefRespawnSeconds/goblinRespawnSecondsRange,
          // demande utilisateur explicite -- décompte réel dans Monsters.update) : un Chef de
          // guerre revient toujours après un délai fixe. Un gobelin ne revient qu'après un délai
          // aléatoire, et SEULEMENT si le meneur de sa zone (Chef ou Seigneur, voir Monsters.init/
          // leaderId) était en vie au moment de CETTE mort -- sinon il reste mort définitivement
          // (tant qu'il ne meurt pas une prochaine fois avec un meneur de nouveau vivant). Le
          // Seigneur de la horde, lui, ne reçoit jamais de respawnTimer : il ne revient jamais (le
          // tuer met fin à la partie, voir GameScene.update).
          if (target.type === 'chief') {
            target.respawnTimer = GameConfig.monsters.chiefRespawnSeconds;
          } else if (target.type === 'goblin') {
            const leader = Monsters.byId.get(target.leaderId);
            if (leader && leader.alive) {
              const [minS, maxS] = GameConfig.monsters.goblinRespawnSecondsRange;
              target.respawnTimer = minS + Math.random() * (maxS - minS);
            }
          }
        }
        this.shots.push({ fromCol: col, fromRow: row, toX: target.x, toRow: target.row, ttl: 0.15 });
      }
    }

    this._spawnShipments();
    this._spawnWarehouseBread();
    this._spawnWarehouseConstructionDeliveries();
    this._updateMaxStats();
  },

  // Records de la partie (voir reset()/demande utilisateur explicite) : population et nombre de
  // bâtiments (chantiers et routes exclus -- seulement ce qui est vraiment "construit") observés
  // CE tick, comparés au maximum déjà connu. Appelé une fois par tick de production plutôt qu'à
  // chaque frame : la population/le nombre de bâtiments ne changent pas plus vite que ça de toute
  // façon (croissance/construction), inutile de reparcourir tiles à 60 i/s pour ça.
  _updateMaxStats() {
    let population = 0, buildings = 0;
    for (const [, tile] of this.tiles) {
      if (tile.type === 'road' || tile.type === 'ruin' || tile.underConstruction) continue;
      buildings++;
      if (tile.population) population += tile.population;
    }
    if (population > this.maxPopulation) this.maxPopulation = population;
    if (buildings > this.maxBuildings) this.maxBuildings = buildings;
  },

  // Vrai si au moins une case voisine est une route (condition pour qu'un Donjon ou une
  // Université soit utilisable).
  _hasAdjacentRoad(col, row) {
    for (const n of HexUtils.neighbors(col, row)) {
      if (n.row < 0 || n.row >= this.rows) continue;
      const tile = this.tiles.get(this.key(HexUtils.wrapCol(n.col, this.cols), n.row));
      if (tile && tile.type === 'road') return true;
    }
    return false;
  },

  // Arbre technologique (voir GameConfig.techTree) : un nœud n'est débloquable que si son parent
  // l'est déjà (chaîne de prérequis, au niveau 1 suffit). Chaque niveau coûte des ressources (voir
  // researchCostFor) depuis la techno Scolarisation (voir techTree.nodes.rec_scolarisation) --
  // avant elle, ce n'était limité que par les prérequis.
  techLevel(id) {
    return this.unlockedTech.get(id) || 0;
  },

  isTechUnlocked(id) {
    return this.techLevel(id) > 0;
  },

  maxTechLevel(id) {
    const node = GameConfig.techTree.nodes[id];
    return (node && node.maxLevel) || 1;
  },

  // Coût du PROCHAIN niveau de ce nœud (celui que canResearchTech/researchTech achèteraient) :
  // researchCostPerLevel × le niveau visé (1er niveau = 1x, 2e = 2x...), réduit par Scolarisation.
  // Renvoie null si le nœud est déjà à son niveau maximum (rien à acheter).
  researchCostFor(id) {
    const level = this.techLevel(id);
    if (level >= this.maxTechLevel(id)) return null;
    const targetLevel = level + 1;
    const scolarisationLevel = this.techLevel('rec_scolarisation');
    const discount = scolarisationLevel > 0
      ? GameConfig.techTree.nodes.rec_scolarisation.costReductionByLevel[scolarisationLevel - 1] : 0;
    const cost = {};
    for (const res in GameConfig.techTree.researchCostPerLevel) {
      cost[res] = Math.round(GameConfig.techTree.researchCostPerLevel[res] * targetLevel * (1 - discount));
    }
    return cost;
  },

  // Vrai si un prérequis bloque le prochain niveau (parent pas débloqué, ou déjà au maximum) --
  // indépendant du coût, pour distinguer "verrouillé" de "juste trop cher" dans l'UI.
  techPrereqMet(id) {
    const node = GameConfig.techTree.nodes[id];
    if (!node) return false;
    const level = this.techLevel(id);
    if (level >= this.maxTechLevel(id)) return false;
    if (level === 0) return !node.parent || this.isTechUnlocked(node.parent);
    return true;
  },

  // Vrai s'il reste un niveau à rechercher ET qu'on peut se le payer : soit le tout premier
  // (nécessite le parent débloqué), soit un niveau supérieur d'un nœud déjà débloqué (pas de
  // nouveau prérequis, juste le coût).
  canResearchTech(id) {
    return this.techPrereqMet(id) && this.canAfford(this.researchCostFor(id));
  },

  researchTech(id) {
    if (!this.canResearchTech(id)) return false;
    this.spend(this.researchCostFor(id));
    this.unlockedTech.set(id, this.techLevel(id) + 1);
    return true;
  },

  // Capacité effective d'une Maison, boostée par la techno Colocation (voir GameConfig.techTree.
  // nodes.pop_colocation) : une seule valeur pour toutes les Maisons, la techno est globale.
  housePopulationCap(def) {
    const level = this.techLevel('pop_colocation');
    const node = GameConfig.techTree.nodes.pop_colocation;
    const bonus = level > 0 ? node.extraCapByLevel[level - 1] : 0;
    return def.populationCap + bonus;
  },

  // Rayon d'action réel d'un Entrepôt : linkRange de base + warehouseExtraRange (bonus dédié,
  // demande utilisateur explicite : "+2 cases", voir GameConfig.logistics), boosté par
  // Aménagement urbain (voir GameConfig.techTree.nodes.log_amenagement) -- PAS cumulatif entre
  // niveaux (voir le nœud), le niveau atteint REMPLACE le bonus du niveau précédent plutôt que de
  // s'y ajouter plusieurs fois.
  warehouseZoneRadius() {
    const level = this.techLevel('log_amenagement');
    const node = GameConfig.techTree.nodes.log_amenagement;
    const bonus = level > 0 ? node.zoneBonusByLevel[level - 1] : 0;
    return GameConfig.logistics.linkRange + GameConfig.logistics.warehouseExtraRange + bonus;
  },

  // Bonus de capacité de stockage, boosté par Gestion des stocks (voir GameConfig.techTree.nodes.
  // log_gestionStocks) -- pas cumulatif non plus, s'ajoute une seule fois à inputCap/outputCap
  // partout où ils sont lus (voir les appels ci-dessous et dans tickProduction).
  capBonus() {
    const level = this.techLevel('log_gestionStocks');
    const node = GameConfig.techTree.nodes.log_gestionStocks;
    return level > 0 ? node.capBonusByLevel[level - 1] : 0;
  },

  // Portée effective d'une tour (Donjon/Château), boostée par Artilleur (voir GameConfig.
  // techTree.nodes.def_donjon, renommé "Artilleur" mais id conservé) -- pas cumulatif.
  towerRange(def) {
    const level = this.techLevel('def_donjon');
    const node = GameConfig.techTree.nodes.def_donjon;
    const bonus = level > 0 ? node.rangeBonusByLevel[level - 1] : 0;
    return def.range + bonus;
  },

  // Dégâts effectifs d'une tour, boostés par Armée de profession (voir techTree.nodes.
  // def_armee) -- pas cumulatif.
  towerDamage(def) {
    const level = this.techLevel('def_armee');
    const node = GameConfig.techTree.nodes.def_armee;
    const bonus = level > 0 ? node.damageBonusByLevel[level - 1] : 0;
    return def.damage * (1 + bonus);
  },

  // Cherche le monstre vivant le plus proche (en cases) dont la position actuelle tombe dans le
  // rayon d'action d'une tour. La position d'un monstre étant continue (pixels), on la convertit
  // en colonne approximative pour la comparer à la zone (les mêmes cases que celles surlignées
  // par redrawActionZone).
  _findMonsterInRange(col, row, range) {
    const colWidth = GameConfig.hex.size * 1.5;
    const cells = HexUtils.hexesInRange(col, row, range, this.cols, this.rows);
    const cellSet = new Set(cells.map(c => c.col + ',' + c.row));

    let closest = null;
    let closestDist = Infinity;
    for (const m of Monsters.list) {
      if (!m.alive) continue;
      const mCol = HexUtils.wrapCol(Math.floor(m.x / colWidth), this.cols);
      if (!cellSet.has(mCol + ',' + m.row)) continue;
      const dist = Math.abs(m.row - row) + Math.abs(mCol - col);
      if (dist < closestDist) {
        closestDist = dist;
        closest = m;
      }
    }
    return closest;
  },

  // Vrai si un monstre vivant occupe PRÉCISÉMENT cette case (voir _findMonsterInRange ci-dessus
  // pour la même conversion position continue -> colonne) -- utilisé par harvestRuin (demande
  // utilisateur explicite : une ruine sous un monstre ne doit pas être pillable).
  hasMonsterOn(col, row) {
    const colWidth = GameConfig.hex.size * 1.5;
    for (const m of Monsters.list) {
      if (!m.alive || m.row !== row) continue;
      if (HexUtils.wrapCol(Math.floor(m.x / colWidth), this.cols) === col) return true;
    }
    return false;
  },

  // Cadavre de monstre (voir resourceNodes.corpse/buildings.recycler/config.monsters.
  // corpseDropChance, demande utilisateur explicite) : un monstre qui vient de mourir a une
  // chance d'en laisser un sur SA case, à la place d'une ressource naturelle, d'une route ou
  // d'une ruine -- MAIS PAS d'un bâtiment encore valide (correction utilisateur explicite : ni
  // les bâtiments opérationnels, ni un chantier en cours, ne doivent disparaître comme ça).
  // Aucun butin ni ruine intermédiaire pour ce qu'il remplace (contrairement à destroyTile, qui
  // gère le piétinement "normal" de la horde, pas cette mort au combat).
  _maybeDropCorpse(monster) {
    if (Math.random() >= GameConfig.monsters.corpseDropChance) return;
    const colWidth = GameConfig.hex.size * 1.5;
    const col = HexUtils.wrapCol(Math.floor(monster.x / colWidth), this.cols);
    const row = monster.row;
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (tile && tile.type !== 'road' && tile.type !== 'ruin') return;
    if (tile) this.tiles.delete(key);
    this.resourceTiles.set(key, { type: 'corpse', amount: 1 });
    this.dirty = true;
    this.buildingsDirty = true;
  },

  // Avance/expire les traits visuels des tirs de tour (voir GameScene.redrawShots).
  updateShots(dtSeconds) {
    this.shots = this.shots.filter(s => (s.ttl -= dtSeconds) > 0);
  },

  // Pour chaque bâtiment ayant du stock en sortie et pas déjà de chargement en route,
  // cherche un partenaire compatible à portée et lui expédie un chargement.
  _spawnShipments() {
    const batch = GameConfig.logistics.shipBatchSize;
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || !def.linkTargets || !tile.outputBuffer || tile.outputBuffer <= 0) continue;
      if (this.shipments.some(s => s.fromKey === key)) continue;

      const [col, row] = key.split(',').map(Number);
      // Essaie chaque type de linkTargets DANS L'ORDRE (plutôt qu'un seul type "le plus proche
      // parmi tous") : utile pour un bâtiment dont les linkTargets ont plusieurs types possibles
      // par ordre de préférence. Le pain, lui, ne vise QUE l'Entrepôt (voir buildings.bakery) —
      // le trajet Entrepôt -> Maison est un second segment séparé, voir _spawnWarehouseBread.
      // Au sein d'UN type, la cible choisie est celle qui a le plus de place libre (scoreFn), pas
      // juste la plus proche : répartit les livraisons entre plusieurs cibles compatibles au lieu
      // de toujours saturer la même (voir findBestPathToBuildingType).
      let found = null;
      for (const targetType of def.linkTargets) {
        found = this.findBestPathToBuildingType(col, row, [targetType], def.linkRange, (t) => {
          if (t.type === 'warehouse') return Infinity;
          return GameConfig.buildings[t.type].inputCap + this.capBonus() - t.inputBuffer;
        });
        if (found) break;
      }
      if (!found) continue;

      const destKey = this.key(found.targetCol, found.targetRow);
      const destTile = this.tiles.get(destKey);
      const destDef = GameConfig.buildings[destTile.type];

      const capacity = destTile.type === 'warehouse' ? Infinity : (destDef.inputCap + this.capBonus() - destTile.inputBuffer);
      const amount = Math.min(batch, tile.outputBuffer, capacity);
      if (amount <= 0) continue;

      tile.outputBuffer -= amount;
      this.shipments.push({
        id: this.nextShipmentId++,
        resource: def.outputResource,
        amount,
        path: found.path,
        progress: 0,
        fromKey: key,
        toKey: destKey,
        toType: destTile.type,
      });
      this.dirty = true;
    }
  },

  // Second segment du cycle du pain (voir buildings.bakery) : chaque Entrepôt puise dans le stock
  // central (this.resources.bread, alimenté par _spawnShipments ci-dessus) pour nourrir la Maison
  // avec le plus de place libre parmi celles à portée par la route (pas juste la plus proche — voir
  // findBestPathToBuildingType) . Même mécanique qu'un producteur normal, sauf que la "source" est
  // le stock central plutôt qu'un outputBuffer local à une case précise.
  _spawnWarehouseBread() {
    const batch = GameConfig.logistics.shipBatchSize;
    for (const [key, tile] of this.tiles) {
      if (tile.type !== 'warehouse' || tile.underConstruction) continue;
      if (this.resources.bread <= 0) continue;
      // PAS s.fromKey === key tout court (voir _spawnWarehouseConstructionDeliveries, qui a le
      // même souci) : un Entrepôt doit pouvoir expédier du pain ET des matériaux de construction
      // EN MÊME TEMPS -- sinon un besoin de pain permanent (plusieurs maisons à nourrir) monopolise
      // indéfiniment l'unique "créneau" et les chantiers à portée ne reçoivent jamais rien (bug
      // vécu pour de vrai : un Entrepôt en construction restait bloqué à 0/15 malgré du stock
      // disponible). Chaque "voie" (pain vs construction) garde son propre garde-fou anti-doublon.
      if (this.shipments.some(s => s.fromKey === key && !s.forConstruction)) continue;

      const [col, row] = key.split(',').map(Number);
      const found = this.findBestPathToBuildingType(col, row, ['house'], this.warehouseZoneRadius(), (t) => {
        return GameConfig.buildings[t.type].inputCap + this.capBonus() - t.inputBuffer;
      });
      if (!found) continue;

      const destKey = this.key(found.targetCol, found.targetRow);
      const destTile = this.tiles.get(destKey);
      const destDef = GameConfig.buildings[destTile.type];
      const capacity = destDef.inputCap + this.capBonus() - destTile.inputBuffer;
      const amount = Math.min(batch, this.resources.bread, capacity);
      if (amount <= 0) continue;

      this.resources.bread -= amount;
      this.shipments.push({
        id: this.nextShipmentId++,
        resource: 'bread',
        amount,
        path: found.path,
        progress: 0,
        fromKey: key,
        toKey: destKey,
        toType: 'house',
      });
      this.dirty = true;
    }
  },

  // Livre les matériaux de construction depuis le stock central vers les chantiers à portée
  // (voir placeBuilding/demande utilisateur) : même mécanique que _spawnWarehouseBread (la
  // "source" est le stock central, pas un outputBuffer local), mais vers N'IMPORTE QUEL type de
  // chantier plutôt qu'un type précis -- d'où findBestPath (prédicat) plutôt que
  // findBestPathToBuildingType (liste de types figée).
  // Priorité EXPLICITE demandée par l'utilisateur : on parcourt les chantiers dans leur ORDRE DE
  // POSE (l'ordre d'insertion de `this.tiles`, jamais réordonné), pas par proximité/score -- le
  // premier chantier posé est toujours servi avant les suivants s'ils sont tous à portée d'un
  // Entrepôt disponible. Pour CE chantier, on cherche ensuite l'Entrepôt le plus proche (scoreFn
  // constant -> BFS s'arrête au premier trouvé, donc le plus proche) parmi ceux pas encore
  // occupés CE TICK (voir `busy`, alimenté à la fois par les livraisons déjà en route et par les
  // envois qu'on vient de décider dans cette même passe). Plusieurs Entrepôts différents à portée
  // peuvent donc livrer le même chantier simultanément (chacun un aller à la fois, comme pour tout
  // autre chargement), chacun une ressource différente si besoin.
  _spawnWarehouseConstructionDeliveries() {
    const batch = GameConfig.logistics.shipBatchSize;
    // Busy PAR (Entrepôt, ressource) et non plus juste par Entrepôt (demande utilisateur
    // explicite) : un Entrepôt peut désormais expédier planches ET pierre taillée EN PARALLÈLE
    // pour la construction, plutôt que la seconde ressource devant attendre que la première
    // finisse son trajet.
    const busy = new Set();
    for (const s of this.shipments) {
      if (s.forConstruction) busy.add(s.fromKey + '|' + s.resource);
    }
    // Décalage de 0,5 s (voir updateShipments/s.delay) sur la SECONDE expédition d'un même
    // Entrepôt décidée dans CET appel : évite que les deux partent visuellement confondues (même
    // case, même instant) sur la carte. Local à cet appel -- un Entrepôt déjà en train d'expédier
    // depuis un appel précédent n'a pas besoin de ce décalage, il n'est déjà plus simultané.
    const dispatchedThisCall = new Set();

    for (const [destKey, tile] of this.tiles) {
      if (!tile.underConstruction) continue;
      const [destCol, destRow] = destKey.split(',').map(Number);

      for (const res in tile.constructionNeeded) {
        const stillNeeded = tile.constructionNeeded[res] - tile.constructionDelivered[res];
        if (stillNeeded <= 0) continue;
        if (this.resources[res] <= 0) continue;

        const candidate = this.findBestPath(destCol, destRow, (t, key) => {
          return t.type === 'warehouse' && !t.underConstruction && !busy.has(key + '|' + res);
        }, this.warehouseZoneRadius(), () => 1);
        if (!candidate) continue;

        const fromKey = this.key(candidate.targetCol, candidate.targetRow);
        const amount = Math.min(batch, this.resources[res], stillNeeded);
        if (amount <= 0) continue;

        this.resources[res] -= amount;
        // candidate.path va du chantier (départ de la BFS) vers l'Entrepôt : on l'inverse pour
        // obtenir le trajet réel du chargement, Entrepôt -> chantier.
        this.shipments.push({
          id: this.nextShipmentId++,
          resource: res,
          amount,
          path: [...candidate.path].reverse(),
          progress: 0,
          delay: dispatchedThisCall.has(fromKey) ? 0.5 : 0,
          fromKey,
          toKey: destKey,
          toType: tile.type,
          forConstruction: true,
        });
        busy.add(fromKey + '|' + res);
        dispatchedThisCall.add(fromKey);
        this.dirty = true;
      }
    }
  },

  // Avance tous les chargements en transit ; livre ceux qui sont arrivés.
  // Appelé chaque frame (indépendamment du tick de production) pour un mouvement fluide. Renvoie
  // les noms des bâtiments dont le chantier vient de se terminer ce tick (voir GameScene, même
  // principe que les messages renvoyés par Monsters.update) -- purement informatif pour le toast,
  // rien ici ne dépend du retour.
  updateShipments(dtSeconds) {
    // Roue (voir techTree.nodes.log_roue) : accélère TOUS les chargements, quelle que soit la
    // ressource ou l'origine, puisqu'ils passent tous par cette même boucle.
    const roueLevel = this.techLevel('log_roue');
    const roueBonus = roueLevel > 0 ? GameConfig.techTree.nodes.log_roue.speedBonusByLevel[roueLevel - 1] : 0;
    const speed = GameConfig.logistics.shipSpeed * (1 + roueBonus);
    // Caisse de transport (voir techTree.nodes.log_charrue) : chance d'une unité de ressource en
    // plus à chaque livraison qui arrive à bon port (pas sur un chargement perdu, voir plus bas).
    const charrueChance = this.isTechUnlocked('log_charrue') ? GameConfig.techTree.nodes.log_charrue.bonusChance : 0;
    const stillTraveling = [];
    const completedBuildings = [];
    let delivered = false;

    for (const s of this.shipments) {
      // Décalage de départ (voir _spawnWarehouseConstructionDeliveries/s.delay, demande
      // utilisateur : deux expéditions "construction" simultanées depuis le même Entrepôt ne
      // doivent pas voyager parfaitement confondues) : consomme le délai en premier, avance quand
      // même du reliquat de dtSeconds une fois écoulé plutôt que de perdre cette fraction de tick.
      let dt = dtSeconds;
      if (s.delay > 0) {
        const consumed = Math.min(s.delay, dt);
        s.delay -= consumed;
        dt -= consumed;
        if (s.delay > 0 || dt <= 0) {
          stillTraveling.push(s);
          continue;
        }
      }
      s.progress += speed * dt;
      if (s.progress < s.path.length - 1) {
        stillTraveling.push(s);
        continue;
      }
      delivered = true;
      const destTile = this.tiles.get(s.toKey);
      if (destTile && destTile.type === s.toType) {
        const amount = (charrueChance > 0 && Math.random() < charrueChance) ? s.amount + 1 : s.amount;
        if (s.forConstruction && destTile.underConstruction) {
          const needed = destTile.constructionNeeded[s.resource];
          destTile.constructionDelivered[s.resource] = Math.min(needed, destTile.constructionDelivered[s.resource] + amount);
          const complete = Object.keys(destTile.constructionNeeded).every(
            (r) => destTile.constructionDelivered[r] >= destTile.constructionNeeded[r]
          );
          if (complete) {
            completedBuildings.push(GameConfig.buildings[destTile.type].name);
            this._completeConstruction(destTile);
          }
        } else if (s.toType === 'warehouse') {
          this.resources[s.resource] = (this.resources[s.resource] || 0) + amount;
        } else {
          const cap = GameConfig.buildings[destTile.type].inputCap + this.capBonus();
          destTile.inputBuffer = Math.min(destTile.inputBuffer + amount, cap);
        }
      }
      // Sinon : le bâtiment de destination a été détruit entre-temps, le chargement est perdu.
    }

    this.shipments = stillTraveling;
    if (delivered) this.dirty = true;
    return completedBuildings;
  },

  // Détruit une case (passage d'un monstre) et la transforme en ruine pillable.
  // Renvoie true si c'était un Entrepôt (pour le message d'alerte).
  destroyTile(col, row) {
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (!tile || tile.type === 'ruin') return false;
    const def = GameConfig.buildings[tile.type];
    // Un chantier n'a encore rien "payé" au sens propre (voir placeBuilding : rien n'est dépensé
    // à la pose, seulement au fur et à mesure des livraisons) -- le ruinLoot complet d'un
    // bâtiment fini serait donc un moyen gratuit de fabriquer des ressources en posant puis
    // démolissant aussitôt. Le butin d'un chantier est exactement ce qui a déjà été livré, ni
    // plus ni moins ; un bâtiment terminé garde son ruinLoot habituel, inchangé.
    const ruinLoot = tile.underConstruction
      ? { ...tile.constructionDelivered }
      : (def ? def.ruinLoot : {});
    const warehouseLost = tile.type === 'warehouse';
    this.tiles.set(key, { type: 'ruin', ruinLoot });
    this.dirty = true;
    this.buildingsDirty = true;
    return warehouseLost;
  },

  // Vrai si au moins un Entrepôt tient encore debout (voir GameScene, condition de défaite : la
  // partie est perdue dès qu'il n'y en a plus aucun -- vérifié seulement quand buildingsDirty,
  // pas à chaque frame, voir l'appelant).
  hasAnyWarehouse() {
    for (const [, tile] of this.tiles) {
      // Pas encore opérationnel (voir placeBuilding) : un Entrepôt en chantier ne compte pas,
      // il ne peut encore rien recevoir/expédier.
      if (tile.type === 'warehouse' && !tile.underConstruction) return true;
    }
    return false;
  },

  // Renvoie null (rien pillé) sans qu'il ne se passe rien si la case n'est pas une ruine, si elle
  // est hors du brouillard de guerre, ou si un monstre est actuellement dessus (demande
  // utilisateur explicite) -- voir GameScene.redrawBuildings pour le pendant visuel (une ruine
  // hors du brouillard ne doit même plus être dessinée).
  harvestRuin(col, row) {
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (!tile || tile.type !== 'ruin') return null;
    if (!this.revealedTiles.has(key)) return null;
    if (this.hasMonsterOn(col, row)) return null;
    const loot = tile.ruinLoot || {};
    for (const res in loot) this.resources[res] = (this.resources[res] || 0) + loot[res];
    this.tiles.delete(key);
    this.dirty = true;
    this.buildingsDirty = true;
    return loot;
  },

  // Remet tout à zéro pour une partie neuve (voir GameScene.restartGame, bouton "Recommencer"
  // après une défaite) -- mêmes valeurs que la déclaration initiale de l'objet en haut du fichier,
  // pas un simple deserialize() : il n'y a pas de sauvegarde de "partie neuve" à recharger.
  reset() {
    this.cols = GameConfig.world.cols;
    this.rows = GameConfig.world.rows;
    this.resources = Object.assign(
      { wood: 0, planks: 0, stone: 0, stoneBlocks: 0, wheat: 0, bread: 0, ore: 0, codex: 0 },
      GameConfig.resources.starting
    );
    this.tiles = new Map();
    this.resourceTiles = new Map();
    this.shipments = [];
    this.nextShipmentId = 1;
    this.laborAssignment = null;
    this.shots = [];
    this.unlockedTech = new Map();
    this.revealedTiles = new Set();
    this.guildZone = new Set();
    this.universityZone = new Set();
    this.dirty = true;
    this.buildingsDirty = true;
    // Records de la partie (voir _updateMaxStats/GameScene.computeGameOverStats, demande
    // utilisateur explicite) : le MAXIMUM jamais atteint, pas la valeur au moment de la défaite
    // (population/bâtiments peuvent avoir redescendu depuis, voir la horde/la famine).
    this.maxPopulation = 0;
    this.maxBuildings = 0;
    this.monstersKilled = 0;
  },

  // Instantané complet de l'état sauvegardable (tout ce qui n'est pas dérivable de GameConfig).
  // laborAssignment n'est pas conservé : c'est un résultat recalculé à chaque tick, pas un état.
  serialize() {
    return {
      resources: { ...this.resources },
      tiles: Array.from(this.tiles.entries()).map(([k, t]) => [k, { ...t }]),
      resourceTiles: Array.from(this.resourceTiles.entries()).map(([k, t]) => [k, { ...t }]),
      shipments: this.shipments.map(s => ({ ...s, path: s.path.map(p => ({ ...p })) })),
      nextShipmentId: this.nextShipmentId,
      unlockedTech: Array.from(this.unlockedTech.entries()),
      maxPopulation: this.maxPopulation,
      maxBuildings: this.maxBuildings,
      monstersKilled: this.monstersKilled,
    };
  },

  deserialize(data) {
    this.resources = Object.assign({ wood: 0, planks: 0, stone: 0, stoneBlocks: 0, wheat: 0, bread: 0, ore: 0, codex: 0 }, data.resources);
    this.tiles = new Map(data.tiles.map(([k, t]) => [k, { ...t }]));
    this.resourceTiles = new Map(data.resourceTiles.map(([k, t]) => [k, { ...t }]));
    this.shipments = data.shipments.map(s => ({ ...s, path: s.path.map(p => ({ ...p })) }));
    this.nextShipmentId = data.nextShipmentId;
    // || 0 : compatible avec les sauvegardes d'avant ces records (voir demande utilisateur).
    this.maxPopulation = data.maxPopulation || 0;
    this.maxBuildings = data.maxBuildings || 0;
    this.monstersKilled = data.monstersKilled || 0;
    // Compatible avec l'ancien format (liste d'ids, sans niveau — voir l'ancien unlockedTech: Set) :
    // une entrée qui n'est pas déjà une paire [id, niveau] est traitée comme le niveau 1.
    this.unlockedTech = new Map((data.unlockedTech || []).map(e => Array.isArray(e) ? e : [e, 1]));
    this.laborAssignment = null;
    this.dirty = true;
    this.buildingsDirty = true;
  },
};
