// ============================================================
// CONFIGURATION DU JEU
// Modifie ces valeurs pour ajuster le jeu sans toucher au reste du code.
// ============================================================

const GameConfig = {
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
    cols: 500,
    // Nombre de rangées de cases en hauteur (le monde NE boucle PAS verticalement)
    rows: 23,
    // Colonne de départ de l'Entrepôt initial : assez loin devant la vague (qui démarre à la colonne 0)
    // pour laisser au joueur le temps de construire avant qu'elle n'arrive. À la moitié du tour
    // (250/500) : la vague met 20 min à l'atteindre pour un 1er tour de 40 min (voir
    // monsters.lapOneSeconds, vitesse divisée par 2 -- demande utilisateur) -- ce ratio doit être
    // conservé si l'un des deux change.
    startCol: 250,
  },
  camera: {
    // zoomMin est un garde-fou absolu (jamais une valeur "confortable" à atteindre en pratique) :
    // le vrai zoom minimum utilisable est calculé dynamiquement (GameScene.getEffectiveZoomMin)
    // pour toujours montrer exactement les 22 rangées du monde, quelle que soit la hauteur d'écran.
    zoomMin: 0.05,
    zoomMax: 2.0,
    zoomStart: 1,
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
    // Monstre blessé (hp < monsters.startingHp, voir GameScene.redrawMonsters) : teinte plus
    // claire/orangée pour rester lisible à la taille minuscule d'un monstre sans dépendre d'une
    // jauge ou d'une icône séparée -- demande utilisateur explicite.
    monsterWounded: 0xffb347,
  },
  resources: {
    // Stock de départ, volontairement généreux : les premiers blobs de ressources peuvent être
    // loin de l'Entrepôt de départ (voir world.cols/resourceNodes.startClearance). Ce coussin doit suffire à
    // lancer les deux chaînes (bois et pierre) et reconstruire un Entrepôt sans jamais bloquer.
    // codex modeste (voir demande utilisateur) : les Codex se récupèrent maintenant pour de vrai
    // sur les cadavres de monstres recyclés (voir buildings.recycler, 10 par cadavre) -- un petit
    // coussin de départ suffit à lancer les premières recherches avant d'avoir un Recycleur actif.
    starting: { wood: 0, planks: 100, stone: 0, stoneBlocks: 30, ore: 0, codex: 50 },
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
    // Introduit par la techno Tunnelier (voir techTree.nodes.ind_tunnelier) : pas encore de
    // bâtiment qui la consomme, s'accumule simplement dans le stock central pour l'instant.
    ore: { long: 'Minerai', short: 'Minerai', color: 0x8a6d4f },
    // Monnaie des recherches (voir techTree.researchCostPerLevel), globale et jamais transportée
    // sur les routes (directement dépensée/gagnée dans le stock central) : récupérée en recyclant
    // des cadavres de monstres (voir buildings.recycler, 10 Codex par cadavre, 20 avec Imprimerie
    // -- voir techTree.nodes.rec_imprimerie). Le stock de départ (voir resources.starting) n'est
    // qu'un petit coussin pour les toutes premières recherches.
    codex: { long: 'Codex', short: 'Codex', color: 0x6f5fa3 },
  },
  // Transport des ressources le long des routes.
  logistics: {
    shipSpeed: 2, // cases par seconde
    shipBatchSize: 3, // quantité expédiée par voyage
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
  // colonnes, ~1 blob de pierre/10 colonnes), doublée (voir demande utilisateur : deux fois plus
  // de ressource sur la carte), puis mise à l'échelle du nombre de colonnes actuel (voir
  // world.cols : ces comptes sont pour 500 colonnes -- à ajuster proportionnellement si world.cols
  // change encore, sous peine de densité deux fois trop faible/forte).
  resourceNodes: {
    tree: { color: 0x1f6b3a, amountMin: 20, amountMax: 40 },
    stone: { color: 0x767a80, amountMin: 25, amountMax: 50 },
    // Le blé n'apparaît pas en blobs au démarrage : ce sont les Fermes qui le plantent
    // elles-mêmes autour d'elles (voir buildings.farm.plants). amountMax sert quand même
    // au calcul de l'opacité (case bien mûre vs. presque récoltée).
    wheat: { color: 0xdbc245, amountMin: 8, amountMax: 8 },
    // Cadavre de monstre (voir buildings.recycler/demande utilisateur) : amount toujours 1 --
    // "une ressource donne un codex", pas un stock qui s'épuise progressivement comme les autres.
    // edgeRowMargin (demande utilisateur explicite) : aucun cadavre posé à la génération du monde
    // dans les 5 premières/dernières rangées (voir GameState._spawnSingleTiles) -- ne concerne
    // QUE cette génération de départ, pas ceux laissés par un monstre tué (_maybeDropCorpse).
    corpse: { color: 0x6b1f3a, amountMin: 1, amountMax: 1, edgeRowMargin: 5 },
    blobCountTree: 150,
    blobCountStone: 100,
    blobSizeMin: 4,
    blobSizeMax: 9,
    // Aucun blob ne peut apparaître à moins de cette distance (en colonnes) de l'Entrepôt de départ.
    startClearance: 4,
    // Cadavre de monstre : PAS un blob (voir _spawnSingleTiles) -- une case isolée et rare,
    // dispersée sur toute la carte. Cible ~1 par écran plein à dézoom maximum (le monde montre
    // toujours ses 23 rangées en hauteur, voir GameScene.getEffectiveZoomMin ; sur un écran 16:9
    // typique ça correspond à environ 45 colonnes visibles) : 500 colonnes / 45 ≈ 11.
    corpseCount: 11,
  },
  // Regroupe les bâtiments par onglet dans le menu de construction (voir GameScene.layoutHud/
  // activeBuildCategory) : la liste à plat est devenue trop longue pour tenir sans scroller une
  // fois la Tour de Guet ajoutée (voir demande utilisateur). L'ordre des clés = l'ordre des
  // onglets ; l'ordre de "ids" = l'ordre dans la liste de cet onglet. Château n'y figure pas : il
  // ne se construit pas depuis ce menu (voir buildings.castle).
  buildingCategories: {
    production: { label: 'Production', ids: ['lumberjackCamp', 'sawmill', 'minerCamp', 'stonecutter', 'farm', 'bakery', 'recycler'] },
    civil: { label: 'Civil', ids: ['warehouse', 'university', 'house'] },
    defense: { label: 'Défense', ids: ['donjon', 'watchtower'] },
    route: { label: 'Route', ids: ['road'] },
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
      linkTargets: ['sawmill'], linkRange: 6,
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
      linkTargets: ['stonecutter'], linkRange: 6,
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
    warehouse: {
      name: 'Entrepôt', cost: { planks: 15, stoneBlocks: 8 }, color: 0xffd23f,
      ruinLoot: { planks: 8, stoneBlocks: 4 },
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
    // Camp de Bûcheron/Mineur, voir tickProduction), MAIS sans linkTargets ni outputBuffer : le
    // Codex ne se transporte jamais sur les routes (voir resourceLabels.codex) -- dès qu'une case
    // de cadavre est entièrement épuisée, 10 Codex sont versés d'un coup au stock central (20 avec
    // une chance liée à Imprimerie, voir techTree.nodes.rec_imprimerie), cas spécial dans
    // tickProduction juste après celui du Tunnelier/minerai. extractRate = 1/60 : un cadavre
    // (amount toujours 1) prend environ 1 minute à recycler à pleine main-d'œuvre.
    recycler: {
      // 25 % de 3 planches (0,75, arrondi à 1) transféré en pierre taillée, en plus de son coût
      // en pierre taillée déjà existant.
      name: 'Recycleur', cost: { planks: 2, stoneBlocks: 4 }, color: 0x6b1f3a,
      kind: 'extractor', resource: 'corpse', outputResource: 'codex',
      extractRadius: 3, extractRate: 1 / 60, outputCap: 3,
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
    // kind: 'tower' => tire sur un monstre à portée (range, cases) toutes les fireInterval
    // secondes à pleine main-d'œuvre (même système que les extracteurs/processeurs : un
    // travailleur affecté = plein régime, sinon le délai entre deux tirs double). N'est actif
    // que s'il touche une route (voir GameState._hasAdjacentRoad) : un Donjon posé isolé ne
    // tire pas, il faut le relier au réseau.
    donjon: {
      // Coût divisé par 2 (demande utilisateur explicite) par rapport à l'original (planks: 20,
      // stoneBlocks: 15) : moitié de 15 arrondie à 8 pour un chiffre entier propre plutôt que 7.5.
      name: 'Donjon', cost: { planks: 10, stoneBlocks: 8 }, color: 0x5a2a3a,
      kind: 'tower', range: 4, fireInterval: 2, damage: 1,
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
    // Coût d'une recherche, par niveau acheté (1er niveau = 1x, 2e = 2x, etc.), avant la réduction
    // de Scolarisation (voir GameState.researchCostFor/techTree.nodes.rec_scolarisation) — identique
    // pour tous les nœuds de l'arbre, quelle que soit leur branche. En Codex (voir resourceLabels.
    // codex) : stock de départ énorme pour l'instant (voir resources.starting), donc ce montant
    // n'a presque aucun effet tant que le vrai gain de Codex (cadavres de monstres) n'existe pas.
    researchCostPerLevel: { codex: 10 },
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
        description: 'Réduit de 10 % / 20 % / 30 % le coût en Codex de toute recherche (celle-ci comprise).',
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
        // donne normalement 10 Codex d'un coup ; avec cette techno, une chance de DOUBLER ce gain
        // (20 au lieu de 10) -- pas un simple +1 (demande utilisateur explicite, corrige la
        // version précédente).
        description: 'Lors du recyclage d\'un cadavre de monstre (voir buildings.recycler), 10 % de chances de doubler le Codex obtenu (20 au lieu de 10).',
        codexChance: 0.10,
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
    // processeurs (Scierie/Tailleur de pierre/Boulangerie) et les tours.
    efficiencyByWorkers: [0.5, 0.65, 0.8, 0.9, 1],
    // Même principe, mais pour les bâtiments de PRODUCTION BRUTE (extracteurs : Camp de
    // Bûcheron/Mineur, Ferme -- PAS les processeurs de raffinage, voir efficiencyByWorkers
    // ci-dessus) : 100 % atteint à 3 travailleurs au lieu de 4 (demande utilisateur explicite).
    // Courbe à progression décroissante analogue, juste recalée sur 3 paliers plutôt que 4.
    efficiencyByWorkersExtractor: [0.5, 0.7, 0.85, 1],
  },
  // La horde de monstres : un bloc dense de petits monstres individuels (carrés, voir
  // GameScene.drawMonster) qui avancent chacun en ligne droite, à vitesse constante, sans
  // contourner aucun obstacle ni suivre la grille hexagonale — ils traversent (et détruisent)
  // tout ce qui se trouve sur leur passage. Aucune interaction du joueur avec eux pour l'instant
  // (pas d'attaque) : la seule chose qui compte est "un monstre qui passe sur une case la détruit".
  monsters: {
    // Vitesse PROGRESSIVE (voir demande utilisateur) : le 1er tour complet du cylindre dure
    // lapOneSeconds: à ce rythme, le front met world.startCol / world.cols * lapOneSeconds pour
    // atteindre l'Entrepôt de départ (20 min avec startCol au milieu du monde, voir world.startCol).
    // Chaque tour suivant est lapSpeedMultiplier fois plus rapide que le précédent (voir
    // Monsters.update) : racine de 2 par défaut, pour que le 3e tour (2 multiplications depuis le
    // 1er) soit exactement 2x plus rapide, donc 2x plus court (40 min -> 20 min).
    // Doublé (donc vitesse divisée par 2, demande utilisateur explicite) par rapport à la valeur
    // d'origine (1200s/20min) -- ce doublement s'applique uniformément à TOUS les tours (voir
    // Monsters.update : speedCols = cols/lapOneSeconds, un facteur constant), pas seulement au 1er.
    lapOneSeconds: 2400, // 40 minutes (vitesse divisée par 2)
    lapSpeedMultiplier: Math.SQRT2,
    // Profondeur du bloc : depthCount monstres par rangée, qui avancent ensemble en formation
    // compacte plutôt qu'une simple ligne.
    depthCount: 20,
    // Espacement entre deux monstres consécutifs d'une même rangée (voir Monsters.init) : plus
    // petit que la largeur d'une case pour que le bloc ait l'air d'une horde tassée plutôt que
    // d'un quadrillage clairsemé. Indépendant de la largeur de case réelle utilisée pour détecter
    // le franchissement des colonnes (Monsters.update) : ceci n'affecte que le rendu/l'espacement.
    depthSpacingFactor: 0.8, // fraction de hexSize.size
    // Taille du carré de chaque monstre (voir GameScene.redrawMonsters), en fraction de hexSize.
    // Assez grand pour presque se toucher horizontalement (avec depthSpacingFactor) et verticalement
    // (avec la hauteur d'une rangée) : c'est ça qui donne l'effet de horde compacte.
    sizeFactor: 1.3,
    // Vie de départ de chaque monstre (voir GameState.tickProduction, section tir de tour, pour
    // les dégâts infligés par un Donjon) -- demande utilisateur explicite (voir aussi
    // GameScene.redrawMonsters : un monstre à hp < startingHp est affiché "blessé", couleur plus
    // claire, pour qu'on distingue au coup d'œil ceux qui vont mourir au prochain tir).
    startingHp: 2,
    // Chance qu'un monstre tué (par une tour, voir tickProduction/_maybeDropCorpse) laisse un
    // cadavre sur sa case -- voir resourceNodes.corpse/buildings.recycler, demande utilisateur.
    corpseDropChance: 0.1,
  },
};
