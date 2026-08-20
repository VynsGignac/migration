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

  placeBuilding(col, row, buildingId) {
    const def = GameConfig.buildings[buildingId];
    if (!def) return { ok: false, reason: 'unknown' };
    const key = this.key(col, row);
    if (this.tiles.has(key)) return { ok: false, reason: 'occupied' };
    if (this.resourceTiles.has(key)) return { ok: false, reason: 'resource' };
    // Une route ne peut s'étendre qu'à partir d'une route déjà posée (voir _hasAdjacentRoad,
    // partagé avec la condition d'activation des Tours/Universités) : empêche de semer des
    // tronçons isolés sans connexion au réseau. L'Entrepôt de départ est entouré de routes dès le
    // début de la partie (voir GameScene.create) pour donner un premier point de départ.
    if (buildingId === 'road' && !this._hasAdjacentRoad(col, row)) return { ok: false, reason: 'noRoadAdjacent' };
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'cost' };

    this.spend(def.cost);
    const tile = { type: buildingId };
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
    this.tiles.set(key, tile);
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
    if (def.kind === 'tower') return def.range;
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
    const revealed = new Set();
    for (const [key, tile] of this.tiles) {
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
      if (tile.type !== 'warehouse') continue;
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
      if (tile.type !== 'university') continue;
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
  findBestPathToBuildingType(fromCol, fromRow, targetTypes, maxRange, scoreFn) {
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

          if (targetTypes.includes(tile.type)) {
            const score = scoreFn(tile);
            if (score > 0 && (!best || score > best.score)) {
              const newPath = [...cur.path, { col: wrappedCol, row: n.row }];
              best = { path: newPath, targetCol: wrappedCol, targetRow: n.row, score };
            }
            continue; // pas un relais (voir plus bas) : une cible du bon type n'est jamais traversée
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
      if (!def) continue;
      if (def.kind === 'house') {
        const [col, row] = key.split(',').map(Number);
        houses.push({ col, row, population: tile.population });
      } else if (def.kind === 'extractor' || def.kind === 'processor' || def.kind === 'tower') {
        const [col, row] = key.split(',').map(Number);
        // Apprentissage (voir techTree.nodes.ind_apprentissage) : les bâtiments de raffinage
        // démarrent avec 1 travailleur déjà compté, avant même la répartition des habitants
        // ci-dessous -- l'algorithme glouton (le moins staffé d'abord) leur envoie donc
        // naturellement moins d'habitants réels pour atteindre le même plein rendement.
        const freeWorker = (def.kind === 'processor' && this.isTechUnlocked('ind_apprentissage')) ? 1 : 0;
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
    const fullStaff = GameConfig.population.efficiencyByWorkers.length - 1;
    let needed = 0;
    for (const [, entry] of this.laborAssignment) {
      needed += Math.max(0, fullStaff - entry.workers);
    }
    return needed;
  },

  // Places de logement encore libres, toutes Maisons confondues (populationCap - population).
  availableHousing() {
    let available = 0;
    for (const [, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (def && def.kind === 'house') available += this.housePopulationCap(def) - tile.population;
    }
    return available;
  },

  // Efficacité (0-1) selon le nombre de travailleurs affectés à un bâtiment (voir
  // GameConfig.population.efficiencyByWorkers) : une courbe, pas un tout-ou-rien. Au-delà du
  // dernier palier configuré, l'efficacité reste à sa dernière valeur (100 % par défaut).
  efficiencyForWorkers(workers) {
    const table = GameConfig.population.efficiencyByWorkers;
    return table[Math.min(workers, table.length - 1)];
  },

  tickProduction(dtSeconds) {
    // 0. Plantation (bâtiments avec plants: true, ex. la Ferme) : crée périodiquement de
    // nouvelles cases de sa ressource dans son rayon, tant qu'il reste de la place libre et
    // que le nombre de cases déjà plantées n'a pas atteint maxPatches. C'est ce qui permet à
    // la Ferme de cultiver son propre blé en boucle au lieu d'épuiser des cases naturelles.
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || !def.plants) continue;

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
      if (!def || def.kind !== 'extractor') continue;

      const [col, row] = key.split(',').map(Number);
      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers);
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
        tile.outputBuffer += take;
        extracted += take;
        this.dirty = true;
        if (resTile.amount <= 0.0001) this.resourceTiles.delete(resKey);
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
    //    Même courbe d'efficacité selon la main-d'œuvre affectée (efficiencyForWorkers -- le
    //    travailleur gratuit d'Apprentissage y est déjà inclus, voir allocateLabor) et Expertise/Guilde.
    for (const [key, tile] of this.tiles) {
      const def = GameConfig.buildings[tile.type];
      if (!def || def.kind !== 'processor') continue;

      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers);
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
      if (!def || def.kind !== 'house') continue;

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
      if (!def || def.kind !== 'tower') continue;

      const [col, row] = key.split(',').map(Number);
      if (!this._hasAdjacentRoad(col, row)) continue;

      const workers = labor.get(key) ? labor.get(key).workers : 0;
      const efficiency = this.efficiencyForWorkers(workers);

      // Alphabétisation (voir techTree.nodes.rec_alphabetisation) : seule techno qui touche aussi
      // les tours, vu son intitulé "TOUS les bâtiments" -- contrairement à Expertise/Guilde/
      // Formateur, qui ne parlent que des bâtiments de PRODUCTION.
      tile.fireCooldown -= dtSeconds * efficiency * (1 + alphabetisationBonus);
      if (tile.fireCooldown > 0) continue;
      tile.fireCooldown = def.fireInterval;

      const target = this._findMonsterInRange(col, row, def.range);
      if (target) {
        target.hp -= def.damage;
        if (target.hp <= 0) target.alive = false;
        this.shots.push({ fromCol: col, fromRow: row, toX: target.x, toRow: target.row, ttl: 0.15 });
      }
    }

    this._spawnShipments();
    this._spawnWarehouseBread();
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

  // Rayon d'action réel d'un Entrepôt, boosté par Aménagement urbain (voir GameConfig.techTree.
  // nodes.log_amenagement) -- PAS cumulatif entre niveaux (voir le nœud), le niveau atteint
  // REMPLACE GameConfig.logistics.linkRange plutôt que de s'y ajouter plusieurs fois.
  warehouseZoneRadius() {
    const level = this.techLevel('log_amenagement');
    const node = GameConfig.techTree.nodes.log_amenagement;
    const bonus = level > 0 ? node.zoneBonusByLevel[level - 1] : 0;
    return GameConfig.logistics.linkRange + bonus;
  },

  // Bonus de capacité de stockage, boosté par Gestion des stocks (voir GameConfig.techTree.nodes.
  // log_gestionStocks) -- pas cumulatif non plus, s'ajoute une seule fois à inputCap/outputCap
  // partout où ils sont lus (voir les appels ci-dessous et dans tickProduction).
  capBonus() {
    const level = this.techLevel('log_gestionStocks');
    const node = GameConfig.techTree.nodes.log_gestionStocks;
    return level > 0 ? node.capBonusByLevel[level - 1] : 0;
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
      if (tile.type !== 'warehouse') continue;
      if (this.resources.bread <= 0) continue;
      if (this.shipments.some(s => s.fromKey === key)) continue;

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

  // Avance tous les chargements en transit ; livre ceux qui sont arrivés.
  // Appelé chaque frame (indépendamment du tick de production) pour un mouvement fluide.
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
    let delivered = false;

    for (const s of this.shipments) {
      s.progress += speed * dtSeconds;
      if (s.progress < s.path.length - 1) {
        stillTraveling.push(s);
        continue;
      }
      delivered = true;
      const destTile = this.tiles.get(s.toKey);
      if (destTile && destTile.type === s.toType) {
        const amount = (charrueChance > 0 && Math.random() < charrueChance) ? s.amount + 1 : s.amount;
        if (s.toType === 'warehouse') {
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
  },

  // Détruit une case (passage d'un monstre) et la transforme en ruine pillable.
  // Renvoie true si c'était un Entrepôt (pour le message d'alerte).
  destroyTile(col, row) {
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (!tile || tile.type === 'ruin') return false;
    const def = GameConfig.buildings[tile.type];
    const warehouseLost = tile.type === 'warehouse';
    this.tiles.set(key, { type: 'ruin', ruinLoot: def ? def.ruinLoot : {} });
    this.dirty = true;
    this.buildingsDirty = true;
    return warehouseLost;
  },

  harvestRuin(col, row) {
    const key = this.key(col, row);
    const tile = this.tiles.get(key);
    if (!tile || tile.type !== 'ruin') return null;
    const loot = tile.ruinLoot || {};
    for (const res in loot) this.resources[res] = (this.resources[res] || 0) + loot[res];
    this.tiles.delete(key);
    this.dirty = true;
    this.buildingsDirty = true;
    return loot;
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
    };
  },

  deserialize(data) {
    this.resources = Object.assign({ wood: 0, planks: 0, stone: 0, stoneBlocks: 0, wheat: 0, bread: 0, ore: 0, codex: 0 }, data.resources);
    this.tiles = new Map(data.tiles.map(([k, t]) => [k, { ...t }]));
    this.resourceTiles = new Map(data.resourceTiles.map(([k, t]) => [k, { ...t }]));
    this.shipments = data.shipments.map(s => ({ ...s, path: s.path.map(p => ({ ...p })) }));
    this.nextShipmentId = data.nextShipmentId;
    // Compatible avec l'ancien format (liste d'ids, sans niveau — voir l'ancien unlockedTech: Set) :
    // une entrée qui n'est pas déjà une paire [id, niveau] est traitée comme le niveau 1.
    this.unlockedTech = new Map((data.unlockedTech || []).map(e => Array.isArray(e) ? e : [e, 1]));
    this.laborAssignment = null;
    this.dirty = true;
    this.buildingsDirty = true;
  },
};
