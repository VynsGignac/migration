// ============================================================
// CONFIGURATION DU JEU
// Modifie ces valeurs pour ajuster le jeu sans toucher au reste du code.
// ============================================================

const GameConfig = {
  // Bascules de test, à remettre à false avant une vraie partie/publication -- PAS des réglages
  // de gameplay. disableFog (demande utilisateur explicite, pour prévisualiser la nouvelle
  // ressource montagne sans construire tout un réseau) : GameState.computeRevealedTiles révèle
  // alors toute la carte d'un coup au lieu de la zone d'action des bâtiments.
  debug: {
    disableFog: true,
  },
  hex: {
    // Taille d'une case hexagonale en pixels (rayon du centre à un coin)
    size: 34,
  },
  // Multiplicateur global de vitesse du jeu (production, croissance de la population, transport,
  // tirs des tours) — demande utilisateur : le jeu semblait globalement trop rapide. NE s'applique
  // PAS à la horde de monstres (voir GameScene.update, qui passe un dt non modifié à Monsters.update)
  // : sa vitesse reste calée sur GameConfig.monsters.lapOneSeconds/lapSpeedMultiplier, en temps
  // réel, exprès.
  // Centralisé ici plutôt qu'éparpillé pour pouvoir être retouché facilement si besoin.
  simulation: {
    speed: 0.5,
  },
  world: {
    // Nombre de colonnes de cases sur la largeur du cylindre
    // (une fois qu'on a parcouru "cols" colonnes vers la droite, on retombe sur la colonne 0)
    // -- 200 (demande utilisateur explicite, réduit depuis 500). Plusieurs autres valeurs sont
    // calibrées PROPORTIONNELLEMENT à ce nombre et doivent être réajustées si il change encore :
    // world.startCol (reste à cols/2), monsters.lapOneSeconds (vitesse initiale de la horde en
    // colonnes/s), et resourceNodes.blobCountTree/blobCountStone/corpseCount (densité de
    // ressources par colonne, voir resourceNodes plus bas).
    cols: 200,
    // Nombre de rangées de cases en hauteur (le monde NE boucle PAS verticalement) -- taille du
    // MONDE réel, ne pas confondre avec monsters.rowCount (nombre de lignes de la horde, purement
    // visuel/formation, découplé de cette valeur -- demande utilisateur explicite : plus de lignes
    // de monstres SANS agrandir le monde, voir Monsters.init).
    rows: 45,
    // Colonne de départ de l'Entrepôt initial. À la moitié du tour (100/200) -- ce ratio doit être
    // conservé si cols change encore. La horde démarre maintenant déjà PASSÉE cette colonne (voir
    // monsters.tailAheadOfWarehouseCols/Monsters.init, demande utilisateur explicite) : elle doit
    // faire presque un tour complet pour l'atteindre, soit ≈18min50 avec la vitesse initiale
    // actuelle (voir monsters.lapOneSeconds : 4 colonnes/30s, divisée par 2 depuis, demande
    // utilisateur explicite).
    startCol: 100,
  },
  camera: {
    // Bornes choisies par l'utilisateur après calibration via l'affichage temporaire du zoom
    // courant (voir GameScene.debugZoomText, retiré une fois ces valeurs figées). zoomMin sert
    // aussi de plancher à GameScene.getEffectiveZoomMin(), qui calcule normalement un minimum
    // dynamique pour remplir exactement la hauteur d'écran (22 rangées) -- sur un écran où ce
    // minimum dynamique serait plus bas que 0.25, ce plancher prend le dessus (sans risque de
    // bande noire : un zoom minimum plus élevé que nécessaire montre juste moins de rangées à la
    // fois, jamais moins que la hauteur d'écran).
    zoomMin: 0.25,
    zoomMax: 1.25,
    zoomStart: 0.5,
  },
  colors: {
    hexFill: 0x2e5339,
    hexStroke: 0x1b3322,
    // Opacité du liseré entre cases (terrain ET bâtiments/ruines) : volontairement discret,
    // juste assez pour deviner la grille sans qu'elle domine visuellement le décor/les
    // illustrations de case (voir GameScene.createTerrainTileSprite et redrawBuildings).
    hexStrokeAlpha: 0.25,
    background: 0x10151a,
    ruin: 0x4a4a4a,
    monster: 0xff2222,
    // Monstre blessé (hp < monsters.hpByType[type], voir GameScene.redrawMonsters) : teinte plus
    // claire/orangée pour rester lisible à la taille minuscule d'un monstre sans dépendre d'une
    // jauge ou d'une icône séparée -- demande utilisateur explicite.
    monsterWounded: 0xffb347,
    // Bordure des cases de bâtiment (voir GameScene.redrawTileArt/redrawBuildings, demande
    // utilisateur explicite) : couleur roche/pierre, distincte du liseré discret entre cases
    // (hexStroke ci-dessus, qui reste inchangé pour le terrain) -- fait ressortir un bâtiment
    // du fond d'herbe qui se voit maintenant autour des icônes.
    buildingBorder: 0x9c9186,
  },
  resources: {
    // Stock de départ, volontairement généreux : les premiers blobs de ressources peuvent être
    // loin de l'Entrepôt de départ (voir world.cols/resourceNodes.startClearance). Ce coussin doit suffire à
    // lancer les deux chaînes (bois et pierre) et reconstruire un Entrepôt sans jamais bloquer.
    // gemme modeste (renommée depuis "Codex", demande utilisateur explicite) : les Gemmes se
    // récupèrent sur les cadavres de monstres recyclés (voir buildings.recycler, 1 par cadavre) --
    // un petit coussin de départ suffit à lancer les premières recherches avant d'avoir un
    // Recycleur de gemmes actif.
    starting: {
      wood: 0, planks: 100, stone: 0, stoneBlocks: 30, ore: 0, ironIngot: 0,
      weapons: 0, statues: 0, devotion: 0, gemme: 50,
    },
  },
  // Nom affiché (long) et abrégé (pour les boutons), et couleur du petit jeton
  // qui voyage sur les routes, pour chaque ressource.
  resourceLabels: {
    wood: { long: 'Bois', short: 'Bois', color: 0x8b5a2b },
    planks: { long: 'Planches', short: 'Pl', color: 0xc9974f },
    stone: { long: 'Pierre', short: 'Roche', color: 0x5a5a70 },
    stoneBlocks: { long: 'Pierre taillée', short: 'PT', color: 0xb0b0b0 },
    wheat: { long: 'Blé', short: 'Blé', color: 0xdbc245 },
    bread: { long: 'Pain', short: 'Pain', color: 0xe8a33d },
    // Introduit par la techno Tunnelier (voir techTree.nodes.ind_tunnelier, une chance que le Camp
    // de Mineur en produise aussi en creusant la pierre), et par le Mineur de Fer (voir
    // buildings.ironMiner, demande utilisateur explicite) qui l'extrait directement des montagnes.
    ore: { long: 'Minerai', short: 'Minerai', color: 0x8a6d4f },
    // Chaîne du fer (demande utilisateur explicite) : Mineur de Fer -> minerai -> Fonderie ->
    // lingot de fer (voir buildings.ironMiner/foundry), même principe que bois/planches ou
    // pierre/pierre taillée.
    ironIngot: { long: 'Lingot de fer', short: 'Fer', color: 0x9aa0a6 },
    // Armurier (demande utilisateur explicite) : lingot de fer + bois brut -> armes.
    weapons: { long: 'Armes', short: 'Armes', color: 0x8a3030 },
    // Sculpteur (demande utilisateur explicite) : pierre brute + lingot de fer -> statues.
    statues: { long: 'Statues', short: 'Stat.', color: 0xa8a190 },
    // Temple (demande utilisateur explicite) : monnaie globale comme la Gemme, jamais transportée
    // sur les routes -- produite en continu proportionnellement au nombre d'Autels dans la zone
    // d'action de chaque Temple (voir buildings.temple/altar, GameState.tickProduction section
    // "Temple").
    devotion: { long: 'Dévotion', short: 'Dévo.', color: 0xe8c96a },
    // Monnaie des recherches (voir techTree.researchCost), globale et jamais transportée sur les
    // routes (directement dépensée/gagnée dans le stock central) : récupérée en recyclant des
    // cadavres de monstres (voir buildings.recycler, 1 Gemme par cadavre, 2 avec Imprimerie -- voir
    // techTree.nodes.rec_imprimerie). Le stock de départ (voir resources.starting) n'est qu'un
    // petit coussin pour les toutes premières recherches. Renommée depuis "Codex" (demande
    // utilisateur explicite) -- clé interne "gemme" (voir GameState.deserialize pour la migration
    // des sauvegardes existantes qui utilisaient encore "codex").
    gemme: { long: 'Gemme', short: 'Gemme', color: 0x6f5fa3 },
  },
  // Répartition manuelle des ressources à plusieurs débouchés possibles (demande utilisateur
  // explicite : menu ouvert en tapant un Entrepôt -- un onglet par ressource, un curseur par
  // bâtiment consommateur, voir GameState.resourceRouting/setResourceRouting/GameScene.
  // openResourceRouting). "consumers" = les types de bâtiments listés dans cet onglet, dans
  // l'ordre d'affichage ; "defaults" = répartition de départ (bois/pierre : tout vers la chaîne
  // historique -- Scierie/Tailleur -- rien vers Armurier/Sculpteur tant que le joueur n'a pas
  // réparti lui-même ; fer : 50/50, aucune chaîne "historique" entre Armurier et Sculpteur).
  resourceRouting: {
    wood: { consumers: ['sawmill', 'armurier'], defaults: { sawmill: 100, armurier: 0 } },
    stone: { consumers: ['stonecutter', 'sculpteur'], defaults: { stonecutter: 100, sculpteur: 0 } },
    ironIngot: { consumers: ['armurier', 'sculpteur'], defaults: { armurier: 50, sculpteur: 50 } },
  },
  // Répartition manuelle de la population par CATÉGORIE de bâtiments (demande utilisateur
  // explicite : menu ouvert en tapant le bouton Maison -- même principe que resourceRouting
  // ci-dessus, mais un seul groupe de curseurs, pas d'onglets par ressource) : chaque catégorie
  // regroupe les bâtiments qui recrutent de la main-d'œuvre (voir GameState.allocateLabor, kind
  // extractor/processor/tower/shrine, Recycleur exclu -- TOUS couverts ici, aucune catégorie
  // "reste"). Les % fixent la part de la population TOTALE de la ville ciblée pour chaque
  // catégorie (pas juste un ordre de priorité) ; à l'intérieur d'une catégorie, le bâtiment le
  // moins staffé à portée d'une Maison est toujours privilégié en premier, comme avant l'ajout de
  // ce réglage. castle inclus dans militaire (même kind 'tower' qu'un Donjon, voir
  // buildings.castle -- un Château amélioré recrute exactement pareil).
  laborRouting: {
    defaultPercent: 20, // 5 catégories, réparties également par défaut (aucune n'est "la" chaîne historique)
    categories: {
      materiaux: { label: 'Matériaux de construction', buildings: ['lumberjackCamp', 'sawmill', 'minerCamp', 'stonecutter'] },
      alimentation: { label: 'Alimentation', buildings: ['farm', 'bakery'] },
      // Libellé "Dévotion" (demande utilisateur explicite, renommé depuis "Civisme") : id interne
      // "civisme" inchangé (pas visible du joueur, seul GameConfig.laborRouting.categories.label
      // apparaît dans le panneau, voir GameScene.refreshLaborRoutingRows).
      civisme: { label: 'Dévotion', buildings: ['sculpteur', 'temple'] },
      metallurgie: { label: 'Métallurgie', buildings: ['ironMiner', 'foundry'] },
      militaire: { label: 'Militaire', buildings: ['donjon', 'armurier', 'castle'] },
    },
  },
  // Dévotion (demande utilisateur explicite) : PAS un stock qui s'accumule comme les autres
  // ressources -- un pourcentage (0-100, voir GameState.resources.devotion). Le Temple lui-même
  // ne produit RIEN (demande utilisateur explicite, "je veux que le temple ne produise rien de
  // lui meme") -- toute la production vient des Autels à portée (voir buildings.temple.
  // devotionPerAltar, %/s PAR Autel dans extractRadius).
  //
  // decayBands : la perte naturelle N'EST PLUS un taux fixe -- elle dépend de la Dévotion ACTUELLE
  // (demande utilisateur explicite, valeurs finales après plusieurs itérations chiffrées avec
  // l'utilisateur) : chaque tranche de 20 points a son propre taux (%/s), qui grimpe avec le
  // niveau -- 0 sous 20 %, jusqu'à 2 %/s (10 %/5s) au-dessus de 80 %. Voir
  // GameState.devotionDecayRateFor, qui choisit la première tranche dont `max` dépasse strictement
  // la Dévotion actuelle (donc 20 % pile tombe déjà dans la tranche 20-40, etc.) ; ratePerSecond =
  // valeur en %/5s divisée par 5 (ex. 1 %/5s -> 0.2).
  devotion: {
    cap: 100,
    decayBands: [
      { max: 20, ratePerSecond: 0 },
      { max: 40, ratePerSecond: 0.2 },
      { max: 60, ratePerSecond: 0.5 },
      { max: 80, ratePerSecond: 1.0 },
      { max: 100, ratePerSecond: 2.0 },
    ],
    // Hystérésis (demande utilisateur explicite : "si la devotion redescend 5% plus bas que le
    // palier... alors l'effet... devient inactif (et se reactive automatiquement dès que le
    // palier est réatteind sans choix à faire)") : un choix déjà validé reste actif tant que la
    // Dévotion ne descend pas sous (seuil - tierInactiveMargin) ; il ne se réactive qu'au retour à
    // (seuil) pile, pas dès (seuil - margin) -- évite un clignotement actif/inactif juste sous le
    // seuil. Le CHOIX lui-même (une fois fait) ne se perd jamais, seul son effet bascule actif/non.
    tierInactiveMargin: 5,
    // desc : effet concret de chaque bénédiction (demande utilisateur explicite), affiché tel
    // quel dans le panneau (voir GameScene.refreshDevotionPanel) -- vérifié par id dans
    // GameState.hasActiveBlessing/effectiveBuildingCost/tickProduction et Monsters.update.
    tiers: [
      {
        id: 'tier1', threshold: 20,
        options: [
          { id: 'commerce', name: 'Commerce religieux', desc: 'Chaque Entrepôt augmente une ressource de 1 % toutes les 10 s.' },
          { id: 'regard', name: 'Regard divin', desc: 'Le brouillard de guerre est entièrement dissipé.' },
        ],
      },
      {
        id: 'tier2', threshold: 40,
        options: [
          { id: 'culte', name: 'Culte organisé', desc: 'Coût en Statues de l\'Autel divisé par 2.' },
          { id: 'croisade', name: 'Croisade', desc: 'Coût de construction du Donjon divisé par 2.' },
        ],
      },
      {
        id: 'tier3', threshold: 60,
        options: [
          { id: 'fertilite', name: 'Déesse de la fertilité', desc: 'Les bâtiments de ressource brute sont 2 fois plus efficaces.' },
          { id: 'artisans', name: 'Dieu des artisans', desc: 'Les bâtiments de ressource raffinée sont 2 fois plus efficaces.' },
        ],
      },
      {
        id: 'tier4', threshold: 80,
        options: [
          { id: 'voyageurs', name: 'Dieu des voyageurs', desc: 'Les routes sont gratuites.' },
          { id: 'guerre', name: 'Déesse de la guerre', desc: 'Coût de l\'amélioration en Château réduit de 50 %.' },
        ],
      },
      {
        id: 'tier5', threshold: 100,
        options: [
          { id: 'fureur', name: 'Fureur divine', desc: 'Toutes les secondes, un gobelin de la horde est tué (il respawn normalement).' },
          { id: 'apogee', name: 'Apogée céleste', desc: 'Tous les coûts de construction sont réduits de 50 % (se cumule en multipliant avec les autres réductions).' },
        ],
      },
    ],
  },
  // Transport des ressources le long des routes.
  logistics: {
    shipSpeed: 2, // cases par seconde
    shipBatchSize: 5, // quantité expédiée par voyage (demande utilisateur explicite, était 3)
    // Portée par défaut à laquelle un producteur peut trouver un Entrepôt/une Université, ET
    // base de la zone d'action RÉELLE de l'Entrepôt (voir warehouseExtraRange ci-dessous, séparé
    // exprès : agrandir seulement l'Entrepôt sans toucher à la portée des autres bâtiments).
    linkRange: 6,
    // Bonus dédié à la zone d'action de l'Entrepôt (voir GameState.warehouseZoneRadius, demande
    // utilisateur explicite : "+2 cases"), en plus de linkRange -- distinct de linkRange pour ne
    // PAS agrandir en même temps la portée de l'Université (qui réutilise linkRange directement,
    // voir zoneRadiusFor) ni celle des producteurs (chacun son propre linkRange dans buildings).
    warehouseExtraRange: 2,
  },
  // Ressources naturelles posées sur la carte sous forme de "blobs" (amas irréguliers).
  // Les nombres de blobs gardent la même densité qu'à 80 colonnes (~1 blob d'arbres/6-7
  // colonnes, ~1 blob de pierre/10 colonnes), doublée UNE PREMIÈRE fois (demande utilisateur :
  // deux fois plus de ressource sur la carte), puis mise à l'échelle du nombre de colonnes actuel
  // (voir world.cols : ces comptes sont pour 200 colonnes) -- à ajuster proportionnellement si
  // world.cols change encore, sous peine de densité deux fois trop faible/forte. La demande "deux
  // fois plus de ressource" reformulée ensuite (pas plus de blobs, chaque blob contient 2x plus de
  // ressource, voir amountMin/amountMax de tree/stone juste en dessous) a donc annulé le second
  // doublement du NOMBRE de blobs, remis à sa valeur précédente.
  resourceNodes: {
    // amount FIXE, pas une fourchette aléatoire (demande utilisateur explicite : "toutes les
    // ressources naturelles d'un meme type aient la meme quantité de ressource initiale") --
    // remplace l'ancien amountMin/amountMax (tirage aléatoire par case). Valeurs (demande
    // utilisateur explicite ultérieure : "70 dans le bois et la pierre, 30 dans les montagnes").
    tree: { color: 0x1f6b3a, amount: 70 },
    stone: { color: 0x767a80, amount: 70 },
    // Nouvelle ressource (demande utilisateur explicite) : blobs à l'origine deux fois moins
    // nombreux que la pierre (blobCountMountain = blobCountStone/2, voir plus bas) et 1.5x plus de
    // ressource par case (base = stone.amount). Extraite par le Mineur de Fer (voir
    // buildings.ironMiner, demande utilisateur explicite ultérieure), le SEUL extracteur du jeu
    // qui se construit DIRECTEMENT sur sa case de ressource plutôt qu'à côté (voir
    // GameState.placeBuilding/GameScene.isValidBuildSpot, ironMinerClearsResource) -- compact: true
    // (voir GameState._growBlob) : forme plus ronde/dense qu'un blob normal. sizeMin/sizeMax
    // (demande utilisateur explicite ultérieure, "3 fois plus gros mais 2 fois plus rare") : 3x
    // blobSizeMin/blobSizeMax (4-9) plutôt que ces valeurs partagées avec tree/stone -- voir aussi
    // blobCountMountain, divisé par 2 en même temps (20 -> 10).
    mountain: { color: 0x4a4e58, amount: 30, compact: true, sizeMin: 12, sizeMax: 27 },
    // Le blé n'apparaît pas en blobs au démarrage : ce sont les Fermes qui le plantent
    // elles-mêmes autour d'elles (voir buildings.farm.plants). amount sert quand même au calcul
    // de l'opacité (case bien mûre vs. presque récoltée).
    wheat: { color: 0xdbc245, amount: 8 },
    // Cadavre de monstre (voir buildings.recycler/demande utilisateur) : amount toujours 10 --
    // pas la vraie quantité de Gemme versée (1, ou 2 avec Imprimerie, voir tickProduction), juste
    // ce qui permet à la case de décroître visiblement 10 -> 0 pendant la
    // récolte au lieu de rester bloquée à "0 restant" tout du long (bug corrigé, demande
    // utilisateur explicite : avec amount=1, Math.round() affichait 0 dès les tout premiers % du
    // chantier, bien avant que le cadavre ne soit réellement épuisé -- trompeur).
    // edgeRowMargin (demande utilisateur explicite) : aucun cadavre posé à la génération du monde
    // dans les 5 premières/dernières rangées (voir GameState._spawnSingleTiles) -- ne concerne
    // QUE cette génération de départ, pas ceux laissés par un monstre tué (_maybeDropCorpse).
    corpse: { color: 0x6b1f3a, amount: 10, edgeRowMargin: 5 },
    blobCountTree: 60,
    blobCountStone: 40,
    // Moitié du nombre de blobs de pierre (demande utilisateur explicite : "2 fois moins nombreux").
    blobCountMountain: 10,
    blobSizeMin: 4,
    blobSizeMax: 9,
    // Aucun blob ne peut apparaître à moins de cette distance (en colonnes) de l'Entrepôt de départ.
    startClearance: 4,
    // Anti-softlock (voir GameState._ensureStartingVisibility) : rayon (en cases, pas en colonnes,
    // contrairement à startClearance ci-dessus) dans lequel chaque ressource en blob doit avoir au
    // moins une case garantie autour de l'Entrepôt de départ -- valeur FIXE demandée explicitement
    // par l'utilisateur (initialement "10 cases", resserré ensuite à "8 cases"), indépendante de
    // warehouseZoneRadius() (portée réelle du jeu, qui grandit avec la techno Aménagement urbain --
    // ce filet de sécurité ne doit pas en dépendre).
    startingVisibilityRadius: 8,
    // Cadavre de monstre : PAS un blob (voir _spawnSingleTiles) -- une case isolée et rare,
    // dispersée sur toute la carte. Densité de base ~1 par écran plein à dézoom maximum (le
    // monde montre toujours ses 45 rangées en hauteur, voir GameScene.getEffectiveZoomMin ; sur
    // un écran 16:9 typique ça correspond à environ 45 colonnes visibles, 200/45 ≈ 4,4), doublée
    // (demande utilisateur explicite) -- mis à l'échelle avec world.cols comme les blobs ci-dessus.
    corpseCount: 9,
  },
  // Regroupe les bâtiments par onglet dans le menu de construction (voir GameScene.layoutHud/
  // activeBuildCategory) : la liste à plat est devenue trop longue pour tenir sans scroller une
  // fois la Tour de Guet ajoutée (voir demande utilisateur). L'ordre des clés = l'ordre des
  // onglets ; l'ordre de "ids" = l'ordre dans la liste de cet onglet. Château n'y figure pas : il
  // ne se construit pas depuis ce menu (voir buildings.castle). Pas d'onglet "Route" (supprimé,
  // demande utilisateur explicite : il ne contenait QUE elle) -- 'road' est injecté directement
  // dans la liste de boutons quel que soit l'onglet actif, voir GameScene.layoutHud/buttonIds.
  // Ordre de "ids" pour production (demande utilisateur explicite, disposition en paires
  // extracteur+transformateur : bûcheron/scierie, mineur de pierre/tailleur, ferme/boulangerie,
  // mineur de fer/fonderie) -- doit rester synchronisé avec l'ordre correspondant dans
  // GameScene.buildHud (buildIds), qui est ce qui pilote VRAIMENT l'ordre d'affichage (voir
  // GameScene.layoutHud/buttonIds, qui filtre Object.keys(this.buildButtons), PAS ce tableau ids
  // directement) -- ids ici ne sert qu'à déterminer QUELS boutons apparaissent dans cet onglet.
  buildingCategories: {
    production: { label: 'Production', ids: ['lumberjackCamp', 'sawmill', 'minerCamp', 'stonecutter', 'farm', 'bakery', 'ironMiner', 'foundry'] },
    // temple/sculpteur/altar ajoutés (demande utilisateur explicite).
    civil: { label: 'Civil', ids: ['warehouse', 'university', 'house', 'temple', 'altar', 'sculpteur'] },
    // Renommé Défense -> Militaire (demande utilisateur explicite) en même temps que Recycleur y
    // est déplacé depuis Production (n'a pas vraiment sa place dans les paires
    // extracteur/transformateur ci-dessus, voir la demande utilisateur : "deplace le dans la
    // colonne militaire"). armurier ajouté (demande utilisateur explicite ultérieure).
    defense: { label: 'Militaire', ids: ['donjon', 'watchtower', 'recycler', 'armurier'] },
  },
  // Chaque bâtiment producteur a son propre stock local (inputBuffer/outputBuffer), pas un
  // pool global : les ressources doivent être physiquement acheminées d'un bâtiment à l'autre.
  // kind: 'extractor' récolte une ressource de terrain (tree/stone) dans extractRadius autour de lui
  //   et stocke le résultat dans son outputBuffer (jusqu'à outputCap).
  // kind: 'processor' transforme inputBuffer en outputBuffer au rythme de "rate"/s (jusqu'à outputCap).
  // linkTargets/linkRange : quand l'outputBuffer n'est pas vide, le bâtiment cherche le plus proche
  //   bâtiment d'un type de linkTargets, à au plus linkRange cases par la route/le réseau bâti, et
  //   lui expédie un chargement (visible en train de voyager sur la route).
  // Coûts pensés par thème : les routes se pavent de pierre, les bâtiments se charpentent
  // surtout en bois, et seul l'Entrepôt (la structure la plus importante) demande les deux.
  // Bâtiments de PRODUCTION (voir buildingCategories.production) : 25 % de leur coût en planches
  // d'origine transféré vers un coût en pierre taillée (demande utilisateur explicite) --
  // arrondi à l'entier le plus proche par bâtiment, pas une simple règle de trois globale.
  buildings: {
    road: { name: 'Route', cost: { stoneBlocks: 1 }, color: 0x8a8a8a, ruinLoot: { stoneBlocks: 1 } },
    lumberjackCamp: {
      // 25 % de 6 planches (~1,5, arrondi à 2) transféré en pierre taillée.
      name: 'Camp de Bûcheron', cost: { planks: 4, stoneBlocks: 2 }, color: 0x8b5a2b,
      kind: 'extractor', resource: 'tree', outputResource: 'wood',
      extractRadius: 2, extractRate: 0.5, outputCap: 20,
      // 'armurier' ajouté (demande utilisateur explicite) : l'Armurier consomme du bois BRUT, pas
      // des planches -- livré directement comme la Scierie, pas via l'Entrepôt.
      linkTargets: ['sawmill', 'armurier'], linkRange: 6,
      ruinLoot: { planks: 3 },
    },
    sawmill: {
      // 25 % de 10 planches (2,5, arrondi à 3) transféré en pierre taillée.
      name: 'Scierie', cost: { planks: 7, stoneBlocks: 3 }, color: 0xc9974f,
      kind: 'processor', inputResource: 'wood', outputResource: 'planks', rate: 1.5,
      inputCap: 15, outputCap: 15,
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    minerCamp: {
      // 25 % de 6 planches (~1,5, arrondi à 2) transféré en pierre taillée.
      name: 'Camp de Mineur', cost: { planks: 4, stoneBlocks: 2 }, color: 0x5a5a70,
      kind: 'extractor', resource: 'stone', outputResource: 'stone',
      extractRadius: 2, extractRate: 0.5, outputCap: 20,
      // 'sculpteur' ajouté (demande utilisateur explicite) : le Sculpteur consomme de la pierre
      // BRUTE, pas de la pierre taillée -- livré directement comme le Tailleur, pas via l'Entrepôt.
      linkTargets: ['stonecutter', 'sculpteur'], linkRange: 6,
      ruinLoot: { planks: 3 },
    },
    stonecutter: {
      // 25 % de 10 planches (2,5, arrondi à 3) transféré en pierre taillée.
      name: 'Tailleur de pierre', cost: { planks: 7, stoneBlocks: 3 }, color: 0xb0b0b0,
      kind: 'processor', inputResource: 'stone', outputResource: 'stoneBlocks', rate: 1.5,
      inputCap: 15, outputCap: 15,
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    // Sculpteur (demande utilisateur explicite, catégorie Civil) : même principe que l'Armurier
    // (voir plus haut, deux ressources en entrée) -- pierre BRUTE livrée directement par un Camp de
    // Mineur (voir buildings.minerCamp.linkTargets), lingot de fer livré depuis le stock central
    // d'un Entrepôt (voir GameState._spawnWarehouseIronIngot). Recette 1:1:1.
    sculpteur: {
      name: 'Sculpteur', cost: { planks: 7, stoneBlocks: 3 }, color: 0x8a8578,
      kind: 'processor', inputResources: ['stone', 'ironIngot'], outputResource: 'statues', rate: 1.2,
      inputCap: 15, outputCap: 15,
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    warehouse: {
      // Coût réduit (demande utilisateur explicite : "10 de bois et 5 de pierre") depuis 15/8.
      name: 'Entrepôt', cost: { planks: 10, stoneBlocks: 5 }, color: 0xffd23f,
      ruinLoot: { planks: 8, stoneBlocks: 4 },
    },
    // Nouvelle chaîne du fer (demande utilisateur explicite). Seul extracteur du jeu construit
    // DIRECTEMENT sur sa case de ressource (une case de montagne, voir resourceNodes.mountain) au
    // lieu d'à côté -- voir GameState.placeBuilding/GameScene.isValidBuildSpot
    // (ironMinerClearsResource) : comme une Route sur du bois/blé, poser un Mineur de Fer efface la
    // ressource sous lui (sinon invisible, voir redrawTileArt qui dessine la case ressource PAR-
    // DESSUS tout bâtiment qui partagerait sa case et `continue` avant de dessiner celui-ci) --
    // extractRadius continue ensuite de puiser dans les cases de montagne voisines, comme le Camp
    // de Mineur sur la pierre, mais sur un rayon plus large (voir plus bas).
    ironMiner: {
      // 25 % de 6 planches (~1,5, arrondi à 2) transféré en pierre taillée.
      name: 'Mineur de Fer', cost: { planks: 4, stoneBlocks: 2 }, color: 0x707c8a,
      kind: 'extractor', resource: 'mountain', outputResource: 'ore',
      // extractRadius 2 -> 4 (demande utilisateur explicite : "augmente la zone d'action des
      // mines à 4 cases", précisé ensuite : SEULEMENT le Mineur de Fer, le Camp de Mineur -- sur
      // la pierre -- reste à 2).
      extractRadius: 4, extractRate: 0.5, outputCap: 20,
      linkTargets: ['foundry'], linkRange: 6,
      ruinLoot: { planks: 3 },
    },
    foundry: {
      // 25 % de 10 planches (2,5, arrondi à 3) transféré en pierre taillée.
      name: 'Fonderie', cost: { planks: 7, stoneBlocks: 3 }, color: 0x8a4a35,
      kind: 'processor', inputResource: 'ore', outputResource: 'ironIngot', rate: 1.5,
      inputCap: 15, outputCap: 15,
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    // Armurier (demande utilisateur explicite, catégorie Militaire) : PREMIER processeur du jeu à
    // deux ressources en entrée (voir inputResources -- pas juste inputResource comme les autres
    // processeurs, un seul suffisait jusqu'ici). Bois brut livré DIRECTEMENT par un Camp de
    // Bûcheron (voir buildings.lumberjackCamp.linkTargets), lingot de fer livré depuis le stock
    // central d'un Entrepôt (voir GameState._spawnWarehouseIronIngot -- PAS directement depuis une
    // Fonderie : le lingot de fer reste centralisé à l'Entrepôt, demande utilisateur explicite
    // d'une session précédente, "le fer est stocké dans les entrepots comme les autres
    // ressources"). Recette 1:1:1 (voir GameState.tickProduction section 2, boucle sur
    // inputResources) : 1 bois + 1 lingot -> 1 arme.
    armurier: {
      name: 'Armurier', cost: { planks: 7, stoneBlocks: 3 }, color: 0x5a4238,
      kind: 'processor', inputResources: ['wood', 'ironIngot'], outputResource: 'weapons', rate: 1.2,
      inputCap: 15, outputCap: 15,
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    // plants: true => en plus de récolter comme un extracteur classique, ce bâtiment crée
    // lui-même de nouvelles cases de sa ressource dans son rayon (voir GameState.tickProduction) :
    // au lieu d'épuiser des cases naturelles existantes, il cultive et récolte en boucle continue.
    // Rythme choisi pour qu'à efficacité "de base" (50 %, sans aucun travailleur affecté — voir
    // population.efficiencyByWorkers), 2 Fermes suffisent tout juste à alimenter 1 Boulangerie à
    // plein régime (2 * 1,2 * 0,5 = 1,2 = bakery.rate * 0,5), qui elle-même nourrit exactement 2
    // Maisons pleines (1,2 pain/s = 2 * 4 hab. * 0,15, voir house.consumptionPerPerson) — demande
    // utilisateur : la chaîne alimentaire ne doit plus dévorer la main-d'œuvre qu'elle nourrit.
    farm: {
      // 25 % de 6 planches (~1,5, arrondi à 2) transféré en pierre taillée.
      name: 'Ferme', cost: { planks: 4, stoneBlocks: 2 }, color: 0xd4b106,
      kind: 'extractor', resource: 'wheat', outputResource: 'wheat',
      extractRadius: 2, extractRate: 1.2, outputCap: 15,
      plants: true, plantInterval: 4, maxPatches: 5, patchAmount: 8,
      linkTargets: ['bakery'], linkRange: 6,
      ruinLoot: { planks: 3 },
    },
    bakery: {
      // 25 % de 10 planches (2,5, arrondi à 3) transféré en pierre taillée.
      name: 'Boulangerie', cost: { planks: 7, stoneBlocks: 3 }, color: 0xdda15e,
      kind: 'processor', inputResource: 'wheat', outputResource: 'bread', rate: 2.4,
      inputCap: 15, outputCap: 15,
      // Le pain part TOUJOURS vers l'Entrepôt, jamais directement vers une Maison : le cycle voulu
      // est Boulangerie -> Entrepôt -> Maison en deux temps (voir GameState._spawnWarehouseBread
      // pour le second segment, Entrepôt -> Maison, qui puise dans le stock central).
      linkTargets: ['warehouse'], linkRange: 6,
      ruinLoot: { planks: 5 },
    },
    // Récolte les cadavres de monstre (voir resourceNodes.corpse/demande utilisateur), rares et
    // dispersés sur la carte plutôt qu'en blobs. Un extracteur classique (même mécanique que
    // Camp de Bûcheron/Mineur, voir tickProduction), MAIS sans linkTargets ni outputBuffer : la
    // Gemme (renommée depuis Codex, demande utilisateur explicite -- voir resourceLabels.gemme) ne
    // se transporte jamais sur les routes -- dès qu'une case de cadavre est entièrement épuisée, 1
    // Gemme est versée d'un coup au stock central (2 avec une chance liée à Imprimerie, voir
    // techTree.nodes.rec_imprimerie), cas spécial dans tickProduction juste après celui du
    // Tunnelier/minerai. extractRate = 10/60 : un cadavre (resourceNodes.corpse.amount = 10, voir
    // plus haut -- juste pour un affichage "10 restant" -> "0" lisible pendant la récolte, PAS la
    // vraie quantité de Gemme) prend environ 1 minute à recycler à pleine main-d'œuvre.
    recycler: {
      // 25 % de 3 planches (0,75, arrondi à 1) transféré en pierre taillée, en plus de son coût
      // en pierre taillée déjà existant. Nom "Recycleur de gemmes" (demande utilisateur explicite,
      // suite au renommage Codex -> Gemme).
      name: 'Recycleur de gemmes', cost: { planks: 2, stoneBlocks: 4 }, color: 0x6b1f3a,
      kind: 'extractor', resource: 'corpse', outputResource: 'gemme',
      extractRadius: 3, extractRate: 10 / 60, outputCap: 3,
      // PAS de main-d'œuvre (voir allocateLabor/tickProduction, cas spécial "recycler") :
      // toujours à pleine efficacité, sans dépendre d'habitants à proximité -- ce bâtiment se
      // pose près d'un cadavre isolé, souvent loin de toute Maison (voir demande utilisateur :
      // "il n'y a pas de main d'œuvre pour les recycleurs").
      ruinLoot: { planks: 2 },
    },
    // kind: 'house' => héberge des habitants (jusqu'à populationCap) qui consomment du pain
    // livré ici (inputBuffer, comme un processeur). Toutes les growthInterval secondes : si le
    // pain a suffi tout du long, la population augmente d'un ; sinon elle baisse (1 minimum).
    // C'est cette population, à portée des bâtiments de production (voir population.laborRadius),
    // qui leur permet de tourner à plein rendement plutôt qu'à 50 %.
    // growthInterval = 2.5s (demande utilisateur explicite : détection de croissance/décroissance
    // divisée par 2 -- l'ancienne valeur était 6s -- ET une Maison à 0 habitant nourrie EN
    // CONTINU doit être pleine en 10s maximum. Comme un habitant s'ajoute par intervalle complet
    // (voir GameState.tickProduction, section 2.5), remplir populationCap=4 habitants prend
    // 4 × growthInterval : 2.5s est la valeur exacte qui donne 10s pile pour les 4, plus stricte
    // qu'une simple moitié de 6 (3s, qui aurait donné 12s -- au-dessus de la limite demandée).
    house: {
      name: 'Maison', cost: { planks: 8 }, color: 0xaf6f4d,
      kind: 'house', inputResource: 'bread', inputCap: 8,
      populationCap: 4, startPopulation: 1,
      consumptionPerPerson: 0.15, growthInterval: 2.5,
      ruinLoot: { planks: 4 },
    },
    // Autel (demande utilisateur explicite, catégorie Civil) : bâtiment purement passif, sans
    // kind -- ne produit/ne consomme rien lui-même, ne reçoit jamais de main-d'œuvre (voir
    // GameState.allocateLabor, qui ne s'applique qu'aux kind extractor/processor/tower). Compté
    // par chaque Temple à portée (voir buildings.temple ci-dessous), c'est tout son rôle.
    altar: {
      // Coût en Statues (demande utilisateur explicite), pas planches/pierre comme les autres
      // bâtiments -- livré/déduit exactement comme n'importe quelle ressource (voir
      // _spawnWarehouseConstructionDeliveries, générique sur tile.constructionNeeded).
      name: 'Autel', cost: { statues: 10 }, color: 0xc9b896,
      ruinLoot: { planks: 2 },
    },
    // Temple (demande utilisateur explicite, catégorie Civil) : NOUVEAU kind 'shrine', différent
    // d'un extracteur (aucune ressource de terrain à épuiser) -- produit de la Dévotion en continu,
    // proportionnellement au nombre d'Autels dans son extractRadius (voir GameState.tickProduction,
    // section "Temple" ; devotionPerAltar = Dévotion/s PAR Autel à pleine efficacité). Versée
    // directement au stock central, jamais transportée sur les routes -- même principe que la
    // Gemme du Recycleur de gemmes. Main-d'œuvre normale (contrairement au Recycleur, pas de raison
    // particulière de l'exempter ici) : voir GameState.allocateLabor/zoneRadiusFor, kind 'shrine'
    // ajouté aux deux à côté d'extractor/processor/tower.
    temple: {
      // Coût précisé par l'utilisateur (planches/pierre/fer/statues, pas juste planches/pierre
      // comme les autres bâtiments).
      name: 'Temple', cost: { planks: 5, stoneBlocks: 5, ironIngot: 5, statues: 20 }, color: 0xd4af6a,
      // extractRadius 10 -> 3 (demande utilisateur explicite, après calcul théorique du nombre
      // d'Autels que ça permet -- voir échanges précédents : 37 cases dans ce rayon, 36 Autels
      // possibles au maximum). devotionPerAltar : 0,5 %/5s par Autel = 0,1 %/s (demande utilisateur
      // explicite -- le Temple lui-même ne produit plus rien, voir GameConfig.devotion).
      kind: 'shrine', extractRadius: 3, devotionPerAltar: 0.1,
      ruinLoot: { planks: 8 },
    },
    // kind: 'tower' => tire sur un monstre à portée (range, cases) toutes les fireInterval
    // secondes à pleine main-d'œuvre (même système que les extracteurs/processeurs : un
    // travailleur affecté = plein régime, sinon le délai entre deux tirs double). N'est actif
    // que s'il touche une route (voir GameState._hasAdjacentRoad) : un Donjon posé isolé ne
    // tire pas, il faut le relier au réseau.
    donjon: {
      // Coût divisé par 2 (demande utilisateur explicite) par rapport à l'original (planks: 20,
      // stoneBlocks: 15) : moitié de 15 arrondie à 8 pour un chiffre entier propre plutôt que 7.5.
      name: 'Donjon', cost: { planks: 10, stoneBlocks: 8 }, color: 0x5a2a3a,
      // Portée (aussi la zone d'action/de révélation du brouillard de guerre, voir
      // GameState.zoneRadiusFor) passée de 4 à 7 cases -- demande utilisateur explicite.
      kind: 'tower', range: 7, fireInterval: 2, damage: 1,
      ruinLoot: { planks: 10, stoneBlocks: 6 },
    },
    // kind: 'watchtower' => aucune action (pas de tir, pas de production), juste une zone de
    // révélation du brouillard de guerre plus grande que la normale (voir zoneRadiusFor) : une
    // tour de guet sert à repérer au loin, pas à combattre. Débloquée par la techno Explorateur
    // (voir techTree.nodes.def_explorateur) -- absente du menu de construction tant qu'elle n'est
    // pas débloquée (voir GameScene.isBuildingUnlocked).
    watchtower: {
      name: 'Tour de Guet', cost: { planks: 6 }, color: 0x6b7a8f,
      kind: 'watchtower', range: 10,
      ruinLoot: { planks: 3 },
    },
    // Pas dans le menu de construction : n'existe que comme amélioration d'un Donjon déjà posé
    // (voir GameState.upgradeToCastle), débloquée par la techno Forgerie (voir techTree.nodes.
    // def_forgerie). "cost" sert de coût d'amélioration (payé au moment de la transformation),
    // pas de coût de construction initiale -- même kind: 'tower' que le Donjon, donc traité
    // automatiquement par tout le code déjà écrit pour les tours (tir, main-d'œuvre, portée...).
    castle: {
      name: 'Château', cost: { planks: 25, stoneBlocks: 20 }, color: 0x3a2a4a,
      kind: 'tower', range: 6, fireInterval: 1.2, damage: 3,
      // Accueille 2x plus de travailleurs qu'un Donjon (8 au lieu de 4) -- voir GameState.
      // efficiencyForWorkers, seul bâtiment dont l'efficacité peut dépasser 100 % (demande
      // utilisateur explicite). Les 4 premiers travailleurs comptent comme pour un Donjon normal
      // (0 -> 50 %, ..., 4 -> 100 %) ; les 4 suivants ajoutent le même gain marginal une seconde
      // fois (5e travailleur = même gain que le 1er, etc.), jusqu'à 150 % à 8 travailleurs -- pas
      // un simple x2 (qui aurait aussi doublé le socle de 50 % à 0 travailleur, absurde).
      capMultiplier: 2,
      ruinLoot: { planks: 15, stoneBlocks: 10 },
    },
    // kind: 'university' => pas de zone d'action, ne reçoit/n'expédie aucune ressource (pas de
    // outputBuffer/inputBuffer, pas de linkTargets). Un clic dessus ouvre l'arbre technologique
    // (voir GameScene.openTechTree) plutôt que d'afficher un panneau d'info classique. N'est
    // utilisable que si reliée à une route (même vérification que le Donjon).
    university: {
      name: 'Université', cost: { planks: 15, stoneBlocks: 10 }, color: 0x2f4d63,
      kind: 'university',
      ruinLoot: { planks: 8, stoneBlocks: 5 },
    },
  },
  // Arbre technologique : 5 branches indépendantes (pas de nœud central commun — chacune part
  // directement du milieu du diagramme, voir GameScene.positionTechTreeNodes) disposées en éventail
  // (angle de base espacé de 360/5 degrés), chacune une chaîne linéaire qui se termine en 2-3
  // choix parallèles (angle de base ± un petit écart, voir GameScene.updateTechTreeBubble pour le
  // rayon/angle -> position). Pour l'instant de simples emplacements gratuits et sans effet (voir
  // GameState.unlockTech) — seul le mécanisme de déblocage (un nœud n'est débloquable que si son
  // parent l'est déjà, ou n'a pas de parent) et l'affichage radial sont testés.
  techTree: {
    nodeRadius: 22,
    // Espacement FIXE entre deux anneaux (pas recalculé selon la taille du panneau) : sur un
    // écran de téléphone en paysage (peu de hauteur disponible), essayer de tout faire tenir
    // écrasait les nœuds les uns sur les autres. Avec un espacement fixe assez généreux pour ne
    // jamais faire se toucher les nœuds, le diagramme peut dépasser la zone visible — on peut
    // alors le faire glisser (voir GameScene.techTreeCamX/Y) pour voir le reste.
    ringSpacing: 70,
    // Coût FIXE d'une recherche (demande utilisateur explicite : "tout les couts sois les memes, 1
    // codex", "codex" renommé "gemme" ensuite -- voir resourceLabels.gemme) -- identique pour tous
    // les nœuds ET tous les niveaux (plus de montée en 1x/2x/3x par niveau comme avant), avant la
    // réduction de Scolarisation (voir GameState.researchCostFor/techTree.nodes.rec_scolarisation).
    // Note : à 1 Gemme, Math.round() ramène systématiquement la réduction de Scolarisation à 1
    // Gemme quand même (0,7 à 0,9 arrondit à 1) -- Scolarisation n'a donc plus d'effet visible tant
    // que ce coût de base reste à 1 (première étape d'un rééquilibrage annoncé par l'utilisateur,
    // pas encore traité ici).
    researchCost: { gemme: 1 },
    nodes: {
      // Population (branche à 0°) : nutrition -> urbanisme -> {immigration, mariage, colocation}.
      // Nœuds à plusieurs niveaux (maxLevel > 1) : cliquables plusieurs fois, un niveau par clic sur
      // "Rechercher" (voir GameState.researchTech). Débloquer le NIVEAU 1 suffit à déverrouiller les
      // enfants — les niveaux suivants n'ouvrent rien de plus dans l'arbre, ils renforcent juste l'effet.
      pop_nutrition: {
        name: 'Nutrition', parent: null, ring: 1, angle: 0, maxLevel: 3,
        description: 'Réduit les besoins en pain de la population de 10 % / 20 % / 30 %.',
        breadReductionByLevel: [0.10, 0.20, 0.30],
      },
      pop_urbanisme: {
        name: 'Urbanisme', parent: 'pop_nutrition', ring: 2, angle: 0,
        description: 'Les maisons gardent toujours au moins 1 habitant, même en cas de famine prolongée.',
      },
      pop_immigration: {
        name: 'Immigration', parent: 'pop_urbanisme', ring: 3, angle: -25, maxLevel: 3,
        description: 'La population croît 50 % / 75 % / 100 % plus vite (le déclin garde sa vitesse normale).',
        growthBonusByLevel: [0.50, 0.75, 1.00],
      },
      pop_mariage: {
        name: 'Mariage', parent: 'pop_urbanisme', ring: 3, angle: 0,
        description: 'Le temps nécessaire pour accueillir un nouvel habitant diminue de 5 % par habitant déjà présent.',
        growthDiscountPerCapita: 0.05,
      },
      pop_colocation: {
        name: 'Colocation', parent: 'pop_urbanisme', ring: 3, angle: 25, maxLevel: 2,
        description: 'Augmente la capacité des maisons de 1 / 2 habitant(s).',
        extraCapByLevel: [1, 2],
      },

      // Industrie (branche à 72°) : apprentissage -> expertise -> guilde -> {forestier, tunnelier, labourage}.
      ind_apprentissage: {
        name: 'Apprentissage', parent: null, ring: 1, angle: 72,
        description: 'Chaque bâtiment de raffinage (Scierie, Tailleur de pierre, Boulangerie) gagne 1 ouvrier gratuit, en plus de la main-d\'œuvre affectée.',
      },
      ind_expertise: {
        name: 'Expertise', parent: 'ind_apprentissage', ring: 2, angle: 72, maxLevel: 3,
        description: 'Les bâtiments de production fonctionnent 10 % / 20 % / 30 % plus vite.',
        speedBonusByLevel: [0.10, 0.20, 0.30],
      },
      ind_guilde: {
        name: 'Guilde', parent: 'ind_expertise', ring: 3, angle: 72, maxLevel: 3,
        description: 'Les Entrepôts augmentent de 5 % / 10 % / 15 % la production des bâtiments dans leur rayon d\'action.',
        productionBonusByLevel: [0.05, 0.10, 0.15],
      },
      ind_forestier: {
        name: 'Forestier', parent: 'ind_guilde', ring: 4, angle: 47,
        description: 'Les Camps de Bûcheron replantent du bois sur une autre case, au rythme même où ils l\'abattent.',
      },
      ind_tunnelier: {
        name: 'Tunnelier', parent: 'ind_guilde', ring: 4, angle: 72,
        description: 'Les Camps de Mineur ont 10 % de chances de produire aussi du minerai, en plus de la pierre.',
        oreChance: 0.10,
      },
      ind_labourage: {
        name: 'Labourage', parent: 'ind_guilde', ring: 4, angle: 97,
        description: 'Les champs de blé de la Ferme sont créés 50 % plus vite.',
        plantSpeedBonus: 0.50,
      },

      // Recherche (branche à 144°) : alphabétisation -> scolarisation -> {formateur, imprimerie}.
      rec_alphabetisation: {
        name: 'Alphabétisation', parent: null, ring: 1, angle: 144, maxLevel: 3,
        description: 'Tous les bâtiments (production ET tours) sont 5 % / 10 % / 15 % plus efficaces.',
        efficiencyBonusByLevel: [0.05, 0.10, 0.15],
      },
      rec_scolarisation: {
        name: 'Scolarisation', parent: 'rec_alphabetisation', ring: 2, angle: 144, maxLevel: 3,
        description: 'Réduit de 10 % / 20 % / 30 % le coût en Gemmes de toute recherche (celle-ci comprise).',
        costReductionByLevel: [0.10, 0.20, 0.30],
      },
      rec_formateur: {
        name: 'Formateur', parent: 'rec_scolarisation', ring: 3, angle: 126,
        description: 'Les bâtiments de production dans la zone d\'action de l\'Université sont 15 % plus efficaces.',
        zoneBonus: 0.15,
      },
      rec_imprimerie: {
        name: 'Imprimerie', parent: 'rec_scolarisation', ring: 3, angle: 162,
        // Voir GameState.tickProduction (section 1, cas spécial "recycler") : un cadavre recyclé
        // donne normalement 1 Gemme d'un coup (renommée depuis Codex, demande utilisateur explicite,
        // et réduite de 10 à 1 en même temps) ; avec cette techno, une chance de DOUBLER ce gain
        // (2 au lieu de 1) -- pas un simple +1 fixe.
        description: 'Lors du recyclage d\'un cadavre de monstre (voir buildings.recycler), 10 % de chances de doubler la Gemme obtenue (2 au lieu de 1).',
        gemmeChance: 0.10,
      },

      // Logistique (branche à 216°) : roue -> caisse de transport -> {aménagement urbain, gestion
      // des stocks, centre-ville}. Les bonus par niveau (zone/capacité) ne sont PAS cumulatifs
      // d'un niveau à l'autre (voir demande utilisateur) : le niveau 3 remplace le niveau 2, il ne
      // s'y ajoute pas -- valable pour toute la branche Logistique, contrairement à Expertise/
      // Guilde/Alphabétisation (Industrie/Recherche) qui, elles, s'additionnent à d'autres bonus.
      log_roue: {
        name: 'Roue', parent: null, ring: 1, angle: 216, maxLevel: 3,
        description: 'Augmente la vitesse de transport de 5 % / 10 % / 15 %.',
        speedBonusByLevel: [0.05, 0.10, 0.15],
      },
      log_charrue: {
        name: 'Caisse de transport', parent: 'log_roue', ring: 2, angle: 216,
        description: '5 % de chances d\'obtenir une unité de ressource supplémentaire à chaque livraison (arrivée d\'un chargement).',
        bonusChance: 0.05,
      },
      log_amenagement: {
        name: 'Aménagement urbain', parent: 'log_charrue', ring: 3, angle: 191, maxLevel: 3,
        description: 'Augmente la zone d\'action des Entrepôts de 2 / 4 / 6 cases (pas cumulatif : le niveau 3 vaut 6 cases, pas 12).',
        zoneBonusByLevel: [2, 4, 6],
      },
      log_gestionStocks: {
        name: 'Gestion des stocks', parent: 'log_charrue', ring: 3, angle: 216, maxLevel: 3,
        description: 'Augmente la capacité de stockage de chaque bâtiment de 5 / 10 / 20 (pas cumulatif).',
        capBonusByLevel: [5, 10, 20],
      },
      // Nom provisoire : effet de la 3e branche de Logistique pas encore défini par le joueur.
      log_tbd: { name: 'Centre-ville', parent: 'log_charrue', ring: 3, angle: 241, description: 'Technologie à définir plus tard.' },

      // Défense (branche à 288°) : explorateur -> artilleur -> {armée de profession, service
      // militaire, forgerie}. def_donjon garde son id (débloqué par des parties déjà en cours)
      // même si son nom affiché change en "Artilleur".
      def_explorateur: {
        name: 'Explorateur', parent: null, ring: 1, angle: 288,
        description: 'Permet de construire des Tours de Guet.',
      },
      def_donjon: {
        name: 'Artilleur', parent: 'def_explorateur', ring: 2, angle: 288, maxLevel: 3,
        description: 'Augmente la portée du Donjon (et du Château) de 1 / 2 / 3 cases (pas cumulatif).',
        rangeBonusByLevel: [1, 2, 3],
      },
      def_armee: {
        name: 'Armée de profession', parent: 'def_donjon', ring: 3, angle: 263, maxLevel: 3,
        description: 'Augmente les dégâts du Donjon (et du Château) de 25 % / 50 % / 100 % (pas cumulatif).',
        damageBonusByLevel: [0.25, 0.50, 1.00],
      },
      def_service: {
        name: 'Service militaire', parent: 'def_donjon', ring: 3, angle: 288,
        description: 'Chaque Donjon (et Château) a toujours 1 habitant à l\'intérieur, en plus de la main-d\'œuvre affectée (même principe qu\'Apprentissage).',
      },
      def_forgerie: {
        name: 'Forgerie', parent: 'def_donjon', ring: 3, angle: 313,
        description: 'Permet d\'améliorer un Donjon en Château.',
      },
    },
  },
  // Main-d'œuvre : chaque habitant d'une Maison ne peut occuper qu'UN SEUL poste à la fois dans un
  // bâtiment de production (extracteur ou processeur) à laborRadius cases (distance à vol d'oiseau -
  // c'est la zone visualisée en jeu). L'affectation (GameState.allocateLabor) répartit les habitants
  // disponibles en priorisant d'abord les bâtiments avec le moins de travailleurs déjà affectés, puis
  // en cas d'égalité les plus proches PAR LA ROUTE (chemin réel à travers routes/bâtiments, pas à vol
  // d'oiseau). Le taux d'extraction/traitement dépend ensuite du nombre de travailleurs affectés à
  // CE bâtiment précis (voir GameState.efficiencyForWorkers) : pas de tout-ou-rien, une courbe.
  population: {
    laborRadius: 5,
    // Distance maximale (en pas) explorée par la route pour départager deux bâtiments à égalité de
    // travailleurs ; volontairement plus grande que laborRadius car un chemin pavé peut serpenter.
    laborRoadSearchRange: 18,
    // Efficacité selon le nombre de travailleurs affectés à un bâtiment : index 0 = 0 travailleur,
    // index 1 = 1 travailleur, etc. Au-delà du dernier index (4 travailleurs), l'efficacité reste
    // à 100 % (voir GameState.efficiencyForWorkers, qui borne l'index). Utilisée par les
    // tours (Donjon/Château) -- voir efficiencyByWorkersProduction ci-dessous pour les bâtiments
    // de la catégorie Production (extracteurs ET processeurs).
    efficiencyByWorkers: [0.5, 0.65, 0.8, 0.9, 1],
    // Même principe, mais pour TOUS les bâtiments de la catégorie Production (voir
    // buildingCategories.production : extracteurs ET processeurs de raffinage -- Camp de
    // Bûcheron/Mineur, Ferme, Scierie, Tailleur de pierre, Boulangerie ; PAS le Recycleur, qui
    // n'a pas de main-d'œuvre du tout) : 100 % atteint à 3 travailleurs au lieu de 4 (demande
    // utilisateur explicite). Courbe à progression décroissante analogue, recalée sur 3 paliers.
    efficiencyByWorkersProduction: [0.5, 0.7, 0.85, 1],
  },
  // La horde de monstres : un bloc dense de petits monstres individuels (carrés, voir
  // GameScene.drawMonster) qui avancent chacun en ligne droite, à vitesse constante, sans
  // contourner aucun obstacle ni suivre la grille hexagonale — ils traversent (et détruisent)
  // tout ce qui se trouve sur leur passage. Aucune interaction du joueur avec eux pour l'instant
  // (pas d'attaque) : la seule chose qui compte est "un monstre qui passe sur une case la détruit".
  monsters: {
    // Vitesse PROGRESSIVE (voir demande utilisateur) : le 1er tour complet du cylindre dure
    // lapOneSeconds, à un rythme constant de world.cols / lapOneSeconds colonnes/s (voir
    // Monsters.update : speedCols = cols/lapOneSeconds au 1er tour). x2 (demande utilisateur
    // explicite : "divise par 2 la vitesse de la horde") depuis la valeur initiale de 750s (8
    // colonnes/30s) -- 1500s (25min) pour world.cols = 200, soit 4 colonnes/30s. À réajuster
    // proportionnellement si world.cols change encore, pour garder cette même vitesse.
    // Chaque tour suivant est lapSpeedMultiplier fois plus rapide que le précédent (voir
    // Monsters.update) : racine de 2 par défaut, pour que le 3e tour (2 multiplications depuis le
    // 1er) soit exactement 2x plus rapide, donc 2x plus court.
    lapOneSeconds: 1500, // 25min (vitesse initiale moitié moindre qu'avant, demande utilisateur explicite)
    lapSpeedMultiplier: Math.SQRT2,
    // Position de départ de la horde (voir Monsters.init) -- demande utilisateur explicite :
    // positionner la horde pour que la FIN de la formation (le dernier gobelin, depth = depthCount-1)
    // démarre 20 colonnes à droite (donc déjà PASSÉE) de l'Entrepôt initial (world.startCol), au
    // lieu du front à la colonne 0 comme avant. Le front (plus avancé que la fin, voir depthCount/
    // depthSpacingFactor) démarre alors lui-même déjà passé l'Entrepôt -- il doit donc faire
    // presque un tour complet du cylindre pour l'atteindre : ≈150,7 colonnes à la vitesse initiale
    // (voir lapOneSeconds) donnent ≈1130s (18min50) avant le 1er contact désormais (vitesse divisée
    // par 2, demande utilisateur explicite -- ≈565s/9min25 avant ce changement).
    tailAheadOfWarehouseCols: 20,
    // Profondeur du bloc : depthCount monstres par rangée, qui avancent ensemble en formation
    // compacte plutôt qu'une simple ligne -- 45 = blockSize(15) x 3 blocs en colonnes. Dimension
    // purement formation/visuelle, déjà découplée du nombre réel de colonnes du monde (world.cols)
    // -- seule la position x résultante compte pour le jeu (voir Monsters.update).
    depthCount: 45,
    // Nombre de LIGNES de la horde (voir Monsters.init) -- 90 = blockSize(15) x 6 blocs en lignes.
    // Comme depthCount ci-dessus, dimension purement formation/visuelle, découplée du nombre réel
    // de rangées du monde (world.rows, 45) : demande utilisateur explicite -- plus de lignes de
    // monstres SANS agrandir le monde. Chaque ligne de formation est associée à une vraie rangée
    // du monde via Math.floor(displayRow * world.rows / rowCount) pour la destruction de case, le
    // brouillard de guerre et le ciblage des tours (voir Monsters.init/GameState) -- plusieurs
    // lignes de formation partagent donc la même vraie rangée (seule la première à l'atteindre
    // détruit quelque chose, comme pour depthCount/les colonnes).
    rowCount: 90,
    // Taille de chaque bloc de la grille de FORMATION (rowCount x depthCount, voir Monsters.init)
    // -- 15 : un Chef de guerre au centre de CHAQUE bloc (17 au total, grille 6 lignes x 3
    // colonnes, demande utilisateur explicite), sauf le bloc historique rowBlock===1/
    // depthBlock===1 qui garde le Seigneur de la horde (position inchangée depuis la grille 3x3
    // d'origine, demande utilisateur explicite de ne pas le déplacer). rowCount et depthCount
    // doivent rester des multiples de blockSize.
    blockSize: 15,
    // Espacement entre deux monstres consécutifs d'une même rangée (voir Monsters.init). Avec le
    // passage à une vraie image de gobelin (voir GameScene.redrawMonsters/js/assets.js), le
    // chevauchement volontairement serré d'avant (carrés unis, un chevauchement ne se voyait pas)
    // ferait se chevaucher des silhouettes détaillées -- demande utilisateur explicite : plus de
    // chevauchement du tout. sizeFactor (juste en dessous) reste strictement inférieur à cette
    // valeur pour garantir un petit espace visible entre deux gobelins consécutifs.
    depthSpacingFactor: 1.0, // fraction de hexSize.size
    // Espacement vertical AFFICHÉ entre deux lignes de monstres (voir GameScene.redrawMonsters),
    // en fraction de hexSize -- demande utilisateur explicite ("beaucoup plus proches, notamment
    // les lignes entre elles") : DÉCOUPLÉ de la vraie hauteur de rangée du monde (rowHeight =
    // hexSize*racine(3) ≈ 1.73*hexSize, utilisée avant), qui laissait un très grand vide entre
    // deux lignes. Purement visuel -- m.row reste la vraie rangée pour le jeu (fog/destruction de
    // case), seul l'AFFICHAGE se resserre ; la horde n'occupe donc plus toute la hauteur de la
    // carte, accepté explicitement par l'utilisateur ("pour l'instant"). Reste strictement
    // supérieur à sizeFactor (juste en dessous) pour ne pas réintroduire de chevauchement vertical.
    rowSpacingFactor: 0.95,
    // Taille du carré de chaque monstre (voir GameScene.redrawMonsters), en fraction de hexSize.
    // Doublée une seconde fois (demande utilisateur explicite), donc x4 au total par rapport à la
    // valeur d'origine (0.85) -- SAUF le Seigneur de la horde, dont le multiplicateur dédié
    // (sizeMultiplierByType.lord, voir GameScene.redrawMonsters) a été divisé par 2 en même temps
    // pour compenser et garder exactement sa taille absolue d'avant cette demande.
    sizeFactor: 3.4,
    // Vie de départ PAR TYPE de monstre (voir GameState.tickProduction, section tir de tour, pour
    // les dégâts infligés par un Donjon) -- demande utilisateur explicite : un gobelin simple meurt
    // en un seul tir (damage: 1 sur le Donjon), un Chef de guerre en résiste 3, le Seigneur de la
    // horde 10 (voir aussi GameScene.redrawMonsters : un monstre à hp < hpByType[m.type] est
    // affiché "blessé", couleur plus claire, pour qu'on distingue au coup d'œil ceux qui vont
    // mourir au prochain tir).
    hpByType: { goblin: 1, chief: 3, lord: 10 },
    // Chance qu'un monstre tué (par une tour, voir tickProduction/_maybeDropCorpse) laisse un
    // cadavre sur sa case -- voir resourceNodes.corpse/buildings.recycler, demande utilisateur.
    corpseDropChance: 0.1,
    // Régénération des Chefs de guerre (voir GameState, section tir de tour, et Monsters.update
    // pour le décompte) : délai FIXE, demande utilisateur explicite ("2 min"). Le Seigneur de la
    // horde, lui, ne régénère JAMAIS -- le tuer met fin à la partie (voir GameScene.update).
    chiefRespawnSeconds: 120,
    // Régénération des gobelins simples : délai ALÉATOIRE dans cette plage (demande utilisateur
    // explicite : "2 à 3 min"), mais ce délai ne démarre que lorsque le meneur (Chef ou Seigneur,
    // voir Monsters.init/leaderId) de leur zone est EN VIE -- un gobelin mort dont le meneur est
    // déjà mort ATTEND (sans décompte) que ce meneur réapparaisse avant que son propre délai ne
    // soit tiré et lancé (voir Monsters.update, demande utilisateur explicite).
    goblinRespawnSecondsRange: [120, 180],
    // Gèle le décompte de régénération (Chef ET gobelins) tant que la "section" (le groupe mené
    // par ce Chef, voir Monsters.markGroupUnderAttack/leaderId) reçoit des tirs -- demande
    // utilisateur explicite : "je veux que le compteur de respawn sois freeze tant que la section
    // est attaqué". Fenêtre glissante rafraîchie à CHAQUE tir reçu par un membre du groupe (voir
    // GameState, section tir de tour) plutôt qu'un simple "pendant le tir" instantané : supérieure
    // à fireInterval du Donjon (2s) pour qu'un tir répété garde la section gelée en continu, sans
    // laisser le décompte reprendre puis regeler entre deux tirs.
    underAttackFreezeSeconds: 4,
  },
};
