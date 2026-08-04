// src/components/GameCanvas.jsx
import React, { useEffect } from 'react';
import Phaser from 'phaser';

export default function GameCanvas({ playerConfig }) {
    useEffect(() => {
        // Pass playerConfig into your Phaser game instance data registry
        const config = {
            type: Phaser.AUTO,
            parent: 'phaser-game',
            // ... other phaser settings ...
            callbacks: {
                preBoot: (game) => {
                    game.registry.set('playerConfig', playerConfig);
                }
            }
        };

        const game = new Phaser.Game(config);

        return () => {
            game.destroy(true);
        };
    }, [playerConfig]);

    return <div id="phaser-game" style={{ width: '100vw', height: '100vh' }} />;
}
