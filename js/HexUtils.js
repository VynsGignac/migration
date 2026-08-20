// ============================================================
// OUTILS MATHÉMATIQUES POUR LA GRILLE HEXAGONALE
// Hexagones "flat-top" (côté plat en haut/bas), coordonnées "offset" (col, row).
// col = colonne (boucle horizontalement autour du cylindre)
// row = rangée (ne boucle jamais verticalement)
//
// On utilise des coordonnées "offset" (et non "axiales") car elles gardent
// les rangées bien horizontales même après un tour complet du cylindre.
// Avec des coordonnées axiales classiques, les rangées se décaleraient de
// plus en plus vers le haut ou le bas au fil des colonnes.
// ============================================================

const HexUtils = {

  // Hauteur (en pixels) entre deux rangées consécutives. ARRONDIE à l'entier le plus proche
  // (plutôt que size*sqrt(3), qui est irrationnel) : la texture du fond de carte (voir
  // GameScene.createTerrainTileSprite) doit se répéter sur un nombre entier de pixels pour
  // paver sans coutures, et TOUT ce qui positionne quelque chose sur la grille (bâtiments,
  // sélection, monstres, worldHeightPx...) doit utiliser exactement cette même valeur — sinon
  // le fond et le reste dérivent l'un de l'autre de plus en plus au fil des rangées (bug vécu :
  // l'icône d'un bâtiment loin de la rangée 0 finissait visiblement décalée de la grille).
  rowHeight(size) {
    return Math.round(size * Math.sqrt(3));
  },

  // Convertit une coordonnée de case (col, row) en position pixel (x, y)
  offsetToPixel(col, row, size) {
    const x = size * 1.5 * col;
    const rowShift = (((col % 2) + 2) % 2 !== 0) ? 0.5 : 0; // une colonne sur deux est décalée verticalement
    const y = this.rowHeight(size) * (row + rowShift);
    return { x, y };
  },

  // Largeur en pixels d'un tour complet du cylindre (utile pour le "wrap")
  worldPixelWidth(worldCols, size) {
    return size * 1.5 * worldCols;
  },

  // Renvoie les 6 sommets d'un hexagone flat-top centré en (cx, cy)
  corners(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i);
      pts.push({
        x: cx + size * Math.cos(angle),
        y: cy + size * Math.sin(angle),
      });
    }
    return pts;
  },

  // Ramène une colonne dans l'intervalle [0, worldCols) même si elle est négative ou trop grande
  wrapCol(col, worldCols) {
    return ((col % worldCols) + worldCols) % worldCols;
  },

  // Renvoie les 6 cases voisines de (col, row) sur la grille "offset" (colonnes impaires décalées vers le bas).
  // Le motif de voisinage change selon la parité de la colonne : voir redblobgames.com/grids/hexagons ("odd-q").
  neighbors(col, row) {
    const evenColDirs = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]];
    const oddColDirs = [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const dirs = (((col % 2) + 2) % 2 === 0) ? evenColDirs : oddColDirs;
    return dirs.map(([dc, dr]) => ({ col: col + dc, row: row + dr }));
  },

  // Toutes les cases à au plus `range` pas de (col, row) (elle incluse), par expansion BFS.
  // On garde les colonnes "non wrappées" pendant l'expansion (la parité col%2, dont dépend
  // neighbors(), est préservée par wrapCol tant que worldCols est pair) et on ne wrap qu'à
  // la sortie, pour renvoyer des coordonnées directement utilisables comme clés de tuile.
  hexesInRange(col, row, range, worldCols, worldRows) {
    const visited = new Set([col + ',' + row]);
    const result = [{ col: this.wrapCol(col, worldCols), row }];
    let frontier = [{ col, row }];

    for (let step = 0; step < range; step++) {
      const next = [];
      for (const cur of frontier) {
        for (const n of this.neighbors(cur.col, cur.row)) {
          if (n.row < 0 || n.row >= worldRows) continue;
          const dedupeKey = n.col + ',' + n.row;
          if (visited.has(dedupeKey)) continue;
          visited.add(dedupeKey);
          result.push({ col: this.wrapCol(n.col, worldCols), row: n.row });
          next.push(n);
        }
      }
      frontier = next;
    }
    return result;
  },

  // Convertit une position pixel (x, y) en coordonnée de case (col, row) la plus proche.
  // Utilisé pour savoir sur quelle case le joueur a tapé/cliqué.
  // (On teste les cases voisines candidates et on garde celle dont le centre est le plus proche :
  // plus simple et tout aussi fiable qu'une formule d'arrondi hexagonal complexe.)
  pixelToOffset(x, y, size) {
    const approxCol = x / (size * 1.5);
    const baseCol = Math.floor(approxCol);

    let best = null;
    let bestDist = Infinity;

    for (let dc = -1; dc <= 1; dc++) {
      const col = baseCol + dc;
      const rowShift = (((col % 2) + 2) % 2 !== 0) ? 0.5 : 0;
      const approxRow = (y / this.rowHeight(size)) - rowShift;
      const baseRow = Math.floor(approxRow);
      for (let dr = -1; dr <= 1; dr++) {
        const row = baseRow + dr;
        const center = this.offsetToPixel(col, row, size);
        const dist = (center.x - x) ** 2 + (center.y - y) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = { col, row };
        }
      }
    }
    return best;
  },
};
