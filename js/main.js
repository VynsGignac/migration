// ============================================================
// POINT D'ENTRÉE DU JEU
// Crée la fenêtre de jeu Phaser et lance la scène principale.
// ============================================================

const gameConfigPhaser = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: GameConfig.colors.background,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  input: {
    activePointers: 3, // permet de détecter 2 doigts en même temps (pour pincer et zoomer)
  },
  scene: [GameScene],
};

const game = new Phaser.Game(gameConfigPhaser);
