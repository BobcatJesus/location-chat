import ModularAvatar from '../entities/ModularAvatar';

// Inside your Scene's create() or when a socket event fires for a new player:
const playerConfig = { body: 'male', outfit: 'tunic_green', hair: 'short' };

// Create the local player or a remote player
this.myAvatar = new ModularAvatar(this, 100, 100, playerConfig);

// Later in your update loop, if moving:
this.myAvatar.playAnimation('walk_down');
