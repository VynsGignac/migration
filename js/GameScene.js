// ============================================================
// SCÈNE PRINCIPALE DU JEU
// Affiche la grille hexagonale du monde cylindrique et gère les contrôles :
// - glisser (souris ou doigt) pour se déplacer
// - molette (PC) ou pincement (mobile) pour zoomer
// - taper une case pour construire, attaquer la vague, ou piller une ruine
//
// Deux caméras se partagent l'écran : la caméra principale (monde, zoomable/déplaçable)
// et une caméra UI fixe (zoom 1, jamais déplacée) qui affiche le panneau latéral gauche.
// Chaque objet n'est visible que via UNE des deux (voir setupCameras()), ce qui garantit
// que le HUD reste à taille constante quel que soit le zoom du monde.
// ============================================================

class GameScene extends Phaser.Scene {

  constructor() {
    super('GameScene');
  }

  preload() {
    // Chargées en base64 (voir js/assets.js), pas depuis un fichier séparé : marche identiquement
    // en local et dans la version "artifact" (fichier HTML unique, voir createTerrainTileSprite
    // et redrawTileArt).
    this.load.image('grassTexture', GameAssets.grassTexture);
    this.load.image('treeTile', GameAssets.treeTile);
    this.load.image('stoneTile', GameAssets.stoneTile);
    this.load.image('wheatTile', GameAssets.wheatTile);
    this.load.image('roadTile', GameAssets.roadTile);
    this.load.image('lumberjackCampTile', GameAssets.lumberjackCampTile);
    this.load.image('minerCampTile', GameAssets.minerCampTile);
    this.load.image('sawmillTile', GameAssets.sawmillTile);
    this.load.image('stonecutterTile', GameAssets.stonecutterTile);
    this.load.image('warehouseTile', GameAssets.warehouseTile);
    this.load.image('woodIcon', GameAssets.woodIcon);
    this.load.image('planksIcon', GameAssets.planksIcon);
    this.load.image('stoneIcon', GameAssets.stoneIcon);
    this.load.image('stoneBlocksIcon', GameAssets.stoneBlocksIcon);
    this.load.image('wheatIcon', GameAssets.wheatIcon);
    this.load.image('breadIcon', GameAssets.breadIcon);
    this.load.image('oreIcon', GameAssets.oreIcon);
  }

  create() {
    this.hexSize = GameConfig.hex.size;
    this.cols = GameConfig.world.cols;
    this.rows = GameConfig.world.rows;
    this.elapsed = 0;
    this.buildMode = null; // null | 'road' | 'lumberjackCamp' | ...
    this.productionAccum = 0;
    this.infoPanelOverrideText = null;
    this.paused = false;

    // Largeur d'un tour complet du cylindre, et hauteur totale approximative du monde
    this.worldWidthPx = HexUtils.worldPixelWidth(this.cols, this.hexSize);
    this.worldHeightPx = HexUtils.rowHeight(this.hexSize) * (this.rows + 1);

    this.cameras.main.setBackgroundColor(GameConfig.colors.background);

    // Le terrain est un motif hexagonal pavé nativement par le GPU (TileSprite), pas des dizaines
    // de milliers d'hexagones redessinés à la main : voir createTerrainTileTexture().
    this.terrainSprite = this.createTerrainTileSprite();

    this.resourceGraphics = this.add.graphics();
    // Brouillard de guerre : assombrit le terrain/les ressources hors de toute zone révélée (voir
    // GameState.computeRevealedTiles), mais reste SOUS buildingsGraphics — les bâtiments/routes déjà
    // construits restent toujours visibles, seuls le terrain vide et les ressources sont cachés.
    this.fogGraphics = this.add.graphics();
    this.buildingsGraphics = this.add.graphics();
    // Chargements en transit et monstres NE sont PAS des Graphics (contrairement à avant) : ils
    // doivent apparaître AU-DESSUS des routes/ressources, qui elles sont désormais dessinées sur
    // tileArtTexture (voir createTileArtLayer) via la uiCamera — un objet monde (Graphics) rendu
    // par la caméra principale se retrouverait TOUJOURS sous elle, quel que soit son depth (deux
    // passes de caméra distinctes, jamais entrelacées). Voir redrawShipments/redrawMonsters, qui
    // dessinent donc eux aussi sur tileArtTexture, juste après les routes/ressources.
    this.shotGraphics = this.add.graphics().setDepth(920);
    this.selectedBuildingKey = null;

    // Surlignage de la case sélectionnée (redessiné à chaque sélection)
    this.selectionGraphics = this.add.graphics();
    this.selectedHex = null;

    // Aperçu "fantôme" du bâtiment en cours de placement, suit le pointeur en mode construction.
    this.ghostGraphics = this.add.graphics().setDepth(900);
    this.buildGhostHex = null;

    // Zone d'action affichée sous le fantôme (pendant le placement) ou sous le bâtiment sélectionné.
    this.zoneGraphics = this.add.graphics().setDepth(850);

    this.worldElements = [
      this.terrainSprite, this.resourceGraphics, this.fogGraphics, this.buildingsGraphics,
      this.shotGraphics, this.selectionGraphics, this.ghostGraphics, this.zoneGraphics,
    ];

    // Types de bâtiment (voir js/assets.js) ayant leur propre illustration complète — dessinés par
    // redrawTileArt, PAS par redrawBuildings (voir plus bas) qui les ignore explicitement.
    this.buildingTileArtKeys = {
      road: 'roadTile',
      lumberjackCamp: 'lumberjackCampTile',
      minerCamp: 'minerCampTile',
      sawmill: 'sawmillTile',
      stonecutter: 'stonecutterTile',
      warehouse: 'warehouseTile',
    };

    // Entrepôt de départ, offert, pour que le joueur ait un réseau à étendre tout de suite. Entouré
    // de routes dès le départ (voir GameState.placeBuilding : une route ne peut plus désormais être
    // posée que depuis une route déjà existante) pour donner un premier point d'ancrage au réseau.
    const startCol = GameConfig.world.startCol;
    const startRow = Math.floor(this.rows / 2);
    GameState.tiles.set(GameState.key(startCol, startRow), { type: 'warehouse' });
    for (const n of HexUtils.neighbors(startCol, startRow)) {
      if (n.row < 0 || n.row >= this.rows) continue;
      GameState.tiles.set(GameState.key(HexUtils.wrapCol(n.col, this.cols), n.row), { type: 'road' });
    }
    GameState.generateResourceBlobs();
    Monsters.init(GameState);

    this.buildHud();
    this.createTileArtLayer();
    this.setupCameras();

    // Position de départ de la caméra : centrée sur l'entrepôt de départ
    const cam = this.cameras.main;
    cam.setZoom(Math.max(GameConfig.camera.zoomStart, this.getEffectiveZoomMin()));
    const startPixel = HexUtils.offsetToPixel(startCol, startRow, this.hexSize);
    cam.centerOn(startPixel.x, this.worldHeightPx / 2);
    this.clampCameraVertical();

    // --- Contrôles : glisser pour déplacer la caméra ---
    this.isDragging = false;
    this.dragMoved = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    // --- Mode "route" : dessiner en glissant plutôt qu'un seul bâtiment à la fois ---
    this.isRoadPainting = false;
    this.lastPaintedRoadKey = null;

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    // --- Contrôle : molette de la souris pour zoomer (PC) ---
    this.input.on('wheel', this.onWheel, this);

    // --- Contrôle : pincement à deux doigts pour zoomer (mobile) ---
    this.pinchStartDist = null;
    this.pinchStartZoom = null;

    this.redrawBuildings();
    this.redrawResources();
  }

  // Couche d'illustrations de case (arbres/pierre/blé/route, voir js/assets.js et redrawTileArt) :
  // contrairement au terrain (texture répétée à l'infini, voir createTerrainTileSprite) ou aux
  // bâtiments (formes vectorielles via Graphics), ce sont de vraies images posées case par case.
  // Un Graphics ne sait pas dessiner d'image, et un canvas aux dimensions du monde entier
  // dépasserait la limite de surface d'un canvas navigateur (même souci que pour le terrain) :
  // on utilise donc un canvas à la taille de l'ÉCRAN seulement, recalculé en coordonnées écran
  // chaque frame (voir redrawTileArt), affiché via la uiCamera (zoom fixe à 1, jamais déplacée)
  // pour ne pas subir un second zoom en plus de celui déjà appliqué à la main dans ce calcul.
  createTileArtLayer() {
    this.tileArtTexture = this.textures.createCanvas(
      'tileArtLayer', Math.max(1, Math.floor(this.scale.width)), Math.max(1, Math.floor(this.scale.height))
    );
    this.tileArtImage = this.add.image(0, 0, 'tileArtLayer').setOrigin(0, 0).setDepth(5);
    this.uiElements.push(this.tileArtImage);
  }

  // Appelé au redimensionnement (voir l'écouteur 'resize' et le filet de sécurité dans update()) :
  // le canvas de la couche d'illustrations doit toujours couvrir tout l'écran.
  resizeTileArtLayer() {
    const w = Math.max(1, Math.floor(this.scale.width));
    const h = Math.max(1, Math.floor(this.scale.height));
    if (this.tileArtTexture.width === w && this.tileArtTexture.height === h) return;
    this.tileArtTexture.setSize(w, h);
  }

  // Deuxième caméra, fixe (jamais de scroll/zoom), dédiée au HUD : chaque objet n'est rendu
  // (et donc cliquable/survolable) que par UNE des deux caméras, sinon le monde zoomerait le HUD.
  setupCameras() {
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('ui');
    this.cameras.main.ignore(this.uiElements);
    this.uiCamera.ignore(this.worldElements);
  }

  // Formate un coût/butin multi-ressources ({ planks: 8, stoneBlocks: 5 }) en texte court.
  formatResources(amounts, useShortLabel) {
    return Object.entries(amounts)
      .map(([res, qty]) => `${Math.round(qty)} ${GameConfig.resourceLabels[res][useShortLabel ? 'short' : 'long']}`)
      .join(' + ');
  }

  // Une case est constructible si elle est vide, sans ressource de terrain, et si le coût est payable.
  isValidBuildSpot(col, row) {
    const key = GameState.key(col, row);
    if (GameState.tiles.has(key)) return false;
    if (GameState.resourceTiles.has(key)) return false;
    if (this.buildMode === 'road' && !GameState._hasAdjacentRoad(col, row)) return false;
    return GameState.canAfford(GameConfig.buildings[this.buildMode].cost);
  }

  // Recalcule la case survolée par le pointeur et redessine l'aperçu du bâtiment (+ sa zone d'action)
  // à cet endroit. N'est utilisé que pour le mode Route (aperçu avant de peindre en glissant) :
  // pour les autres bâtiments, le fantôme suit la case sélectionnée (tap), pas le pointeur —
  // voir handleTap et setBuildMode.
  updateBuildGhost(pointer) {
    if (!this.buildMode) return;
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
    const modX = ((worldPoint.x % this.worldWidthPx) + this.worldWidthPx) % this.worldWidthPx;
    const { col, row } = HexUtils.pixelToOffset(modX, worldPoint.y, this.hexSize);

    if (row < 0 || row >= this.rows) {
      this.buildGhostHex = null;
    } else {
      this.buildGhostHex = { col: HexUtils.wrapCol(col, this.cols), row };
    }
    this.redrawBuildGhost();
    this.redrawActionZone();
  }

  redrawBuildGhost() {
    const g = this.ghostGraphics;
    g.clear();
    if (!this.buildMode || !this.buildGhostHex) return;

    const def = GameConfig.buildings[this.buildMode];
    const valid = this.isValidBuildSpot(this.buildGhostHex.col, this.buildGhostHex.row);
    g.lineStyle(2, valid ? 0xffffff : 0xff3333, 0.9);
    g.fillStyle(def.color, valid ? 0.5 : 0.25);

    for (let copy = -1; copy <= 1; copy++) {
      const offsetX = copy * this.worldWidthPx;
      const { x, y } = HexUtils.offsetToPixel(this.buildGhostHex.col, this.buildGhostHex.row, this.hexSize);
      const pts = HexUtils.corners(x + offsetX, y, this.hexSize * 0.82);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
    }
  }

  // Surligne la zone d'action : celle du bâtiment en cours de placement (aperçu fantôme) si on
  // est en mode construction, sinon celle du bâtiment actuellement sélectionné. Rayon d'extraction
  // pour un extracteur (ou une Ferme), portée de liaison pour un processeur ou un Entrepôt.
  redrawActionZone() {
    const g = this.zoneGraphics;
    g.clear();

    let col, row, type;
    if (this.buildMode && this.buildGhostHex) {
      type = this.buildMode;
      col = this.buildGhostHex.col;
      row = this.buildGhostHex.row;
    } else if (this.selectedBuildingKey) {
      const tile = GameState.tiles.get(this.selectedBuildingKey);
      if (!tile) return;
      type = tile.type;
      [col, row] = this.selectedBuildingKey.split(',').map(Number);
    } else {
      return;
    }

    const radius = GameState.zoneRadiusFor(type);
    if (radius == null) return;

    const cells = HexUtils.hexesInRange(col, row, radius, this.cols, this.rows);
    g.lineStyle(2, 0x4fd1ff, 0.9);
    g.fillStyle(0x4fd1ff, 0.15);
    for (const cell of cells) {
      for (let copy = -1; copy <= 1; copy++) {
        const offsetX = copy * this.worldWidthPx;
        const { x, y } = HexUtils.offsetToPixel(cell.col, cell.row, this.hexSize);
        const pts = HexUtils.corners(x + offsetX, y, this.hexSize * 0.98);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }
    }
  }

