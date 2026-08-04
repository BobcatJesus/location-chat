
import React, { useState } from 'react';
import RetroAuthModal from './RetroAuthModal';
import SpatialCanvas from './SpatialCanvas'; // Your Phaser/Canvas component

export default function App() {
  const [currentView, setCurrentView] = useState('menu'); // 'menu' or 'room'
  const [activeRoom, setActiveRoom] = useState(null);

  // Triggered when user clicks "Enter" on a realm
  const handleEnterRoom = (room) => {
    setActiveRoom(room);
    setCurrentView('room'); // This exits the location options page!
  };

  return (
    <div className="side-quest-app">
      {currentView === 'menu' ? (
        <div className="overworld-container">
          <header>
            <h1>SIDE QUEST</h1>
            <h2>The Lost Overworld</h2>
          </header>

          <div className="realm-selection">
            <h3>CHOOSE YOUR REALM</h3>
            {/* Example room click handler */}
            <button onClick={() => handleEnterRoom({ id: 'downtown', name: 'Downtown Plaza' })}>
              Enter Downtown Plaza
            </button>
          </div>
        </div>
      ) : (
        /* Top-down 2D retro canvas view where avatars spawn and chat */
        <SpatialCanvas room={activeRoom} onLeave={() => setCurrentView('menu')} />
      )}
    </div>
  );
}


