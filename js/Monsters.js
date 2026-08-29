// ============================================================
// HORDE DE MONSTRES
// Remplace l'ancienne "vague" (une bande qui détruisait des colonnes entières) par des monstres
// individuels : chacun avance en ligne droite, à vitesse constante, sans se soucier des routes
// ni des bâtiments — pas de pathfinding, pas de contournement, juste une position continue qui
// augmente avec le temps. En traversant une case, il la détruit. Formation : un bloc dense de
// depthCount monstres par rangée de formation (espacés d'une largeur de case), sur rowCount
// rangées de formation (voir GameConfig.monsters -- ce nombre est purement visuel, DÉCOUPLÉ du
// vrai nombre de rangées du monde, voir init() ci-dessous), qui avancent ensemble. Pas
// d'interaction du joueur avec eux pour l'instant (voir hp dans config).
// ============================================================

const Monsters = {
  list: [], // { id, row, x (pixels, continu), hp, alive }
  nextId: 1,
  // Distance totale parcourue par la horde depuis le début de la partie (pixels, jamais remise à
  // zéro sauf init()) : sert à déterminer le tour du cylindre en cours (voir update()) pour la
  // vitesse progressive, sans avoir besoin d'un compteur de tours séparé à tenir à jour à la main.
  totalDistancePx: 0,

  // Peuple la horde : un bloc de depthCount monstres par rangée de FORMATION (rowCount rangées au
  // total), le front (depth 0) démarrant à la colonne 0, le reste s'étirant derrière (colonnes
  // négatives, qui boucleront naturellement sur l'autre bord du cylindre le temps que le front
  // avance). L'écart entre monstres d'une même rangée (depthSpacingFactor) est volontairement plus
  // petit qu'une case, pour un rendu de horde tassée (voir GameScene.redrawMonsters) — indépendant
  // de la largeur de case réelle utilisée pour la détection de franchissement de colonne dans
  // update() ci-dessous.
  // rowCount (lignes de formation, voir GameConfig.monsters) est DÉCOUPLÉ du vrai nombre de
  // rangées du monde (gameState.rows) -- demande utilisateur explicite : plus de lignes de
  // monstres SANS agrandir le monde. m.row (utilisé pour la destruction de case, le brouillard de
  // guerre et le ciblage des tours, voir GameState/GameScene) reste la VRAIE rangée du monde,
  // obtenue en compressant displayRow (0..rowCount-1) sur [0, gameState.rows) ; m.displayRow
  // (0..rowCount-1) sert uniquement au rendu vertical (voir GameScene.redrawMonsters) et au calcul
  // de la grille de blocs ci-dessous (comme pour depthCount/les colonnes, plusieurs lignes de
  // formation peuvent donc partager la même vraie rangée -- seule la première à l'atteindre y
  // détruit quelque chose).
  // Découpe le bloc rowCount x depthCount (lignes de formation x profondeur) en une grille de
  // blocs 15x15 : 6 blocs en lignes x 3 blocs en colonnes (18 blocs au total, demande utilisateur
  // explicite pour remplir plus la carte, voir GameConfig.monsters.blockSize) : un Chef de guerre
  // au centre de CHAQUE bloc (17), sauf le bloc historique rowBlock===1/depthBlock===1 (position
  // inchangée depuis la grille 3x3 d'origine, demande utilisateur explicite de ne pas déplacer le
  // Seigneur de la horde) qui reçoit le Seigneur de la horde à la place. Mêmes stats que les
  // gobelins pour l'instant (voir demande utilisateur) -- seul le type (donc l'image, voir
  // GameScene.redrawMonsters) change.
  // Variantes d'image purement cosmétiques pour les gobelins simples (demande utilisateur
  // explicite : plusieurs images ajoutées, utilisées au hasard, mêmes caractéristiques pour tous
  // -- seul le rendu change, voir GameScene.redrawMonsters). 'goblinIcon' (image d'origine) fait
  // partie du tirage au même titre que les nouvelles.
  goblinVariants: ['goblinIcon', 'goblinIcon2', 'goblinIcon3', 'goblinIcon4'],

  init(gameState) {
    const cfg = GameConfig.monsters;
    const depthSpacing = GameConfig.hex.size * cfg.depthSpacingFactor;
    const blockSize = cfg.blockSize;
    const centerLocal = Math.floor((blockSize - 1) / 2);
    this.list = [];
    this.nextId = 1;
    this.totalDistancePx = 0;
    for (let displayRow = 0; displayRow < cfg.rowCount; displayRow++) {
      const worldRow = Math.floor(displayRow * gameState.rows / cfg.rowCount);
      const rowBlock = Math.floor(displayRow / blockSize);
      const localRow = displayRow % blockSize;
      for (let depth = 0; depth < cfg.depthCount; depth++) {
        const depthBlock = Math.floor(depth / blockSize);
        const localDepth = depth % blockSize;
        let type = 'goblin';
        if (localRow === centerLocal && localDepth === centerLocal) {
          // Bloc historique du Seigneur de la horde (position figée depuis la grille 3x3
          // d'origine, demande utilisateur explicite de ne pas le déplacer en agrandissant la
          // grille) -- tous les autres blocs de la grille reçoivent un Chef de guerre.
          const isLordBlock = rowBlock === 1 && depthBlock === 1;
          type = isLordBlock ? 'lord' : 'chief';
        }
        const variant = type === 'goblin'
          ? this.goblinVariants[Math.floor(Math.random() * this.goblinVariants.length)]
          : undefined;
        this.list.push({
          id: this.nextId++,
          row: worldRow,
          displayRow,
          x: -depth * depthSpacing,
          hp: cfg.startingHp,
          alive: true,
          type,
          variant,
        });
      }
    }
  },

  // Avance chaque monstre vivant et détruit les cases qu'il vient de traverser (sur SA rangée
  // uniquement, contrairement à l'ancienne vague qui détruisait la colonne entière). Comme tous
  // les monstres d'une même rangée avancent à la même vitesse en gardant leur écart initial,
  // seul le premier de chaque rangée détruit réellement quelque chose ; les suivants ne font que
  // traverser des ruines déjà faites — c'est voulu (le bloc dense est surtout visuel, la
  // profondeur donnant l'impression d'une horde plutôt qu'une simple ligne de front).
  update(dt, elapsed, gameState) {
    const cfg = GameConfig.monsters;
    const colWidth = GameConfig.hex.size * 1.5;
    const worldWidthPx = colWidth * gameState.cols;

    // Vitesse progressive (voir demande utilisateur) : le 1er tour complet du cylindre dure
    // lapOneSeconds, chaque tour suivant est lapSpeedMultiplier fois plus rapide que le précédent
    // (racine de 2 par défaut, voir GameConfig.monsters : 2 multiplications = 3e tour 2x plus
    // rapide, donc 2x plus court). "lap" ci-dessous = nombre de tours déjà complétés (0 = en train
    // de faire le 1er).
    const lap = Math.floor(this.totalDistancePx / worldWidthPx);
    const speedCols = (gameState.cols / cfg.lapOneSeconds) * Math.pow(cfg.lapSpeedMultiplier, lap);
    const speedPx = speedCols * colWidth;
    const advance = speedPx * dt;
    this.totalDistancePx += advance;

    const messages = [];

    for (const m of this.list) {
      if (!m.alive) continue;
      const prevCol = Math.floor(m.x / colWidth);
      m.x += advance;
      const newCol = Math.floor(m.x / colWidth);

      for (let c = prevCol + 1; c <= newCol; c++) {
        const wrappedCol = HexUtils.wrapCol(c, gameState.cols);
        const warehouseLost = gameState.destroyTile(wrappedCol, m.row);
        if (warehouseLost) messages.push('Un Entrepôt a été englouti par les monstres !');
      }

      // Ramène x dans [0, worldWidthPx) pour éviter une dérive flottante sur une longue partie
      // (les cases traversées ont déjà été calculées ci-dessus via wrapCol, donc sans risque).
      m.x = ((m.x % worldWidthPx) + worldWidthPx) % worldWidthPx;
    }

    return messages;
  },

  serialize() {
    return { list: this.list.map(m => ({ ...m })), nextId: this.nextId, totalDistancePx: this.totalDistancePx };
  },

  deserialize(data) {
    this.list = (data.list || []).map(m => ({ ...m }));
    this.nextId = data.nextId || 1;
    this.totalDistancePx = data.totalDistancePx || 0;
  },
};