  // Mini-icône (bandeau ressources mobile, voir buildHud/layoutHud) : symbole simple à la couleur
  // de la ressource (celle des jetons de transport sur les routes, pour rester cohérent), dans un
  // carré de côté `size` dont (x, y) est le coin haut-gauche.
  drawResourceBarIcon(g, type, x, y, size) {
    const color = GameConfig.resourceLabels[type].color;
    const cx = x + size / 2, cy = y + size / 2;
    switch (type) {
      case 'wood':
        g.fillStyle(color, 1);
        g.fillRoundedRect(x, y + size * 0.32, size, size * 0.36, size * 0.16);
        g.lineStyle(Math.max(1, size * 0.06), 0x000000, 0.35);
        g.strokeCircle(x + size * 0.18, cy, size * 0.16);
        g.strokeCircle(x + size * 0.82, cy, size * 0.16);
        break;
      case 'planks':
        g.fillStyle(color, 1);
        g.fillRect(x, y + size * 0.06, size, size * 0.22);
        g.fillRect(x, y + size * 0.39, size, size * 0.22);
        g.fillRect(x, y + size * 0.72, size, size * 0.22);
        break;
      case 'stone':
        g.fillStyle(color, 1);
        g.fillCircle(cx, cy, size * 0.44);
        break;
      case 'stoneBlocks':
        g.fillStyle(color, 1);
        g.lineStyle(Math.max(1, size * 0.05), 0x000000, 0.35);
        g.fillRect(x + size * 0.08, y + size * 0.08, size * 0.84, size * 0.84);
        g.strokeRect(x + size * 0.08, y + size * 0.08, size * 0.84, size * 0.84);
        break;
      case 'wheat':
        g.lineStyle(Math.max(1, size * 0.11), color, 1);
        g.beginPath();
        g.moveTo(cx, y + size); g.lineTo(x + size * 0.16, y);
        g.moveTo(cx, y + size); g.lineTo(cx, y);
        g.moveTo(cx, y + size); g.lineTo(x + size * 0.84, y);
        g.strokePath();
        break;
      case 'bread':
        g.fillStyle(color, 1);
        g.fillEllipse(cx, cy, size * 0.92, size * 0.62);
        break;
      default:
        break;
    }
  }

  // Vrai si une fenêtre modale plein écran est ouverte (sauvegardes, arbre technologique...) :
  // ces vues bloquent toute interaction avec la carte en dessous, comme isPointerOverHud le fait
  // déjà pour les éléments du HUD classique.
  isModalOpen() {
    return this.saveMenuOpen || this.techTreeOpen;
  }

  // Vrai si le pointeur est actuellement au-dessus d'un élément du HUD (bandeau/colonne, pavé de
  // construction, bouton) : évite qu'un tap "traverse" jusqu'à la case de la carte en dessous.
  isPointerOverHud(pointer) {
    if (this.isModalOpen()) return true;
    if (Phaser.Geom.Rectangle.Contains(this.sidebarBg.getBounds(), pointer.x, pointer.y)) return true;
    if (this.buildMenuBg.visible && Phaser.Geom.Rectangle.Contains(this.buildMenuBg.getBounds(), pointer.x, pointer.y)) return true;
    if (this.buildMenuToggle.visible && Phaser.Geom.Rectangle.Contains(this.buildMenuToggle.getBounds(), pointer.x, pointer.y)) return true;
    if (this.confirmButton.visible && Phaser.Geom.Rectangle.Contains(this.confirmButton.getBounds(), pointer.x, pointer.y)) return true;
    if (Phaser.Geom.Rectangle.Contains(this.pauseButton.getBounds(), pointer.x, pointer.y)) return true;
    if (Phaser.Geom.Rectangle.Contains(this.menuButton.getBounds(), pointer.x, pointer.y)) return true;
    for (const id in this.buildButtons) {
      const btn = this.buildButtons[id];
      if (btn.visible && Phaser.Geom.Rectangle.Contains(btn.getBounds(), pointer.x, pointer.y)) return true;
    }
    return false;
  }

  // "Main-d'œuvre : ..." : rappelle le nombre de travailleurs affectés à ce bâtiment et
  // l'efficacité qui en résulte (voir GameState.efficiencyForWorkers, une courbe par palier,
  // pas un tout-ou-rien).
  laborStatusLine(col, row) {
    const workers = GameState.getAssignedWorkers(col, row);
    const pct = Math.round(GameState.efficiencyForWorkers(workers) * 100);
    return workers > 0
      ? `Main-d'œuvre : ${workers} travailleur(s) affecté(s) (${pct} %)`
      : `Main-d'œuvre : aucun travailleur affecté (${pct} %)`;
  }

  // Construit le texte du panneau d'info pour le bâtiment sélectionné : ressource disponible
  // à proximité (extracteurs), stock en entrée pas encore traité, stock en sortie pas encore expédié.
  buildingInfoText(col, row, tile) {
    const def = GameConfig.buildings[tile.type];
    const lines = [def.name];

    if (def.kind === 'extractor') {
      const nearby = HexUtils.hexesInRange(col, row, def.extractRadius, this.cols, this.rows)
        .reduce((sum, p) => {
          const res = GameState.getResourceTile(p.col, p.row);
          return sum + (res && res.type === def.resource ? res.amount : 0);
        }, 0);
      lines.push(`Ressource à proximité : ${Math.round(nearby)}`);
      lines.push(`En sortie (à expédier) : ${Math.round(tile.outputBuffer)}/${def.outputCap}`);
      lines.push(this.laborStatusLine(col, row));
    } else if (def.kind === 'processor') {
      lines.push(`En entrée (à traiter) : ${Math.round(tile.inputBuffer)}/${def.inputCap}`);
      lines.push(`En sortie (à expédier) : ${Math.round(tile.outputBuffer)}/${def.outputCap}`);
      lines.push(this.laborStatusLine(col, row));
    } else if (def.kind === 'house') {
      lines.push(`Habitants : ${tile.population}/${GameState.housePopulationCap(def)}`);
      lines.push(`Pain en réserve : ${Math.round(tile.inputBuffer)}/${def.inputCap}`);
      lines.push(tile.hadDeficit ? 'Manque de pain : la population va baisser.' : 'Bien nourrie.');
    } else if (def.kind === 'tower') {
      const active = GameState._hasAdjacentRoad(col, row);
      lines.push(active ? 'Relié à une route : actif.' : 'Pas de route adjacente : inactif.');
      if (active) lines.push(this.laborStatusLine(col, row));
    } else if (tile.type === 'warehouse') {
      lines.push('Les livraisons reçues ici rejoignent le stock central.');
    } else if (tile.type === 'road') {
      lines.push('Relie le réseau : laisse passer les chargements.');
    }
    return lines.join('\n');
  }

  // --- HUD : panneau latéral (PC) ou bandeau haut + menu rétractable (mobile), messages flottants ---
  buildHud() {
    this.uiElements = [];
    this.buildMenuOpen = false; // mode mobile uniquement : le pavé de boutons est replié par défaut
    this.mobileLayout = false; // recalculé dans layoutHud() selon la taille d'écran réelle

    this.sidebarBg = this.add.rectangle(0, 0, 10, 10, 0x0a0f14, 0.85).setOrigin(0, 0).setDepth(999);
    this.uiElements.push(this.sidebarBg);

    // Fond derrière la grille de construction mobile, pour qu'un tap entre deux boutons ne
    // "traverse" pas jusqu'à la carte (équivalent du sidebarBg, mais seulement quand le menu est ouvert).
    this.buildMenuBg = this.add.rectangle(0, 0, 10, 10, 0x0a0f14, 0.92).setOrigin(0, 0).setDepth(999).setVisible(false);
    this.uiElements.push(this.buildMenuBg);

    // Main-d'œuvre nécessaire pour amener toute la production à 100 % (voir GameState.
    // neededWorkers) et logements encore libres (GameState.availableHousing) : contrairement aux
    // ressources ci-dessus (stock central), ce sont des indicateurs d'état de la population,
    // positionnés juste sous le bandeau/texte de ressources (voir layoutHud).
    this.populationStatsText = this.add.text(0, 0, '', {
      font: 'bold 12px sans-serif', color: '#c9e8ff', backgroundColor: '#000000aa', padding: { x: 8, y: 4 },
    }).setDepth(1000);
    this.uiElements.push(this.populationStatsText);

    // Bandeau ressources mobile : une seule ligne icône+valeur par ressource (le texte complet
    // PC, sur 3 lignes, prend trop de hauteur sur un écran de téléphone en paysage). Les icônes
    // sont dessinées (pas des emoji) pour un rendu garanti identique sur toutes les plateformes,
    // dans le même style que les icônes de bâtiments/ressources sur la carte (voir drawBuildingIcon).
    // Le dessin ne dépend que de la mise en page (redessiné dans layoutHud) ; seules les valeurs
    // affichées changent à chaque frame (update()).
    this.resourceBarIconsGraphics = this.add.graphics().setDepth(1000).setVisible(false);
    this.uiElements.push(this.resourceBarIconsGraphics);
    // Uniquement les produits finaux (voir demande utilisateur) : le bois, la pierre brute et le
    // blé restent des ressources internes (production/stock) mais ne s'affichent plus ici.
    // "ore" (minerai) reste affiché même à 0 tant que Tunnelier n'est pas débloqué (voir
    // techTree.nodes.ind_tunnelier) : ni plus clair ni plus simple de faire apparaître/disparaître
    // un emplacement du bandeau selon l'état de l'arbre techno, pour un seul cas.
    this.resourceOrder = ['planks', 'stoneBlocks', 'bread', 'ore'];
    // Là où un logo (voir js/assets.js) existe, une vraie image remplace l'icône vectorielle
    // dessinée ci-dessus (drawResourceBarIcon).
    this.resourceBarIconTextureKeys = {
      planks: 'planksIcon', stoneBlocks: 'stoneBlocksIcon', bread: 'breadIcon', ore: 'oreIcon',
    };
    this.resourceBarIconImages = {};
    for (const res in this.resourceBarIconTextureKeys) {
      const img = this.add.image(0, 0, this.resourceBarIconTextureKeys[res])
        .setOrigin(0, 0).setDepth(1000).setVisible(false);
      this.resourceBarIconImages[res] = img;
      this.uiElements.push(img);
    }
    this.resourceValueTexts = {};
    for (const res of this.resourceOrder) {
      const t = this.add.text(0, 0, '0', {
        font: 'bold 14px sans-serif', color: '#ffd23f',
      }).setDepth(1000).setVisible(false);
      this.resourceValueTexts[res] = t;
      this.uiElements.push(t);
    }

    // Panneau d'info : contenu variable (aide de construction / infos du bâtiment sélectionné /
    // dernière case tapée). Sur PC toujours à la même position ; sur mobile, n'apparaît que
    // quand il y a quelque chose à montrer, pour ne pas manger l'écran en permanence.
    this.infoPanelText = this.add.text(10, 90, '', {
      font: '13px sans-serif', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 8, y: 6 },
      lineSpacing: 3,
    }).setDepth(1000);
    this.uiElements.push(this.infoPanelText);

    this.toastText = this.add.text(0, 0, '', {
      font: 'bold 15px sans-serif', color: '#ffffff', backgroundColor: '#000000cc', padding: { x: 10, y: 6 },
    }).setDepth(1001).setAlpha(0);
    this.uiElements.push(this.toastText);

    // Pause / Menu : toujours en haut à droite de l'écran, quelle que soit la mise en page
    // (PC ou mobile) — voir layoutHud(), positionné avant les branches desktop/mobile.
    this.pauseButton = this.add.text(0, 0, '⏸', {
      font: 'bold 18px sans-serif', color: '#10151a', backgroundColor: '#ffd23f', padding: { x: 10, y: 8 },
    }).setDepth(1002).setInteractive({ useHandCursor: true });
    this.pauseButton.on('pointerup', () => this.togglePause());
    this.uiElements.push(this.pauseButton);

    this.menuButton = this.add.text(0, 0, '☰', {
      font: 'bold 18px sans-serif', color: '#ffffff', backgroundColor: '#2e5339', padding: { x: 10, y: 8 },
    }).setDepth(1002).setInteractive({ useHandCursor: true });
    this.menuButton.on('pointerup', () => this.toggleSaveMenu());
    this.uiElements.push(this.menuButton);

    this.buildSaveMenu();
    this.buildTechTree();

    // Bouton unique qui ouvre/ferme le pavé de construction en mode mobile, et sert aussi de
    // bouton d'annulation quand un mode de construction est actif (pas besoin de rouvrir le pavé).
    this.buildMenuToggle = this.add.text(0, 0, '', {
      font: 'bold 15px sans-serif', color: '#10151a', backgroundColor: '#ffd23f', padding: { x: 14, y: 12 },
    }).setDepth(1000).setInteractive({ useHandCursor: true }).setVisible(false);
    this.buildMenuToggle.on('pointerup', () => {
      if (this.paused) return;
      if (this.buildMode) {
        this.setBuildMode(null);
      } else {
        this.buildMenuOpen = !this.buildMenuOpen;
        this.layoutHud();
      }
    });
    this.uiElements.push(this.buildMenuToggle);

    // Bouton "Valider" : construit le bâtiment à l'endroit du fantôme. Visible seulement quand
    // un mode de construction (hors Route) a un aperçu positionné sur une case.
    this.confirmButton = this.add.text(0, 0, '✓ Valider', {
      font: 'bold 15px sans-serif', color: '#10151a', backgroundColor: '#5fd97a', padding: { x: 14, y: 12 },
    }).setDepth(1000).setInteractive({ useHandCursor: true }).setVisible(false);
    this.confirmButton.on('pointerup', () => this.confirmBuild());
    this.uiElements.push(this.confirmButton);

    const buildDefs = [
      { id: 'road', label: 'Route' },
      { id: 'lumberjackCamp', label: 'Camp Bûcheron' },
      { id: 'sawmill', label: 'Scierie' },
      { id: 'minerCamp', label: 'Camp Mineur' },
      { id: 'stonecutter', label: 'Tailleur pierre' },
      { id: 'farm', label: 'Ferme' },
      { id: 'bakery', label: 'Boulangerie' },
      { id: 'house', label: 'Maison' },
      { id: 'warehouse', label: 'Entrepôt' },
      { id: 'donjon', label: 'Donjon' },
      { id: 'university', label: 'Université' },
    ];
    this.buildButtons = {};
    buildDefs.forEach((def) => {
      const cost = GameConfig.buildings[def.id].cost;
      const text = `${def.label}  —  ${this.formatResources(cost, true)}`;
      const btn = this.add.text(0, 0, text, {
        font: '13px sans-serif', color: '#ffffff', backgroundColor: '#2e5339',
        padding: { x: 10, y: 9 }, align: 'left',
      })
        .setDepth(1000).setInteractive({ useHandCursor: true });
      btn.on('pointerup', () => this.setBuildMode(this.buildMode === def.id ? null : def.id));
      this.buildButtons[def.id] = btn;
      this.uiElements.push(btn);
    });

