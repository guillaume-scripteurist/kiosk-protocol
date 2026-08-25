/**
 * Le QR de configuration porte un mot de passe, jamais un jeton. Ces tests
 * fixent ce que la borne accepte de lire, et ce qu'elle refuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeDeviceConfigQr,
  parseDeviceConfigQr,
  DeviceConfigQrVersionError,
  DEVICE_CONFIG_QR_VERSION,
} from '../dist/index.js';

test('aller-retour : ce qu\'on encode est ce qu\'on relit', () => {
  const qr = encodeDeviceConfigQr({
    serverUrl: 'https://kiosk.scripteurist.fr',
    password: 'phrase-de-passe',
  });
  assert.deepEqual(parseDeviceConfigQr(qr), {
    serverUrl: 'https://kiosk.scripteurist.fr',
    password: 'phrase-de-passe',
    target: null,
  });
});

test('la barre oblique finale est retirée des deux côtés', () => {
  // Sans cela, la borne construirait « https://x.fr//api/v1/… » : certains
  // mandataires l'acceptent, d'autres rendent un 404 très difficile à lire.
  const qr = encodeDeviceConfigQr({ serverUrl: 'https://x.fr///', password: 'p' });
  assert.equal(parseDeviceConfigQr(qr).serverUrl, 'https://x.fr');
});

test('la cible n\'est présente que si elle est utile', () => {
  // Un registre durable résout par le seul mot de passe ; un serveur de
  // soirées doit désigner la session, sans quoi une borne rejoindrait celle de
  // la semaine dernière.
  const sans = JSON.parse(encodeDeviceConfigQr({ serverUrl: 'https://x.fr', password: 'p' }));
  assert.equal(sans.g, undefined);

  const avec = encodeDeviceConfigQr({ serverUrl: 'https://x.fr', password: 'p', target: 'sess-1' });
  assert.equal(parseDeviceConfigQr(avec).target, 'sess-1');
});

test('un QR qui n\'est pas une configuration rend null, sans jeter', () => {
  for (const entree of [
    null,
    '',
    'https://exemple.fr',
    '{ pas du json',
    JSON.stringify({ v: 2, t: 'badge', c: 'MARIE7' }),
  ]) {
    assert.equal(parseDeviceConfigQr(entree), null);
  }
});

test('une version inconnue est un refus explicite', () => {
  const futur = JSON.stringify({ v: 99, t: 'kiosk-config', u: 'https://x.fr', p: 'p' });
  assert.throws(() => parseDeviceConfigQr(futur), DeviceConfigQrVersionError);
});

test('une URL sans schéma est refusée', () => {
  // La borne s'en servirait pour construire ses appels : « kiosk.fr/api » ne
  // désigne rien, et l'erreur n'apparaîtrait qu'au premier envoi de vidéo.
  const qr = JSON.stringify({
    v: DEVICE_CONFIG_QR_VERSION,
    t: 'kiosk-config',
    u: 'kiosk.scripteurist.fr',
    p: 'p',
  });
  assert.equal(parseDeviceConfigQr(qr), null);
});

test('un mot de passe vide est refusé', () => {
  const qr = JSON.stringify({
    v: DEVICE_CONFIG_QR_VERSION,
    t: 'kiosk-config',
    u: 'https://x.fr',
    p: '',
  });
  assert.equal(parseDeviceConfigQr(qr), null);
});
