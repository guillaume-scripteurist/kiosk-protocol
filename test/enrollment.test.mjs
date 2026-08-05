/**
 * Le QR de configuration passe par le MÊME chemin que tous les autres QR
 * scannés par une borne : badges joueurs, menus de restaurant, tickets de
 * caisse. Ces tests portent surtout sur ce que le lecteur doit ignorer sans
 * broncher — une exception ici couperait le scan pour toute la salle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeKioskConfigQr,
  parseKioskConfigQr,
  KioskConfigQrVersionError,
  KIOSK_CONFIG_QR_VERSION,
} from '../dist/index.js';

const valide = {
  serverUrl: 'https://play.scripteurist.fr',
  gameId: '3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6070',
  password: 'soiree-du-5-aout',
};

test('un QR encodé se relit à l\'identique', () => {
  assert.deepEqual(parseKioskConfigQr(encodeKioskConfigQr(valide)), valide);
});

test('la barre oblique finale du serveur est retirée des deux côtés', () => {
  // Sinon on construit des URL en `https://serveur//api/…`, que certains
  // mandataires renvoient en 404 sans que la cause saute aux yeux.
  const encode = encodeKioskConfigQr({ ...valide, serverUrl: 'https://play.exemple.fr///' });
  assert.equal(JSON.parse(encode).u, 'https://play.exemple.fr');
  assert.equal(parseKioskConfigQr(encode).serverUrl, 'https://play.exemple.fr');
});

test('tout ce qui n\'est pas un QR de configuration rend null, sans jeter', () => {
  const autres = [
    'https://play.scripteurist.fr/j/DFG3P',                    // badge joueur, code court
    'https://play.scripteurist.fr/<uuid>/<token>',             // badge joueur, URL longue
    'DFG3P',                                                   // code court seul
    'a'.repeat(32),                                            // jeton seul
    '{"gameId":"x","token":"y","pseudo":"Marie"}',             // badge joueur en JSON
    'https://menu-du-restaurant.example/carte',
    '',
    '   ',
    'texte quelconque',
    '{ ceci n\'est pas du json',
    '{}',
    'null',
    '[]',
  ];
  for (const texte of autres) {
    assert.equal(parseKioskConfigQr(texte), null, `« ${texte} » aurait dû être ignoré`);
  }
});

test('les entrées non textuelles ne font pas tomber le scan', () => {
  for (const valeur of [null, undefined, 42, {}, [], true]) {
    assert.equal(parseKioskConfigQr(valeur), null);
  }
});

test('un QR de configuration incomplet est ignoré', () => {
  // Mieux vaut ignorer qu'appliquer une configuration à moitié : une borne
  // pointée sur un serveur sans session est plus difficile à diagnostiquer
  // qu'une borne qui n'a rien fait.
  const cas = [
    { v: 1, t: 'kiosk-config', u: '', g: 'x', p: 'y' },
    { v: 1, t: 'kiosk-config', u: 'https://x', g: '', p: 'y' },
    { v: 1, t: 'kiosk-config', u: 'https://x', g: 'y', p: '' },
    // Une URL sans schéma : `new URL()` la refuserait plus tard, mais le refus
    // se produirait après que la borne a affiché un écran de confirmation.
    { v: 1, t: 'kiosk-config', u: 'play.exemple.fr', g: 'y', p: 'z' },
  ];
  for (const c of cas) assert.equal(parseKioskConfigQr(JSON.stringify(c)), null);
});

test('une version inconnue est signalée, pas confondue avec un QR illisible', () => {
  // La personne vient de scanner exactement le bon QR : lui afficher « QR non
  // reconnu » l'enverrait chercher un problème là où il n'y en a pas.
  const futur = JSON.stringify({ v: 99, t: 'kiosk-config', u: 'https://x', g: 'y', p: 'z' });
  assert.throws(() => parseKioskConfigQr(futur), KioskConfigQrVersionError);
  try {
    parseKioskConfigQr(futur);
  } catch (err) {
    assert.equal(err.version, 99);
    assert.match(err.message, new RegExp(`version ${KIOSK_CONFIG_QR_VERSION}`));
  }
});

test('le QR ne contient jamais de jeton admin', () => {
  // Garde-fou de conception : un QR s'affiche sur un écran et se photographie.
  // Le jeton admin pilote TOUTES les bornes de la session et donne l'annuaire
  // des joueurs ; il ne doit pas s'y trouver, même par inadvertance.
  // v = version, t = type, u = url du serveur, g = session, p = mot de passe.
  const champs = Object.keys(JSON.parse(encodeKioskConfigQr(valide)));
  assert.deepEqual(champs.sort(), ['g', 'p', 't', 'u', 'v']);
});