    this.layoutHud();
    this.scale.on('resize', (size) => {
      this.uiCamera?.setSize(size.width, size.height);
      if (this.tileArtTexture) this.resizeTileArtLayer();
      this.layoutHud();
      this.layoutSaveMenu();
      this.layoutTechTree();
      this.clampZoomAndCamera();
    });
  }

  // Panneau modal Sauvegardes : un fond plein écran (bloque tout clic vers la carte en dessous)
  // + un panneau centré avec 3 emplacements (Sauvegarder / Charger chacun). Créé une fois ici,
  // toujours présent mais invisible par défaut ; voir toggleSaveMenu()/layoutSaveMenu().
  buildSaveMenu() {
    this.saveMenuOpen = false;

    this.saveMenuOverlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.6)
      .setOrigin(0, 0).setDepth(1010).setVisible(false).setInteractive();
    this.saveMenuOverlay.on('pointerup', () => this.toggleSaveMenu(false));
    this.uiElements.push(this.saveMenuOverlay);

    // Interactif (sans action propre) uniquement pour "absorber" les clics à l'intérieur du
    // panneau avant qu'ils n'atteignent l'overlay en dessous (qui, lui, ferme le menu).
    this.saveMenuPanel = this.add.rectangle(0, 0, 10, 10, 0x14202b, 0.97)
      .setOrigin(0, 0).setDepth(1011).setStrokeStyle(2, 0xffd23f).setVisible(false).setInteractive();
    this.uiElements.push(this.saveMenuPanel);

    this.saveMenuTitle = this.add.text(0, 0, 'Sauvegardes', {
      font: 'bold 16px sans-serif', color: '#ffd23f',
    }).setDepth(1012).setVisible(false);
    this.uiElements.push(this.saveMenuTitle);

    this.saveMenuClose = this.add.text(0, 0, '✕', {
      font: 'bold 15px sans-serif', color: '#10151a', backgroundColor: '#ffd23f', padding: { x: 9, y: 6 },
    }).setDepth(1012).setInteractive({ useHandCursor: true }).setVisible(false);
    this.saveMenuClose.on('pointerup', () => this.toggleSaveMenu(false));
    this.uiElements.push(this.saveMenuClose);

    this.saveSlots = [];
    for (let i = 1; i <= 3; i++) {
      const label = this.add.text(0, 0, '', {
        font: '13px sans-serif', color: '#ffffff', lineSpacing: 4,
      }).setDepth(1012).setVisible(false);
      const saveBtn = this.add.text(0, 0, 'Sauvegarder', {
        font: '13px sans-serif', color: '#10151a', backgroundColor: '#5fd97a', padding: { x: 10, y: 7 },
      }).setDepth(1012).setInteractive({ useHandCursor: true }).setVisible(false);
      const loadBtn = this.add.text(0, 0, 'Charger', {
        font: '13px sans-serif', color: '#10151a', backgroundColor: '#4fd1ff', padding: { x: 10, y: 7 },
      }).setDepth(1012).setInteractive({ useHandCursor: true }).setVisible(false);
      const slot = i;
      saveBtn.on('pointerup', () => this.saveToSlot(slot));
      loadBtn.on('pointerup', () => this.loadFromSlot(slot));
      this.uiElements.push(label, saveBtn, loadBtn);
      this.saveSlots.push({ label, saveBtn, loadBtn });
    }
  }

  // Repositionne le panneau de sauvegarde (appelé à l'ouverture et au redimensionnement).
  layoutSaveMenu() {
    const w = this.scale.width, h = this.scale.height;
    this.saveMenuOverlay.setSize(w, h);

    const panelWidth = Math.min(400, w - 32);
    const panelHeight = Math.min(320, h - 24);
    const px = (w - panelWidth) / 2;
    const py = (h - panelHeight) / 2;
    this.saveMenuPanel.setPosition(px, py).setSize(panelWidth, panelHeight);
    this.saveMenuTitle.setPosition(px + 16, py + 12);
    this.saveMenuClose.setPosition(px + panelWidth - this.saveMenuClose.width - 10, py + 8);

    const rowsTop = py + 48;
    const rowHeight = (panelHeight - 60) / 3;
    this.saveSlots.forEach((slot, i) => {
      const rowY = rowsTop + i * rowHeight;
      slot.label.setPosition(px + 16, rowY).setWordWrapWidth(panelWidth - 190).setFontSize(13);
      slot.saveBtn.setPosition(px + panelWidth - slot.saveBtn.width - slot.loadBtn.width - 26, rowY + rowHeight / 2 - 34);
      slot.loadBtn.setPosition(px + panelWidth - slot.loadBtn.width - 14, rowY + rowHeight / 2 - 34);
    });
  }

  // Ouvre/ferme le panneau de sauvegarde. L'ouvrir met automatiquement le jeu en pause (on ne
  // veut pas pouvoir sauvegarder/charger pendant que la simulation continue de tourner) ; le
  // fermer laisse le jeu en pause, à reprendre explicitement avec le bouton Pause.
  toggleSaveMenu(forceState) {
    this.saveMenuOpen = forceState !== undefined ? forceState : !this.saveMenuOpen;
    const visible = this.saveMenuOpen;
    this.saveMenuOverlay.setVisible(visible);
    this.saveMenuPanel.setVisible(visible);
    this.saveMenuTitle.setVisible(visible);
    this.saveMenuClose.setVisible(visible);
    this.saveSlots.forEach(s => {
      s.label.setVisible(visible);
      s.saveBtn.setVisible(visible);
      s.loadBtn.setVisible(visible);
    });

    if (visible) {
      if (!this.paused) this.togglePause();
      this.refreshSaveMenu();
      this.layoutSaveMenu();
    }
  }

  // Met à jour le texte de chaque emplacement (vide / date de sauvegarde) et active ou grise
  // le bouton "Charger" en fonction de la présence d'une sauvegarde dans ce slot.
  refreshSaveMenu() {
    this.saveSlots.forEach((slotUI, i) => {
      const slot = i + 1;
      const raw = localStorage.getItem(this.saveSlotKey(slot));
      let info = null;
      if (raw) {
        try { info = JSON.parse(raw); } catch (e) { info = null; }
      }
      if (info) {
        const when = new Date(info.savedAt).toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        slotUI.label.setText(`Emplacement ${slot}\nSauvegardé le ${when}`);
        slotUI.loadBtn.setAlpha(1).setInteractive({ useHandCursor: true });
      } else {
        slotUI.label.setText(`Emplacement ${slot}\nVide`);
        slotUI.loadBtn.setAlpha(0.4).disableInteractive();
      }
    });
  }

  saveSlotKey(slot) {
    return `cylindreCitySave_${slot}`;
  }

  saveToSlot(slot) {
    const data = {
      version: 1,
      savedAt: Date.now(),
      elapsed: this.elapsed,
      gameState: GameState.serialize(),
      monsters: Monsters.serialize(),
    };
    try {
      localStorage.setItem(this.saveSlotKey(slot), JSON.stringify(data));
      this.showToast(`Sauvegardé (emplacement ${slot})`);
    } catch (e) {
      this.showToast('Échec de la sauvegarde');
    }
    this.refreshSaveMenu();
  }

  loadFromSlot(slot) {
    const raw = localStorage.getItem(this.saveSlotKey(slot));
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      this.showToast('Sauvegarde illisible');
      return;
    }

    GameState.deserialize(data.gameState);
    Monsters.deserialize(data.monsters || {});
    this.elapsed = data.elapsed || 0;
    this.productionAccum = 0;

    this.buildMode = null;
    this.buildGhostHex = null;
    this.selectedHex = null;
    this.selectedBuildingKey = null;
    this.infoPanelOverrideText = null;
    this.isRoadPainting = false;
    this.ghostGraphics.clear();
    this.zoneGraphics.clear();
    this.redrawSelection();

    this.toggleSaveMenu(false);
    this.showToast(`Emplacement ${slot} chargé`);
  }

  // Panneau modal Arbre technologique : mêmes principes que le panneau Sauvegardes (fond plein
  // écran + panneau centré), mais son contenu est un diagramme radial : les nœuds sont disposés
  // en anneaux concentriques autour d'un centre (voir GameConfig.techTree), reliés à leur parent
  // par un trait. Créé une fois ici, repositionné à l'ouverture et au redimensionnement.
  buildTechTree() {
    this.techTreeOpen = false;
    // Décalage de la "caméra" de l'arbre (glisser pour naviguer, voir onPointerDown/Move/Up) :
    // en unités du diagramme, pas en pixels écran — indépendant de la caméra du monde.
    this.techTreeCamX = 0;
    this.techTreeCamY = 0;
    this.techTreePanDragging = false;
    this.techTreeSelectedId = null;

    this.techTreeOverlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.75)
      .setOrigin(0, 0).setDepth(1010).setVisible(false).setInteractive();
    this.techTreeOverlay.on('pointerup', () => this.toggleTechTree(false));
    this.uiElements.push(this.techTreeOverlay);

    this.techTreePanel = this.add.rectangle(0, 0, 10, 10, 0x14202b, 0.97)
      .setOrigin(0, 0).setDepth(1011).setStrokeStyle(2, 0xffd23f).setVisible(false).setInteractive();
    this.uiElements.push(this.techTreePanel);

    this.techTreeTitle = this.add.text(0, 0, 'Arbre technologique (glisse pour naviguer)', {
      font: 'bold 16px sans-serif', color: '#ffd23f',
    }).setDepth(1012).setVisible(false);
    this.uiElements.push(this.techTreeTitle);

    this.techTreeClose = this.add.text(0, 0, '✕', {
      font: 'bold 15px sans-serif', color: '#10151a', backgroundColor: '#ffd23f', padding: { x: 9, y: 6 },
    }).setDepth(1013).setInteractive({ useHandCursor: true }).setVisible(false);
    this.techTreeClose.on('pointerup', () => this.toggleTechTree(false));
    this.uiElements.push(this.techTreeClose);

    // Bulle de description façon BD, ancrée près du nœud sélectionné (this.techTreeSelectedId) et
    // entièrement masquée dès qu'aucun nœud n'est sélectionné (voir updateTechTreeBubble) — pas de
    // zone fixe qui prend de la place en permanence.
    this.techTreeBubbleGraphics = this.add.graphics().setDepth(1014).setVisible(false);
    this.uiElements.push(this.techTreeBubbleGraphics);

    this.techTreeBubbleText = this.add.text(0, 0, '', {
      font: '12px sans-serif', color: '#10151a', align: 'left', lineSpacing: 3,
    }).setDepth(1015).setVisible(false);
    this.uiElements.push(this.techTreeBubbleText);

    // Bouton de confirmation, affiché seulement quand le nœud sélectionné est débloquable et pas
    // encore débloqué (voir updateTechTreeBubble). Tant qu'on ne clique pas dessus, sélectionner un
    // nœud se contente d'afficher sa description (voir onTechNodeClick) — ça ne débloque rien.
    this.techTreeResearchBtn = this.add.text(0, 0, 'Rechercher', {
      font: 'bold 12px sans-serif', color: '#10151a', backgroundColor: '#ffd23f', padding: { x: 9, y: 5 },
    }).setDepth(1015).setInteractive({ useHandCursor: true }).setVisible(false);
    this.techTreeResearchBtn.on('pointerup', () => this.researchSelectedTech());
    this.uiElements.push(this.techTreeResearchBtn);

    // Les traits reliant chaque nœud à son parent (redessinés dans refreshTechTree, pas ici).
    this.techTreeGraphics = this.add.graphics().setDepth(1012).setVisible(false);
    this.uiElements.push(this.techTreeGraphics);

    // Un cercle + une étiquette par nœud, créés une fois pour toutes ; repositionnés à chaque
    // glissement (positionTechTreeNodes) et colorés selon leur état dans refreshTechTree().
    this.techTreeNodes = {};
    for (const id in GameConfig.techTree.nodes) {
      const circle = this.add.circle(0, 0, GameConfig.techTree.nodeRadius, 0x555566, 1)
        .setStrokeStyle(2, 0x10151a, 1)
        .setDepth(1013).setInteractive({ useHandCursor: true }).setVisible(false);
      circle.on('pointerup', () => this.onTechNodeClick(id));
      const label = this.add.text(0, 0, GameConfig.techTree.nodes[id].name, {
        font: '11px sans-serif', color: '#ffffff', align: 'center',
      }).setOrigin(0.5, 0).setDepth(1013).setVisible(false);
      this.uiElements.push(circle, label);
      this.techTreeNodes[id] = { circle, label };
    }

    // Masque rectangulaire (zone des nœuds, sous le titre et au-dessus du texte d'info) : le
    // diagramme peut dépasser largement cette zone une fois qu'on glisse, il ne doit pas déborder
    // par-dessus le titre/texte ni les bords du panneau. Le graphics source du masque n'est lui-
    // même jamais ajouté à la scène, seule sa forme sert de gabarit.
    this.techTreeMaskGraphics = this.make.graphics({ x: 0, y: 0 }, false);
    const mask = new Phaser.Display.Masks.GeometryMask(this, this.techTreeMaskGraphics);
    this.techTreeGraphics.setMask(mask);
    for (const id in this.techTreeNodes) {
      this.techTreeNodes[id].circle.setMask(mask);
      this.techTreeNodes[id].label.setMask(mask);
    }
  }

  // Repositionne le panneau et sa zone masquée selon la taille d'écran disponible (appelé à
  // l'ouverture et au redimensionnement, pas à chaque glissement — voir positionTechTreeNodes).
  layoutTechTree() {
    const w = this.scale.width, h = this.scale.height;
    this.techTreeOverlay.setSize(w, h);

    const panelWidth = Math.min(w - 32, 720);
    const panelHeight = Math.min(h - 24, 560);
    const px = (w - panelWidth) / 2;
    const py = (h - panelHeight) / 2;
    this.techTreePanel.setPosition(px, py).setSize(panelWidth, panelHeight);
    this.techTreeTitle.setPosition(px + 16, py + 12).setFontSize(this.mobileLayout ? 13 : 16);
    this.techTreeClose.setPosition(px + panelWidth - this.techTreeClose.width - 10, py + 8);

    // Plus de zone de texte fixe en bas : la description flotte dans une bulle près du nœud
    // sélectionné (voir updateTechTreeBubble), donc la zone des nœuds peut occuper tout l'espace
    // sous le titre.
    this.techTreeNodesArea = { x: px, y: py + 40, width: panelWidth, height: panelHeight - 50 };
    this.techTreeMaskGraphics.clear();
    this.techTreeMaskGraphics.fillStyle(0xffffff);
    this.techTreeMaskGraphics.fillRect(
      this.techTreeNodesArea.x, this.techTreeNodesArea.y,
      this.techTreeNodesArea.width, this.techTreeNodesArea.height
    );

    this.positionTechTreeNodes();
  }

  // Place chaque nœud selon sa position radiale (ring/angle, espacement FIXE — voir
  // GameConfig.techTree.ringSpacing) décalée par techTreeCamX/Y : appelé à l'ouverture, au
  // redimensionnement, ET à chaque déplacement du glisser (voir onPointerMove), donc gardé léger.
  positionTechTreeNodes() {
    const cfg = GameConfig.techTree;
    const area = this.techTreeNodesArea;
    const centerX = area.x + area.width / 2 - this.techTreeCamX;
    const centerY = area.y + area.height / 2 - this.techTreeCamY;

    this.techTreeNodePositions = {};
    for (const id in cfg.nodes) {
      const node = cfg.nodes[id];
      const r = node.ring * cfg.ringSpacing;
      const rad = Phaser.Math.DegToRad(node.angle);
      const x = centerX + r * Math.cos(rad);
      const y = centerY + r * Math.sin(rad);
      this.techTreeNodePositions[id] = { x, y };
      const { circle, label } = this.techTreeNodes[id];
      circle.setPosition(x, y);
      label.setPosition(x, y + cfg.nodeRadius + 4);
    }

    this.refreshTechTree();
    this.updateTechTreeBubble();
  }

  // Redessine les traits parent->enfant (verts si l'enfant est débloqué, gris sinon) et recolore
  // chaque nœud selon son état : gris = verrouillé, doré = un niveau reste à rechercher (premier
  // déblocage OU amélioration d'un nœud à plusieurs niveaux), vert = au niveau maximum.
  refreshTechTree() {
    const g = this.techTreeGraphics;
    g.clear();
    const cfg = GameConfig.techTree;

    for (const id in cfg.nodes) {
      const node = cfg.nodes[id];
      if (!node.parent) continue;
      const a = this.techTreeNodePositions[node.parent];
      const b = this.techTreeNodePositions[id];
      const unlocked = GameState.isTechUnlocked(id);
      g.lineStyle(3, unlocked ? 0x5fd97a : 0x555566, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }

    for (const id in cfg.nodes) {
      const node = cfg.nodes[id];
      const level = GameState.techLevel(id);
      const maxLevel = GameState.maxTechLevel(id);
      const researchable = GameState.canResearchTech(id);
      const maxed = level > 0 && !researchable;
      const color = maxed ? 0x5fd97a : (researchable ? 0xffd23f : 0x555566);
      const circle = this.techTreeNodes[id].circle;
      circle.setFillStyle(color, 1);
      // Le nœud actuellement sélectionné (dont la description s'affiche en bas) se distingue par
      // un contour blanc épais plutôt que le fin liseré sombre par défaut de tous les autres.
      const selected = id === this.techTreeSelectedId;
      circle.setStrokeStyle(selected ? 3 : 2, selected ? 0xffffff : 0x10151a, 1);
      // Nœuds à plusieurs niveaux : le niveau atteint s'affiche sous le nom une fois débloqué
      // (ex. "Nutrition (2/3)"), pour distinguer un nœud encore améliorable d'un nœud tout neuf.
      this.techTreeNodes[id].label.setText(maxLevel > 1 && level > 0 ? `${node.name} (${level}/${maxLevel})` : node.name);
    }
  }

  // (Re)dessine la bulle de description façon BD près du nœud sélectionné (this.techTreeSelectedId,
  // voir onTechNodeClick) : nom, description, état, et le bouton "Rechercher" si débloquable.
  // Entièrement masquée dès qu'aucun nœud n'est sélectionné. Suit le nœud pendant le glisser (appelé
  // depuis positionTechTreeNodes à chaque tick de drag, donc gardé simple).
  updateTechTreeBubble() {
    const id = this.techTreeSelectedId;
    const g = this.techTreeBubbleGraphics;
    g.clear();

    if (!id) {
      g.setVisible(false);
      this.techTreeBubbleText.setVisible(false);
      this.techTreeResearchBtn.setVisible(false);
      return;
    }

    const node = GameConfig.techTree.nodes[id];
    const level = GameState.techLevel(id);
    const maxLevel = GameState.maxTechLevel(id);
    const researchable = GameState.canResearchTech(id);
    const unlocked = level > 0;
    let status;
    if (unlocked && !researchable) {
      status = maxLevel > 1 ? 'Niveau maximum atteint.' : 'Déjà débloqué.';
    } else if (researchable) {
      status = unlocked ? `Amélioration disponible (niveau ${level}/${maxLevel}).` : 'Débloquable.';
    } else {
      const parentName = node.parent ? GameConfig.techTree.nodes[node.parent].name : '?';
      status = `Débloque d'abord "${parentName}".`;
    }
    const showBtn = researchable;

    this.techTreeResearchBtn.setText(unlocked ? 'Améliorer' : 'Rechercher');

    this.techTreeBubbleText.setWordWrapWidth(190);
    this.techTreeBubbleText.setText(`${node.name}\n${node.description}\n${status}`);
    this.techTreeBubbleText.setVisible(true);

    const padding = 10;
    const textBounds = this.techTreeBubbleText.getBounds();
    const btnW = showBtn ? this.techTreeResearchBtn.width : 0;
    const btnH = showBtn ? this.techTreeResearchBtn.height : 0;
    const bubbleWidth = Math.max(textBounds.width, btnW) + padding * 2;
    const bubbleHeight = textBounds.height + (showBtn ? btnH + 8 : 0) + padding * 2;

    const nodePos = this.techTreeNodePositions[id];
    const nodeRadius = GameConfig.techTree.nodeRadius;
    const tailSize = 10;

    // Préfère apparaître au-dessus du nœud (plus naturel comme une bulle de BD) ; passe en dessous
    // s'il n'y a pas la place (nœud proche du haut du panneau).
    const area = this.techTreeNodesArea;
    const above = (nodePos.y - nodeRadius - tailSize - bubbleHeight) > area.y;
    let bubbleX = nodePos.x - bubbleWidth / 2;
    let bubbleY = above
      ? (nodePos.y - nodeRadius - tailSize - bubbleHeight)
      : (nodePos.y + nodeRadius + tailSize);

    // Reste dans les limites du panneau (peut légèrement déborder de la zone masquée des nœuds,
    // comme le reste du chrome du panneau (titre, bouton fermer) — seuls les nœuds/traits sont
    // masqués, voir buildTechTree).
    const panelBounds = this.techTreePanel.getBounds();
    bubbleX = Phaser.Math.Clamp(bubbleX, panelBounds.x + 8, panelBounds.x + panelBounds.width - bubbleWidth - 8);
    bubbleY = Phaser.Math.Clamp(bubbleY, panelBounds.y + 36, panelBounds.y + panelBounds.height - bubbleHeight - 8);

    g.fillStyle(0xfff6d8, 0.98);
    g.lineStyle(2, 0x10151a, 1);
    g.fillRoundedRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8);
    g.strokeRoundedRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8);

    // La petite pointe façon bulle de BD, dessinée par-dessus le corps pour effacer le morceau de
    // contour qu'elle recouvre et rester visuellement soudée à la bulle.
    const tailX = Phaser.Math.Clamp(nodePos.x, bubbleX + 14, bubbleX + bubbleWidth - 14);
    g.fillStyle(0xfff6d8, 0.98);
    g.beginPath();
    if (above) {
      g.moveTo(tailX - tailSize * 0.6, bubbleY + bubbleHeight - 1);
      g.lineTo(tailX + tailSize * 0.6, bubbleY + bubbleHeight - 1);
      g.lineTo(tailX, bubbleY + bubbleHeight - 1 + tailSize);
    } else {
      g.moveTo(tailX - tailSize * 0.6, bubbleY + 1);
      g.lineTo(tailX + tailSize * 0.6, bubbleY + 1);
      g.lineTo(tailX, bubbleY + 1 - tailSize);
    }
    g.closePath();
    g.fillPath();
    g.setVisible(true);

    this.techTreeBubbleText.setPosition(bubbleX + padding, bubbleY + padding);

    if (showBtn) {
      this.techTreeResearchBtn.setPosition(
        bubbleX + bubbleWidth - btnW - padding, bubbleY + bubbleHeight - btnH - padding
      );
      this.techTreeResearchBtn.setVisible(true);
    } else {
      this.techTreeResearchBtn.setVisible(false);
    }
  }

  // Ouvre/ferme l'arbre technologique. L'ouvrir met le jeu en pause, comme le panneau de
  // sauvegarde ; le fermer laisse le jeu en pause, à reprendre explicitement.
  toggleTechTree(forceState) {
    this.techTreeOpen = forceState !== undefined ? forceState : !this.techTreeOpen;
    const visible = this.techTreeOpen;
    this.techTreeOverlay.setVisible(visible);
    this.techTreePanel.setVisible(visible);
    this.techTreeTitle.setVisible(visible);
    this.techTreeClose.setVisible(visible);
    this.techTreeGraphics.setVisible(visible);
    this.techTreeBubbleGraphics.setVisible(false);
    this.techTreeBubbleText.setVisible(false);
    this.techTreeResearchBtn.setVisible(false);
    for (const id in this.techTreeNodes) {
      this.techTreeNodes[id].circle.setVisible(visible);
      this.techTreeNodes[id].label.setVisible(visible);
    }

    if (visible) {
      if (!this.paused) this.togglePause();
      // Toujours recentré sur le milieu du diagramme (d'où rayonnent les 5 branches) à
      // l'ouverture, plutôt que de garder la position du glisser précédent (qui pourrait laisser
      // la vue sur une zone vide et déroutante).
      this.techTreeCamX = 0;
      this.techTreeCamY = 0;
      this.techTreePanDragging = false;
      this.techTreeSelectedId = null;
      this.layoutTechTree();
    }
  }

  // Clic sur un nœud : le sélectionne (affiche sa description + son état dans une bulle, voir
  // updateTechTreeBubble) sans le débloquer — le déblocage ne se fait qu'en validant explicitement
  // via le bouton "Rechercher" (voir researchSelectedTech).
  onTechNodeClick(id) {
    this.techTreeSelectedId = id;
    this.refreshTechTree();
    this.updateTechTreeBubble();
  }

  // Débloque (ou améliore, pour un nœud à plusieurs niveaux) le nœud actuellement sélectionné —
  // appelé par le bouton "Rechercher"/"Améliorer", visible seulement quand un niveau reste
  // disponible (voir updateTechTreeBubble). Gratuit : aucun coût en ressources.
  researchSelectedTech() {
    const id = this.techTreeSelectedId;
    if (!id || !GameState.canResearchTech(id)) return;
    GameState.researchTech(id);
    this.refreshTechTree();
    this.updateTechTreeBubble();
  }

  // Point d'entrée depuis handleTap() : une Université ouvre l'arbre technologique au lieu du
  // panneau d'info habituel, mais seulement si elle est reliée à une route (même exigence que
  // le Donjon).
  openTechTree(col, row) {
    if (!GameState._hasAdjacentRoad(col, row)) {
      this.showToast('Université non reliée à une route');
      return;
    }
    this.toggleTechTree(true);
  }

  // Bascule pause/reprise. En pause : la simulation (production, transport, vague) est gelée et
  // la construction désactivée, mais la caméra reste libre et les cases restent cliquables pour
  // consulter leurs infos (voir update() et handleTap()).
  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.setBuildMode(null);
      this.isRoadPainting = false;
    }
    this.setBuildButtonsEnabled(!this.paused);
    this.pauseButton.setText(this.paused ? '▶' : '⏸');
    this.showToast(this.paused ? 'Jeu en pause' : 'Reprise du jeu');
  }

  // Grise les boutons de construction (et les rend non cliquables) pendant la pause.
  setBuildButtonsEnabled(enabled) {
    for (const id in this.buildButtons) {
      this.buildButtons[id].setAlpha(enabled ? 1 : 0.4);
    }
    this.buildMenuToggle.setAlpha(enabled ? 1 : 0.4);
    this.confirmButton.setAlpha(enabled ? 1 : 0.4);
  }

  // Zoom minimum effectif pour cette taille d'écran : exactement ce qu'il faut pour que le monde
  // (qui ne boucle pas verticalement) remplisse toute la hauteur visible, quel que soit
  // l'appareil — ainsi, au zoom minimal, on voit toujours les 22 rangées complètes, sur PC comme
  // sur un téléphone en paysage. GameConfig.camera.zoomMin n'est plus qu'un garde-fou absolu très
  // bas (évite un zoom nul/négatif) : avant, sa valeur de 0.5 empêchait les écrans bas (téléphone
  // en paysage) de dézoomer assez pour tout voir, alors qu'un PC plus haut y arrivait sans souci —
  // le mobile affichait donc moins de cases que le PC au lieu d'au moins autant.
  getEffectiveZoomMin() {
    // hudTopInset (mobile) : hauteur du bandeau du haut, qui couvre une partie de l'écran sans
    // rien cacher du monde en dessous — il faut donc viser la hauteur RESTANTE, sinon le zoom
    // minimal calcule midpoint plein écran alors qu'une bande du bas ne sera jamais visible.
    const usableHeight = this.cameras.main.height - (this.hudTopInset || 0);
    const neededToFillHeight = usableHeight / this.worldHeightPx;
    const zoomMin = Math.max(GameConfig.camera.zoomMin, Math.min(neededToFillHeight, GameConfig.camera.zoomMax));
    return zoomMin;
  }

  // Recale le zoom courant (et le scroll) sur les nouvelles limites après un redimensionnement.
  clampZoomAndCamera() {
    const cam = this.cameras.main;
    const zoomMin = this.getEffectiveZoomMin();
    if (cam.zoom < zoomMin) cam.setZoom(zoomMin);
    this.clampCameraVertical();
  }

  // Bascule entre deux mises en page selon la place réellement disponible :
  // - PC (écran assez large ET assez haut pour empiler tous les boutons) : colonne fixe à
  //   gauche, toujours visible, comme avant.
  // - Mobile (écran étroit, ou trop bas pour la colonne PC — ex. téléphone en paysage) :
  //   bandeau compact en haut (ressources + infos) et pavé de construction replié par défaut
  //   derrière un bouton, avec des cases plus grandes pour le doigt.
  layoutHud() {
    const w = this.scale.width, h = this.scale.height;

    // Pause / Menu : toujours en haut à droite, indépendamment de la mise en page PC/mobile.
    this.menuButton.setPosition(w - this.menuButton.width - 10, 10);
    this.pauseButton.setPosition(w - this.menuButton.width - this.pauseButton.width - 20, 10);

    const buttonIds = Object.keys(this.buildButtons);
    const desktopSidebarWidth = 220;
    const desktopBtnHeight = 38, desktopGap = 6;
    const confirmRowHeight = 42;
    const desktopNeededHeight = 190 + confirmRowHeight + buttonIds.length * (desktopBtnHeight + desktopGap) + 20;
    const showConfirm = !!(this.buildMode && this.buildMode !== 'road' && this.buildGhostHex);

    this.mobileLayout = w < 640 || desktopNeededHeight > h;

    if (!this.mobileLayout) {
      this.sidebarWidth = desktopSidebarWidth;
      // La colonne PC est sur le CÔTÉ (gauche), elle ne cache aucune rangée en haut/bas du monde.
      this.hudTopInset = 0;

      this.sidebarBg.setPosition(0, 0).setSize(this.sidebarWidth, h).setVisible(true);
      this.buildMenuBg.setVisible(false);
      this.buildMenuToggle.setVisible(false);

      // Grille d'icônes (même logos/icônes que le bandeau mobile, voir resourceBarIconTextureKeys/
      // drawResourceBarIcon) plutôt qu'un texte brut : demande explicite pour que le PC
      // corresponde au mobile plutôt que d'afficher "Planches 100 Pierre taillée 30 ...".
      this.resourceBarIconsGraphics.clear().setVisible(true);
      const pcIconSize = 20, pcNumberSlotWidth = 34, pcIconGap = 4, pcColGap = 8, pcRowGap = 6, pcCols = 3;
      this.resourceOrder.forEach((res, i) => {
        const col = i % pcCols, row = Math.floor(i / pcCols);
        const bx = 10 + col * (pcIconSize + pcIconGap + pcNumberSlotWidth + pcColGap);
        const by = 10 + row * (pcIconSize + pcRowGap);
        if (this.resourceBarIconTextureKeys[res]) {
          this.resourceBarIconImages[res].setPosition(bx, by).setDisplaySize(pcIconSize, pcIconSize).setVisible(true);
        } else {
          this.drawResourceBarIcon(this.resourceBarIconsGraphics, res, bx, by, pcIconSize);
        }
        this.resourceValueTexts[res].setPosition(bx + pcIconSize + pcIconGap, by + 2).setFontSize(13).setVisible(true);
      });
      const iconGridHeight = Math.ceil(this.resourceOrder.length / pcCols) * (pcIconSize + pcRowGap);

      this.populationStatsText.setPosition(10, 10 + iconGridHeight + 6).setFontSize(12).setVisible(true);
      this.infoPanelText.setPosition(10, 10 + iconGridHeight + 34).setFontSize(13).setWordWrapWidth(this.sidebarWidth - 20);

      // La ligne du bouton "Valider" est toujours réservée (bâtiments listés plus bas dans tous
      // les cas), pour que la liste ne saute pas de place à chaque fois qu'il apparaît/disparaît.
      this.confirmButton
        .setPosition(10, 190).setFixedSize(this.sidebarWidth - 20, confirmRowHeight)
        .setFontSize(14).setVisible(showConfirm);

      let y = 190 + confirmRowHeight + desktopGap;
      for (const id of buttonIds) {
        this.buildButtons[id]
          .setPosition(10, y).setFixedSize(this.sidebarWidth - 20, desktopBtnHeight)
          .setFontSize(13).setAlign('left').setWordWrapWidth(0).setVisible(true);
        y += desktopBtnHeight + desktopGap;
      }

      this.toastText.setPosition(
        this.sidebarWidth + (w - this.sidebarWidth) / 2 - this.toastText.width / 2,
        h - 60
      );
      return;
    }

    // --- Mise en page mobile ---
    // Pensée pour le paysage : un téléphone en paysage est souvent bas (320-430px de haut), donc
    // toutes les tailles ci-dessous s'adaptent à la hauteur réelle plutôt que d'utiliser des
    // valeurs fixes qui pourraient déborder de l'écran sur les appareils les plus petits.
    this.sidebarWidth = 0; // la carte utilise tout l'écran, rien n'est réservé sur les côtés

    // Bandeau ressources : icônes + valeurs sur une seule ligne (voir drawResourceBarIcon).
    // Emplacements de largeur fixe par ressource, pour que la mise en page ne bouge pas quand une
    // valeur gagne/perd un chiffre.
    const barIconSize = 18, numberSlotWidth = 34, groupGap = 6, iconGap = 3;
    const barY = 8;
    const statsRowHeight = 18;
    const topBarHeight = barIconSize + statsRowHeight + 18;
    this.sidebarBg.setPosition(0, 0).setSize(w, topBarHeight).setVisible(true);
    // Voir getEffectiveZoomMin()/clampCameraVertical() : le bandeau du haut cache une bande du
    // monde sans réduire la hauteur de caméra elle-même, il faut donc le soustraire à part.
    this.hudTopInset = topBarHeight;

    this.resourceBarIconsGraphics.clear().setVisible(true);
    let bx = 8;
    for (const res of this.resourceOrder) {
      if (this.resourceBarIconTextureKeys[res]) {
        this.resourceBarIconImages[res].setPosition(bx, barY).setDisplaySize(barIconSize, barIconSize).setVisible(true);
      } else {
        this.drawResourceBarIcon(this.resourceBarIconsGraphics, res, bx, barY, barIconSize);
      }
      this.resourceValueTexts[res].setPosition(bx + barIconSize + iconGap, barY + 1).setVisible(true);
      bx += barIconSize + iconGap + numberSlotWidth + groupGap;
    }
    // Deuxième ligne du bandeau : main-d'œuvre nécessaire / logements libres (voir GameState.
    // neededWorkers/availableHousing), pas des ressources du stock central.
    this.populationStatsText.setPosition(8, barY + barIconSize + 4).setFontSize(12).setVisible(true);

    const compact = h < 420;
    const btnHeight = compact ? 42 : 56;
    const gap = compact ? 6 : 8;
    this.buildMenuToggle.setFontSize(compact ? 13 : 15);
    this.buildMenuToggle.setText(
      this.buildMode ? `✕ Annuler (${GameConfig.buildings[this.buildMode].name})`
        : (this.buildMenuOpen ? '✕ Fermer' : '🔨 Construire')
    );
    this.buildMenuToggle.setPosition(w - this.buildMenuToggle.width - 10, h - this.buildMenuToggle.height - 10).setVisible(true);

    this.confirmButton.setFontSize(compact ? 13 : 15);
    this.confirmButton
      .setPosition(w - this.buildMenuToggle.width - this.confirmButton.width - 20, h - this.confirmButton.height - 10)
      .setVisible(showConfirm);

    const cols = 3;
    const btnWidth = (w - gap * (cols + 1)) / cols;
    const rows = Math.ceil(buttonIds.length / cols);
    const menuHeight = rows * (btnHeight + gap) + gap;
    // Ne descend jamais sous le bandeau du haut, même si en théorie ça manquerait de place :
    // le pavé n'est de toute façon affiché que ponctuellement (replié par défaut).
    const menuTop = Math.max(topBarHeight + 4, h - menuHeight - this.buildMenuToggle.height - 24);

    this.buildMenuBg.setPosition(0, menuTop - gap).setSize(w, menuHeight + gap * 2).setVisible(this.buildMenuOpen);

    buttonIds.forEach((id, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      this.buildButtons[id]
        .setPosition(gap + col * (btnWidth + gap), menuTop + gap + row * (btnHeight + gap))
        .setFixedSize(btnWidth, btnHeight)
        .setFontSize(compact ? 12 : 14).setAlign('center').setWordWrapWidth(btnWidth - 12)
        .setVisible(this.buildMenuOpen);
    });

    // Le panneau d'info flotte juste sous le bandeau du haut ; sa visibilité/contenu réel est
    // géré par updateInfoPanel() (affiché seulement s'il y a quelque chose à montrer).
    this.infoPanelText.setPosition(8, topBarHeight + 6).setFontSize(14).setWordWrapWidth(w - 16);

    this.toastText.setPosition(w / 2 - this.toastText.width / 2, menuTop - 50);
  }

  setBuildMode(mode) {
    if (this.paused && mode) return; // pas de construction pendant la pause
    this.buildMode = mode;
    this.buildGhostHex = null;
    for (const id in this.buildButtons) {
      this.buildButtons[id].setBackgroundColor(id === mode ? '#ffd23f' : '#2e5339');
      this.buildButtons[id].setColor(id === mode ? '#10151a' : '#ffffff');
    }
    if (mode) {
      // Activer un mode de construction remplace l'inspection en cours : on ne veut pas mélanger
      // la zone d'action de l'ancien bâtiment sélectionné avec celle du bâtiment en cours de pose.
      this.selectedBuildingKey = null;
      // Sur mobile, le pavé se referme automatiquement dès qu'un bâtiment est choisi, pour
      // libérer l'écran ; le bouton bascule alors en "Annuler" (voir layoutHud).
      this.buildMenuOpen = false;
      // Si une case était déjà sélectionnée (tap avant d'ouvrir le menu), le fantôme s'y place
      // tout de suite, prêt à valider — sinon il attend qu'on tape une case (voir handleTap).
      if (mode !== 'road' && this.selectedHex) {
        this.buildGhostHex = { col: this.selectedHex.col, row: this.selectedHex.row };
      }
      this.redrawBuildGhost();
      this.redrawActionZone();
    } else {
      this.ghostGraphics.clear();
      this.zoneGraphics.clear();
    }
    this.layoutHud();
  }

  // Construit le bâtiment en cours d'aperçu à l'endroit du fantôme (bouton "Valider").
  // N'existe pas pour le mode Route : celui-ci construit directement en glissant.
  confirmBuild() {
    if (this.paused || !this.buildMode || this.buildMode === 'road' || !this.buildGhostHex) return;
    const { col, row } = this.buildGhostHex;
    const result = GameState.placeBuilding(col, row, this.buildMode);
    if (result.ok) {
      this.showToast(GameConfig.buildings[this.buildMode].name + ' construit');
      this.setBuildMode(null);
    } else if (result.reason === 'cost') {
      this.showToast('Pas assez de ressources');
    } else if (result.reason === 'occupied') {
      this.showToast('Case déjà occupée');
    } else if (result.reason === 'resource') {
      this.showToast('Il y a une ressource ici : choisis une autre case');
    }
  }

  showToast(msg) {
    this.toastText.setText(msg);
    this.layoutHud();
    this.toastText.setAlpha(1);
    if (this.toastTween) this.toastTween.stop();
    this.toastTween = this.tweens.add({
      targets: this.toastText, alpha: 0, delay: 1400, duration: 600,
    });
  }

  // Construit une petite texture d'un "motif" du quadrillage hexagonal (2 colonnes de large —
  // le motif se répète tous les 2 colonnes à cause du décalage de rangée qui alterne par parité
  // de colonne — sur 1 rangée de haut), puis un TileSprite qui la pave à l'infini sur toute la
  // largeur du monde (x3 pour le défilement continu gauche/centre/droite, comme avant).
  //
  // Avant, le terrain était un objet Graphics contenant chaque hexagone du monde entier (jusqu'à
  // des dizaines de milliers sur une carte de 1000 colonnes), retraversé par le moteur à chaque
  // image quel que soit ce qui est réellement visible — d'où les déplacements saccadés. Une
  // tentative de ne redessiner que les colonnes visibles a introduit un bug de rendu Phaser/WebGL
  // difficile à cerner à très petit zoom (une partie du terrain ne s'affichait plus). Le pavage
  // GPU via TileSprite règle les deux problèmes à la fois : une seule petite texture, aucun
  // redessin par image, et le GPU ne calcule que les pixels réellement visibles.
  createTerrainTileSprite() {
    const colWidth = this.hexSize * 1.5;
    const rowHeight = HexUtils.rowHeight(this.hexSize);
    const tileWidth = 2 * colWidth;
    const tileHeight = rowHeight;

    // Motif texturé (photo d'herbe fournie par l'utilisateur, voir js/assets.js) plutôt qu'une
    // couleur plate : dessiné via un <canvas> natif (pas Phaser.Graphics, qui ne sait pas remplir
    // une forme avec une image) — chaque hexagone du motif sert de masque de découpe (clip) dans
    // lequel l'image est dessinée. Un miroir horizontal/vertical alterné par case casse un peu la
    // répétition, la petite unité du motif (2 colonnes x 1 rangée, voir plus bas) ne laissant sinon
    // voir qu'un seul "coup de tampon" de texture répété tel quel sur toute la carte.
    const canvas = document.createElement('canvas');
    canvas.width = tileWidth;
    canvas.height = tileHeight;
    const ctx = canvas.getContext('2d');
    const grassImg = this.textures.get('grassTexture').getSourceImage();
    const strokeHex = GameConfig.colors.hexStroke;
    const strokeColor = `rgba(${(strokeHex >> 16) & 0xff}, ${(strokeHex >> 8) & 0xff}, ${strokeHex & 0xff}, ${GameConfig.colors.hexStrokeAlpha})`;

    const hexPath = (cx, cy) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        const px = cx + this.hexSize * Math.cos(angle);
        const py = cy + this.hexSize * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    // Motif dessiné en 3x3 exemplaires autour de la tuile : les hexagones à cheval sur un bord
    // apparaissent ainsi complets des deux côtés, condition nécessaire à un pavage sans couture.
    for (let tileDX = -1; tileDX <= 1; tileDX++) {
      for (let tileDY = -1; tileDY <= 1; tileDY++) {
        for (let col = -1; col <= 2; col++) {
          for (let row = -1; row <= 1; row++) {
            const { x, y } = HexUtils.offsetToPixel(col, row, this.hexSize);
            const cx = x + tileDX * tileWidth;
            const cy = y + tileDY * tileHeight;

            ctx.save();
            hexPath(cx, cy);
            ctx.clip();
            const flipX = ((col + row) % 2 !== 0) ? -1 : 1;
            const flipY = (row % 2 !== 0) ? -1 : 1;
            ctx.translate(cx, cy);
            ctx.scale(flipX, flipY);
            const s = this.hexSize * 2.05; // légère marge : couvre tout l'hexagone sans bord visible
            ctx.drawImage(grassImg, -s / 2, -s / 2, s, s);
            ctx.restore();

            ctx.save();
            hexPath(cx, cy);
            ctx.lineWidth = 1;
            ctx.strokeStyle = strokeColor;
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    this.textures.addCanvas('hexTerrainTile', canvas);

    // worldWidthPx (1000 colonnes) et le padding vertical sont choisis multiples exacts de la
    // tuile, pour que le pavage tombe pile sur col=0/row=0 et reste aligné avec les bâtiments/
    // ressources (dessinés, eux, à leurs coordonnées exactes via HexUtils.offsetToPixel).
    // Marge généreuse (pas seulement cosmétique) : sur mobile, clampCameraVertical() autorise à
    // remonter au-delà de la rangée 0 pour laisser le bandeau ressources (hudTopInset) au-dessus
    // du monde sans rien cacher de la carte — une marge trop courte laissait apparaître un bandeau
    // noir (texture du terrain non couverte) entre le bandeau UI et la carte. Cette marge doit
    // rester généreuse même dans des contextes où la taille réelle du conteneur peut différer de
    // ce qui est mesuré en jeu (ex. intégré dans le cadre de partage d'un Artifact) : 20 rangées
    // de chaque côté couvrent large, jusqu'au garde-fou de zoom minimum absolu.
    // ATTENTION taille du canvas : width*height de ce TileSprite reste soumis à la limite de
    // surface totale d'un canvas navigateur (~268 millions de pixels sur Chrome/Skia) — au-delà,
    // "getImageData" échoue en Out Of Memory et la scène entière ne se charge plus (vécu en
    // testant une marge verticale trop généreuse). D'où des multiplicateurs mesurés (1.2x en
    // largeur, pas 3x) qui laissent la place à une marge verticale confortable tout en restant
    // nettement sous la limite (~227M de pixels ici, pour un budget sûr autour de 228M).
    const paddingRows = 20;
    const left = -this.worldWidthPx * 0.1;
    const top = -paddingRows * tileHeight;
    const width = this.worldWidthPx * 1.2;
    const height = this.worldHeightPx + paddingRows * 2 * tileHeight;

    return this.add.tileSprite(left, top, width, height, 'hexTerrainTile').setOrigin(0, 0);
  }

  redrawResources() {
    // Les 3 types de ressource (arbre/pierre/blé) ont chacun leur propre illustration (voir
    // js/assets.js) et sont désormais dessinés par redrawTileArt (case par case, en coordonnées
    // écran) plutôt qu'ici : ce Graphics reste donc toujours vide. Gardé (plutôt que supprimé)
    // pour ne pas toucher au reste de la mécanique (worldElements, ordre de rendu, etc.).
    this.resourceGraphics.clear();
  }

  // Assombrit les cases hors de toute zone révélée (voir GameState.revealedTiles/
  // computeRevealedTiles), pour distinguer "vide et exploré" de "pas encore révélé". Une case déjà
  // construite (route, bâtiment, ruine) n'est JAMAIS assombrie : le joueur sait où sont ses propres
  // constructions même hors de portée de tout brouillard levé. Recalculé chaque frame (comme
  // redrawMonsters) plutôt que seulement sur GameState.dirty, puisque le résultat dépend aussi du
  // cadrage caméra — mais seulement sur les colonnes/rangées effectivement visibles (le monde a
  // 1000 colonnes, hors de question de tester chaque case à chaque frame).
  redrawFog() {
    const g = this.fogGraphics;
    g.clear();

    const cam = this.cameras.main;
    const view = cam.worldView;
    const colWidth = this.hexSize * 1.5;
    const rowHeight = HexUtils.rowHeight(this.hexSize);
    const colMin = Math.floor(view.x / colWidth) - 1;
    const colMax = Math.ceil(view.right / colWidth) + 1;
    // PAS bornées à [0, this.rows) : la caméra peut voir un peu au-delà de la dernière/première
    // rangée (marge de confort, voir clampCameraVertical) — cette marge n'est pas une vraie case du
    // monde, mais doit quand même être assombrie plutôt que de laisser paraître un terrain "déjà vu"
    // au bord de la carte (bug vécu : une fine bande non voilée visible tout en bas en scrollant à
    // fond). GameState.tiles/revealedTiles n'ont de toute façon jamais d'entrée hors de ces bornes.
    const rowMin = Math.floor(view.y / rowHeight) - 1;
    const rowMax = Math.ceil(view.bottom / rowHeight) + 1;

    g.fillStyle(0x000000, 0.55);
    for (let col = colMin; col <= colMax; col++) {
      const wrappedCol = HexUtils.wrapCol(col, this.cols);
      for (let row = rowMin; row <= rowMax; row++) {
        const key = GameState.key(wrappedCol, row);
        if (row >= 0 && row < this.rows && (GameState.revealedTiles.has(key) || GameState.tiles.has(key))) continue;
        // offsetToPixel avec la colonne RÉELLE (non wrappée, potentiellement hors [0,cols)) donne
        // directement la bonne position écran à ce niveau de scroll, sans recourir aux 3 copies
        // utilisées ailleurs pour les objets en nombre fini (voir redrawBuildings) — la clé wrappée
        // ne sert qu'à interroger l'état (revealedTiles/tiles ci-dessus).
        const { x, y } = HexUtils.offsetToPixel(col, row, this.hexSize);
        const pts = HexUtils.corners(x, y, this.hexSize);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
      }
    }
  }

  // Dessine les cases ayant une illustration dédiée (arbres/pierre/blé/route, voir js/assets.js) :
  // contrairement au reste (formes vectorielles via Graphics, voir redrawBuildings), ce sont de
  // vraies images — impossibles à dessiner avec Graphics, d'où le canvas séparé (voir
  // createTileArtLayer). Calculé directement en coordonnées ÉCRAN (via la même relation
  // "zoom centré sur le milieu de la caméra" déjà vérifiée pour clampCameraVertical, jamais
  // worldX = scrollX + screenX/zoom) plutôt qu'en coordonnées monde, car ce canvas est affiché à
  // travers la uiCamera (zoom fixe à 1) pour ne pas subir un second zoom en plus de celui déjà
  // appliqué ici à la main. Chaque frame (comme redrawFog), en ne parcourant que les colonnes/
  // rangées visibles — le monde a 1000 colonnes, hors de question de tester chaque case à chaque
  // frame.
  // Petite fabrique réutilisée par tout ce qui dessine en coordonnées écran sur tileArtTexture
  // (redrawTileArt/redrawShipments/redrawMonsters) : même relation "zoom centré sur le milieu de
  // la caméra" déjà vérifiée pour clampCameraVertical (jamais worldX = scrollX + screenX/zoom),
  // et revérifiée pour X et Y par un aller-retour contre cam.getWorldPoint (référence native
  // Phaser) avant d'être branchée ici.
  getWorldToScreen() {
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    const centerScreenX = cam.width / 2;
    const centerScreenY = cam.height / 2;
    return {
      cam, zoom,
      worldToScreen: (wx, wy) => ({
        x: centerScreenX + (wx - cam.scrollX - centerScreenX) * zoom,
        y: centerScreenY + (wy - cam.scrollY - centerScreenY) * zoom,
      }),
    };
  }

  redrawTileArt() {
    const tex = this.tileArtTexture;
    const ctx = tex.context;
    ctx.clearRect(0, 0, tex.width, tex.height);

    const { cam, zoom, worldToScreen } = this.getWorldToScreen();
    const view = cam.worldView;
    const colWidth = this.hexSize * 1.5;
    const rowHeight = HexUtils.rowHeight(this.hexSize);
    const colMin = Math.floor(view.x / colWidth) - 1;
    const colMax = Math.ceil(view.right / colWidth) + 1;
    const rowMin = Math.max(0, Math.floor(view.y / rowHeight) - 1);
    const rowMax = Math.min(this.rows - 1, Math.ceil(view.bottom / rowHeight) + 1);

    const hexPathAt = (cx, cy, size) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        const px = cx + size * Math.cos(angle);
        const py = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const drawTile = (col, row, textureKey, alpha) => {
      const { x: wx, y: wy } = HexUtils.offsetToPixel(col, row, this.hexSize);
      const { x: sx, y: sy } = worldToScreen(wx, wy);
      const size = this.hexSize * zoom;
      if (sx < -size - 4 || sx > tex.width + size + 4 || sy < -size - 4 || sy > tex.height + size + 4) return;
      const img = this.textures.get(textureKey).getSourceImage();
      ctx.save();
      ctx.globalAlpha = alpha;
      hexPathAt(sx, sy, size);
      ctx.clip();
      const s = size * 2.05; // légère marge : couvre tout l'hexagone sans bord visible
      ctx.drawImage(img, sx - s / 2, sy - s / 2, s, s);
      ctx.restore();
    };

    const resourceKeyByType = { tree: 'treeTile', stone: 'stoneTile', wheat: 'wheatTile' };

    for (let col = colMin; col <= colMax; col++) {
      const wrappedCol = HexUtils.wrapCol(col, this.cols);
      for (let row = rowMin; row <= rowMax; row++) {
        const key = GameState.key(wrappedCol, row);
        // Brouillard de guerre : même règle que l'ancien redrawResources — une ressource hors de
        // toute zone révélée ne doit pas être identifiable.
        if (!GameState.revealedTiles.has(key)) continue;

        const res = GameState.resourceTiles.get(key);
        if (res) {
          const textureKey = resourceKeyByType[res.type];
          if (!textureKey) continue;
          // Même indice visuel d'épuisement qu'avant (voir l'ancien redrawResources) : la case
          // s'éclaircit vers la transparence à mesure que le stock baisse.
          const nodeCfg = GameConfig.resourceNodes[res.type];
          const fraction = Phaser.Math.Clamp(res.amount / nodeCfg.amountMax, 0, 1);
          drawTile(col, row, textureKey, 0.35 + 0.65 * fraction);
          continue;
        }
        const tile = GameState.tiles.get(key);
        if (tile) {
          const textureKey = this.buildingTileArtKeys[tile.type];
          if (textureKey) drawTile(col, row, textureKey, 1);
        }
      }
    }
  }

  // Redessine les bâtiments/ruines posés (appelé seulement quand GameState.dirty). Une route a sa
  // propre illustration (voir js/assets.js) et est désormais dessinée par redrawTileArt, pas ici ;
  // tout le reste reçoit en plus une icône (voir drawBuildingIcon) pour se distinguer d'un coup
  // d'œil sans dépendre uniquement de la couleur de fond.
  redrawBuildings() {
    const g = this.buildingsGraphics;
    g.clear();

    for (const [key, tile] of GameState.tiles) {
      if (this.buildingTileArtKeys[tile.type]) continue;
      const [col, row] = key.split(',').map(Number);
      const color = tile.type === 'ruin' ? GameConfig.colors.ruin : GameConfig.buildings[tile.type].color;

      for (let copy = -1; copy <= 1; copy++) {
        const offsetX = copy * this.worldWidthPx;
        const { x, y } = HexUtils.offsetToPixel(col, row, this.hexSize);
        const pts = HexUtils.corners(x + offsetX, y, this.hexSize * 0.82);
        // Refixé à chaque copie : drawBuildingIcon() change fillStyle/lineStyle en interne et ne
        // les restaure pas, sinon la case suivante hériterait par erreur des couleurs de l'icône.
        g.lineStyle(1, GameConfig.colors.hexStroke, GameConfig.colors.hexStrokeAlpha);
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.strokePath();

        this.drawBuildingIcon(g, tile.type, x + offsetX, y, this.hexSize);
      }
    }
  }

  // Construit un chemin (fermé par défaut) à partir de points normalisés (fraction de hexSize)
  // relatifs au centre (x, y). Le chemin doit ensuite être rempli/tracé par l'appelant
  // (g.fillPath()/g.strokePath()) — pas de rappel automatique pour rester flexible (chemin
  // ouvert non refermé pour une simple ligne brisée, par ex.).
  tracePoly(g, pts, x, y, s, close = true) {
    g.beginPath();
    g.moveTo(x + pts[0][0] * s, y + pts[0][1] * s);
    for (let i = 1; i < pts.length; i++) g.lineTo(x + pts[i][0] * s, y + pts[i][1] * s);
    if (close) g.closePath();
  }

  // Icône "encre" par-dessus l'hexagone d'un bâtiment. Un seul ton sombre pour toutes les
  // silhouettes (la couleur du bâtiment est déjà portée par le fond) : la distinction entre types
  // vient de la FORME, pas de la couleur — plus lisible à petite taille qu'un jeu de teintes.
  drawBuildingIcon(g, type, x, y, s) {
    const ink = 0x201812;

    if (type === 'ruin') {
      // Décombres : deux blocs irréguliers + une fissure.
      g.fillStyle(0x333333, 0.95);
      g.lineStyle(s * 0.03, 0x161616, 0.9);
      this.tracePoly(g, [[-0.30, 0.06], [-0.06, -0.06], [-0.02, 0.20], [-0.20, 0.32], [-0.34, 0.24]], x, y, s);
      g.fillPath(); g.strokePath();
      this.tracePoly(g, [[0.04, 0.10], [0.30, -0.10], [0.34, 0.14], [0.14, 0.30], [-0.02, 0.26]], x, y, s);
      g.fillPath(); g.strokePath();
      g.lineStyle(s * 0.045, 0x0c0c0c, 0.85);
      this.tracePoly(g, [[-0.18, -0.32], [-0.02, -0.06], [-0.14, 0.02], [0.08, 0.34]], x, y, s, false);
      g.strokePath();
      return;
    }

    switch (type) {
      case 'lumberjackCamp': {
        // Hache : manche en diagonale + fer clair.
        g.lineStyle(s * 0.09, ink, 0.95);
        this.tracePoly(g, [[-0.24, 0.30], [0.14, -0.22]], x, y, s, false);
        g.strokePath();
        g.fillStyle(0xd9d9d9, 1);
        g.lineStyle(s * 0.025, ink, 0.9);
        this.tracePoly(g, [[0.14, -0.22], [0.40, -0.12], [0.32, 0.10], [0.04, -0.02]], x, y, s);
        g.fillPath(); g.strokePath();
        break;
      }
      case 'sawmill': {
        // Lame de scie circulaire : cercle + dents + moyeu.
        g.lineStyle(s * 0.06, ink, 0.95);
        g.strokeCircle(x, y, s * 0.24);
        g.fillStyle(ink, 0.95);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const a2 = a + 0.22;
          const bx = x + Math.cos(a) * s * 0.24, by = y + Math.sin(a) * s * 0.24;
          const bx2 = x + Math.cos(a2) * s * 0.24, by2 = y + Math.sin(a2) * s * 0.24;
          const tx = x + Math.cos(a + 0.11) * s * 0.36, ty = y + Math.sin(a + 0.11) * s * 0.36;
          g.fillTriangle(bx, by, bx2, by2, tx, ty);
        }
        g.fillStyle(0xd9d9d9, 1);
        g.fillCircle(x, y, s * 0.07);
        break;
      }
      case 'minerCamp': {
        // Pioche : manche + tête en "V" évasé.
        g.lineStyle(s * 0.08, ink, 0.95);
        this.tracePoly(g, [[0.02, 0.32], [-0.02, -0.10]], x, y, s, false);
        g.strokePath();
        g.fillStyle(ink, 0.95);
        this.tracePoly(g, [[-0.02, -0.10], [-0.36, -0.28], [-0.22, -0.02]], x, y, s);
        g.fillPath();
        this.tracePoly(g, [[-0.02, -0.10], [0.34, -0.20], [0.18, 0.04]], x, y, s);
        g.fillPath();
        break;
      }
      case 'stonecutter': {
        // Bloc de pierre + burin planté à un coin.
        g.fillStyle(0xcfcfcf, 1);
        g.lineStyle(s * 0.03, ink, 0.9);
        this.tracePoly(g, [[-0.24, -0.06], [0.24, -0.06], [0.24, 0.30], [-0.24, 0.30]], x, y, s);
        g.fillPath(); g.strokePath();
        g.lineStyle(s * 0.025, 0x8a8a8a, 0.9);
        this.tracePoly(g, [[-0.10, -0.06], [-0.02, 0.30]], x, y, s, false);
        g.strokePath();
        g.fillStyle(ink, 0.95);
        this.tracePoly(g, [[0.06, -0.30], [0.24, -0.14], [0.10, -0.10]], x, y, s);
        g.fillPath();
        break;
      }
      case 'warehouse': {
        // Grange : toit triangulaire + corps + porte claire.
        g.fillStyle(ink, 0.9);
        this.tracePoly(g, [[-0.32, -0.04], [0.32, -0.04], [0, -0.32]], x, y, s);
        g.fillPath();
        g.fillStyle(0x8a5a2f, 1);
        g.lineStyle(s * 0.03, ink, 0.9);
        this.tracePoly(g, [[-0.26, -0.04], [0.26, -0.04], [0.26, 0.32], [-0.26, 0.32]], x, y, s);
        g.fillPath(); g.strokePath();
        g.fillStyle(0xffe9a8, 1);
        this.tracePoly(g, [[-0.07, 0.10], [0.07, 0.10], [0.07, 0.32], [-0.07, 0.32]], x, y, s);
        g.fillPath();
        break;
      }
      case 'farm': {
        // Gerbe de blé : épis en éventail + lien.
        g.lineStyle(s * 0.045, 0x6b4f10, 0.95);
        const tips = [[-0.24, -0.26], [-0.12, -0.34], [0, -0.36], [0.12, -0.34], [0.24, -0.26]];
        for (const tip of tips) {
          this.tracePoly(g, [[0, 0.30], tip], x, y, s, false);
          g.strokePath();
        }
        g.fillStyle(0x6b4f10, 1);
        this.tracePoly(g, [[-0.16, 0.10], [0.16, 0.10], [0.10, 0.22], [-0.10, 0.22]], x, y, s);
        g.fillPath();
        break;
      }
      case 'bakery': {
        // Pain : miche ovale + entailles.
        g.fillStyle(0xc98a41, 1);
        g.lineStyle(s * 0.03, ink, 0.9);
        g.fillEllipse(x, y + s * 0.06, s * 0.62, s * 0.42);
        g.strokeEllipse(x, y + s * 0.06, s * 0.62, s * 0.42);
        g.lineStyle(s * 0.03, ink, 0.85);
        for (const dx of [-0.14, 0, 0.14]) {
          this.tracePoly(g, [[dx - 0.08, -0.06], [dx + 0.06, 0.16]], x, y, s, false);
          g.strokePath();
        }
        break;
      }
      case 'house': {
        // Maison : toit + corps + porte + fenêtre.
        g.fillStyle(ink, 0.9);
        this.tracePoly(g, [[-0.28, -0.02], [0.28, -0.02], [0, -0.30]], x, y, s);
        g.fillPath();
        g.fillStyle(0xe8d8b8, 1);
        g.lineStyle(s * 0.03, ink, 0.9);
        this.tracePoly(g, [[-0.22, -0.02], [0.22, -0.02], [0.22, 0.32], [-0.22, 0.32]], x, y, s);
        g.fillPath(); g.strokePath();
        g.fillStyle(ink, 0.9);
        this.tracePoly(g, [[-0.07, 0.10], [0.07, 0.10], [0.07, 0.32], [-0.07, 0.32]], x, y, s);
        g.fillPath();
        g.fillStyle(0x9fd4e8, 1);
        g.fillRect(x - 0.15 * s, y - 0.16 * s, s * 0.1, s * 0.1);
        break;
      }
      case 'donjon': {
        // Tour crénelée : corps + créneaux en haut + meurtrière.
        g.fillStyle(ink, 0.92);
        this.tracePoly(g, [
          [-0.20, -0.24], [-0.20, -0.34], [-0.12, -0.34], [-0.12, -0.24],
          [-0.04, -0.24], [-0.04, -0.34], [0.04, -0.34], [0.04, -0.24],
          [0.12, -0.24], [0.12, -0.34], [0.20, -0.34], [0.20, -0.24],
          [0.20, 0.32], [-0.20, 0.32],
        ], x, y, s);
        g.fillPath();
        g.fillStyle(0xc9971f, 1);
        g.fillRect(x - 0.03 * s, y - 0.06 * s, s * 0.06, s * 0.24);
        break;
      }
      case 'university': {
        // Fronton triangulaire + colonnes, façade d'académie classique.
        g.fillStyle(ink, 0.9);
        this.tracePoly(g, [[-0.30, -0.06], [0.30, -0.06], [0, -0.30]], x, y, s);
        g.fillPath();
        g.fillStyle(0xe8d8b8, 1);
        this.tracePoly(g, [[-0.26, -0.06], [0.26, -0.06], [0.26, 0.32], [-0.26, 0.32]], x, y, s);
        g.fillPath();
        g.fillStyle(ink, 0.9);
        for (const cx of [-0.16, -0.055, 0.055, 0.16]) {
          this.tracePoly(g, [[cx - 0.03, -0.04], [cx + 0.03, -0.04], [cx + 0.03, 0.30], [cx - 0.03, 0.30]], x, y, s);
          g.fillPath();
        }
        break;
      }
      default:
        break;
    }
  }

  // Icône (voir js/assets.js) par chargement en transit, interpolée le long de son chemin.
  // Redessinée chaque frame car la progression change en continu (contrairement aux bâtiments/
  // ressources). Dessinée sur tileArtTexture (voir redrawTileArt), PAS sur son propre Graphics :
  // un chargement doit apparaître au-dessus des routes, qui elles vivent sur ce même canvas (voir
  // le commentaire dans create() sur shotGraphics) — appelé juste après redrawTileArt, jamais avant.
  redrawShipments() {
    const ctx = this.tileArtTexture.context;
    const { worldToScreen, zoom } = this.getWorldToScreen();
    const iconKeyByResource = {
      wood: 'woodIcon', planks: 'planksIcon', stone: 'stoneIcon', stoneBlocks: 'stoneBlocksIcon',
      wheat: 'wheatIcon', bread: 'breadIcon',
    };

    for (const s of GameState.shipments) {
      const idx = Math.min(Math.floor(s.progress), s.path.length - 1);
      const nextIdx = Math.min(idx + 1, s.path.length - 1);
      const frac = s.progress - idx;
      const a = s.path[idx];
      const b = s.path[nextIdx];
      const pa = HexUtils.offsetToPixel(a.col, a.row, this.hexSize);
      const pb = HexUtils.offsetToPixel(b.col, b.row, this.hexSize);
      const wx = pa.x + (pb.x - pa.x) * frac;
      const wy = pa.y + (pb.y - pa.y) * frac;
      const { x, y } = worldToScreen(wx, wy);

      const textureKey = iconKeyByResource[s.resource];
      const size = this.hexSize * 0.84 * zoom; // 2x la taille précédente (voir demande utilisateur)
      if (textureKey) {
        const img = this.textures.get(textureKey).getSourceImage();
        const aspect = img.width / img.height;
        const w = aspect >= 1 ? size : size * aspect;
        const h = aspect >= 1 ? size / aspect : size;
        ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
      } else {
        const r = size / 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#' + GameConfig.resourceLabels[s.resource].color.toString(16).padStart(6, '0');
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(16, 21, 26, 0.8)';
        ctx.stroke();
      }
    }
  }

  // Horde de monstres : chacun un petit carré dessiné à sa position continue (Monsters.list).
  // Contrairement à l'ancienne bande, chaque monstre a sa propre rangée et sa propre position en
  // ligne droite : l'ensemble ne suit donc pas la grille hexagonale (voir Monsters.update). Taille
  // volontairement plus grande que l'espacement (voir GameConfig.monsters.sizeFactor/
  // depthSpacingFactor) pour un rendu de horde tassée plutôt qu'un quadrillage clairsemé. Dessiné
  // sur tileArtTexture (voir redrawShipments ci-dessus pour pourquoi), toujours en dernier pour
  // rester visible même par-dessus un chargement au même endroit.
  redrawMonsters() {
    const ctx = this.tileArtTexture.context;
    const { worldToScreen, zoom } = this.getWorldToScreen();

    const size = this.hexSize * GameConfig.monsters.sizeFactor * zoom;
    const colWidth = this.hexSize * 1.5;
    ctx.fillStyle = '#' + GameConfig.colors.monster.toString(16).padStart(6, '0');
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;

    for (const m of Monsters.list) {
      if (!m.alive) continue;
      // Brouillard de guerre : un monstre hors de toute zone révélée ne doit pas non plus être
      // visible (voir GameState.revealedTiles) — même logique que pour les ressources naturelles.
      const col = HexUtils.wrapCol(Math.floor(m.x / colWidth), this.cols);
      if (!GameState.revealedTiles.has(GameState.key(col, m.row))) continue;
      const wy = HexUtils.rowHeight(this.hexSize) * (m.row + 0.25);
      const { x: sx, y: sy } = worldToScreen(m.x, wy);
      const x = sx - size / 2, y = sy - size / 2;
      ctx.fillRect(x, y, size, size);
      ctx.strokeRect(x, y, size, size);
    }
  }

  // Éclairs des tirs de tour (Donjon) : une ligne brève entre la tour et sa cible, qui s'estompe
  // avec le temps (GameState.shots, purement visuel — les dégâts sont déjà appliqués au tir,
  // voir GameState.tickProduction). Même position Y "en ligne droite" que redrawMonsters pour
  // que le trait touche visuellement le carré du monstre visé.
  redrawShots() {
    const g = this.shotGraphics;
    g.clear();

    for (const s of GameState.shots) {
      const alpha = Phaser.Math.Clamp(s.ttl / 0.15, 0, 1);
      const from = HexUtils.offsetToPixel(s.fromCol, s.fromRow, this.hexSize);
      const toY = HexUtils.rowHeight(this.hexSize) * (s.toRow + 0.25);
      g.lineStyle(this.hexSize * 0.1, 0xffd23f, alpha);
      for (let copy = -1; copy <= 1; copy++) {
        const offsetX = copy * this.worldWidthPx;
        g.beginPath();
        g.moveTo(from.x + offsetX, from.y);
        g.lineTo(s.toX + offsetX, toY);
        g.strokePath();
      }
    }
  }

  // Redessine le contour jaune sur la case actuellement sélectionnée
  redrawSelection() {
    const g = this.selectionGraphics;
    g.clear();
    if (!this.selectedHex) return;

    g.lineStyle(3, 0xffd23f, 1);
    for (let copy = -1; copy <= 1; copy++) {
      const offsetX = copy * this.worldWidthPx;
      const { x, y } = HexUtils.offsetToPixel(this.selectedHex.col, this.selectedHex.row, this.hexSize);
      const pts = HexUtils.corners(x + offsetX, y, this.hexSize);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.strokePath();
    }
  }

  onPointerDown(pointer) {
    if (this.techTreeOpen) {
      // Un glisser dans la zone des nœuds fait naviguer le diagramme (voir onPointerMove) ; un
      // simple tap sur un nœud est géré séparément par son propre écouteur 'pointerup' (dépose ce
      // drag à zéro déplacement, donc sans effet). En dehors du panneau, laisse l'overlay fermer.
      if (Phaser.Geom.Rectangle.Contains(this.techTreePanel.getBounds(), pointer.x, pointer.y)) {
        this.techTreePanDragging = true;
        this.techTreePanLastX = pointer.x;
        this.techTreePanLastY = pointer.y;
      }
      return;
    }
    if (this.isModalOpen()) return;
    this.isDragging = true;
    this.dragMoved = 0;
    this.lastPointerX = pointer.x;
    this.lastPointerY = pointer.y;
    // Figé ici, avant que le clic sur un bouton n'ait pu changer l'état du HUD (par ex. le pavé
    // de construction mobile qui se referme au choix d'un bâtiment) : onPointerUp doit juger le
    // tap sur la position de départ, sinon un bouton qui se cache pendant son propre clic
    // laisserait croire, une fois relâché, que le tap est "tombé" sur la carte en dessous.
    this.pointerDownOverHud = this.isPointerOverHud(pointer);

    // En mode Route, un glisser pave des routes case par case au lieu de faire défiler la
    // caméra : on pose déjà la première case ici (couvre aussi le cas d'un simple tap).
    if (this.buildMode === 'road' && !this.pointerDownOverHud) {
      this.isRoadPainting = true;
      this.lastPaintedRoadKey = null;
      this.paintRoadAt(pointer);
    }
  }

  onPointerMove(pointer) {
    if (this.techTreeOpen) {
      if (this.techTreePanDragging && pointer.isDown) {
        const dx = pointer.x - this.techTreePanLastX;
        const dy = pointer.y - this.techTreePanLastY;
        this.techTreeCamX -= dx;
        this.techTreeCamY -= dy;
        this.techTreePanLastX = pointer.x;
        this.techTreePanLastY = pointer.y;
        this.positionTechTreeNodes();
      }
      return;
    }
    if (this.isModalOpen()) return;
    // Seul le mode Route fait suivre l'aperçu au pointeur (aperçu avant de peindre en glissant).
    // Pour les autres bâtiments, le fantôme reste sur la case sélectionnée par tap (voir
    // handleTap / setBuildMode) : glisser doit pouvoir faire défiler la carte normalement,
    // sans déplacer aussi le fantôme en même temps.
    if (this.buildMode === 'road') this.updateBuildGhost(pointer);

    if (this.isRoadPainting) {
      this.paintRoadAt(pointer);
      return;
    }

    if (!pointer.isDown || !this.isDragging) return;
    // Si deux doigts sont posés, on est en train de pincer pour zoomer : on ne déplace pas la caméra
    if (this.input.pointer1.isDown && this.input.pointer2.isDown) return;

    const dx = pointer.x - this.lastPointerX;
    const dy = pointer.y - this.lastPointerY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);

    const cam = this.cameras.main;
    cam.scrollX -= dx / cam.zoom;
    cam.scrollY -= dy / cam.zoom;
    this.wrapCameraHorizontal();
    this.clampCameraVertical();

    this.lastPointerX = pointer.x;
    this.lastPointerY = pointer.y;
  }

  onPointerUp(pointer) {
    if (this.techTreeOpen) {
      this.techTreePanDragging = false;
      return;
    }
    if (this.isModalOpen()) return;
    this.isDragging = false;
    if (this.isRoadPainting) {
      this.isRoadPainting = false;
      return;
    }
    // Si le doigt/la souris n'a presque pas bougé, on considère que c'est un "tap" — sauf si
    // le tap a commencé sur un élément du HUD : son propre handler s'en charge, il ne doit pas
    // aussi construire/sélectionner la case de la carte située derrière lui.
    if (this.dragMoved < 6 && !this.pointerDownOverHud) {
      this.handleTap(pointer);
    }
  }

  // Pose une route sur la case sous le pointeur, si ce n'est pas déjà celle posée à l'instant
  // précédent (évite de retenter en boucle sur la même case pendant qu'on s'y attarde).
  paintRoadAt(pointer) {
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
    const modX = ((worldPoint.x % this.worldWidthPx) + this.worldWidthPx) % this.worldWidthPx;
    const { col, row } = HexUtils.pixelToOffset(modX, worldPoint.y, this.hexSize);
    if (row < 0 || row >= this.rows) return;

    const wrappedCol = HexUtils.wrapCol(col, this.cols);
    const key = GameState.key(wrappedCol, row);
    if (key === this.lastPaintedRoadKey) return;
    this.lastPaintedRoadKey = key;

    const result = GameState.placeBuilding(wrappedCol, row, 'road');
    if (!result.ok && result.reason === 'cost') {
      this.showToast('Pas assez de ressources pour continuer la route');
    } else if (!result.ok && result.reason === 'noRoadAdjacent') {
      this.showToast('Une route doit partir d\'une route existante');
    }
    this.redrawBuildGhost();
  }

  onWheel(pointer, gameObjects, deltaX, deltaY) {
    if (this.isModalOpen()) return;
    const cam = this.cameras.main;
    const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Phaser.Math.Clamp(cam.zoom * zoomFactor, this.getEffectiveZoomMin(), GameConfig.camera.zoomMax);
    cam.setZoom(newZoom);
    this.clampCameraVertical();
  }

  // Ramène le défilement horizontal dans l'intervalle [0, worldWidthPx) pour boucler à l'infini
  wrapCameraHorizontal() {
    const cam = this.cameras.main;
    if (cam.scrollX < 0) cam.scrollX += this.worldWidthPx;
    if (cam.scrollX >= this.worldWidthPx) cam.scrollX -= this.worldWidthPx;
  }

  // Empêche de faire défiler la caméra au-delà du haut/bas du monde (qui, lui, ne boucle pas).
  // Le haut du monde doit apparaître sous le bandeau mobile (hudTopInset), pas sous le tout haut
  // de l'écran — sinon, au dézoom max, le bandeau cache une bande de hauteur égale à son
  // épaisseur et la même hauteur déborde hors champ en bas (symptôme rapporté : la carte
  // "commence en bas du bandeau" et sa partie basse est hors champ).
  //
  // ATTENTION (bug vécu, corrigé après calibration via cam.getWorldPoint) : Phaser applique le
  // zoom relatif au CENTRE de la caméra, pas au coin haut-gauche. cam.scrollY est le monde vu au
  // CENTRE de l'écran, PAS en haut — la relation réelle est
  //   worldY(screenY) = scrollY + centerScreen + (screenY - centerScreen) / zoom
  // (vérifié empiriquement), et non worldY = scrollY + screenY/zoom comme le code le supposait à
  // tort ici (chaque autre endroit du jeu utilise cam.getWorldPoint directement et n'a jamais eu
  // ce problème — seul ce calcul à la main, propre au calage haut/bas, était concerné). On résout
  // cette équation pour placer précisément la rangée 0 sous le bandeau et la dernière rangée en
  // bas de l'écran.
  clampCameraVertical() {
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    const centerScreen = cam.height / 2;
    const topInset = this.hudTopInset || 0;
    const padding = this.hexSize * 0.5;

    const minScrollY = -padding - centerScreen + (centerScreen - topInset) / zoom;
    const maxScrollYRaw = this.worldHeightPx + padding - centerScreen - centerScreen / zoom;
    const maxScrollY = Math.max(minScrollY, maxScrollYRaw);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY);
  }

  // Route un tap vers construction / pillage de ruine / simple sélection, selon le mode courant
  // et ce qui se trouve sur la case tapée. Les monstres eux-mêmes ne réagissent à aucun tap (voir
  // Monsters.js) : leur seule interaction avec le joueur est de détruire ce qu'ils traversent.
  handleTap(pointer) {
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);

    const modX = ((worldPoint.x % this.worldWidthPx) + this.worldWidthPx) % this.worldWidthPx;
    const { col, row } = HexUtils.pixelToOffset(modX, worldPoint.y, this.hexSize);

    if (row < 0 || row >= this.rows) {
      this.selectedHex = null;
      this.redrawSelection();
      return;
    }

    const wrappedCol = HexUtils.wrapCol(col, this.cols);
    this.selectedHex = { col: wrappedCol, row };
    this.redrawSelection();
    this.selectedBuildingKey = null;
    this.infoPanelOverrideText = null;

    if (this.buildMode && this.buildMode !== 'road') {
      // Ne construit pas tout de suite : déplace juste l'aperçu (et sa zone d'action) sur cette
      // case. La construction ne se fait qu'en validant explicitement (bouton "Valider").
      this.buildGhostHex = { col: wrappedCol, row };
      this.redrawBuildGhost();
      this.redrawActionZone();
      this.layoutHud();
      return;
    }

    // Une Université s'ouvre directement en arbre technologique (au lieu du panneau d'info
    // habituel), que le jeu soit en pause ou non — ouvrir le menu gère lui-même la pause.
    if (GameState.getTile(wrappedCol, row).type === 'university') {
      this.openTechTree(wrappedCol, row);
      return;
    }

    if (this.paused) {
      // En pause : consultation uniquement, pas de construction/pillage (ça changerait l'état du
      // jeu pendant que la simulation est censée être gelée).
      const tile = GameState.getTile(wrappedCol, row);
      if (tile.type !== 'empty' && tile.type !== 'ruin') {
        this.selectedBuildingKey = GameState.key(wrappedCol, row);
      } else if (tile.type === 'ruin') {
        this.infoPanelOverrideText = 'Ruines (reprends pour piller).';
      } else {
        const resTile = GameState.getResourceTile(wrappedCol, row);
        if (resTile) {
          const label = resTile.type === 'tree' ? 'Arbres' : (resTile.type === 'stone' ? 'Pierre' : 'Blé');
          this.infoPanelOverrideText = `${label} (${Math.round(resTile.amount)} restant)`;
        }
      }
      this.redrawActionZone();
      return;
    }

    const tile = GameState.getTile(wrappedCol, row);
    if (tile.type === 'ruin') {
      const loot = GameState.harvestRuin(wrappedCol, row);
      this.showToast(`+${this.formatResources(loot, true)} (ruines)`);
      this.infoPanelOverrideText = 'Ruines pillées.';
      this.redrawActionZone();
      return;
    }

    if (tile.type !== 'empty') {
      this.selectedBuildingKey = GameState.key(wrappedCol, row);
      this.redrawActionZone();
      return;
    }
    const resTile = GameState.getResourceTile(wrappedCol, row);
    if (resTile) {
      const label = resTile.type === 'tree' ? 'Arbres' : (resTile.type === 'stone' ? 'Pierre' : 'Blé');
      this.infoPanelOverrideText = `${label} (${Math.round(resTile.amount)} restant)`;
    }
    this.redrawActionZone();
  }

  // Contenu du panneau d'info : aide de construction en priorité, sinon les infos vivantes du
  // bâtiment sélectionné, sinon le dernier résultat de tap (case, ruines, ressource...).
  // Sur PC il est toujours affiché (avec un texte d'invite par défaut) ; sur mobile, il ne
  // prend de la place que quand il y a effectivement quelque chose à montrer.
  updateInfoPanel() {
    let text = null;

    if (this.buildMode === 'road') {
      text = 'Construction : Route\nGlisse sur la carte pour tracer.\nTape "Annuler" pour arrêter.';
    } else if (this.buildMode) {
      const def = GameConfig.buildings[this.buildMode];
      if (this.buildGhostHex) {
        const valid = this.isValidBuildSpot(this.buildGhostHex.col, this.buildGhostHex.row);
        text = `Construction : ${def.name}\n`
          + (valid ? 'Valide pour construire ici,\nou tape une autre case.' : 'Case invalide : choisis-en une autre.')
          + '\nTape "Annuler" pour arrêter.';
      } else {
        text = `Construction : ${def.name}\nTape une case pour choisir où construire.`;
      }
    } else if (this.selectedBuildingKey) {
      const tile = GameState.tiles.get(this.selectedBuildingKey);
      if (tile && tile.type !== 'ruin' && GameConfig.buildings[tile.type]) {
        const [col, row] = this.selectedBuildingKey.split(',').map(Number);
        text = this.buildingInfoText(col, row, tile);
      } else {
        this.selectedBuildingKey = null;
        this.redrawActionZone();
      }
    } else {
      text = this.infoPanelOverrideText;
    }

    if (this.paused) {
      text = '⏸ En pause\n' + (text || 'Tape une case pour voir ses infos.');
    }

    if (this.mobileLayout) {
      this.infoPanelText.setVisible(!!text);
      if (text) this.infoPanelText.setText(text);
    } else {
      this.infoPanelText.setVisible(true).setText(text || 'Tape une case pour voir ses infos.');
    }
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Filet de sécurité : recalcule la mise en page (et donc hudTopInset) et recale la caméra dès
    // qu'un écart de taille est détecté, plutôt que de ne recalculer qu'à l'évènement 'resize' de
    // Phaser. Utile quand le jeu est intégré dans un cadre externe (ex. la page de partage d'un
    // Artifact) : la taille réelle du conteneur peut se stabiliser un instant après le chargement,
    // sans forcément déclencher cet évènement — sans ce filet, les bornes de défilement vertical
    // calculées au démarrage restent fausses en permanence (rangées du bas inatteignables, bandeau
    // noir en haut). Coût négligeable (comparaison de deux nombres) tant que la taille ne change pas.
    if (this.scale.width !== this.lastLayoutWidth || this.scale.height !== this.lastLayoutHeight) {
      this.lastLayoutWidth = this.scale.width;
      this.lastLayoutHeight = this.scale.height;
      // La caméra UI (bandeau/boutons) a sa propre taille, gérée séparément de la caméra
      // principale — normalement mise à jour dans l'écouteur 'resize' (voir setupCameras), mais
      // ce filet doit faire de même explicitement puisqu'il peut se déclencher sans que cet
      // évènement n'ait lieu. Oublié une première fois : le bandeau restait à la taille de sa
      // création pendant que hudTopInset/la caméra principale se corrigeaient, désynchronisant
      // visuellement la zone couverte par le bandeau de la valeur utilisée pour la caméra.
      this.uiCamera?.setSize(this.scale.width, this.scale.height);
      this.resizeTileArtLayer();
      this.layoutHud();
      this.layoutSaveMenu();
      this.layoutTechTree();
    }
    this.clampZoomAndCamera();

    // Gestion du pincement à deux doigts (zoom tactile) : reste actif pendant la pause (la
    // caméra doit pouvoir bouger), mais pas quand une fenêtre modale est ouverte.
    if (!this.isModalOpen()) {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      if (p1.isDown && p2.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchStartDist === null) {
          this.pinchStartDist = dist;
          this.pinchStartZoom = this.cameras.main.zoom;
        } else {
          const scale = dist / this.pinchStartDist;
          const newZoom = Phaser.Math.Clamp(this.pinchStartZoom * scale, this.getEffectiveZoomMin(), GameConfig.camera.zoomMax);
          this.cameras.main.setZoom(newZoom);
          this.clampCameraVertical();
        }
        this.isDragging = false;
      } else {
        this.pinchStartDist = null;
        this.pinchStartZoom = null;
      }
    }

    // Simulation (temps de jeu, production, transport, monstres) : entièrement gelée en pause.
    // Redessiner reste inconditionnel juste après (redrawShipments/redrawMonsters/dirty), pour
    // que l'état chargé depuis une sauvegarde s'affiche tout de suite même si le jeu reste en pause.
    if (!this.paused) {
      this.elapsed += dt;

      // GameConfig.simulation.speed ralentit tout SAUF la horde (voir Monsters.update ci-dessous,
      // qui reçoit dt non modifié) : production, croissance de la population, transport, tours.
      const simDt = dt * GameConfig.simulation.speed;

      this.productionAccum += simDt;
      if (this.productionAccum >= 1) {
        GameState.tickProduction(this.productionAccum);
        this.productionAccum = 0;
      }
      // Le transport avance chaque frame (pas seulement au tick de production) pour un mouvement fluide.
      GameState.updateShipments(simDt);
      GameState.updateShots(simDt);

      const monsterMessages = Monsters.update(dt, this.elapsed, GameState);
      for (const msg of monsterMessages) this.showToast(msg);
    }

    if (GameState.buildingsDirty) {
      GameState.computeRevealedTiles();
      GameState.computeGuildZone();
      GameState.buildingsDirty = false;
    }
    this.redrawFog();

    // Ordre important : ce sont 3 étapes d'un même dessin (routes/ressources, puis chargements,
    // puis monstres par-dessus), sur le même canvas tileArtTexture — voir le commentaire sur
    // shotGraphics dans create() pour pourquoi elles ne peuvent pas rester des Graphics normaux.
    // Un seul refresh() à la fin, pas un par étape.
    this.redrawTileArt();
    this.redrawShipments();
    this.redrawMonsters();
    this.tileArtTexture.refresh();

    this.redrawShots();

    if (GameState.dirty) {
      this.redrawBuildings();
      this.redrawResources();
      GameState.dirty = false;
    }

    // PC et mobile utilisent désormais tous les deux la grille d'icônes (voir layoutHud) plutôt
    // que resourceText (texte brut, resté pour référence mais toujours invisible).
    const r = GameState.resources;
    for (const res of this.resourceOrder) this.resourceValueTexts[res].setText(String(Math.floor(r[res])));
    this.populationStatsText.setText(
      `Main-d'œuvre nécessaire : ${GameState.neededWorkers()}   Logements libres : ${GameState.availableHousing()}`
    );

    this.updateInfoPanel();
  }
}
