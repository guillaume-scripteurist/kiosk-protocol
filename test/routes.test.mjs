/**
 * La traduction des routes est le seul endroit qui sait que les deux serveurs
 * ne rangent pas leurs URL pareil. Ces tests fixent les deux formes : une
 * erreur ici ne se voit qu'en salle, le soir de l'installation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrollEndpoint, enrollBody, deviceEndpoints } from '../dist/index.js';

test('enrôlement : play désigne la session dans le chemin, hub dans le corps', () => {
  assert.equal(
    enrollEndpoint('play', 'https://play.fr/', 'sess-1'),
    'https://play.fr/api/sessions/sess-1/kiosks/enroll',
  );
  assert.equal(
    enrollEndpoint('hub', 'https://hub.fr', 'seminaire'),
    'https://hub.fr/api/v1/devices/enroll',
  );

  assert.deepEqual(enrollBody('play', { password: 'p', target: 'sess-1', name: 'Salon' }), {
    password: 'p',
    name: 'Salon',
  });
  assert.deepEqual(enrollBody('hub', { password: 'p', target: 'seminaire', name: 'Salon' }), {
    password: 'p',
    name: 'Salon',
    target: 'seminaire',
  });
});

test('la socket de régie n\'est pas au même chemin sur les deux serveurs', () => {
  assert.equal(deviceEndpoints('play', { serverUrl: 'https://play.fr', target: 's' }).websocket,
    'wss://play.fr/api/ws');
  assert.equal(deviceEndpoints('hub', { serverUrl: 'https://hub.fr' }).websocket,
    'wss://hub.fr/ws');
});

test('http reste ws — une borne de test tourne en clair sur le réseau local', () => {
  assert.equal(deviceEndpoints('play', { serverUrl: 'http://192.168.1.20:3000', target: 's' }).websocket,
    'ws://192.168.1.20:3000/api/ws');
});

test('le registre durable ne rend pas d\'annuaire', () => {
  // La borne doit pouvoir masquer « réservé à… » plutôt que d'afficher une
  // liste vide qu'aucun réessai ne remplira.
  assert.equal(deviceEndpoints('hub', { serverUrl: 'https://hub.fr' }).roster, null);
  assert.equal(deviceEndpoints('play', { serverUrl: 'https://play.fr', target: 's' }).roster,
    'https://play.fr/api/sessions/s/devices/roster');
});

test('dépôt vidéo : play signe en un temps, hub en deux', () => {
  const play = deviceEndpoints('play', { serverUrl: 'https://play.fr', target: 's' }).video;
  assert.equal(play.oneShot, true);
  assert.equal(play.create, 'https://play.fr/api/sessions/s/kiosk/videos/sign');
  assert.equal(play.uploaded('e1'), 'https://play.fr/api/sessions/s/kiosk/videos/e1/uploaded');
  assert.equal(play.status('e1'), 'https://play.fr/api/sessions/s/kiosk/videos/e1');

  const hub = deviceEndpoints('hub', { serverUrl: 'https://hub.fr' }).video;
  assert.equal(hub.oneShot, false);
  assert.equal(hub.create, 'https://hub.fr/api/v1/recordings');
  assert.equal(hub.ticket('r1'), 'https://hub.fr/api/v1/recordings/r1/ticket');
  assert.equal(hub.uploaded('r1'), 'https://hub.fr/api/v1/recordings/r1/uploaded');
  assert.equal(hub.status('r1'), 'https://hub.fr/api/v1/recordings/r1');
});

test('un identifiant exotique ne sort pas de son segment d\'URL', () => {
  const hub = deviceEndpoints('hub', { serverUrl: 'https://hub.fr' }).video;
  assert.equal(hub.status('../campaigns'), 'https://hub.fr/api/v1/recordings/..%2Fcampaigns');
});
