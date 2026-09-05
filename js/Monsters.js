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
  // total). Position de départ (voir GameConfig.monsters.tailAheadOfWarehouseCols, demande
  // utilisateur explicite) : la FIN de la formation (depth = depthCount-1, la plus en retrait)
  // démarre à world.startCol + tailAheadOfWarehouseCols colonnes -- donc déjà passée l'Entrepôt
  // initial -- et le front (depth 0) démarre encore plus loin devant elle, à cette même position
  // PLUS le décalage total de la formation (depthCount-1 pas de depthSpacing). Le reste de la
  // formation s'étire derrière le front selon ce même écart (colonnes qui boucleront naturellement
  // sur l'autre bord du cylindre le temps que le front avance). L'écart entre monstres d'une même
  // rangée (depthSpacingFactor) est volontairement plus petit qu'une case, pour un rendu de horde
  // tassée (voir GameScene.redrawMonsters) — indépendant de la largeur de case réelle utilisée
  // pour la détection de franchissement de colonne dans update() ci-dessous.
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
    const colWidth = GameConfig.hex.size * 1.5;
    // Voir commentaire au-dessus de init() : la fin de la formation (dernier depth) doit démarrer
    // à world.startCol + tailAheadOfWarehouseCols colonnes ; le front (depth 0) démarre donc à
    // cette position PLUS le décalage total de la formation ((depthCount-1) * depthSpacing), qu'on
    // retire ensuite pas à pas par depth ci-dessous (x: frontStartX - depth * depthSpacing).
    const tailStartX = (GameConfig.world.startCol + cfg.tailAheadOfWarehouseCols) * colWidth;
    const frontStartX = tailStartX + (cfg.depthCount - 1) * depthSpacing;
    this.list = [];
    // Index id -> monstre (voir GameState, résolution rapide de leaderId à la mort d'un gobelin
    // pour la régénération) et référence directe au Seigneur (voir GameScene.update, condition de
    // victoire) -- reconstruits aussi par deserialize(), pas persistés (dérivables de list).
    this.byId = new Map();
    this.lord = null;
    this.nextId = 1;
    this.totalDistancePx = 0;
    // groupId -> secondes restantes avant que la section ne soit plus considérée "sous le feu"
    // (voir markGroupUnderAttack/update, GameConfig.monsters.underAttackFreezeSeconds) : décompte
    // en temps réel comme respawnTimer, jamais persisté (pas critique de le perdre en rechargeant
    // une sauvegarde, juste un état de combat transitoire).
    this.groupUnderAttack = new Map();
    // Minuteur de Fureur divine (voir killRandomGoblin/update ci-dessous, GameConfig.devotion.tiers,
    // demande utilisateur explicite) : temps RÉEL comme le reste de la horde, jamais persisté (état
    // transitoire, comme groupUnderAttack).
    this.fureurTimer = 0;
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
        // Meneur (Chef ou Seigneur) de la zone de ce gobelin, pour la condition de régénération
        // (voir GameState, section tir de tour, et GameConfig.monsters.goblinRespawnSecondsRange) :
        // calculé directement à partir des ids séquentiels attribués ci-dessous, SANS passe
        // supplémentaire -- id(displayRow, depth) = displayRow * depthCount + depth + 1 (nextId
        // incrémenté une fois par push, dans cet ordre), et le meneur du bloc (rowBlock,
        // depthBlock) est toujours celui au centre local (centerLocal, centerLocal) de ce bloc.
        const leaderId = type === 'goblin'
          ? (rowBlock * blockSize + centerLocal) * cfg.depthCount + (depthBlock * blockSize + centerLocal) + 1
          : undefined;
        const monster = {
          id: this.nextId++,
          row: worldRow,
          displayRow,
          x: frontStartX - depth * depthSpacing,
          hp: cfg.hpByType[type],
          alive: true,
          type,
          variant,
          leaderId,
        };
        this.list.push(monster);
        this.byId.set(monster.id, monster);
        if (type === 'lord') this.lord = monster;
      }
    }
  },

  // Identifiant de "section" (voir GameConfig.monsters.underAttackFreezeSeconds) : le groupe mené
  // par un Chef/Seigneur, c'est-à-dire son propre id pour un meneur, ou l'id de SON meneur pour un
  // gobelin (leaderId, voir init()) -- un Chef et tous ses gobelins partagent donc le même groupId.
  groupIdFor(monster) {
    return monster.leaderId != null ? monster.leaderId : monster.id;
  },

  // Appelée depuis GameState (section tir de tour) à CHAQUE tir qui touche un monstre, qu'il en
  // meure ou non : rafraîchit la fenêtre "sous le feu" de toute sa section (voir groupIdFor),
  // gelant le décompte de régénération de tous ses membres morts (voir update() ci-dessous).
  markGroupUnderAttack(monster) {
    this.groupUnderAttack.set(this.groupIdFor(monster), GameConfig.monsters.underAttackFreezeSeconds);
  },

  // Fureur divine (voir GameConfig.devotion.tiers, demande utilisateur explicite) : tue un gobelin
  // vivant tiré au hasard dans toute la horde, sans passer par markGroupUnderAttack -- "cela ne
  // compte pas comme 'une section est attaquée'", donc le respawn de sa section n'est PAS gelé par
  // cet effet (contrairement à un tir de tour, voir GameState section tir de tour). Le respawn du
  // gobelin lui-même suit ensuite les règles habituelles (voir update(), branche m.leaderId != null),
  // sans traitement spécial.
  killRandomGoblin(gameState) {
    const candidates = this.list.filter((m) => m.alive && m.type === 'goblin');
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    target.hp = 0;
    target.alive = false;
    gameState.monstersKilled++;
    gameState._maybeDropCorpse(target);
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

    // Régénère les blobs de ressources (bois/pierre/montagne) à CHAQUE tour complet de la horde
    // (demande utilisateur explicite : "à la fin de la horde, les blobs de ressource sois
    // regeneré, pas forcement exactement à la meme place que precedement") -- réutilise
    // exactement generateResourceBlobs() (même génération aléatoire qu'au tout début de la
    // partie, voir GameState), qui ne fait qu'AJOUTER de nouveaux blobs sur des cases encore
    // libres (_tileIsFreeForResource) : les ressources restantes d'avant, elles, ne sont ni
    // déplacées ni perdues. "lap" ci-dessus est calculé AVANT d'avancer (vitesse de CE tick) ; on
    // compare avec le nouveau total pour détecter le franchissement.
    const lapAfter = Math.floor(this.totalDistancePx / worldWidthPx);
    if (lapAfter > lap) {
      gameState.generateResourceBlobs();
      messages.push('La horde a bouclé un tour : de nouvelles ressources sont apparues.');
    }

    // Fenêtres "sous le feu" (voir markGroupUnderAttack) : décrémentées une fois par frame ici,
    // entrées expirées retirées plutôt que laissées grossir indéfiniment dans la Map.
    for (const [groupId, remaining] of this.groupUnderAttack) {
      const next = remaining - dt;
      if (next <= 0) this.groupUnderAttack.delete(groupId);
      else this.groupUnderAttack.set(groupId, next);
    }

    // Fureur divine (voir killRandomGoblin ci-dessus) : temps réel, comme le déplacement de la
    // horde -- remis à 0 tant que la bénédiction est inactive pour ne pas tuer une rafale de
    // gobelins d'un coup à sa réactivation.
    if (!gameState.hasActiveBlessing('fureur')) {
      this.fureurTimer = 0;
    } else {
      this.fureurTimer += dt;
      while (this.fureurTimer >= 1) {
        this.fureurTimer -= 1;
        this.killRandomGoblin(gameState);
      }
    }

    for (const m of this.list) {
      // Position TOUJOURS avancée, même mort (voir régénération ci-dessous, GameConfig.monsters.
      // chiefRespawnSeconds/goblinRespawnSecondsRange, demande utilisateur explicite) : la
      // formation reste un bloc rigide, un monstre régénéré doit réapparaître à SA place ACTUELLE
      // dans la formation, pas à l'endroit (obsolète) où il est mort -- seule la détection de
      // franchissement de case (destruction) est sautée pour un monstre mort, juste en dessous.
      const prevCol = Math.floor(m.x / colWidth);
      m.x += advance;
      const newCol = Math.floor(m.x / colWidth);

      if (m.alive) {
        for (let c = prevCol + 1; c <= newCol; c++) {
          const wrappedCol = HexUtils.wrapCol(c, gameState.cols);
          const warehouseLost = gameState.destroyTile(wrappedCol, m.row);
          if (warehouseLost) messages.push('Un Entrepôt a été englouti par les monstres !');
        }
      } else if (m.respawnTimer != null) {
        // Décompte en temps RÉEL, comme le déplacement de la horde (dt non modifié par
        // GameConfig.simulation.speed, voir GameScene.update qui passe le même dt ici) -- pas au
        // rythme ralenti du reste du jeu. Pour un Chef, respawnTimer est lancé dès sa mort (voir
        // GameState, section tir de tour) ; pour un gobelin, voir juste en dessous. Le Seigneur de
        // la horde n'en reçoit jamais et ne régénère donc jamais.
        const leader = m.leaderId != null ? this.byId.get(m.leaderId) : null;
        if (leader && !leader.alive) {
          // Meneur mort une SECONDE fois pendant que ce gobelin comptait déjà son propre délai
          // (démarré la fois précédente où le meneur était en vie, voir la branche leaderId
          // ci-dessous) -- bug vécu pour de vrai (demande utilisateur explicite : "les gobelins
          // respawn alors que leur chef de guerre est mort") : le vieux décompte, devenu obsolète,
          // est effacé ; il en redemandera un NOUVEAU dès que le meneur sera de nouveau en vie
          // (même branche leaderId, à une frame future).
          m.respawnTimer = null;
        } else if (!this.groupUnderAttack.has(this.groupIdFor(m))) {
          // Section pas sous le feu (voir markGroupUnderAttack, demande utilisateur explicite :
          // "je veux que le compteur de respawn sois freeze tant que la section est attaqué") :
          // décompte normal. Sinon (fenêtre encore active), il reste gelé tel quel cette frame.
          m.respawnTimer -= dt;
          if (m.respawnTimer <= 0) {
            m.respawnTimer = null;
            m.alive = true;
            m.hp = cfg.hpByType[m.type];
          }
        }
      } else if (m.leaderId != null) {
        // Gobelin mort SANS respawnTimer en cours : soit il vient de mourir avec son meneur déjà
        // mort, soit il attend encore depuis une mort précédente (demande utilisateur explicite :
        // "il attend que le chef de guerre réapparaisse avant de lancer le timer de sa propre
        // résurrection") -- vérifié à CHAQUE frame tant que le meneur (Chef ou Seigneur, voir
        // Monsters.init) reste mort ; dès qu'il est de nouveau en vie, le délai aléatoire de
        // régénération démarre enfin (voir GameConfig.monsters.goblinRespawnSecondsRange).
        const leader = this.byId.get(m.leaderId);
        if (leader && leader.alive) {
          const [minS, maxS] = GameConfig.monsters.goblinRespawnSecondsRange;
          m.respawnTimer = minS + Math.random() * (maxS - minS);
        }
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
    // Reconstruits à partir de list (pas persistés, voir init()) : fonctionne aussi sur une
    // sauvegarde d'avant cette fonctionnalité (leaderId/respawnTimer seront alors simplement
    // absents -- ces gobelins ne régénéreront pas, sans erreur).
    this.byId = new Map(this.list.map(m => [m.id, m]));
    this.lord = this.list.find(m => m.type === 'lord') || null;
    // Pas persisté (voir groupUnderAttack plus haut, état de combat transitoire) : une
    // sauvegarde rechargée repart avec toutes les sections "hors du feu", sans erreur.
    this.groupUnderAttack = new Map();
    this.fureurTimer = 0;
  },
};
