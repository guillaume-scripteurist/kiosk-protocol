/**
 * Le badge signé remplace le sondage de l'annuaire. C'est ce qui permet à une
 * borne de reconnaître quelqu'un SANS réseau et SANS connaître personne.
 *
 * Ces tests fixent ce qu'elle doit accepter, ce qu'elle doit refuser, et — au
 * moins aussi important — ce qu'elle ne doit pas faire tomber en essayant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  signBadge,
  verifyBadge,
  parseBadge,
  BadgeVersionError,
  BADGE_QR_VERSION,
} from '../dist/index.js';

const SECRET = 'secret-de-campagne';

test('un badge signé se vérifie avec le secret de sa campagne', async () => {
  const qr = await signBadge({ code: 'MARIE7', expiresAt: null }, SECRET);
  const { badge, rejection } = await verifyBadge(qr, SECRET);
  assert.equal(rejection, null);
  assert.equal(badge.code, 'MARIE7');
});

test('le badge d\'une autre campagne est refusé', async () => {
  // Deux événements en parallèle dans le même lieu : sans ce refus, les
  // participants de l'un enregistreraient sur les bornes de l'autre.
  const qr = await signBadge({ code: 'MARIE7', expiresAt: null }, SECRET);
  const { badge, rejection } = await verifyBadge(qr, 'un-autre-secret');
  assert.equal(badge, null);
  assert.equal(rejection, 'bad-signature');
});

test('un badge périmé est refusé, et le motif le dit', async () => {
  // « Badge périmé » et « badge d'une autre campagne » n'appellent pas le même
  // geste. Les confondre envoie chercher au mauvais endroit.
  const qr = await signBadge({ code: 'MARIE7', expiresAt: 1000 }, SECRET);
  const { rejection } = await verifyBadge(qr, SECRET, 2000);
  assert.equal(rejection, 'expired');
});

test('un badge encore valable passe', async () => {
  const qr = await signBadge({ code: 'MARIE7', expiresAt: 5000 }, SECRET);
  const { rejection } = await verifyBadge(qr, SECRET, 2000);
  assert.equal(rejection, null);
});

test('l\'expiration est vérifiée APRÈS la signature', async () => {
  // Sinon la borne renseignerait sur la validité d'un badge fabriqué de toutes
  // pièces : « périmé » dirait que le code existe, « signature » que non.
  const faux = JSON.stringify({ v: BADGE_QR_VERSION, t: 'badge', c: 'INVENTE', e: 1, s: 'nawak' });
  const { rejection } = await verifyBadge(faux, SECRET, 999999);
  assert.equal(rejection, 'bad-signature');
});

test('un badge non signé est distingué d\'un badge mal signé', async () => {
  // Le premier arrive en mode `resolve`, où c'est normal ; le second est une
  // tentative. La borne ne doit pas les traiter pareil.
  const nonSigne = JSON.stringify({ v: BADGE_QR_VERSION, t: 'badge', c: 'MARIE7', e: 0 });
  assert.equal((await verifyBadge(nonSigne, SECRET)).rejection, 'unsigned');
});

test('la modification du code invalide la signature', async () => {
  const qr = await signBadge({ code: 'MARIE7', expiresAt: null }, SECRET);
  const trafique = qr.replace('MARIE7', 'PAUL42');
  assert.equal((await verifyBadge(trafique, SECRET)).rejection, 'bad-signature');
});

test('repousser l\'expiration invalide la signature', async () => {
  // L'expiration est DANS la charge signée. Sans cela, un badge périmé se
  // rallongerait à la main en éditant un chiffre.
  const qr = await signBadge({ code: 'MARIE7', expiresAt: 1000 }, SECRET);
  const trafique = qr.replace('"e":1000', '"e":99999999999');
  assert.equal((await verifyBadge(trafique, SECRET)).rejection, 'bad-signature');
});

test('parseBadge ne jette jamais sur ce qui n\'est pas un badge', () => {
  // La borne passe ici le contenu de TOUT QR décodé : menu de restaurant,
  // ticket de caisse, badge d'un autre système. Une exception ferait tomber le
  // scan pour tout le monde, et pas seulement pour le QR fautif.
  for (const entree of [
    null,
    undefined,
    '',
    'https://exemple.fr',
    'MARIE7',
    '{ pas du json',
    '{}',
    '[]',
    JSON.stringify({ v: 2, t: 'kiosk-config', u: 'https://x.fr', p: 'mdp' }),
  ]) {
    assert.equal(parseBadge(entree), null, `entrée refusée bruyamment : ${entree}`);
  }
});

test('une version inconnue est un refus EXPLICITE, pas un null', () => {
  // La borne doit pouvoir dire « ce badge vient d'un serveur plus récent »
  // plutôt qu'afficher « badge non reconnu » à quelqu'un qui présente
  // exactement le bon.
  const futur = JSON.stringify({ v: 99, t: 'badge', c: 'MARIE7', e: 0, s: 'x' });
  assert.throws(() => parseBadge(futur), BadgeVersionError);
});

test('parseBadge lit un badge non signé — c\'est le mode resolve', () => {
  const brut = JSON.stringify({ v: BADGE_QR_VERSION, t: 'badge', c: 'MARIE7', e: 0 });
  const lu = parseBadge(brut);
  assert.equal(lu.code, 'MARIE7');
  assert.equal(lu.signature, null);
  assert.equal(lu.expiresAt, null);
});

test('signer sans secret ou sans code est refusé', async () => {
  await assert.rejects(() => signBadge({ code: 'MARIE7', expiresAt: null }, ''), /Secret/);
  await assert.rejects(() => signBadge({ code: '  ', expiresAt: null }, SECRET), /Code/);
});

test('la signature est stable pour un même badge', async () => {
  // Un badge réimprimé doit être le même badge : sinon le premier cesserait de
  // fonctionner sans que personne ne l'ait décidé.
  const a = await signBadge({ code: 'MARIE7', expiresAt: 42 }, SECRET);
  const b = await signBadge({ code: 'MARIE7', expiresAt: 42 }, SECRET);
  assert.equal(a, b);
});
