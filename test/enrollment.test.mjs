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
  DeviceConfigQrServerKindError,
  DEVICE_CONFIG_QR_VERSION,
  pickDeviceSettings,
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
    serverKind: 'play',
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

test('la nature du serveur fait l\'aller-retour', () => {
  const qr = encodeDeviceConfigQr({ serverUrl: 'https://hub.fr', password: 'p', serverKind: 'hub' });
  assert.equal(JSON.parse(qr).s, 'hub');
  assert.equal(parseDeviceConfigQr(qr).serverKind, 'hub');
});

test('un QR v2 est encore lu, et vaut « play »', () => {
  // Les deux serveurs ne se déploient pas le même jour : une borne à jour doit
  // continuer de s'enrôler sur une instance play qui émet encore la v2.
  const v2 = JSON.stringify({ v: 2, t: 'kiosk-config', u: 'https://x.fr', p: 'p', g: 'sess-1' });
  assert.deepEqual(parseDeviceConfigQr(v2), {
    serverUrl: 'https://x.fr',
    password: 'p',
    target: 'sess-1',
    serverKind: 'play',
  });
});

test('un serveur de nature inconnue est un refus explicite', () => {
  // Retomber sur « play » enverrait la borne frapper des URL inexistantes, et
  // l'opérateur chercherait une panne de réseau devant un 404 muet.
  const qr = JSON.stringify({
    v: DEVICE_CONFIG_QR_VERSION, t: 'kiosk-config', u: 'https://x.fr', p: 'p', s: 'regie',
  });
  assert.throws(() => parseDeviceConfigQr(qr), DeviceConfigQrServerKindError);
});

test('le profil de borne ne laisse passer que les clés prévues', () => {
  const profil = pickDeviceSettings({
    KIOSK_MAX_DURATION: 90,
    KIOSK_TRANSCODE: false,
    KIOSK_ADMIN_KEY: 'secret',
    // Ce qui décrit la MACHINE et non l'événement ne se pousse pas.
    KIOSK_RECORDINGS_DIR: 'D:/videos',
    KIOSK_NAME: 'Salon',
    // Ni le résultat de l'enrôlement lui-même.
    GAME_DEVICE_TOKEN: 'vole',
    INVENTE: 'x',
  });
  assert.deepEqual(profil, {
    KIOSK_MAX_DURATION: '90',
    KIOSK_TRANSCODE: 'false',
    KIOSK_ADMIN_KEY: 'secret',
  });
});
