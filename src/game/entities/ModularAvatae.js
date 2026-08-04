import Phaser from 'phaser';

export default class ModularAvatar extends Phaser.GameObjects.Container {
    constructor(scene, x, y, playerConfig) {
        super(scene, x, y);

        // 1. Create individual sprite layers using the player's config choices
        this.bodySprite = scene.add.sprite(0, 0, `body_${playerConfig.body || 'male'}`);
        this.outfitSprite = scene.add.sprite(0, 0, `outfit_${playerConfig.outfit || 'default'}`);
        this.hairSprite = scene.add.sprite(0, 0, `hair_${playerConfig.hair || 'short'}`);

        // Optional tinting if you use grayscale base assets
        if (playerConfig.hairColor) {
            this.hairSprite.setTint(playerConfig.hairColor);
        }

        // Add layers to the container so they move and stay grouped together
        this.add([this.bodySprite, this.outfitSprite, this.hairSprite]);

        scene.add.existing(this);
    }

    // Helper method to sync and play animations across all layers simultaneously
    playAnimation(animKey) {
        const layers = [this.bodySprite, this.outfitSprite, this.hairSprite];
        layers.forEach(sprite => {
            const textureKey = sprite.texture.key;
            // Assumes your animations are named like "walk_down_body", "walk_down_outfit", etc.
            const fullAnimKey = `${animKey}_${textureKey.split('_')[0]}`;
            if (sprite.anims && sprite.scene.anims.exists(fullAnimKey)) {
                sprite.anims.play(fullAnimKey, true);
            }
        });
    }

    // Update position (useful for interpolating other players' movements via Socket.io)
    updatePosition(x, y) {
        this.setPosition(x, y);
    }
}
